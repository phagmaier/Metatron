import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  idSchema,
  type Session,
  type StopRecord,
  sessionSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { mutate } from "../storage/mutations.ts";
import type { Store } from "../storage/store.ts";
import type { Engine } from "./engine.ts";

const stopResultSchema = z.strictObject({
  stopId: idSchema,
  pausedRunIds: z.array(idSchema),
  sessionIds: z.array(idSchema),
});
type StopResult = z.infer<typeof stopResultSchema>;

function sessionFor(store: Store, attemptId: string) {
  return store.listSessions().find((s) => s.attemptId === attemptId);
}

function save(
  store: Store,
  session: Session,
  record: StopRecord,
  type: string,
  payload: Record<string, string | number | null>,
  key: string,
) {
  const updated = sessionSchema.parse({
    ...session,
    stops: [...session.stops.filter((s) => s.id !== record.id), record],
    updatedAt: new Date().toISOString(),
  });
  store.db
    .prepare("UPDATE sessions SET data=? WHERE id=?")
    .run(JSON.stringify(updated), session.id);
  const attempt = store.getAttempt(session.attemptId);
  store.recordEvent(
    {
      runId: store.getTask(attempt.taskId).runId,
      taskId: attempt.taskId,
      attemptId: attempt.id,
      sessionId: session.id,
      type,
      correlationId: record.id,
      payload: { stopId: record.id, scope: record.scope, ...payload },
    },
    key,
  );
}

export function stopPending(store: Store, attemptId: string) {
  return (
    sessionFor(store, attemptId)?.stops.some((s) => s.status === "pending") ??
    false
  );
}

// Must run inside the caller's command transaction: intent is durable before
// any native signal. Only sessions holding a live reservation are targeted.
export function recordStops(
  engine: Engine,
  scope: StopRecord["scope"],
  include: (runId: string, taskId: string) => boolean,
  pausedRunIds: string[] = [],
): StopResult {
  const { store } = engine;
  const stopId = randomUUID();
  const sessionIds: string[] = [];
  for (const dispatch of engine.scheduling.list()) {
    if (dispatch.state !== "active" || !dispatch.attemptId) continue;
    if (!include(dispatch.runId, dispatch.taskId)) continue;
    const session = sessionFor(store, dispatch.attemptId);
    if (!session || ["exited", "crashed"].includes(session.state)) continue;
    save(
      store,
      session,
      {
        id: stopId,
        scope,
        requestedAt: new Date().toISOString(),
        processId: session.processId,
        status: "pending",
        resolvedAt: null,
        evidence: null,
        diagnostic: null,
      },
      "stop.requested",
      { processId: session.processId },
      `stop:${stopId}:${session.id}`,
    );
    sessionIds.push(session.id);
  }
  return { stopId, pausedRunIds, sessionIds };
}

// A failed signal is diagnostic only; the outcome still waits for process or
// session evidence when the executor ends, or for restart reconciliation.
export function signalStops(engine: Engine, stopId: string) {
  const { store } = engine;
  for (const session of store.listSessions()) {
    const record = session.stops.find(
      (s) => s.id === stopId && s.status === "pending",
    );
    if (!record) continue;
    const stop = engine.nativeStops.get(
      store.getAttempt(session.attemptId).taskId,
    );
    // An executor still starting has no stop function yet; it checks the
    // durable pending stop before launch and again once its process exists.
    if (!stop) continue;
    void stop(record.scope === "emergency" ? "emergency" : undefined)
      .catch(() => {
        const current = store.getSession(session.id);
        const pending = current.stops.find(
          (s) => s.id === stopId && s.status === "pending",
        );
        if (!pending) return;
        const diagnostic =
          record.scope === "emergency"
            ? "App-owned process shutdown did not acknowledge"
            : "Native cancellation did not acknowledge";
        mutate(
          store.db,
          `stop:${stopId}:${session.id}:signal`,
          "stopSignalFailed",
          { stopId, sessionId: session.id },
          z.boolean(),
          () => {
            save(
              store,
              store.getSession(session.id),
              { ...pending, diagnostic },
              "stop.signal_failed",
              { diagnostic },
              `stop:${stopId}:${session.id}:signal:event`,
            );
            return true;
          },
        );
      })
      .catch((error: unknown) => {
        console.error(
          "Stop persistence failed; recovery required",
          error instanceof Error ? error.name : "Unknown error",
        );
        process.exitCode = 1;
      });
  }
}

