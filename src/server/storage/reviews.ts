import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  idSchema,
  integrationCandidateSchema,
  reviewResultSchema,
  reviewSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import type { IntegrationPreview } from "../../shared/integration.ts";
import { worktreeEvidenceSchema } from "../../shared/worktrees.ts";
import {
  getIntegrationCandidate,
  listIntegrationCandidates,
} from "./candidates.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
import {
  implementationLineage,
  implementationTask,
  revisionAncestors,
  revisionTaskIds,
} from "./revisions.ts";
import type { Store } from "./store.ts";

const createSchema = z.strictObject({
  reviewerAttemptId: idSchema,
  result: reviewResultSchema,
});

// Tool submissions stay provisional in the journal. Only native completion
// with a clean candidate checkout may turn one into a durable review, in the
// same transaction that completes the attempt. Failed/recovered work is never
// adopted automatically, and no API accepts caller-supplied candidate linkage.
export function createReview(store: Store, input: unknown, key: string) {
  const data = createSchema.parse(input);
  return mutate(store.db, key, "createReview", data, reviewSchema, () => {
    const attempt = store.getAttempt(data.reviewerAttemptId);
    const task = store.getTask(attempt.taskId);
    const run = store.getRun(task.runId);
    const profile = run.teamSnapshot?.profiles.find(
      (p) => p.id === attempt.profileId,
    );
    if (!task.reviewCandidateId || profile?.permission !== "read_only")
      throw new DomainError(
        "POLICY_DENIED",
        "Only an assigned read-only reviewer can record a review",
      );
    const candidate = getIntegrationCandidate(store, task.reviewCandidateId);
    if (
      candidate.taskId !== task.parentTaskId ||
      store.getTask(candidate.taskId).runId !== task.runId ||
      candidate.attemptId === attempt.id
    )
      throw new DomainError(
        "INVALID_REFERENCE",
        "Review candidate linkage differs from its assignment",
      );
    if (attempt.status !== "running" || task.status !== "RUNNING")
      throw new DomainError(
        "CONFLICT",
        "Reviews are recorded only while their attempt completes; recovery needs an explicit decision",
      );
    if (
      store.db
        .prepare("SELECT 1 FROM reviews WHERE reviewer_attempt_id=?")
        .get(attempt.id)
    )
      throw new DomainError("CONFLICT", "Attempt already has a review");
    const captured = store.db
      .prepare(
        "SELECT payload FROM events WHERE attempt_id=? AND type='worktree.captured' ORDER BY sequence DESC LIMIT 1",
      )
      .get(attempt.id);
    const evidence = worktreeEvidenceSchema.safeParse(
      captured ? JSON.parse(String(captured.payload)) : null,
    );
    if (
      !evidence.success ||
      evidence.data.headSha !== candidate.candidateSha ||
      evidence.data.baseSha !== candidate.baseSha ||
      evidence.data.files.length ||
      evidence.data.diffCheck !== "passed"
    )
      throw new DomainError(
        "CONFLICT",
        "A review requires clean Git evidence at its candidate commit",
      );
    const now = new Date().toISOString();
    const review = reviewSchema.parse({
      ...data.result,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      taskId: candidate.taskId,
      reviewerAttemptId: attempt.id,
      candidateId: candidate.id,
    });
    store.db
      .prepare("INSERT INTO reviews VALUES (?,?,?,?,?)")
      .run(
        review.id,
        review.taskId,
        attempt.id,
        candidate.id,
        JSON.stringify(review),
      );
    const updated = integrationCandidateSchema.parse({
      ...candidate,
      reviewIds: [...candidate.reviewIds, review.id],
      // A recorded recommendation grants no approval or integration authority.
      status: candidate.status === "proposed" ? "reviewed" : candidate.status,
      updatedAt: now,
    });
    store.db
      .prepare("UPDATE integration_candidates SET data=? WHERE id=?")
      .run(JSON.stringify(updated), candidate.id);
    appendEvent(store.db, {
      type: "review.saved",
      runId: task.runId,
      taskId: task.id,
      attemptId: attempt.id,
      correlationId: key,
      payload: {
        reviewId: review.id,
        implementationTaskId: candidate.taskId,
        candidateId: candidate.id,
        recommendation: review.recommendation,
        findingCount: review.findings.length,
      },
    });
    const lineage = implementationLineage(
      store,
      store.getTask(candidate.taskId),
    );
    if (
      lineage[0]?.id === candidate.taskId &&
      listIntegrationCandidates(store, candidate.taskId).at(-1)?.id ===
        candidate.id &&
      lineage.every((implementation) =>
        ["READY_TO_INTEGRATE", "BLOCKED_CONFLICT"].includes(
          implementation.status,
        ),
      )
    )
      // New evidence reopens review, not the historical owner decision. This
      // also restores the normal revision/re-review path before a fresh preview.
      for (const implementation of lineage)
        store.transitionTask(
          {
            id: implementation.id,
            expectedStatus: implementation.status,
            status: "AWAITING_REVIEW",
            reason: `New independent review ${review.id}; a fresh preview and owner approval are required`,
          },
          `${key}:reopen:${implementation.id}`,
        );
    return review;
  });
}

export function listReviews(store: Store, taskId: string) {
  idSchema.parse(taskId);
  return store.db
    .prepare(
      "SELECT data FROM reviews WHERE task_id=? OR reviewer_attempt_id IN (SELECT id FROM attempts WHERE task_id=?) ORDER BY rowid",
    )
    .all(taskId, taskId)
    .map((row) => reviewSchema.parse(JSON.parse(String(row.data))));
}

// Failed/deferred reviews have no durable verdict and never run automatically.
// An explicit retry becomes READY/QUEUED and must block approval/application.
export function integrationReviewBlocker(
  store: Store,
  preview: Pick<
    IntegrationPreview,
    "runId" | "implementationTaskId" | "candidateId" | "reviewId"
  >,
) {
  const latest = listReviews(store, preview.implementationTaskId)
    .filter((review) => review.candidateId === preview.candidateId)
    .at(-1);
  if (latest?.recommendation !== "pass")
    return "The current candidate needs a passing independent review, then a fresh preview and owner approval";
  if (latest.id !== preview.reviewId)
    return "A newer review of this candidate exists; prepare and approve a new preview";
  if (
    store
      .listTasks(preview.runId)
      .some(
        (task) =>
          task.reviewCandidateId === preview.candidateId &&
          [
            "READY",
            "QUEUED",
            "RUNNING",
            "WAITING_HUMAN",
            "WAITING_DEPENDENCY",
          ].includes(task.status),
      )
  )
    return "A review of this candidate is still in progress";
  return null;
}

// Read-only owner view: everything reviewed across the revision lineage, with
// the candidate that integration actions currently resolve to.
export function reviewHistory(store: Store, taskId: string) {
  const task = store.getTask(taskId);
  const root = revisionAncestors(store, task).at(-1) ?? task;
  const ids = revisionTaskIds(store, root);
  const candidates = ids
    .flatMap((id) => listIntegrationCandidates(store, id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reviews = ids
    .flatMap((id) => listReviews(store, id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((review) => ({
      review,
      reviewerProfileId: store.getAttempt(review.reviewerAttemptId).profileId,
    }));
  return {
    currentCandidateId:
      listIntegrationCandidates(store, implementationTask(store, root).id).at(
        -1,
      )?.id ?? null,
    candidates,
    reviews,
  };
}
