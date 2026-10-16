import {
  type IntegrationCandidate,
  idSchema,
  integrationCandidateSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type IntegrationApplication,
  type IntegrationPreview,
  integrationPreviewSchema,
} from "../../shared/integration.ts";
import { getIntegrationCandidate } from "./candidates.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
import { implementationLineage } from "./revisions.ts";
import type { Store } from "./store.ts";

export function insertIntegration(
  store: Store,
  preview: IntegrationPreview,
  key: string,
) {
  store.db
    .prepare(
      "INSERT INTO integrations(id, task_id, candidate_id, path, data) VALUES (?,?,?,?,?)",
    )
    .run(
      preview.id,
      preview.taskId,
      preview.candidateId,
      preview.worktreePath,
      JSON.stringify(integrationPreviewSchema.parse(preview)),
    );
  appendEvent(store.db, {
    type: "integration.requested",
    runId: preview.runId,
    taskId: preview.taskId,
    correlationId: key,
    payload: {
      integrationId: preview.id,
      candidateId: preview.candidateId,
      reviewId: preview.reviewId,
      destinationBranch: preview.destinationBranch,
      declaredTests: preview.tests.length,
    },
  });
}

export function getIntegration(store: Store, id: string) {
  idSchema.parse(id);
  const row = store.db
    .prepare("SELECT data FROM integrations WHERE id=?")
    .get(id);
  if (!row) throw new DomainError("NOT_FOUND", "Integration preview not found");
  return integrationPreviewSchema.parse(JSON.parse(String(row.data)));
}

export function listIntegrations(store: Store, taskId: string) {
  idSchema.parse(taskId);
  return store.db
    .prepare("SELECT data FROM integrations WHERE task_id=? ORDER BY rowid")
    .all(taskId)
    .map((row) => integrationPreviewSchema.parse(JSON.parse(String(row.data))));
}

// Progress is saved only while preparing; a finished or interrupted preview is
// immutable, so a late job can never overwrite what recovery or the owner saw.
export function saveIntegration(
  store: Store,
  next: IntegrationPreview,
  type: string,
  key: string,
) {
  return mutate(
    store.db,
    key,
    "saveIntegration",
    next,
    integrationPreviewSchema,
    () => {
      if (getIntegration(store, next.id).status !== "preparing")
        throw new DomainError(
          "CONFLICT",
          "Integration preview is no longer preparing",
        );
      const preview = integrationPreviewSchema.parse({
        ...next,
        updatedAt: new Date().toISOString(),
      });
      store.db
        .prepare("UPDATE integrations SET data=? WHERE id=?")
        .run(JSON.stringify(preview), preview.id);
      appendEvent(store.db, {
        type,
        runId: preview.runId,
        taskId: preview.taskId,
        correlationId: key,
        payload: {
          integrationId: preview.id,
          status: preview.status,
          destinationSha: preview.destinationSha,
          resultSha: preview.resultSha,
          checks: preview.checks.map((c) => `${c.name}:${c.status}`),
          testResults: preview.testResults.map((t) => t.result),
        },
      });
      return preview;
    },
  );
}

// Called inside the owner's decision transaction. A decision is written once,
// on a finished preview, and is mirrored on its candidate; nothing else about
// the preview changes, and every worktree, branch and artifact is retained.
export function saveIntegrationDecision(
  store: Store,
  preview: IntegrationPreview,
  candidate: IntegrationCandidate,
  decision: NonNullable<IntegrationPreview["decision"]>,
  key: string,
) {
  const current = getIntegration(store, preview.id);
  if (current.status === "preparing" || current.decision)
    throw new DomainError(
      "CONFLICT",
      "Integration preview is not awaiting a decision",
    );
  const decided = integrationPreviewSchema.parse({
    ...current,
    decision,
    updatedAt: decision.decidedAt,
  });
  store.db
    .prepare("UPDATE integrations SET data=? WHERE id=?")
    .run(JSON.stringify(decided), decided.id);
  const approved = decision.outcome === "approved";
  const updated = integrationCandidateSchema.parse({
    ...candidate,
    status: approved ? "approved" : "rejected",
    humanDecision: approved ? "approved" : "rejected",
    decidedAt: decision.decidedAt,
    updatedAt: decision.decidedAt,
  });
  store.db
    .prepare("UPDATE integration_candidates SET data=? WHERE id=?")
    .run(JSON.stringify(updated), updated.id);
  appendEvent(store.db, {
    type: `integration.${decision.outcome}`,
    runId: decided.runId,
    taskId: decided.taskId,
    correlationId: key,
    payload: {
      integrationId: decided.id,
      candidateId: decided.candidateId,
      reviewId: decided.reviewId,
      destinationBranch: decided.destinationBranch,
      destinationSha: decided.destinationSha,
      resultSha: decided.resultSha,
      rationale: decision.rationale,
    },
  });
  return decided;
}

function writePreview(store: Store, preview: IntegrationPreview) {
  const saved = integrationPreviewSchema.parse(preview);
  store.db
    .prepare("UPDATE integrations SET data=? WHERE id=?")
    .run(JSON.stringify(saved), saved.id);
  return saved;
}

function moveLineage(
  store: Store,
  preview: IntegrationPreview,
  to: "INTEGRATING" | "DONE" | "BLOCKED_CONFLICT",
  reason: string,
  key: string,
) {
  for (const task of implementationLineage(
    store,
    store.getTask(preview.taskId),
  )) {
    // A previously blocked application is resolved by the new attempt.
    if (to === "INTEGRATING" && task.status === "BLOCKED_CONFLICT")
      store.transitionTask(
        {
          id: task.id,
          expectedStatus: "BLOCKED_CONFLICT",
          status: "READY_TO_INTEGRATE",
          reason,
        },
        `${key}:${task.id}:resolved`,
      );
    store.transitionTask(
      {
        id: task.id,
        expectedStatus: store.getTask(task.id).status,
        status: to,
        reason,
      },
      `${key}:${task.id}:${to}`,
    );
  }
}