function classify(
  store: Store,
  session: Session,
  record: StopRecord,
  restarted: boolean,
): Pick<StopRecord, "status" | "evidence" | "diagnostic"> {
  const exit = store.db
    .prepare(
      "SELECT payload FROM events WHERE attempt_id=? AND type IN ('pi.process_exit','codex.process_exit','claude-code.process_exit','opencode.process_exit') ORDER BY sequence DESC LIMIT 1",
    )
    .get(session.attemptId);
  if (exit) {
    const payload = z
      .object({ exitCode: z.int().nullable(), signal: z.string().nullable() })
      .parse(JSON.parse(String(exit.payload)));
    return {
      status: "confirmed",
      evidence: `Owned ${session.adapter} process exit observed (exit code ${payload.exitCode ?? "none"}, signal ${payload.signal ?? "none"})`,
      diagnostic: record.diagnostic,
    };
  }
  if (!restarted && session.adapter === "fake")
    return {
      status: "confirmed",
      evidence: "FAKE playback closed by the app; no OS process existed",
      diagnostic: record.diagnostic,
    };
  if (!restarted && !session.nativeSessionId && session.state === "exited")
    return {
      status: "confirmed",
      evidence:
        "Native launch never completed; the adapter reported no live process",
      diagnostic: record.diagnostic,
    };
  if (record.diagnostic)
    return {
      status: "failed",
      evidence: null,
      diagnostic: `${record.diagnostic}; no process exit was observed. Inspect PID ${record.processId ?? "unavailable"} before any recovery decision.`,
    };
  return {
    status: "uncertain",
    evidence: null,
    diagnostic: restarted
      ? "The app restarted before termination evidence was recorded; the process may still be running. Inspect before any recovery decision."
      : `Session ended ${session.state} without process exit evidence; termination is not confirmed.`,
  };
}

// Called once an executor has finished (or at restart for a previous process).
export function settleStops(
  store: Store,
  attemptId: string,
  restarted = false,
) {
  const session = sessionFor(store, attemptId);
  if (!session) return;
  for (const record of session.stops) {
    if (record.status !== "pending") continue;
    mutate(
      store.db,
      `stop:${record.id}:${session.id}:settle`,
      "settleStop",
      { attemptId, restarted },
      z.boolean(),
      () => {
        const current = store.getSession(session.id);
        const pending = current.stops.find((s) => s.id === record.id);
        if (pending?.status !== "pending") return false;
        const outcome = classify(store, current, pending, restarted);
        save(
          store,
          current,
          { ...pending, ...outcome, resolvedAt: new Date().toISOString() },
          "stop.outcome",
          outcome,
          `stop:${record.id}:${session.id}:outcome`,
        );
        return true;
      },
    );
  }
}

// Restart never re-signals: no process from the previous app is owned here.
export function recoverStops(store: Store) {
  for (const session of store.listSessions())
    if (
      session.stops.some((s) => s.status === "pending") &&
      !["created", "running"].includes(
        store.getAttempt(session.attemptId).status,
      )
    )
      settleStops(store, session.attemptId, true);
}

export function stopRun(engine: Engine, input: unknown, key: string) {
  const { runId } = z.strictObject({ runId: idSchema }).parse(input);
  const { store } = engine;
  const result = mutate(
    store.db,
    key,
    "stopRun",
    { runId },
    stopResultSchema,
    () => {
      const run = store.getRun(runId);
      if (run.status === "stopped" || run.status === "completed")
        throw new DomainError(
          "CONFLICT",
          "Run is already terminal; use emergency stop for an unconfirmed process",
        );
      store.updateRun({ id: run.id, status: "stopped" }, `${key}:run`);
      const stopped = recordStops(engine, "run", (id) => id === run.id);
      // Only reserved work is cancelled; queued tasks stay as recorded and the
      // terminal run halts their dispatch. Worktrees, artifacts and history
      // stay, and each live session keeps its reservation until it exits.
      for (const dispatch of engine.scheduling.list())
        if (dispatch.runId === run.id && dispatch.state === "active")
          engine.cancelTask(dispatch.taskId, `${key}:${dispatch.taskId}`, null);
      return stopped;
    },
  );
  signalStops(engine, result.stopId);
  return result;
}

export function emergencyStop(engine: Engine, input: unknown, key: string) {
  z.strictObject({}).parse(input);
  const { store } = engine;
  const result = mutate(
    store.db,
    key,
    "emergencyStop",
    {},
    stopResultSchema,
    () => {
      const paused: string[] = [];
      for (const run of store.listRuns())
        if (run.status === "active") {
          store.updateRun(
            { id: run.id, status: "paused" },
            `${key}:${run.id}:pause`,
          );
          paused.push(run.id);
        }
      // Targets only sessions this app reserved; manual harness sessions and
      // other processes are never discovered or signalled.
      return recordStops(engine, "emergency", () => true, paused);
    },
  );
  signalStops(engine, result.stopId);
  return result;
}
