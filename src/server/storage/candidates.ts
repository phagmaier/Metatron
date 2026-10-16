import { randomUUID } from "node:crypto";
import {
  idSchema,
  integrationCandidateSchema,
} from "../../shared/domain/entities.ts";
import { createIntegrationCandidateSchema } from "../../shared/domain/inputs.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
import type { Store } from "./store.ts";

// Recorded in the same transaction that completes the writer attempt. The Git
// commit already exists by then; a crash in between leaves an unrecorded,
// create-only candidate branch on a RECOVERY_REQUIRED attempt, which is never
// adopted here automatically.
export function createIntegrationCandidate(
  store: Store,
  input: unknown,
  key: string,
) {
  const data = createIntegrationCandidateSchema.parse(input);
  return mutate(
    store.db,
    key,
    "createIntegrationCandidate",
    data,
    integrationCandidateSchema,
    () => {
      const attempt = store.getAttempt(data.attemptId);
      const task = store.getTask(attempt.taskId);
      const profile = store
        .getRun(task.runId)
        .teamSnapshot?.profiles.find((p) => p.id === attempt.profileId);
      if (profile?.permission !== "workspace_write")
        throw new DomainError(
          "POLICY_DENIED",
          "Only a writer attempt can propose an integration candidate",
        );
      if (attempt.status !== "running")
        throw new DomainError(
          "CONFLICT",
          "A candidate is recorded only while its attempt completes; recovered attempts need an explicit decision",
        );
      if (attempt.baseSha !== data.baseSha)
        throw new DomainError(
          "INVALID_REFERENCE",
          "Candidate base differs from the attempt's recorded base",
        );
      if (
        store.db
          .prepare("SELECT 1 FROM integration_candidates WHERE attempt_id=?")
          .get(attempt.id)
      )
        throw new DomainError(
          "CONFLICT",
          "Attempt already has an integration candidate",
        );
      const now = new Date().toISOString();
      const candidate = integrationCandidateSchema.parse({
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        taskId: task.id,
        reviewIds: [],
        status: "proposed",
        humanDecision: null,
        decidedAt: null,
      });
      store.db
        .prepare(
          "INSERT INTO integration_candidates(id, task_id, attempt_id, data) VALUES (?, ?, ?, ?)",
        )
        .run(candidate.id, task.id, attempt.id, JSON.stringify(candidate));
      appendEvent(store.db, {
        type: "integration_candidate.created",
        runId: task.runId,
        taskId: task.id,
        attemptId: attempt.id,
        correlationId: key,
        payload: {
          candidateId: candidate.id,
          baseSha: candidate.baseSha,
          candidateSha: candidate.candidateSha,
          reportSubmitted: candidate.reportSubmitted,
        },
      });
      return candidate;
    },
  );
}

export function getIntegrationCandidate(store: Store, id: string) {
  idSchema.parse(id);
  const row = store.db
    .prepare("SELECT data FROM integration_candidates WHERE id=?")
    .get(id);
  if (!row)
    throw new DomainError("NOT_FOUND", "Integration candidate not found");
  return integrationCandidateSchema.parse(JSON.parse(String(row.data)));
}

export function listIntegrationCandidates(store: Store, taskId: string) {
  idSchema.parse(taskId);
  return store.db
    .prepare(
      "SELECT data FROM integration_candidates WHERE task_id=? ORDER BY rowid",
    )
    .all(taskId)
    .map((row) =>
      integrationCandidateSchema.parse(JSON.parse(String(row.data))),
    );
}
