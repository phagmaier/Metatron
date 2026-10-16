import { z } from "zod";
import {
  idSchema,
  type Task,
  taskSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  getIntegrationCandidate,
  listIntegrationCandidates,
} from "./candidates.ts";
import { mutate } from "./mutations.ts";
import type { Store } from "./store.ts";

// Earlier revision children recorded their linkage in the journal only. Read
// that durable linkage too, without treating ordinary task parents as revisions.
export function revisionSource(store: Store, task: Task): Task | null {
  const legacy = task.revisionSourceTaskId
    ? undefined
    : store.db
        .prepare(
          "SELECT task_id FROM events WHERE type='task.revision_requested' AND json_extract(payload,'$.revisionTaskId')=? ORDER BY sequence DESC LIMIT 1",
        )
        .get(task.id);
  const id =
    task.revisionSourceTaskId ??
    (legacy ? idSchema.parse(legacy.task_id) : null);
  if (!id) return null;
  const source = store.getTask(id);
  if (
    source.runId !== task.runId ||
    task.parentTaskId !== source.id ||
    source.reviewCandidateId
  )
    throw new DomainError("INVALID_REFERENCE", "Invalid revision source");
  return source;
}

export function revisionAncestors(store: Store, task: Task) {
  const ancestors: Task[] = [];
  const visited = new Set([task.id]);
  let source = revisionSource(store, task);
  while (source) {
    if (visited.has(source.id))
      throw new DomainError("CONFLICT", "Revision lineage contains a cycle");
    visited.add(source.id);
    ancestors.push(source);
    source = revisionSource(store, source);
  }
  return ancestors;
}

export function implementationTask(store: Store, task: Task): Task {
  const visited = new Set<string>();
  let current = task;
  for (;;) {
    if (visited.has(current.id))
      throw new DomainError("CONFLICT", "Revision lineage contains a cycle");
    visited.add(current.id);
    const legacy = current.latestRevisionTaskId
      ? undefined
      : store.db
          .prepare(
            "SELECT payload FROM events WHERE type='task.revision_requested' AND task_id=? ORDER BY sequence DESC LIMIT 1",
          )
          .get(current.id);
    const next =
      current.latestRevisionTaskId ??
      (legacy
        ? z
            .object({ revisionTaskId: idSchema })
            .parse(JSON.parse(String(legacy.payload))).revisionTaskId
        : null);
    if (!next) return current;
    const revision = store.getTask(next);
    if (
      !revisionAncestors(store, revision).some(
        (parent) => parent.id === current.id,
      )
    )
      throw new DomainError(
        "INVALID_REFERENCE",
        "Revision is outside its implementation lineage",
      );
    current = revision;
  }
}

// The current implementation first, then every revision ancestor up to the
// original task. Integration decisions move them together.
export function implementationLineage(store: Store, task: Task) {
  const root = revisionAncestors(store, task).at(-1) ?? task;
  const current = implementationTask(store, root);
  return [current, ...revisionAncestors(store, current)];
}

export function revisionCandidate(store: Store, task: Task) {
  const source = revisionSource(store, task);
  const candidate = task.revisionCandidateId
    ? getIntegrationCandidate(store, task.revisionCandidateId)
    : source
      ? (listIntegrationCandidates(store, source.id).at(-1) ?? null)
      : null;
  if (candidate && candidate.taskId !== source?.id)
    throw new DomainError(
      "INVALID_REFERENCE",
      "Revision candidate differs from its source task",
    );
  return candidate;
}

export function saveRevisionTask(store: Store, task: Task) {
  const updated = taskSchema.parse({
    ...task,
    updatedAt: new Date().toISOString(),
  });
  store.db
    .prepare("UPDATE tasks SET data=? WHERE id=?")
    .run(JSON.stringify(updated), updated.id);
  return updated;
}

export function revisionTaskIds(store: Store, task: Task) {
  return [
    task.id,
    ...store
      .listTasks(task.runId)
      .filter((other) =>
        revisionAncestors(store, other).some((parent) => parent.id === task.id),
      )
      .map((other) => other.id),
  ];
}

// The completed child and every waiting ancestor become reviewable together.
// Failure/recovery never calls this path; owner cancellation is never undone.
export function reconcileRevision(
  store: Store,
  taskId: string,
  attemptId: string,
) {
  const task = store.getTask(taskId);
  const ancestors = revisionAncestors(store, task);
  if (!ancestors.length) return;
  return mutate(
    store.db,
    `revision-complete:${attemptId}`,
    "reconcileRevision",
    { taskId, attemptId },
    z.boolean(),
    () => {
      if (
        store.getAttempt(attemptId).taskId !== task.id ||
        store.getAttempt(attemptId).status !== "completed" ||
        task.status !== "AWAITING_REVIEW"
      )
        throw new DomainError(
          "CONFLICT",
          "Revision needs a completed attempt and result",
        );
      if (
        revisionCandidate(store, task) &&
        !listIntegrationCandidates(store, task.id).some(
          (c) => c.attemptId === attemptId,
        )
      )
        throw new DomainError(
          "CONFLICT",
          "Revision requires a newly captured candidate",
        );
      for (const parent of ancestors) {
        if (
          parent.status !== "CHANGES_REQUESTED" ||
          implementationTask(store, parent).id !== task.id
        )
          continue;
        saveRevisionTask(store, { ...parent, latestRevisionTaskId: task.id });
        store.transitionTask(
          {
            id: parent.id,
            expectedStatus: "CHANGES_REQUESTED",
            status: "AWAITING_REVIEW",
            reason: `Revision ${task.id} completed; new review required`,
          },
          `revision-complete:${attemptId}:${parent.id}:ready`,
        );
        store.recordEvent(
          {
            runId: parent.runId,
            taskId: parent.id,
            type: "task.revision_ready",
            correlationId: attemptId,
            payload: { revisionTaskId: task.id, attemptId },
          },
          `revision-complete:${attemptId}:${parent.id}:event`,
        );
      }
      return true;
    },
  );
}

export function reconcileCompletedRevisions(store: Store) {
  for (const attempt of store.listAttempts()) {
    if (attempt.status !== "completed") continue;
    const task = store.getTask(attempt.taskId);
    if (task.status !== "AWAITING_REVIEW" || !revisionSource(store, task))
      continue;
    // Legacy empty or unrecorded native candidates stay with the owner; only
    // already durable results can repair a parent after an upgrade/restart.
    if (
      revisionCandidate(store, task) &&
      !listIntegrationCandidates(store, task.id).some(
        (candidate) => candidate.attemptId === attempt.id,
      )
    )
      continue;
    reconcileRevision(store, task.id, attempt.id);
  }
}
