import assert from "node:assert/strict";
import { test } from "node:test";
import { CodexEvents } from "../src/server/adapters/codex-events.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";

const threadId = "thread-1";
const item = (method: string, value: object) => ({
  method,
  params: { threadId, turnId: "turn-1", item: value },
});
test("Codex completes only on its own turn/completed and maps statuses, tools and usage", () => {
  const mapper = new CodexEvents(threadId);
  mapper.start("turn-1");
  assert.deepEqual(
    mapper.consume({
      method: "item/agentMessage/delta",
      params: { threadId, delta: "Hello" },
    }),
    [{ type: "text_delta", text: "Hello" }],
  );
  assert.deepEqual(
    mapper.consume({
      method: "item/agentMessage/delta",
      params: { threadId: "other-thread", delta: "Ignored" },
    }),
    [],
  );
  assert.deepEqual(
    mapper.consume(
      item("item/started", {
        id: "tool-1",
        type: "mcpToolCall",
        server: "lao",
        tool: "get_run_status",
      }),
    ),
    [
      {
        type: "tool_started",
        toolId: "tool-1",
        summary: "mcp lao.get_run_status",
      },
    ],
  );
  // Installed 0.163.0 enables a native sleep tool; a silent wait still shows.
  assert.deepEqual(
    mapper.consume(
      item("item/completed", { id: "sleep-1", type: "sleep", durationMs: 5 }),
    ),
    [{ type: "tool_finished", toolId: "sleep-1", summary: "sleep · done" }],
  );
  assert.deepEqual(
    mapper.consume({
      method: "thread/tokenUsage/updated",
      params: {
        threadId,
        tokenUsage: { last: { inputTokens: 3, outputTokens: 2 } },
      },
    }),
    [],
  );
  assert.deepEqual(
    mapper.consume({
      method: "turn/completed",
      params: { threadId, turn: { id: "older-turn", status: "completed" } },
    }),
    [],
  );
  assert.deepEqual(
    mapper.consume({
      method: "turn/completed",
      params: { threadId, turn: { id: "turn-1", status: "interrupted" } },
    }),
    [
      {
        type: "usage",
        inputTokens: 3,
        outputTokens: 2,
        source: "codex thread token usage (last turn)",
      },
      { type: "turn_completed", nativeStatus: "interrupted" },
    ],
  );
});
test("Codex delegation items, final errors and exits never look like success", () => {
  const mapper = new CodexEvents(threadId);
  mapper.start("turn-1");
  assert.equal(
    mapper.consume(
      item("item/started", { id: "a", type: "subAgentActivity" }),
    )[0]?.type === "session_error",
    true,
  );
  assert.deepEqual(
    mapper.consume({
      method: "error",
      params: {
        threadId,
        willRetry: true,
        error: { codexErrorInfo: "serverOverloaded" },
      },
    }),
    [],
  );
  const [auth] = mapper.consume({
    method: "error",
    params: {
      threadId,
      willRetry: false,
      error: { message: "secret detail", codexErrorInfo: "unauthorized" },
    },
  });
  assert.equal(auth?.type === "session_error" && auth.code, "auth");
  assert.equal(JSON.stringify(auth).includes("secret detail"), false);
  const failed = mapper.consume({
    method: "turn/completed",
    params: {
      threadId,
      turn: {
        id: "turn-1",
        status: "failed",
        error: { codexErrorInfo: "usageLimitExceeded" },
      },
    },
  });
  assert.deepEqual(
    failed.map((e) => (e.type === "session_error" ? e.code : e.type)),
    ["usage_limit", "turn_completed"],
  );
  assert.deepEqual(
    mapper.consume({ method: "transport/exit", params: { code: 0 } }),
    [{ type: "process_state", state: "exited", exitCode: 0 }],
  );
  assert.deepEqual(
    mapper.consume({ method: "future/notification", params: {} }),
    [],
  );
});
test("Codex uses exact native error variants and keeps usage limits distinct from exhausted credits", () => {
  for (const [info, code] of [
    ["unauthorized", "auth"],
    ["rateLimitExceeded", "rate_limit"],
    ["usageLimitExceeded", "usage_limit"],
    ["sessionBudgetExceeded", "native_error"],
    [{ httpConnectionFailed: { httpStatusCode: 401 } }, "auth"],
    [{ responseStreamDisconnected: { httpStatusCode: 429 } }, "rate_limit"],
    [{ httpConnectionFailed: { httpStatusCode: 403 } }, "native_error"],
    [{ other: "unauthorized credits exhausted secret-token" }, "native_error"],
  ] as const) {
    const mapper = new CodexEvents(threadId);
    mapper.start("turn-1");
    assert.deepEqual(
      mapper.consume({
        method: "error",
        params: {
          threadId,
          turnId: "other-turn",
          willRetry: false,
          error: { codexErrorInfo: info },
        },
      }),
      [],
    );
    const [event] = mapper.consume({
      method: "error",
      params: {
        threadId,
        turnId: "turn-1",
        willRetry: false,
        error: { codexErrorInfo: info },
      },
    });
    assert.equal(event?.type === "session_error" && event.code, code);
    assert.ok(!JSON.stringify(event).includes("secret-token"));
  }
});
test("RPC separates a Codex request rejection from a process exit without leaking native error text", async () => {
  const script = `let b='',n=0;process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){const v=JSON.parse(b.slice(0,i));b=b.slice(i+1);if(++n>1)process.exit(3);process.stdout.write(JSON.stringify({id:v.id,error:{code:-32600,message:'fixture-secret'}})+'\\n')}});`;
  const rpc = new CodexRpc(
    process.execPath,
    ["-e", script],
    "/tmp",
    process.env,
  );
  try {
    await assert.rejects(rpc.request("thread/start"), (error: Error) => {
      assert.equal("code" in error && error.code, "NATIVE_REJECTED");
      assert.ok(!error.message.includes("fixture-secret"));
      return true;
    });
    await assert.rejects(rpc.request("turn/start"), {
      code: "NATIVE_TRANSPORT",
    });
    await assert.rejects(rpc.request("turn/start"), {
      code: "NATIVE_TRANSPORT",
    });
  } finally {
    assert.equal((await rpc.close()).code, 3);
  }
});
