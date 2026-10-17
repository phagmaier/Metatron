import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

// Deterministic Codex app-server protocol fixture. It never contacts a model
// provider; scripted "Lead" turns call the real session gateway over MCP.
const scenario = process.env.LAO_CODEX_FIXTURE_SCENARIO ?? "delegate";
const home = process.env.CODEX_HOME ?? "";
const disabled = process.argv.flatMap((arg, i) =>
  process.argv[i - 1] === "--disable" ? [arg] : [],
);
const log = (entry: object) => {
  if (process.env.LAO_CODEX_FIXTURE_LOG)
    appendFileSync(
      process.env.LAO_CODEX_FIXTURE_LOG,
      `${JSON.stringify({ pid: process.pid, ...entry })}\n`,
    );
};
const emit = (value: object) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);
const notify = (method: string, params: object) => emit({ method, params });
let gateway: { url: string; token: string; approved: boolean } | null = null;
let threadId = "";
let active: { id: string; done: boolean } | null = null;
let rpc = 0;
const serverRequests = new Map<
  string | number,
  (message: { result?: unknown; error?: unknown }) => void
>();
async function approval(id: string | number, method: string) {
  const response = new Promise<{ result?: unknown; error?: unknown }>(
    (resolve) => serverRequests.set(id, resolve),
  );
  emit({
    id,
    method,
    params: {
      threadId,
      turnId: active?.id,
      itemId: `item-${id}`,
      command: "fixture-secret",
      reason: "fixture-secret",
      permissions: {
        network: { enabled: true },
        fileSystem: { write: ["/fixture-secret"] },
      },
    },
  });
  const timer = setTimeout(() => {
    log({ approvalTimeout: method });
    finish("failed");
  }, 2000);
  try {
    return await response;
  } finally {
    clearTimeout(timer);
    serverRequests.delete(id);
  }
}
async function mcp(method: string, params: object = {}) {
  if (!gateway) throw new Error("No gateway configured");
  const response = await fetch(gateway.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${gateway.token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpc++, method, params }),
  });
  if (!response.ok) return { httpStatus: response.status };
  return z
    .object({ result: z.unknown().optional() })
    .loose()
    .parse(await response.json());
}
async function tool(name: string, args: object = {}) {
  // Like installed Codex, refuse non-read-only MCP tools under approval
  // "never" unless the server's tools are pre-approved in thread config.
  if (!gateway?.approved && !/^(get|list|read)_/.test(name)) {
    log({ tool: name, refusedNatively: true });
    return { error: { code: "NATIVE_APPROVAL_REQUIRED" } };
  }
  const id = randomUUID();
  notify("item/started", {
    threadId,
    turnId: active?.id,
    item: { id, type: "mcpToolCall", server: "lao", tool: name },
  });
  const reply = await mcp("tools/call", { name, arguments: args });
  const result = z
    .object({
      structuredContent: z.record(z.string(), z.unknown()),
      isError: z.boolean(),
    })
    .parse(reply.result);
  notify("item/completed", {
    threadId,
    turnId: active?.id,
    item: {
      id,
      type: "mcpToolCall",
      server: "lao",
      tool: name,
      status: result.isError ? "failed" : "completed",
    },
  });
  log({ tool: name, isError: result.isError });
  return result.isError
    ? { error: result.structuredContent.error as { code: string } }
    : { value: result.structuredContent.result };
}
function say(text: string) {
  const itemId = randomUUID();
  notify("item/started", {
    threadId,
    turnId: active?.id,
    item: { id: itemId, type: "agentMessage" },
  });
  notify("item/agentMessage/delta", {
    threadId,
    turnId: active?.id,
    itemId,
    delta: text,
  });
}
function finish(status: "completed" | "interrupted" | "failed") {
  if (!active || active.done) return;
  active.done = true;
  notify("thread/tokenUsage/updated", {
    threadId,
    turnId: active.id,
    tokenUsage: { last: { inputTokens: 11, outputTokens: 7 }, total: {} },
  });
  notify("turn/completed", {
    threadId,
    turn: { id: active.id, status, items: [], error: null },
  });
  log({ turn: "end", status });
}
const rosterSchema = z.object({
  roster: z.array(z.object({ profileId: z.string(), role: z.string() })),
});
async function lead(prompt: string) {
  if (scenario === "hold") return;
  if (scenario.startsWith("provider-")) {
    await delay(Number(process.env.LAO_CODEX_PROVIDER_DELAY ?? 0));
    for (let i = 0; i < 2; i++)
      notify("error", {
        threadId,
        turnId: active?.id,
        willRetry: false,
        error: {
          codexErrorInfo:
            scenario === "provider-auth"
              ? "unauthorized"
              : scenario === "provider-rate"
                ? "rateLimitExceeded"
                : "usageLimitExceeded",
          message: "fixture-secret",
        },
      });
    finish("failed");
    return;
  }
  if (scenario === "permissions") {
    const requests: [string | number, string][] = [
      [901, "item/commandExecution/requestApproval"],
      [901, "item/commandExecution/requestApproval"],
      ["901", "item/commandExecution/requestApproval"],
      [902, "item/fileChange/requestApproval"],
      [903, "item/permissions/requestApproval"],
      [904, "execCommandApproval"],
      [905, "applyPatchApproval"],
      [906, "mcpServer/elicitation/request"],
      [907, "future/approval"],
    ];
    for (const [id, method] of requests) {
      const answer = await approval(id, method);
      log({ approval: method, ...answer });
    }
    say("Protocol fixture permissions denied; no tools executed.");
    return finish("completed");
  }
  if (scenario === "delegation_item") {
    notify("item/started", {
      threadId,
      turnId: active?.id,
      item: { id: randomUUID(), type: "collabAgentToolCall" },
    });
    return;
  }
  if (scenario === "slow") await delay(300);
  const status = rosterSchema.parse((await tool("get_run_status")).value);
  const reader = status.roster.find((r) => r.role === "Reader");
  if (!prompt.includes("Run objective")) {
    const tasks = z
      .array(z.object({ taskId: z.string(), status: z.string() }))
      .parse((await tool("list_tasks")).value);
    const reviewed = tasks.filter((t) => t.status === "AWAITING_REVIEW");
    const reports = [];
    for (const task of reviewed) {
      const report = z
        .object({
          structuredReport: z.object({ summary: z.string() }).nullable(),
          toolSubmitted: z.boolean(),
        })
        .parse((await tool("read_report", { taskId: task.taskId })).value);
      reports.push(
        `${report.structuredReport?.summary ?? "none"} (tool-submitted ${report.toolSubmitted})`,
      );
    }
    say(`Worker reports: ${reports.join("; ")}`);
    return finish("completed");
  }
  const count = scenario === "fanout" ? 2 : 1;
  const outcomes = [];
  for (let i = 0; i < count; i++) {
    const proposed = z.object({ id: z.string() }).parse(
      (
        await tool("propose_task", {
          title: `Read README ${i}`,
          objective: "Report the README heading",
        })
      ).value,
    );
    if (scenario === "deny") {
      const worker = await tool("submit_result", {
        taskId: proposed.id,
        report: "Lead impersonating a worker",
      });
      const foreign = await tool("assign_task", {
        taskId: proposed.id,
        profileId: randomUUID(),
      });
      outcomes.push(
        `denied ${worker.error?.code ?? "none"}, ${foreign.error?.code ?? "none"}`,
      );
    }
    const assigned = await tool("assign_task", {
      taskId: proposed.id,
      profileId: reader?.profileId,
    });
    outcomes.push(
      assigned.error
        ? `assign ${assigned.error.code}`
        : `assigned ${proposed.id}`,
    );
  }
  say(`Lead turn: ${outcomes.join("; ")}`);
  finish("completed");
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += String(chunk);
  while (buffer.includes("\n")) {
    const end = buffer.indexOf("\n");
    const message = z
      .object({
        id: z.union([z.number(), z.string()]).optional(),
        method: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        result: z.unknown().optional(),
        error: z.unknown().optional(),
      })
      .parse(JSON.parse(buffer.slice(0, end)));
    buffer = buffer.slice(end + 1);
    if (message.id === undefined) continue;
    if (!message.method) {
      serverRequests.get(message.id)?.(message);
      continue;
    }
    if (typeof message.id !== "number")
      throw new Error("Expected a numeric client request id");
    void handle(message.id, message.method, message.params ?? {}).catch(
      (error: unknown) =>
        emit({
          id: message.id,
          error: { code: -32000, message: String(error) },
        }),
    );
  }
});
const threads = join(home, "fixture-threads");
function configure(params: Record<string, unknown>) {
  const config = z
    .object({
      mcp_servers: z.object({
        lao: z.object({
          url: z.string(),
          bearer_token_env_var: z.string(),
          default_tools_approval_mode: z.string().optional(),
        }),
      }),
    })
    .parse(params.config);
  gateway = {
    url: config.mcp_servers.lao.url,
    token: process.env[config.mcp_servers.lao.bearer_token_env_var] ?? "",
    approved: config.mcp_servers.lao.default_tools_approval_mode === "approve",
  };
  return {
    thread: { id: threadId },
    model: params.model,
    approvalPolicy: params.approvalPolicy,
    sandbox: {
      type: params.sandbox === "read-only" ? "readOnly" : "workspaceWrite",
      networkAccess: false,
    },
  };
}
async function handle(
  id: number,
  method: string,
  params: Record<string, unknown>,
) {
  log({ method, ...(params.threadId ? { threadId: params.threadId } : {}) });
  let result: unknown = {};
  switch (method) {
    case "initialize":
      result = { codexHome: home, platformOs: "linux" };
      break;
    case "experimentalFeature/list":
      result = {
        data: ["multi_agent", "apps", "plugins", "hooks"].map((name) => ({
          name,
          enabled:
            process.env.LAO_CODEX_FIXTURE_FEATURES_ON === "1" ||
            !disabled.includes(name),
        })),
      };
      break;
    case "account/read":
      result = {
        account:
          process.env.LAO_CODEX_FIXTURE_AUTH === "none"
            ? null
            : { type: "apiKey" },
      };
      break;
    case "model/list":
      result = {
        data: [
          {
            id: "fixture-model",
            displayName: "Protocol fixture",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Fast" },
              {
                reasoningEffort: "ultra",
                description: "Maximum reasoning with automatic task delegation",
              },
            ],
          },
        ],
        nextCursor: null,
      };
      break;
    case "thread/start":
      threadId = randomUUID();
      mkdirSync(threads, { recursive: true });
      writeFileSync(join(threads, threadId), "fixture thread");
      result = configure(params);
      break;
    case "thread/resume":
      threadId = String(params.threadId);
      if (!existsSync(join(threads, threadId)))
        throw new Error("Unknown thread");
      result = configure(params);
      break;
    case "mcpServerStatus/list": {
      await mcp("initialize", { protocolVersion: "2025-06-18" });
      const listed = z
        .object({ tools: z.array(z.object({ name: z.string() })) })
        .safeParse((await mcp("tools/list")).result);
      result = {
        data: [
          {
            name: "lao",
            runtimeStatus: listed.success ? "connected" : "failed",
            tools: listed.success
              ? Object.fromEntries(listed.data.tools.map((t) => [t.name, t]))
              : {},
          },
        ],
      };
      break;
    }
    case "turn/start": {
      active = { id: randomUUID(), done: false };
      const input = z.array(z.object({ text: z.string() })).parse(params.input);
      result = { turn: { id: active.id, status: "inProgress", items: [] } };
      emit({ id, result });
      log({ turn: "start", effort: params.effort ?? null });
      void lead(input[0]?.text ?? "").catch((error: unknown) => {
        log({ error: String(error) });
        finish("failed");
      });
      return;
    }
    case "turn/interrupt":
      emit({ id, result: {} });
      finish("interrupted");
      return;
  }
  emit({ id, result });
}
