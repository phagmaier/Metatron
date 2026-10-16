import assert from "node:assert/strict";
import { test } from "node:test";
import { CodexEvents } from "../src/server/adapters/codex-events.ts";

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
    ["quota", "turn_completed"],
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
