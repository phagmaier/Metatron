import { z } from "zod";
import { artifactSchema, idSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  workflowHandoffSchema,
  workflowSourceSchema,
} from "../../shared/workflows.ts";
import { mutate } from "./mutations.ts";
import type { Store } from "./store.ts";
import { getWorkflowRun, workflowChild, workflowOutcome } from "./workflows.ts";

export function workflowSource(
  store: Store,
  input: string,
  stageId: string,
  taskId: string,
) {
  const outcome = workflowOutcome(store, taskId);
  const cancelled = store.getTask(taskId).status === "CANCELLED";
  const result = outcome.attemptId
    ? store.db
        .prepare(
          "SELECT id FROM events WHERE attempt_id=? AND type='worker.result' ORDER BY sequence DESC LIMIT 1",
        )
        .get(outcome.attemptId)
    : undefined;
  const failure =
    outcome.status === "failed"
      ? cancelled
        ? store.db
            .prepare(
              "SELECT id,payload FROM events WHERE task_id=? AND type='task.transitioned' AND json_extract(payload,'$.to')='CANCELLED' ORDER BY sequence DESC LIMIT 1",
            )
            .get(taskId)
        : store.db
            .prepare(
              "SELECT id,payload FROM events WHERE attempt_id=? AND type='attempt.diagnostic' ORDER BY sequence DESC LIMIT 1",
            )
            .get(outcome.attemptId)
      : undefined;
  const payload = failure
    ? z
        .object({
          reason: z.string().optional(),
          diagnostic: z.string().optional(),
        })
        .parse(JSON.parse(String(failure.payload)))
    : null;
  return {
    input,
    stageId,
    ...outcome,
    resultEventId: result ? idSchema.parse(result.id) : null,
    failureEventId: failure ? idSchema.parse(failure.id) : null,
    failure:
      outcome.status === "failed"
        ? cancelled
          ? ("cancelled" as const)
          : ("failed" as const)
        : null,
    diagnostic:
      outcome.status === "failed"
        ? (
            payload?.diagnostic ??
            payload?.reason ??
            (outcome.attemptId
              ? store.getAttempt(outcome.attemptId).recovery?.reason
              : null) ??
            (cancelled
              ? "Child cancelled; no cancellation event was recorded"
              : "Attempt failed; inspect the retained journal")
          ).slice(0, 4000)
        : outcome.diagnostic,
  };
}

const inputSchema = workflowHandoffSchema.omit({ createdAt: true });

export function saveWorkflowHandoff(store: Store, input: unknown, key: string) {
  const data = inputSchema.parse(input);
  return mutate(
    store.db,
    key,
    "saveWorkflowHandoff",
    data,
    workflowHandoffSchema,
    () => {
      const child = workflowChild(store, data.taskId);
      if (
        !child ||
        child.workflow.id !== data.workflowId ||
        child.stage.id !== data.stageId
      )
        throw new DomainError(
          "INVALID_REFERENCE",
          "Handoff target is not this workflow child",
        );
      if (child.state.status !== "queued")
        throw new DomainError(
          "CONFLICT",
          "Workflow inputs must be prepared before recording their bindings",
        );
      const parameters = Object.fromEntries(
        child.stage.inputs
          .filter((binding) => binding.source === "parameter")
          .map((binding) => [
            binding.name,
            child.workflow.parameters[binding.ref],
          ]),
      );
      const sources = child.stage.inputs
        .filter((binding) => binding.source === "stage")
        .flatMap((binding) => {
          const upstream = child.workflow.stages.find(
            (state) => state.stageId === binding.ref,
          );
          return (upstream?.taskIds ?? []).map((taskId) => {
            const source = workflowSource(
              store,
              binding.name,
              binding.ref,
              taskId,
            );
            if (
              !["completed", "failed"].includes(source.status) ||
              (child.stage.partialFailure === "stop" &&
                source.status !== "completed")
            )
              throw new DomainError(
                "CONFLICT",
                "Only settled, permitted evidence can enter a workflow handoff",
              );
            return workflowSourceSchema.parse({
              input: source.input,
              stageId: source.stageId,
              taskId: source.taskId,
              attemptId: source.attemptId,
              status: source.status,
              artifactId: source.report?.id ?? null,
              resultEventId: source.resultEventId,
              failureEventId: source.failureEventId,
              failure: source.failure,
              diagnostic: source.diagnostic,
            });
          });
        });
      if (
        JSON.stringify(data.parameters) !== JSON.stringify(parameters) ||
        JSON.stringify(data.sources) !== JSON.stringify(sources)
      )
        throw new DomainError(
          "CONFLICT",
          "Workflow source bindings changed during preparation",
        );
      const handoff = workflowHandoffSchema.parse({
        ...data,
        createdAt: new Date().toISOString(),
      });
      store.db
        .prepare("INSERT INTO workflow_handoffs VALUES (?,?,?)")
        .run(data.taskId, data.workflowId, JSON.stringify(handoff));
      store.recordEvent(
        {
          type: "workflow.handoff_saved",
          runId: child.workflow.runId,
          taskId: data.taskId,
          correlationId: key,
          payload: {
            workflowId: data.workflowId,
            stageId: data.stageId,
            sourceCount: sources.length,
            partial: sources.some((source) => source.status === "failed"),
          },
        },
        `${key}:event`,
      );
      return handoff;
    },
  );
}

// Read canonical attempt/artifact/journal history, not just the latest report.
// Legacy prepared children have no binding: never invent historical provenance.
export function workflowEvidence(store: Store, id: string) {
  const workflow = getWorkflowRun(store, id);
  const handoffs = store.db
    .prepare(
      "SELECT data FROM workflow_handoffs WHERE workflow_id=? ORDER BY rowid",
    )
    .all(id)
    .map((row) => workflowHandoffSchema.parse(JSON.parse(String(row.data))));
  const attempts = store.listAttempts();
  return {
    workflowId: workflow.id,
    children: workflow.stages.flatMap((state) =>
      state.taskIds.map((taskId) => {
        const outcome = workflowOutcome(store, taskId);
        const artifacts = store.db
          .prepare("SELECT data FROM artifacts WHERE task_id=? ORDER BY rowid")
          .all(taskId)
          .map((row) => artifactSchema.parse(JSON.parse(String(row.data))));
        return {
          stageId: state.stageId,
          task: store.getTask(taskId),
          outcome: { status: outcome.status, diagnostic: outcome.diagnostic },
          handoff:
            handoffs.find((handoff) => handoff.taskId === taskId) ?? null,
          taskArtifacts: artifacts.filter(
            (artifact) => artifact.attemptId === null,
          ),
          attempts: attempts
            .filter((attempt) => attempt.taskId === taskId)
            .map((attempt) => {
              const events = store.db
                .prepare(
                  "SELECT id,type,payload FROM events WHERE attempt_id=? AND type IN ('worker.result','attempt.diagnostic','recovery.required') ORDER BY sequence",
                )
                .all(attempt.id)
                .map((row) => ({
                  eventId: idSchema.parse(row.id),
                  type: String(row.type),
                  payload: z
                    .record(z.string(), z.json())
                    .parse(JSON.parse(String(row.payload))),
                }));
              return {
                attempt,
                artifacts: artifacts.filter(
                  (artifact) => artifact.attemptId === attempt.id,
                ),
                resultEvent:
                  events.find((event) => event.type === "worker.result") ??
                  null,
                diagnostics: events.filter(
                  (event) => event.type !== "worker.result",
                ),
              };
            }),
        };
      }),
    ),
  };
}
