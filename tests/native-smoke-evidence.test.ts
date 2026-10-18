import assert from "node:assert/strict";
import { test } from "node:test";
import { streamEvidence } from "../scripts/native-smoke-evidence.ts";

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
