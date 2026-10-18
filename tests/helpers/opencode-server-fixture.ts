import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

// Inert native boundary, not an OpenCode/model substitute: real HTTP/SSE and disposable file effects.
const scenario = process.argv[2] ?? "read";
const password = randomUUID();
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
const persisted = join(process.cwd(), "fixture-session.json");
const modelSchema = z.object({
  id: z.string(),
  providerID: z.string(),
  variant: z.string().optional(),
});
const sessionSchema = z.object({
  id: z.string(),
  agent: z.string(),
  model: modelSchema,
  permissions: z.array(
    z.object({
      action: z.string(),
      resource: z.string(),
      effect: z.enum(["allow", "ask", "deny"]),
    }),
  ),
  location: z.object({ directory: z.string() }),
  outcome: z.enum(["succeeded", "failed", "interrupted"]).optional(),
});
type NativeSession = z.infer<typeof sessionSchema>;
type Request = {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  source: { type: "tool"; messageID: string; id: string };
};
let session: NativeSession | undefined;
try {
  session = sessionSchema.parse(JSON.parse(await readFile(persisted, "utf8")));
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
let running = false;
let stage = 0;
let releaseConnection: (() => void) | undefined;
let releaseValidation: (() => void) | undefined;
let sourceFetched = false;
let validationReleased = false;
const subscribers = new Set<ServerResponse>();
const pending = new Map<
  string,
  {
    request: Request;
    path: string;
    input: Record<string, unknown>;
    tool: string;
  }
>();
const messages = new Map<string, object>();
const config = z
  .object({
    agents: z.object({
      metatron: z.object({
        system: z.string(),
        permissions: sessionSchema.shape.permissions,
      }),
    }),
    mcp: z
      .object({ servers: z.object({ lao: z.object({ url: z.string() }) }) })
      .optional(),
  })
  .parse(
    JSON.parse(
      await readFile(
        join(process.env.OPENCODE_CONFIG_DIR ?? "", "opencode.json"),
        "utf8",
      ),
    ),
  );
async function save() {
  await writeFile(persisted, JSON.stringify(session));
}
function event(type: string, data: object, foreign = false) {
  const value = {
    id: randomUUID(),
    type,
    location: { directory: foreign ? "/foreign" : session?.location.directory },
    data,
  };
  for (const response of subscribers)
    response.write(`data: ${JSON.stringify(value)}\n\n`);
}
async function gateway(name: string, args: object) {
  if (!config.mcp) return;
  const response = await fetch(config.mcp.servers.lao.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LAO_GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const value = z
    .object({ result: z.object({ isError: z.boolean() }) })
    .parse(await response.json());
  if (!response.ok || value.result.isError)
    throw new Error("Fixture gateway denied");
}
async function success() {
  if (!session) return;
  await gateway("submit_result", {
    outcome: "completed",
    summary: "Inert OpenCode HTTP boundary fixture",
    changedFiles: stage ? ["approved.txt"] : [],
    tests: [{ command: "Fixture: no test execution", result: "not_run" }],
  });
  session.outcome = "succeeded";
  running = false;
  if (scenario === "unreconciled") delete session.outcome;
  await save();
  event("session.execution.succeeded", { sessionID: session.id });
}
function ask(path: string, tool = "write") {
  if (!session) return;
  const id = `req_${randomUUID()}`;
  const messageID = `msg_${randomUUID()}`;
  const toolID = `tool_${randomUUID()}`;
  const actual = resolve(session.location.directory, path);
  const input =
    tool === "read"
      ? { path: actual }
      : { path: actual, content: "approved\n" };
  const request: Request = {
    id,
    sessionID: session.id,
    action: tool === "read" ? "read" : "edit",
    resources: [actual],
    source: { type: "tool", messageID, id: toolID },
  };
  const content = [
    {
      type: "tool",
      id: "unrelated-streaming-tool",
      name: "read",
      state: { status: "streaming", input: "partial JSON" },
    },
    {
      type: "tool",
      id: toolID,
      name: tool,
      state: { status: "running", input },
    },
  ];
  messages.set(messageID, {
    id: messageID,
    type: "assistant",
    agent: "metatron",
    model: session.model,
    content,
  });
  pending.set(id, { request, path: actual, input, tool });
  event("session.tool.input.started", {
    sessionID: session.id,
    assistantMessageID: messageID,
    id: toolID,
    name: tool,
  });
  event("session.tool.called", {
    sessionID: session.id,
    assistantMessageID: messageID,
    id: toolID,
    input,
    executed: true,
  });
  event("permission.asked", request);
}
async function start() {
  if (!session) return;
  running = true;
  delete session.outcome;
  await save();
  if (scenario === "cancel-connect")
    await writeFile(
      join(process.cwd(), "unapproved-prompt.txt"),
      "Native generation started after cancellation",
    );
  if (scenario === "ack-only") {
    for (const response of subscribers) response.end();
    return;
  }
  if (scenario === "foreign")
    event("session.execution.succeeded", { sessionID: "ses_foreign" }, true);
  event("session.execution.started", { sessionID: session.id });
  event("session.step.started", {
    sessionID: session.id,
    agent: "metatron",
    model:
      scenario === "model-drift"
        ? { ...session.model, variant: "high" }
        : session.model,
  });
  if (scenario === "disconnect") {
    for (const response of subscribers) response.end();
    return;
  }
  if (scenario === "unexpected-exit") {
    process.exit(130);
  }
  if (scenario === "active") {
    event("session.text.delta", {
      sessionID: session.id,
      assistantMessageID: "msg_active",
      ordinal: 0,
      delta: "generating\n",
    });
    return;
  }
  await gateway("read_assignment", {});
  if (
    ["approval", "retarget", "single-write"].includes(scenario) ||
    (scenario === "engine" &&
      config.agents.metatron.permissions.some(
        (rule) => rule.action === "edit" && rule.effect === "ask",
      ))
  ) {
    ask("approved.txt");
    return;
  }
  if (scenario === "secret") {
    ask(".env", "read");
    return;
  }
  if (scenario === "cancel-read") {
    ask("README.md", "read");
    return;
  }
  if (scenario === "read-only-write") {
    ask("approved.txt");
    return;
  }
  for (const delta of ["  native\n", "end\n"])
    event("session.text.delta", {
      sessionID: session.id,
      assistantMessageID: "msg_text",
      ordinal: 0,
      delta,
    });
  event("session.text.ended", {
    sessionID: session.id,
    assistantMessageID: "msg_text",
    ordinal: 0,
    text: "  native\nend\n",
  });
  event("session.message.content.updated", {
    sessionID: session.id,
    messageID: "msg_text",
    content: [{ type: "text", text: "  native\nend\n" }],
  });
  await success();
}
const server = createServer(async (request, response) => {
  const send = (data: unknown, status = 200) => {
    response
      .writeHead(status, { "Content-Type": "application/json" })
      .end(JSON.stringify(data));
  };
  if (request.headers.authorization !== authorization)
    return send({ error: "Unauthorized" }, 401);
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  try {
    if (path === "/api/info")
      return send({
        version: "2.0.29-fixture",
        pid: process.pid,
        urls: [origin],
      });
    if (path === "/api/model")
      return send({
        data:
          scenario === "no-models"
            ? []
            : [
                {
                  id: "model",
                  providerID: "fixture",
                  name: "Inert fixture, not native",
                  enabled: true,
                  variants: [{ id: "low" }, { id: "high" }],
                },
              ],
      });
    if (path === "/api/event") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
      });
      subscribers.add(response);
      response.on("close", () => subscribers.delete(response));
      const connected = () =>
        response.write(
          `data: ${JSON.stringify({ type: "server.connected" })}\n\n`,
        );
      if (scenario === "cancel-connect") {
        response.flushHeaders();
        releaseConnection = connected;
        await writeFile(
          join(process.cwd(), "fixture-awaiting-connect"),
          "ready",
        );
      } else connected();
      return;
    }
    if (path === "/api/plugin")
      return send({
        data: [
          "opencode.config.agent",
          "opencode.config.policy",
          "opencode.config.provider",
          "opencode.config.mcp",
          "opencode.tool.read",
          "opencode.tool.glob",
          "opencode.tool.grep",
          "opencode.tool.edit",
          "opencode.tool.write",
        ].map((id) => ({
          id,
          source: { type: "builtin" },
          state: { status: "active" },
        })),
      });
    if (path === "/api/agent/metatron")
      return send({ data: { id: "metatron", ...config.agents.metatron } });
    let body: unknown = {};
    if (request.method === "POST") {
      let text = "";
      for await (const chunk of request) text += String(chunk);
      if (text) body = JSON.parse(text);
    }
    if (path === "/api/session" && request.method === "POST") {
      const input = z
        .object({
          agent: z.string(),
          model: modelSchema,
          permissions: sessionSchema.shape.permissions,
          location: sessionSchema.shape.location,
        })
        .parse(body);
      session = { id: `ses_${randomUUID().replaceAll("-", "")}`, ...input };
      await save();
      return send({ data: session });
    }
    if (path === "/api/session/active")
      return send({
        data: running && session ? { [session.id]: { type: "running" } } : {},
      });
    if (path === "/api/mcp")
      return send({
        data: config.mcp
          ? [{ name: "lao", status: { status: "connected" } }]
          : [],
      });
    if (path === "/api/experimental/mcp/lao/connect") {
      response.writeHead(204).end();
      return;
    }
    if (session && path === `/api/experimental/session/${session.id}/wait`) {
      response.writeHead(204).end();
      return;
    }
    if (!session || !path.startsWith(`/api/session/${session.id}`))
      return send({ error: "NotFound" }, 404);
    const suffix = path.slice(`/api/session/${session.id}`.length);
    if (!suffix) {
      if (scenario === "cancel-read" && sourceFetched && !validationReleased) {
        releaseValidation = () => {
          validationReleased = true;
          send({ data: session });
        };
        await writeFile(
          join(process.cwd(), "fixture-awaiting-validation"),
          "ready",
        );
        return;
      }
      return send({ data: session });
    }
    if (suffix === "/prompt") {
      const prompt = z.object({ resume: z.boolean().optional() }).parse(body);
      send({
        data: {
          id: `inbox_${randomUUID()}`,
          type: "user",
          sessionID: session.id,
        },
      });
      if (prompt.resume !== false)
        void start().catch(() => {
          if (session)
            event("session.execution.failed", {
              sessionID: session.id,
              error: { type: "FixtureFailure" },
            });
        });
      return;
    }
    if (suffix === "/inbox") return send({ data: [] });
    if (suffix === "/interrupt") {
      const interrupted = running;
      releaseConnection?.();
      releaseValidation?.();
      if (scenario === "cancel-connect" || scenario === "cancel-read")
        await delay(200);
      running = false;
      session.outcome = "interrupted";
      pending.clear();
      await save();
      send({ interrupted });
      event("session.execution.interrupted", { sessionID: session.id });
      return;
    }
    if (suffix.startsWith("/message/")) {
      sourceFetched = true;
      return send({ data: messages.get(decodeURIComponent(suffix.slice(9))) });
    }
    const match = /^\/permission\/([^/]+)(\/reply)?$/.exec(suffix);
    if (match) {
      const id = decodeURIComponent(match[1] ?? "");
      const item = pending.get(id);
      if (!item) return send({ error: "NotFound" }, 404);
      if (!match[2]) {
        if (scenario === "retarget") {
          item.input.path = resolve(
            session.location.directory,
            "unapproved.txt",
          );
          item.request.resources = [String(item.input.path)];
        }
        return send({ data: item.request });
      }
      const decision = z
        .object({ decision: z.enum(["once", "reject"]) })
        .parse(body).decision;
      pending.delete(id);
      response.writeHead(204).end();
      if (decision === "reject") {
        pending.clear();
        return;
      }
      if (item.tool === "write") {
        await writeFile(item.path, String(item.input.content));
        stage++;
      }
      if (item.tool === "read" && scenario === "cancel-read")
        await writeFile(
          join(process.cwd(), "cancelled-read-result.txt"),
          await readFile(item.path),
        );
      event("session.tool.success", {
        sessionID: session.id,
        assistantMessageID: item.request.source.messageID,
        id: item.request.source.id,
        content: [{ type: "text", text: "Inert operation finished" }],
        executed: true,
      });
      if (scenario === "approval" && stage === 1) ask("denied.txt");
      else await success();
      return;
    }
    return send({ error: "NotFound" }, 404);
  } catch {
    return send({ error: "InertFixtureFailure" }, 400);
  }
});
const listening = Promise.withResolvers<void>();
server.listen(0, "127.0.0.1", listening.resolve);
await listening.promise;
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Fixture TCP address missing");
const origin = `http://127.0.0.1:${address.port}`;
console.log(`server listening on ${origin}`);
if (scenario === "split-startup") {
  process.stdout.write(`server password ${password.slice(0, 5)}`);
  await delay(50);
  process.stdout.write(`${password.slice(5)}\n`);
} else console.log(`server password ${password}`);
process.on("SIGTERM", () => {
  for (const response of subscribers) response.end();
  server.close();
  process.exit(scenario === "engine" ? 130 : 0);
});
