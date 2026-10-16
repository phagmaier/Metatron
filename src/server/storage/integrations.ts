import { idSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type IntegrationPreview,
  integrationPreviewSchema,
} from "../../shared/integration.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
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

// A preview cannot outlive its process: tests and Git steps are never resumed
// or replayed at startup. Its worktree and artifacts stay for inspection.
export function interruptIntegrations(store: Store) {
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
