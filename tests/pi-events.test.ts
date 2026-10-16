import assert from "node:assert/strict";
import { test } from "node:test";
import { PiEvents } from "../src/server/adapters/pi-events.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";

test("Pi waits for agent_settled and the final assistant stop reason, never prompt acceptance or agent_end", () => {
  const mapper = new PiEvents();
  assert.deepEqual(
    mapper.consume({ type: "agent_end", messages: [], willRetry: false }),
    [],
  );
  assert.deepEqual(
    mapper.consume({ type: "response", command: "prompt", success: true }),
    [],
  );
  assert.deepEqual(
    mapper.consume({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: " hello \u2028 world ",
      },
    }),
    [{ type: "text_delta", text: " hello \u2028 world " }],
  );
  assert.deepEqual(
    mapper.consume({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        usage: { input: 2, output: 3 },
      },
    }),
    [
      {
        type: "usage",
        inputTokens: 2,
        outputTokens: 3,
        source: "pi native assistant message",
      },
    ],
  );
  assert.deepEqual(mapper.consume({ type: "agent_settled", aborted: false }), [
    { type: "turn_completed", nativeStatus: "completed" },
  ]);
});
test("Pi maps auth/quota, aborts and unexplained exits without inventing task success or leaking native errors", () => {
  for (const [message, code] of [
    ["401 bad API key secret-token", "auth"],
    ["429 credits exhausted secret-token", "quota"],
  ]) {
    const mapper = new PiEvents();
    const events = mapper.consume({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: message,
      },
    });
    assert.equal(events[0]?.type, "session_error");
    assert.ok(JSON.stringify(events).includes(String(code)));
    assert.ok(!JSON.stringify(events).includes("secret-token"));
    assert.deepEqual(
      mapper.consume({ type: "agent_settled", aborted: false }),
      [{ type: "turn_completed", nativeStatus: "failed" }],
    );
  }
  assert.deepEqual(
    new PiEvents().consume({ type: "agent_settled", aborted: true }),
    [{ type: "turn_completed", nativeStatus: "interrupted" }],
  );
  assert.deepEqual(
    new PiEvents().consume({ type: "transport_exit", code: 0 }),
    [{ type: "process_state", state: "exited", exitCode: 0 }],
  );
  assert.deepEqual(
    new PiEvents().consume({ type: "agent_settled", aborted: false }),
    [{ type: "turn_completed", nativeStatus: "failed" }],
  );
  const deadline = new PiEvents().consume({
    type: "transport_error",
    reason: "deadline",
  });
  assert.equal(deadline[0]?.type, "session_error");
  assert.ok(JSON.stringify(deadline).includes('"code":"deadline"'));
});
test("RPC subprocess correlates responses, preserves Unicode separators, records exit and rejects malformed frames", async () => {
  const script = `let b='';process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){const v=JSON.parse(b.slice(0,i));b=b.slice(i+1);process.stdout.write(JSON.stringify({id:v.id,type:'response',command:v.type,success:true,data:{echo:v.type}})+'\\n');process.stdout.write(JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'a\u2028b'}})+'\\n')}});`;
  const rpc = new PiRpc(
    process.execPath,
    ["--input-type=module", "-e", script],
    "/tmp",
    process.env,
  );
  const records: unknown[] = [];
  rpc.subscribe((e) => records.push(e));
  try {
    assert.deepEqual(
      await Promise.all([rpc.request("one"), rpc.request("two")]),
      [{ echo: "one" }, { echo: "two" }],
    );
  } finally {
    const exit = await rpc.close();
    assert.equal(exit.code, 0);
  }
  assert.ok(JSON.stringify(records).includes("a\u2028b"));
  const bad = new PiRpc(
    process.execPath,
    ["-e", "process.stdout.write('not-json\\n');setTimeout(()=>{},5000)"],
    "/tmp",
    process.env,
  );
  const error = new Promise((resolve) =>
    bad.subscribe((e) => {
      if (e.type === "transport_error") resolve(e);
    }),
  );
  await error;
  const exit = await bad.close();
  assert.equal(exit.signal, "SIGTERM");
});