// Called inside the owner's apply transaction, before any Git command runs, so
// a crash leaves a durable INTEGRATING claim that restart never re-executes.
export function startIntegrationApplication(
  store: Store,
  preview: IntegrationPreview,
  application: IntegrationApplication,
  key: string,
) {
  const saved = writePreview(store, {
    ...preview,
    applications: [...preview.applications, application],
    updatedAt: application.startedAt,
  });
  moveLineage(
    store,
    saved,
    "INTEGRATING",
    `Owner confirmed applying integration ${saved.id} to ${saved.destinationBranch}`,
    key,
  );
  appendEvent(store.db, {
    type: "integration.application_started",
    runId: saved.runId,
    taskId: saved.taskId,
    correlationId: key,
    payload: {
      integrationId: saved.id,
      applicationId: application.id,
      method: application.method,
      destinationBranch: saved.destinationBranch,
      expectedSha: application.expectedSha,
      resultSha: application.resultSha,
    },
  });
  return saved;
}

// The outcome comes from Git state read after the attempt, never from an exit
// code alone. Anything other than a verified result or a verified no-op is
// "interrupted": the owner inspects it, and nothing is retried automatically.
export function finishIntegrationApplication(
  store: Store,
  id: string,
  outcome: Pick<IntegrationApplication, "observedSha" | "diagnostic"> & {
    status: "applied" | "blocked" | "interrupted";
  },
  key: string,
) {
  return mutate(
    store.db,
    key,
    "finishIntegrationApplication",
    { id, ...outcome },
    integrationPreviewSchema,
    () => {
      const preview = getIntegration(store, id);
      const last = preview.applications.at(-1);
      if (last?.status !== "applying")
        throw new DomainError(
          "CONFLICT",
          "Integration application is not in progress",
        );
      const now = new Date().toISOString();
      const finished: IntegrationApplication = {
        ...last,
        ...outcome,
        finishedAt: now,
      };
      const saved = writePreview(store, {
        ...preview,
        applications: [...preview.applications.slice(0, -1), finished],
        updatedAt: now,
      });
      if (outcome.status === "applied") {
        const candidate = getIntegrationCandidate(store, saved.candidateId);
        store.db
          .prepare("UPDATE integration_candidates SET data=? WHERE id=?")
          .run(
            JSON.stringify(
              integrationCandidateSchema.parse({
                ...candidate,
                status: "integrated",
                updatedAt: now,
              }),
            ),
            candidate.id,
          );
      }
      moveLineage(
        store,
        saved,
        outcome.status === "applied" ? "DONE" : "BLOCKED_CONFLICT",
        outcome.status === "applied"
          ? `Integration ${saved.id} applied to ${saved.destinationBranch} at ${outcome.observedSha}`
          : `Integration ${saved.id} ${outcome.status} on ${saved.destinationBranch}`,
        key,
      );
      if (outcome.status === "interrupted")
        store.createHumanRequest(
          {
            runId: saved.runId,
            affectedTaskIds: [saved.taskId],
            type: "manual_check",
            urgency: "high",
            reason:
              `Applying integration to ${saved.destinationBranch} did not finish cleanly; ${outcome.diagnostic ?? ""}`.slice(
                0,
                4000,
              ),
            suggestedAction: `Nothing was retried. Inspect ${saved.destinationBranch} and your checkout. Applying again rechecks Git first; it records the result if ${saved.destinationBranch} already points at ${finished.resultSha}. You can also cancel; everything is retained.`,
            blocking: false,
          },
          `${key}:request`,
        );
      appendEvent(store.db, {
        type: `integration.application_${outcome.status}`,
        runId: saved.runId,
        taskId: saved.taskId,
        correlationId: key,
        payload: {
          integrationId: saved.id,
          applicationId: finished.id,
          method: finished.method,
          destinationBranch: saved.destinationBranch,
          observedSha: finished.observedSha,
          resultSha: finished.resultSha,
        },
      });
      return saved;
    },
  );
}

// A preview cannot outlive its process: tests and Git steps are never resumed
// or replayed at startup. Its worktree and artifacts stay for inspection.
export function interruptIntegrations(store: Store) {
  // An application claim left by a crash is never re-executed: Git may or may
  // not have moved the branch, so the owner decides after inspecting it.
  for (const row of store.db
    .prepare(
      "SELECT id FROM integrations WHERE json_extract(data,'$.applications[#-1].status')='applying'",
    )
    .all()) {
    const preview = getIntegration(store, String(row.id));
    finishIntegrationApplication(
      store,
      preview.id,
      {
        status: "interrupted",
        observedSha: null,
        diagnostic:
          "the app stopped while applying, so Git was not rechecked afterwards",
      },
      `integration:${preview.id}:${preview.applications.at(-1)?.id}:interrupted`,
    );
  }
  for (const row of store.db
    .prepare(
      "SELECT id FROM integrations WHERE json_extract(data,'$.status')='preparing'",
    )
    .all()) {
    const preview = getIntegration(store, String(row.id));
    saveIntegration(
      store,
      {
        ...preview,
        status: "interrupted",
        diagnostic:
          "App stopped while preparing this preview; it was not rerun. Request a new preview.",
      },
      "integration.interrupted",
      `integration:${preview.id}:interrupted`,
    );
  }
}
