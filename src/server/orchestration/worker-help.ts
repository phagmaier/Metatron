import { createHash } from "node:crypto";
import { z } from "zod";
import {
  type HumanRequest,
  humanRequestSchema,
} from "../../shared/domain/entities.ts";
import { createHumanRequestSchema } from "../../shared/domain/inputs.ts";
import { DomainError } from "../../shared/domain/states.ts";
import type { ToolInput } from "../../shared/orchestration.ts";
import { mutate } from "../storage/mutations.ts";
import type { Store } from "../storage/store.ts";
import type { Engine } from "./engine.ts";
import { notifyLead } from "./lead-run.ts";

export function pendingWorkerHelp(store: Store, attemptId: string) {
  const row = store.db
    .prepare(
      `SELECT payload,correlation_id FROM events WHERE attempt_id=? AND type='worker.help_requested'
       AND NOT EXISTS (SELECT 1 FROM events WHERE attempt_id=? AND type='worker.help_finalized') LIMIT 1`,
    )
    .get(attemptId, attemptId);
  return row
    ? {
        key: String(row.correlation_id),
        request: createHumanRequestSchema.parse(
          JSON.parse(String(row.payload)),
        ),
      }
    : null;
}

// This command ends at a tool boundary, before any native side effect. Only the
// executor, after confirmed shutdown, may turn the durable intent into a wait.
type HelpResult = {
  request: HumanRequest | null;
  stopRequested: boolean;
  stop: "unsupported" | "not_requested" | "requested";
  intentId?: string;
};
function requestHelp(
  engine: Engine,
  request: unknown,
  attemptId: string,
): HelpResult {
  const { store } = engine;
  const data = createHumanRequestSchema.parse(request);
  const key = `worker-help:${attemptId}:${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
  const pending = pendingWorkerHelp(store, attemptId);
  if (pending && pending.key !== key)
    throw new DomainError(
      "CONFLICT",
      "This worker is already stopping for owner help",
    );
  const stop = engine.nativeStops.get(store.getAttempt(attemptId).taskId);
  if (!data.blocking || !stop) {
    const saved = store.createHumanRequest(
      {
        ...data,
        blocking: false,
        reason:
          data.reason +
          (data.blocking
            ? "\n\nWorker stop is unsupported for this session; execution has not been suspended. Inspect the session before acting."
            : ""),
      },
      key,
    );
    return {
      request: saved,
      stopRequested: false,
      stop: data.blocking ? "unsupported" : "not_requested",
    };
  }
  const intent = store.recordEvent(
    {
      runId: data.runId,
      taskId: store.getAttempt(attemptId).taskId,
      attemptId,
      sessionId: data.sessionId,
      type: "worker.help_requested",
      correlationId: key,
      payload: data,
    },
    key,
  );
  return {
    request: null,
    stopRequested: true,
    stop: "requested",
    intentId: intent.id,
  };
}

const signalResultSchema = z.strictObject({
  recorded: z.uuid().nullable(),
  request: humanRequestSchema.nullable(),
  stopRequested: z.boolean(),
  stop: z.enum(["unsupported", "not_requested", "requested"]),
  intentId: z.uuid().optional(),
  leadWoken: z.boolean(),
});

export function workerHelp(
  engine: Engine,
  data: Extract<ToolInput, { name: "request_human_action" | "report_issue" }>,
  sessionId: string | null,
  attemptId: string | null,
  commandKey: string,
) {
  if (!sessionId || !attemptId)
    throw new DomainError(
      "POLICY_DENIED",
      "Worker help requires its authenticated session",
    );
  const { store } = engine;
  if (store.db.isTransaction)
    throw new DomainError(
      "CONFLICT",
      "Worker signals require their own committed command",
    );
  const task = store.getTask(data.taskId);
  const issue = data.name === "report_issue";
  const urgent = ["high", "urgent"].includes(data.urgency);
  const blocking = data.blocking || (issue && urgent);
  const key = `worker-signal:${attemptId}:${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
  const wasPending = pendingWorkerHelp(store, attemptId);
  const result = mutate(
    store.db,
    commandKey,
    "workerSignalCommand",
    data,
    signalResultSchema,
    () =>
      mutate(store.db, key, "workerSignal", data, signalResultSchema, () => {
        if (pendingWorkerHelp(store, attemptId))
          throw new DomainError(
            "CONFLICT",
            "This worker is already stopping for owner help",
          );
        const event = issue
          ? store.recordEvent(
              {
                runId: task.runId,
                taskId: task.id,
                attemptId,
                sessionId,
                type: "worker.issue",
                correlationId: key,
                payload: {
                  summary: data.summary,
                  details: data.details,
                  urgency: data.urgency,
                  blocking,
                },
              },
              `${key}:issue`,
            )
          : null;
        const help: HelpResult =
          !issue || blocking
            ? requestHelp(
                engine,
                {
                  runId: task.runId,
                  sessionId,
                  affectedTaskIds: [task.id],
                  type: issue ? "manual_check" : data.type,
                  urgency: data.urgency,
                  reason: issue
                    ? `${data.summary}\n\n${data.details}`
                    : data.reason,
                  suggestedAction: issue
                    ? (data.suggestedAction ??
                      "Inspect the worker's finding and retained evidence before deciding how to continue")
                    : data.suggestedAction,
                  blocking,
                },
                attemptId,
              )
            : { request: null, stopRequested: false, stop: "not_requested" };
        const leadWoken = notifyLead(
          engine,
          task.id,
          urgent ? "urgent_issue" : blocking ? "human_request" : "issue",
          issue ? data.summary : data.reason,
          `${key}:notify`,
        );
        return { recorded: event?.id ?? null, ...help, leadWoken };
      }),
  );
  if (result.stopRequested && !wasPending) {
    // Commit intent + issue + Lead notification before native side effects.
    // Keep the reservation until the executor confirms shutdown and retains Git.
    const stop = engine.nativeStops.get(task.id);
    if (stop)
      void stop("human_request")
        .catch(() => {
          store.recordEvent(
            {
              runId: task.runId,
              taskId: task.id,
              attemptId,
              sessionId,
              type: "worker.help_stop_failed",
              correlationId: key,
              payload: {
                diagnostic:
                  "Worker stop did not acknowledge; inspect shutdown/recovery evidence",
              },
            },
            `${key}:stop-failed`,
          );
        })
        .catch((error: unknown) => {
          console.error(
            "Worker help stop persistence failed; recovery required",
            error instanceof Error ? error.name : "Unknown error",
          );
          process.exitCode = 1;
        });
  }
  return result;
}

export function finishWorkerHelp(
  engine: Engine,
  attemptId: string,
  stopped: boolean,
) {
  const { store } = engine;
  const intent = pendingWorkerHelp(store, attemptId);
  if (!intent) return false;
  const task = store.getTask(store.getAttempt(attemptId).taskId);
  mutate(
    store.db,
    `${intent.key}:finish`,
    "finishWorkerHelp",
    { attemptId, stopped },
    humanRequestSchema,
    () => {
      const attempt = store.getAttempt(attemptId);
      const cancelled = task.status === "CANCELLED";
      if (!stopped && attempt.status === "running")
        engine.fail(
          task.id,
          attemptId,
          "Worker help shutdown is unconfirmed; inspect retained evidence before retrying",
          true,
        );
      else if (attempt.status === "running")
        store.updateAttempt(
          { id: attemptId, status: cancelled ? "cancelled" : "interrupted" },
          `${intent.key}:attempt`,
        );
      const blocking = stopped && store.getTask(task.id).status === "RUNNING";
      const request = store.createHumanRequest(
        {
          ...intent.request,
          blocking,
          reason:
            intent.request.reason +
            (blocking
              ? ""
              : cancelled
                ? "\n\nThe owner cancelled this task; it remains cancelled."
                : "\n\nShutdown was not confirmed or the app restarted; a recovery decision is required. Execution has not been labeled suspended."),
        },
        `${intent.key}:request`,
      );
      store.recordEvent(
        {
          runId: task.runId,
          taskId: task.id,
          attemptId,
          sessionId: intent.request.sessionId,
          type: "worker.help_finalized",
          correlationId: intent.key,
          payload: { requestId: request.id, stopped, blocking },
        },
        `${intent.key}:finalized`,
      );
      return request;
    },
  );
  return true;
}

export function recoverWorkerHelp(engine: Engine) {
  const rows = engine.store.db
    .prepare(
      "SELECT DISTINCT attempt_id FROM events WHERE type='worker.help_requested'",
    )
    .all();
  for (const row of rows) {
    const attemptId = String(row.attempt_id);
    const attempt = engine.store.getAttempt(attemptId);
    if (!["created", "running"].includes(attempt.status))
      finishWorkerHelp(engine, attemptId, false);
  }
}
