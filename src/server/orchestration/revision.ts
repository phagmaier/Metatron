import { z } from "zod";
import { idSchema, type Task } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import type { Actor } from "../../shared/orchestration.ts";
import { listIntegrationCandidates } from "../storage/candidates.ts";
import { ownerAnswers } from "../storage/human-requests.ts";
import { mutate } from "../storage/mutations.ts";
import { listReviews } from "../storage/reviews.ts";
import {
  implementationTask,
  revisionAncestors,
  revisionCandidate,
  revisionSource,
  revisionTaskIds,
  saveRevisionTask,
} from "../storage/revisions.ts";
import type { Engine } from "./engine.ts";
import { authorize } from "./policy.ts";

const requestSchema = z.strictObject({
  taskId: idSchema,
  feedback: z.string().trim().min(1).max(8000),
});

export function requestRevision(
  engine: Engine,
  actor: Actor,
  input: unknown,
  key: string,
) {
  const data = requestSchema.parse(input);
  const { store } = engine;
  const requested = store.getTask(data.taskId);
  const run = authorize(
    store,
    actor,
    requested.runId,
    "request_revision",
    requested.id,
  );
  return mutate(
    store.db,
    key,
    "requestRevision",
    { name: "request_revision", ...data },
    z.unknown(),
    () => {
      if (requested.kind !== "work" || requested.reviewCandidateId)
        throw new DomainError(
          "POLICY_DENIED",
          "Revise an implementation task, not its review or Lead",
        );
      let task = implementationTask(store, store.getTask(requested.id));
      // Cancelling a failed revision preserves its worktree; a subsequent owner
      // request may explicitly start over from its last successful source.
      if (
        task.status === "CANCELLED" &&
        actor.role === "owner" &&
        requested.status === "CHANGES_REQUESTED"
      )
        task = revisionSource(store, task) ?? task;
      if (
        !["AWAITING_REVIEW", "CHANGES_REQUESTED"].includes(task.status) ||
        !task.assignedProfileId ||
        requested.status === "CANCELLED"
      )
        throw new DomainError(
          "CONFLICT",
          "Only completed work can be revised; interrupted work needs an explicit retry decision",
        );
      const ancestors = revisionAncestors(store, task);
      const root = ancestors.at(-1) ?? task;
      const current = implementationTask(store, root);
      if (
        ancestors.some(
          (parent) =>
            !["AWAITING_REVIEW", "CHANGES_REQUESTED"].includes(parent.status),
        )
      )
        throw new DomainError(
          "CONFLICT",
          "An ancestor implementation is no longer eligible for revision",
        );
      if (
        task.status === "CHANGES_REQUESTED" &&
        !(actor.role === "owner" && current.status === "CANCELLED")
      )
        throw new DomainError("CONFLICT", "A revision is already pending");
      if (requested.id !== root.id && requested.id !== task.id)
        throw new DomainError(
          "CONFLICT",
          "Request revision on the original task or its current implementation",
        );
      const cycles = revisionTaskIds(store, root).length - 1;
      if (cycles >= run.limits.maxRevisionCyclesPerTask)
        throw new DomainError(
          "BUDGET_EXCEEDED",
          "Revision cycle budget exhausted for this task",
        );
      const candidate = listIntegrationCandidates(store, task.id).at(-1);
      const profile = engine.scheduling.profile(run.id, task.assignedProfileId);
      if (
        run.execution === "native" &&
        profile.permission === "workspace_write" &&
        !candidate
      )
        throw new DomainError(
          "CONFLICT",
          "A native implementation revision requires a captured candidate",
        );
      const created = store.createTask(
        {
          runId: run.id,
          title: `Revision ${cycles + 1}: ${root.title}`.slice(0, 200),
          objective: `${root.objective.slice(0, 12000)}\n\nRevision feedback from the ${actor.role}:\n${data.feedback}`,
          acceptanceCriteria: root.acceptanceCriteria,
          priority: task.priority,
          scope: root.scope,
          parentTaskId: task.id,
          origin: actor.role === "owner" ? "owner" : "lead",
        },
        `${key}:task`,
      );
      const revision = saveRevisionTask(store, {
        ...created,
        revisionSourceTaskId: task.id,
        revisionCandidateId: candidate?.id ?? null,
      });
      for (let parent of [task, ...ancestors]) {
        parent = saveRevisionTask(store, {
          ...parent,
          latestRevisionTaskId: revision.id,
        });
        if (parent.status === "AWAITING_REVIEW")
          store.transitionTask(
            {
              id: parent.id,
              expectedStatus: parent.status,
              status: "CHANGES_REQUESTED",
              reason: `${actor.role} requested revision ${revision.id}`,
            },
            `${key}:changes:${parent.id}`,
          );
      }
      store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          type: "task.revision_requested",
          correlationId: key,
          payload: {
            rootTaskId: root.id,
            revisionTaskId: revision.id,
            sourceCandidateId: candidate?.id ?? null,
            cycle: cycles + 1,
            feedback: data.feedback,
          },
        },
        `${key}:event`,
      );
      const result =
        actor.role === "lead" && run.mode === "supervised"
          ? {
              ...engine.scheduling.propose(
                revision.id,
                profile.id,
                `${key}:proposal`,
              ),
              revisionTaskId: revision.id,
            }
          : {
              outcome: "queued",
              revisionTaskId: revision.id,
              dispatch: engine.scheduling.enqueue(
                actor,
                { taskId: revision.id, profileId: profile.id },
                `${key}:assign`,
              ),
            };
      if (task.ownerPinned)
        saveRevisionTask(store, {
          ...store.getTask(revision.id),
          ownerPinned: true,
        });
      return result;
    },
  );
}

