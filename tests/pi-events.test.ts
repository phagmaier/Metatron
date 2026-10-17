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
        source: "pi native assistant message (may be partial)",
      },
    ],
  );
  assert.deepEqual(mapper.consume({ type: "agent_settled", aborted: false }), [
    { type: "turn_completed", nativeStatus: "completed" },
  ]);
});
test("Pi classifies only explicit provider failures, without leaking native errors or inferring exhaustion from usage", () => {
  for (const [message, code] of [
    ["401 bad API key secret-token", "auth"],
    ["429 credits exhausted secret-token", "credits_exhausted"],
    ["429 Too Many Requests secret-token", "rate_limit"],
    ["insufficient_quota secret-token", "usage_limit"],
    ["Credit balance unavailable secret-token", "native_error"],
    ["Unable to read API key usage secret-token", "native_error"],
    ["403 request forbidden secret-token", "native_error"],
    ["Quota report unavailable secret-token", "native_error"],
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
});
test("Pi aborts and unexplained exits never imply provider failure or task success", () => {
  const aborted = new PiEvents().consume({
    type: "message_end",
    message: { role: "assistant", stopReason: "aborted", errorMessage: "401" },
  });
  assert.equal(
    aborted[0]?.type === "session_error" && aborted[0].code,
    "native_error",
  );
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
test("RPC separates a native request rejection from a process exit without leaking native error text", async () => {
  const script = `let b='',n=0;process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){const v=JSON.parse(b.slice(0,i));b=b.slice(i+1);if(++n>1)process.exit(3);process.stdout.write(JSON.stringify({id:v.id,type:'response',command:v.type,success:false,error:'fixture-secret'})+'\\n')}});`;
  const rpc = new PiRpc(process.execPath, ["-e", script], "/tmp", process.env);
  try {
    await assert.rejects(rpc.request("set_model"), (error: Error) => {
      assert.equal("code" in error && error.code, "NATIVE_REJECTED");
      assert.ok(!error.message.includes("fixture-secret"));
      return true;
    });
    await assert.rejects(rpc.request("get_state"), {
      code: "NATIVE_TRANSPORT",
    });
    await assert.rejects(rpc.request("get_state"), {
      code: "NATIVE_TRANSPORT",
    });
  } finally {
    assert.equal((await rpc.close()).code, 3);
  }
});
