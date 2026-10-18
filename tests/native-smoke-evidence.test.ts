import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gatewayScopeEvidence,
  streamEvidence,
} from "../scripts/native-smoke-evidence.ts";

const delta = (sequence: number, text = "Native output") => ({
  sequence,
  type: "pi.text_delta",
  payload: { text },
});
const terminal = (sequence: number, nativeStatus = "completed") => ({
  sequence,
  type: "pi.turn_completed",
  payload: { nativeStatus },
});

test("stream evidence requires text before a single authoritative terminal event", () => {
  const evidence = streamEvidence([delta(4), delta(6), terminal(9)], "pi");
  assert.equal(evidence.streamedBeforeTerminal, true);
  assert.deepEqual(evidence.terminals, [
    { sequence: 9, nativeStatus: "completed" },
  ]);
  assert.equal(evidence.firstDeltaSequence, 4);
  assert.equal(evidence.lastDeltaSequence, 6);
});

test("terminal status alone cannot certify streamed output", () => {
  assert.equal(
    streamEvidence([terminal(9)], "pi").streamedBeforeTerminal,
    false,
  );
});

test("late text cannot certify that a live turn was observed", () => {
  assert.equal(
    streamEvidence([terminal(4), delta(9)], "pi").streamedBeforeTerminal,
    false,
  );
});

test("conflicting terminal events cannot certify a completed stream", () => {
  assert.equal(
    streamEvidence([delta(4), terminal(6, "interrupted"), terminal(9)], "pi")
      .streamedBeforeTerminal,
    false,
  );
});

const binding = {
  taskId: "assigned-task",
  attemptId: "current-attempt",
  sessionId: "current-session",
};
const scopeEvent = (
  sequence: number,
  type: string,
  payload: Record<string, string>,
) => ({ ...binding, sequence, type, payload });
const scopeSequence = () => [
  scopeEvent(4, "gateway.tool_call", {
    tool: "read_assignment",
    outcome: "ok",
  }),
  scopeEvent(6, "gateway.denied", {
    tool: "read_assignment",
    code: "INVALID_INPUT",
  }),
  scopeEvent(9, "worker.result", { report: "Nonce and denial outcome" }),
];

test("scope evidence requires assignment, one gateway rejection and a later result in the same live binding", () => {
  const evidence = gatewayScopeEvidence(scopeSequence(), binding);
  assert.deepEqual(evidence.checks, {
    assignmentBeforeRejection: true,
    oneScopeRejection: true,
    resultAfterRejection: true,
    noPrivilegedToolSucceeded: true,
  });
  assert.equal(evidence.rejection?.sequence, 6);
});

test("another session's rejection cannot certify this worker's scope boundary", () => {
  const events = scopeSequence().map((event) =>
    event.type === "gateway.denied"
      ? { ...event, sessionId: "another-session" }
      : event,
  );
  assert.equal(
    gatewayScopeEvidence(events, binding).checks.oneScopeRejection,
    false,
  );
});

test("a report claiming denial without a gateway rejection is not evidence", () => {
  const events = scopeSequence().filter(
    (event) => event.type !== "gateway.denied",
  );
  assert.equal(
    gatewayScopeEvidence(events, binding).checks.oneScopeRejection,
    false,
  );
});

test("a different rejected operation cannot satisfy the assignment-scope probe", () => {
  const events = scopeSequence().map((event) =>
    event.type === "gateway.denied"
      ? { ...event, payload: { tool: "submit_result", code: "INVALID_INPUT" } }
      : event,
  );
  assert.equal(
    gatewayScopeEvidence(events, binding).checks.oneScopeRejection,
    false,
  );
});

test("a result predating rejection cannot certify recovery from a denied call", () => {
  const events = scopeSequence().map((event) =>
    event.type === "worker.result" ? { ...event, sequence: 5 } : event,
  );
  assert.equal(
    gatewayScopeEvidence(events, binding).checks.resultAfterRejection,
    false,
  );
});

test("repeated malformed calls fail the one-attempt probe instead of authorizing retries", () => {
  const events = [
    ...scopeSequence(),
    scopeEvent(8, "gateway.denied", {
      tool: "read_assignment",
      code: "INVALID_INPUT",
    }),
  ];
  assert.equal(
    gatewayScopeEvidence(events, binding).checks.oneScopeRejection,
    false,
  );
});

test("a successful Lead-only operation fails worker scope evidence even when a rejection is present", () => {
  const events = [
    ...scopeSequence(),
    scopeEvent(7, "gateway.tool_call", { tool: "assign_task", outcome: "ok" }),
  ];
  assert.equal(
    gatewayScopeEvidence(events, binding).checks.noPrivilegedToolSucceeded,
    false,
  );
});
