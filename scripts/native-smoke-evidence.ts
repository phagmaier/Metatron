import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Engine } from "../src/server/orchestration/engine.ts";
import type { Event } from "../src/shared/domain/entities.ts";

type SmokeEvent = Pick<Event, "sequence" | "type" | "payload">;
export type CancellationRequest = {
  afterTextSequence: number;
  requestSequence: number;
};

export function smokeEvents(engine: Engine, runId: string, taskId?: string) {
  const events: Event[] = [];
  for (let after = 0; ; ) {
    const page = engine.store.events({ runId, taskId, after, limit: 500 });
    events.push(...page);
    const last = page.at(-1);
    if (page.length < 500 || !last) return events;
    after = last.sequence;
  }
}

export function streamEvidence(events: SmokeEvent[], harness: string) {
  const deltas = events.filter(
    (e) =>
      e.type === `${harness}.text_delta` &&
      typeof e.payload.text === "string" &&
      e.payload.text.length > 0,
  );
  const terminals = events
    .filter((e) => e.type === `${harness}.turn_completed`)
    .map((e) => ({
      sequence: e.sequence,
      nativeStatus: e.payload.nativeStatus,
    }));
  const first = deltas.at(0)?.sequence ?? null;
  const last = deltas.at(-1)?.sequence ?? null;
  return {
    deltaCount: deltas.length,
    firstDeltaSequence: first,
    lastDeltaSequence: last,
    samples: deltas.slice(0, 3).map((e) => ({
      sequence: e.sequence,
      text: String(e.payload.text).slice(0, 160),
    })),
    terminals,
    streamedBeforeTerminal:
      first !== null &&
      last !== null &&
      terminals.length === 1 &&
      last < (terminals[0]?.sequence ?? 0),
  };
}

export async function settleSmoke(engine: Engine) {
  for (let tries = 0; ; tries++) {
    try {
      await engine.idle();
      return;
    } catch (error) {
      if (
        !(error instanceof Error && /deadline/.test(error.message) && tries < 5)
      )
        throw error;
    }
  }
}

export async function cancelAfterText(
  engine: Engine,
  runId: string,
  taskId: string,
  harness: string,
): Promise<CancellationRequest> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const events = smokeEvents(engine, runId, taskId);
    assert.equal(
      events.some((e) => e.type === `${harness}.turn_completed`),
      false,
      "Turn ended before active cancellation could be observed; never replay it",
    );
    const delta = events.findLast(
      (e) =>
        e.type === `${harness}.text_delta` &&
        typeof e.payload.text === "string" &&
        e.payload.text.length > 0,
    );
    if (delta && engine.nativeStops.has(taskId)) {
      assert.equal(engine.store.getTask(taskId).status, "RUNNING");
      // Journal observation and stop synchronously: no event-loop gap can turn
      // an already completed turn into a claimed active-cancellation PASS.
      const requested = engine.store.recordEvent(
        {
          runId,
          taskId,
          type: "smoke.cancel_requested",
          correlationId: taskId,
          payload: { afterTextSequence: delta.sequence },
        },
        `smoke-cancel:${randomUUID()}`,
      );
      engine.cancel(taskId, `smoke-stop:${randomUUID()}`);
      return {
        afterTextSequence: delta.sequence,
        requestSequence: requested.sequence,
      };
    }
    assert.ok(
      Date.now() < deadline,
      "No active text observed before stop deadline",
    );
    await delay(25);
  }
}

export function cancellationEvidence(
  engine: Engine,
  runId: string,
  taskId: string,
  harness: string,
  request: CancellationRequest,
) {
  const events = smokeEvents(engine, runId, taskId);
  const stream = streamEvidence(events, harness);
  const attempt = engine.store.listAttempts().find((a) => a.taskId === taskId);
  const session = engine.store
    .listSessions()
    .find((s) => s.attemptId === attempt?.id);
  const terminal = stream.terminals[0];
  const processExit = events
    .filter((e) => e.type === `${harness}.process_exit`)
    .map((e) => e.payload);
  const sessionErrors = events
    .filter((e) => e.type === `${harness}.session_error`)
    .map((e) => e.payload);
  const checks = {
    textBeforeRequest: request.afterTextSequence < request.requestSequence,
    nativeInterruptedAfterRequest:
      stream.streamedBeforeTerminal &&
      terminal?.nativeStatus === "interrupted" &&
      terminal.sequence > request.requestSequence,
    taskCancelled: engine.store.getTask(taskId).status === "CANCELLED",
    ownedShutdown:
      session?.state === "exited" &&
      session.exitCode === 0 &&
      processExit.length === 1 &&
      processExit[0]?.exitCode === 0 &&
      processExit[0]?.signal === null &&
      processExit[0]?.interrupted === true,
    noSessionError: sessionErrors.length === 0,
    noSuccessReport: !events.some((e) =>
      ["worker.result", "report.saved", "lead.message"].includes(e.type),
    ),
  };
  return {
    checks,
    request,
    stream,
    nativeSessionId: session?.nativeSessionId ?? null,
    taskStatus: engine.store.getTask(taskId).status,
    sessionState: session?.state ?? null,
    exitCode: session?.exitCode ?? null,
    processExit,
    sessionErrors,
  };
}
