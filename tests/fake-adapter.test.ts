import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { SessionEvent } from "../src/server/adapters/contract.ts";
import { FakeAdapter } from "../src/server/adapters/fake.ts";
import { fakeSessionInput } from "./helpers/domain-fixture.ts";

async function collect(source: AsyncIterable<SessionEvent>) {
  const events: SessionEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

test("fake playback is deterministic, records prompts and reports discovered capability limits", async () => {
  const adapter = new FakeAdapter();
  const capabilities = await adapter.discover();
  assert.equal(capabilities.adapter, "fake");
  assert.equal(capabilities.supportsToolGateway, false);
  assert.deepEqual(capabilities.models[0]?.thinking, []);
  await assert.rejects(
    adapter.startSession({ ...fakeSessionInput(), thinking: "unsupported" }),
    { code: "UNSUPPORTED" },
  );
  const session = await adapter.startSession(fakeSessionInput());
  const events = await collect(adapter.prompt(session, "First prompt"));
  assert.deepEqual(
    events.map((e) => e.type),
    ["process_state", "text_delta", "turn_completed"],
  );
  assert.deepEqual(adapter.history(session).prompts, ["First prompt"]);
});

test("text deltas preserve whitespace exactly for native streaming compatibility", async () => {
  const adapter = new FakeAdapter([[{ type: "text_delta", text: " \n " }]]);
  const session = await adapter.startSession(fakeSessionInput());
  assert.deepEqual(
    (await collect(adapter.prompt(session, "Whitespace"))).at(-1),
    { type: "text_delta", text: " \n " },
  );
});
test("permission pause waits for matching human decision while steering queues", async () => {
  const adapter = new FakeAdapter([
    [
      {
        type: "approval_requested",
        nativeRequestId: "permission-1",
        details: "FAKE permission",
      },
      { type: "turn_completed", nativeStatus: "completed" },
    ],
  ]);
  const session = await adapter.startSession(fakeSessionInput());
  const iterator = adapter.prompt(session, "Begin")[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value?.type, "process_state");
  assert.equal(await adapter.steer(session, "Live steer"), "sent");
  assert.deepEqual((await iterator.next()).value, {
    type: "process_state",
    state: "waiting_permission",
    exitCode: null,
  });
  assert.equal((await iterator.next()).value?.type, "approval_requested");
  assert.equal(await adapter.steer(session, "After permission"), "queued");
  await assert.rejects(adapter.respondToApproval(session, "wrong", "approve"), {
    code: "NOT_FOUND",
  });
  await adapter.respondToApproval(session, "permission-1", "approve");
  assert.equal((await iterator.next()).value?.type, "process_state");
  assert.deepEqual((await iterator.next()).value, {
    type: "turn_completed",
    nativeStatus: "completed",
  });
  assert.equal((await iterator.next()).done, true);
  assert.deepEqual(adapter.history(session).steering, [
    "Live steer",
    "After permission",
  ]);
});
test("cancellation unblocks a pending permission and yields interruption", async () => {
  const adapter = new FakeAdapter([
    [
      { type: "approval_requested", nativeRequestId: "p", details: "Pause" },
      { type: "text_delta", text: "Should never appear" },
    ],
  ]);
  const session = await adapter.startSession(fakeSessionInput());
  const iterator = adapter.prompt(session, "Begin")[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  await iterator.next();
  const pending = iterator.next();
  await adapter.cancel(session);
  assert.deepEqual((await pending).value, {
    type: "turn_completed",
    nativeStatus: "interrupted",
  });
  assert.equal((await iterator.next()).done, true);
  await assert.rejects(collect(adapter.prompt(session, "No rerun")), {
    code: "CONFLICT",
  });
});
test("disconnect is ambiguous and resumes only against the original task and repository", async () => {
  const adapter = new FakeAdapter([
    [{ type: "process_state", state: "disconnected", exitCode: null }],
    [{ type: "turn_completed", nativeStatus: "completed" }],
  ]);
  const input = fakeSessionInput();
  const session = await adapter.startSession(input);
  const events = await collect(adapter.prompt(session, "Ambiguous"));
  assert.equal(
    events.some((e) => e.type === "turn_completed"),
    false,
  );
  await assert.rejects(
    adapter.resume(session.nativeSessionId, { ...input, taskId: randomUUID() }),
    { code: "INVALID_REFERENCE" },
  );
  await assert.rejects(
    adapter.resume(session.nativeSessionId, {
      ...input,
      cwd: "/tmp/another-repo",
    }),
    { code: "INVALID_REFERENCE" },
  );
  await assert.rejects(
    collect(adapter.prompt(session, "No implicit reconnect")),
    { code: "CONFLICT" },
  );
  const resumed = await adapter.resume(session.nativeSessionId, input);
  assert.equal(resumed.nativeSessionId, session.nativeSessionId);
  assert.equal(
    (await collect(adapter.prompt(resumed, "Explicit resume"))).at(-1)?.type,
    "turn_completed",
  );
});
test("crash, clean exit, quota exhaustion and silent playback never invent success", async () => {
  const scenarios: SessionEvent[][] = [
    [{ type: "process_state", state: "crashed", exitCode: 139 }],
    [{ type: "process_state", state: "exited", exitCode: 0 }],
    [
      {
        type: "session_error",
        code: "quota_exhausted",
        recoverable: true,
        message: "FAKE quota",
      },
    ],
    [],
  ];
  for (const script of scenarios) {
    const adapter = new FakeAdapter([script]);
    const session = await adapter.startSession(fakeSessionInput());
    const events = await collect(adapter.prompt(session, "Failure simulation"));
    assert.equal(
      events.some((e) => e.type === "turn_completed"),
      false,
    );
    if (script[0]?.type === "process_state") {
      assert.deepEqual(events.at(-1), script[0]);
      await assert.rejects(
        adapter.resume(session.nativeSessionId, session.input),
        { code: "CONFLICT" },
      );
    }
  }
});
test("concurrent prompts are rejected and disposal ends the owned fake session", async () => {
  const adapter = new FakeAdapter();
  const session = await adapter.startSession(fakeSessionInput());
  const iterator = adapter.prompt(session, "One")[Symbol.asyncIterator]();
  await iterator.next();
  await assert.rejects(collect(adapter.prompt(session, "Two")), {
    code: "CONFLICT",
  });
  await adapter.dispose(session);
  assert.deepEqual((await iterator.next()).value, {
    type: "turn_completed",
    nativeStatus: "interrupted",
  });
  await assert.rejects(adapter.steer(session, "Gone"), { code: "NOT_FOUND" });
});