// Detailed prior results belong in a saved handoff, rather than the task-card
// objective. Only the worker receives it; independent reviewers get their own packet.
export async function revisionPacket(
  engine: Engine,
  task: Task,
  attemptId: string,
) {
  const { store } = engine;
  const source = revisionSource(store, task);
  if (!source) return null;
  const candidate = revisionCandidate(store, task);
  const previous = candidate
    ? store.db
        .prepare(
          "SELECT payload FROM events WHERE attempt_id=? AND type='worker.result' ORDER BY sequence DESC LIMIT 1",
        )
        .get(candidate.attemptId)
    : store.db
        .prepare(
          "SELECT payload FROM events WHERE task_id=? AND type='worker.result' ORDER BY sequence DESC LIMIT 1",
        )
        .get(source.id);
  const text = [
    task.objective,
    `Acceptance criteria (bounded; full list in read_assignment):\n${task.acceptanceCriteria.join("\n").slice(0, 2000)}`,
    `Source task: ${source.id}\nSource candidate: ${candidate?.candidateSha ?? "No source candidate (report-only task)"}\nRun base: ${store.getRun(task.runId).repository?.baseSha ?? "simulation"}`,
    `Previous result (bounded):\n${previous ? String(previous.payload).slice(0, 3000) : "No structured report was submitted."}`,
    `Recorded review findings (bounded):\n${JSON.stringify(listReviews(store, source.id)).slice(0, 6000)}`,
    ownerAnswers(store, [
      task.id,
      source.id,
      ...revisionAncestors(store, source).map((t) => t.id),
    ]),
    "Continue from the source candidate in this fresh worktree. Preserve earlier implementation while addressing feedback. Earlier reviews do not approve the new candidate. Report tests as not_run when unavailable.",
  ]
    .join("\n\n")
    .slice(0, 32000);
  const artifact = await engine.saveReport(
    task,
    attemptId,
    text,
    "Revision context packet",
  );
  mutate(
    store.db,
    `revision-packet:${attemptId}`,
    "revisionPacket",
    { attemptId },
    z.boolean(),
    () => {
      store.db
        .prepare("INSERT INTO artifacts VALUES (?,?,?,?)")
        .run(artifact.id, task.id, attemptId, JSON.stringify(artifact));
      store.recordEvent(
        {
          runId: task.runId,
          taskId: task.id,
          attemptId,
          type: "revision.packet",
          correlationId: attemptId,
          payload: {
            artifactId: artifact.id,
            sourceTaskId: source.id,
            sourceCandidateId: candidate?.id ?? null,
            sourceCandidateSha: candidate?.candidateSha ?? null,
          },
        },
        `revision-packet:${attemptId}:event`,
      );
      return true;
    },
  );
  return text;
}
