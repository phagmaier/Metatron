import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ManagedSession } from "../src/server/adapters/contract.ts";
import { startApp } from "../src/server/app.ts";
import { toolsFor } from "../src/server/orchestration/policy.ts";
import { appLocations } from "../src/server/storage/database.ts";
import { harnessSchema } from "../src/shared/domain/entities.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { harnessLabel, nativeTeam } from "../src/shared/native.ts";
import { workerTools } from "../src/shared/orchestration.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";
import { smokeEvents } from "./native-smoke-evidence.ts";

// Zero prompts by construction: this script never calls adapter.prompt. It
// starts one real native read-only worker session behind a recording loopback
// proxy, records the gateway catalog the native client itself fetched, then
// calls each Lead tool with that session's binding from this script. Those
// denials are server-side observations, not native-client invocations.
const { values } = parseArgs({
  options: {
    harness: { type: "string" },
    model: { type: "string" },
    thinking: { type: "string" },
    output: { type: "string" },
  },
});
assert.ok(
  values.harness && values.model && values.output,
  "Usage: mise x -- env XDG_DATA_HOME=/tmp/<disposable> pnpm smoke:worker-catalog --harness codex|claude-code|opencode|pi --model <discovered model> [--thinking <level>] --output <new evidence.json>. Starts a native session without any prompt.",
);
const harness = harnessSchema.parse(values.harness);
const model = values.model;
const thinking = values.thinking ?? null;
const output = resolve(values.output);
try {
  await access(output);
  throw new Error(`Refusing to overwrite existing evidence ${output}`);
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
const locations = appLocations();
assert.match(
  locations.data,
  /^\/tmp\/[^/]+\/local-agent-orchestrator$/,
  "Set XDG_DATA_HOME to a disposable directory directly under /tmp",
);
const personal = [
  ".codex/config.toml",
  ".claude/settings.json",
  ".pi/agent/settings.json",
  ".pi/agent/auth.json",
  ".config/opencode/opencode.json",
  ".config/opencode/opencode.jsonc",
  ".local/share/opencode/auth.json",
];
const metadata = () =>
  Promise.all(
    personal.map(async (path) => {
      try {
        const info = await stat(join(homedir(), path));
        return `${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return `${path}:absent`;
        throw error;
      }
    }),
  );

type Exchange = {
  httpMethod: string;
  rpcMethod: string | null;
  issuedToken: boolean;
  status: number;
  clientInfo?: unknown;
  tool?: string;
  listedTools?: string[];
  errorCode?: string;
};
const exchanges: Exchange[] = [];
let issued = "";
let upstream = "";
// Records JSON-RPC method names, client identity and served tool names only;
// never the bearer token, arguments or result payloads.
const proxy = createServer((request, response) => {
  void (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    let rpc: { method?: unknown; params?: Record<string, unknown> } = {};
    try {
      rpc = body ? JSON.parse(body) : {};
    } catch {}
    const headers: Record<string, string> = {};
    for (const name of [
      "authorization",
      "content-type",
      "accept",
      "mcp-protocol-version",
    ]) {
      const value = request.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const reply = await fetch(upstream, {
      method: request.method ?? "POST",
      headers,
      ...(request.method === "POST" ? { body } : {}),
    });
    const text = await reply.text();
    const exchange: Exchange = {
      httpMethod: request.method ?? "",
      rpcMethod: typeof rpc.method === "string" ? rpc.method : null,
      issuedToken: headers.authorization === `Bearer ${issued}`,
      status: reply.status,
    };
    if (exchange.rpcMethod === "initialize")
      exchange.clientInfo = rpc.params?.clientInfo ?? null;
    if (exchange.rpcMethod === "tools/call")
      exchange.tool = String(rpc.params?.name ?? "");
    try {
      const parsed = JSON.parse(text);
      if (exchange.rpcMethod === "tools/list" && parsed.result?.tools)
        exchange.listedTools = parsed.result.tools.map(
          (t: { name: string }) => t.name,
        );
      const code = parsed.result?.structuredContent?.error?.code;
      if (typeof code === "string") exchange.errorCode = code;
    } catch {}
    exchanges.push(exchange);
    const type = reply.headers.get("content-type");
    response.writeHead(reply.status, type ? { "Content-Type": type } : {});
    response.end(text);
  })().catch(() => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
});
await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
const address = proxy.address();
assert.ok(address && typeof address !== "string");
const proxyUrl = `http://127.0.0.1:${address.port}/mcp`;

const fixture = await createGitFixture();
const baseline = await fixture.git("rev-parse", "HEAD");
const personalBefore = await metadata();
const database = join(locations.data, `worker-catalog-${randomUUID()}.sqlite`);
const app = await startApp({
  development: false,
  port: 0,
  databasePath: database,
});
upstream = `${app.origin}/mcp`;
const { engine } = app;
const { store } = engine;
const adapter = engine.adapters[harness];
const receipt: Record<string, unknown> = {
  harness,
  selected: { model, thinking },
  submittedPrompts: 0,
  boundary:
    "Native client catalog fetch plus probe-originated server-side Lead-tool denials on the same worker binding; not a native-client Lead-tool invocation",
};
let passed = false;
let managed: ManagedSession | undefined;
try {
  const project = await engine.openProject(
    {
      name: `M8 ${harnessLabel[harness]} worker catalog`,
      repositoryPath: fixture.directory,
    },
    randomUUID(),
  );
  const run = store.createRun(
    {
      projectId: project.id,
      title: "M8 worker catalog probe (never dispatched)",
      initialPrompt: "Zero-prompt worker gateway catalog probe",
      mode: "supervised",
      execution: "native",
      repository: project.repository,
      teamSnapshot: {
        ...nativeTeam(model, thinking, harness),
        roles: engine.presets().roles,
      },
    },
    randomUUID(),
  );
  // Direct records, never a dispatch: the scheduler has nothing to launch or prompt.
  const task = store.createTask(
    { runId: run.id, title: "Catalog probe", objective: "Never prompted" },
    randomUUID(),
  );
  const attempt = store.createAttempt(
    {
      taskId: task.id,
      adapter: harness,
      intendedOperation: "Zero-prompt worker catalog probe",
      cwd: fixture.directory,
    },
    randomUUID(),
  );
  const session = store.createSession({ attemptId: attempt.id }, randomUUID());
  for (const [from, to] of [
    ["not_started", "starting"],
    ["starting", "busy"],
  ] as const)
    store.updateSession(
      { id: session.id, expectedState: from, state: to },
      randomUUID(),
    );
  issued = engine.gateway.issue({
    role: "worker",
    sessionId: session.id,
    runId: run.id,
    taskId: task.id,
    attemptId: attempt.id,
  });
  const before = {
    tasks: store.listTasks(run.id).length,
    attempts: store.listAttempts().length,
    dispatches: engine.scheduling.list().length,
  };
  try {
    managed = await adapter.startSession({
      runId: run.id,
      taskId: task.id,
      attemptId: attempt.id,
      cwd: fixture.directory,
      roleInstructions:
        "Zero-prompt catalog probe. This session receives no prompt.",
      model,
      thinking,
      permission: "read_only",
      contextPolicy: "fresh",
      contextPacket: "Never sent",
      toolEndpoint: proxyUrl,
      environment: { LAO_GATEWAY_TOKEN: issued },
    });
    // Some clients list tools after their start handshake; allow a bounded settle.
    await new Promise((done) => setTimeout(done, 2000));
  } catch (error) {
    receipt.startFailure = {
      code: error instanceof DomainError ? error.code : "START_FAILED",
      message:
        error instanceof DomainError
          ? error.message
          : "Native session start failed",
    };
  }
  const native = [...exchanges];
  const lists = native.filter((e) => e.rpcMethod === "tools/list");
  const expected = [...workerTools].sort();
  const leadOnly = toolsFor("lead", run.mode).filter(
    (name) => !(workerTools as readonly string[]).includes(name),
  );
  const denials = [];
  for (const name of leadOnly) {
    const reply = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${issued}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "tools/call",
        params: { name, arguments: {} },
      }),
    });
    const body = (await reply.json()) as {
      result?: {
        isError?: boolean;
        structuredContent?: { error?: { code?: string } };
      };
    };
    denials.push({
      tool: name,
      isError: body.result?.isError ?? null,
      code: body.result?.structuredContent?.error?.code ?? null,
    });
  }
  const journal = smokeEvents(engine, run.id)
    .filter((e) => e.type.startsWith("gateway."))
    .map((e) => ({ type: e.type, payload: e.payload }));
  const after = {
    tasks: store.listTasks(run.id).length,
    attempts: store.listAttempts().length,
    dispatches: engine.scheduling.list().length,
  };
  const checks = {
    nativeSessionStarted: !!managed,
    nativeClientInitialized: native.some(
      (e) => e.rpcMethod === "initialize" && e.issuedToken && e.status === 200,
    ),
    nativeClientListedTools: lists.some(
      (e) => e.issuedToken && e.status === 200,
    ),
    servedExactlyWorkerCatalog:
      lists.length > 0 &&
      lists.every(
        (e) =>
          JSON.stringify([...(e.listedTools ?? [])].sort()) ===
          JSON.stringify(expected),
      ),
    noNativeToolCalls: !native.some((e) => e.rpcMethod === "tools/call"),
    everyLeadToolDenied:
      denials.length > 0 &&
      denials.every((d) => d.isError === true && d.code === "POLICY_DENIED"),
    deniedJournaled:
      journal.filter(
        (e) =>
          e.type === "gateway.denied" &&
          (e.payload as { code?: string }).code === "POLICY_DENIED",
      ).length === leadOnly.length,
    noStateCreatedByDenials: JSON.stringify(before) === JSON.stringify(after),
  };
  Object.assign(receipt, {
    version: (await adapter.discover()).version,
    nativeExchanges: native,
    expectedWorkerCatalog: expected,
    leadOnlyTools: leadOnly,
    probeLeadDenials: denials,
    gatewayJournal: journal,
    checks,
  });
  passed = Object.values(checks).every(Boolean);
} finally {
  if (managed) await adapter.dispose(managed);
  await app.close();
  await new Promise<void>((done) => proxy.close(() => done()));
}
const ownerUnchanged =
  (await fixture.git("status", "--porcelain")) === "" &&
  (await fixture.git("rev-parse", "HEAD")) === baseline;
const personalUnchanged =
  JSON.stringify(await metadata()) === JSON.stringify(personalBefore);
Object.assign(receipt, {
  ownerCheckoutUnchanged: ownerUnchanged,
  personalConfigMetadataUnchanged: personalUnchanged,
  passed: passed && ownerUnchanged && personalUnchanged,
  limitations: [
    "No model prompt: whether a model would attempt an unlisted Lead tool, and how the native client rejects it locally, is not observed",
    "Lead-tool denials are sent by this script with the native session's binding, not by the native client",
  ],
});
// A failed probe keeps its database for inspection; a pass needs nothing kept.
receipt.retained = receipt.passed ? null : { database };
const text = `${JSON.stringify(receipt, null, 2)}\n`;
for (const [key, value] of Object.entries(process.env))
  if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && value && value.length >= 8)
    assert.equal(text.includes(value), false, `${key} value reached evidence`);
assert.equal(text.includes(issued), false, "Gateway token reached evidence");
await writeFile(output, text, { mode: 0o600, flag: "wx" });
await fixture.verify(async () => {});
if (receipt.passed)
  for (const suffix of ["", "-wal", "-shm"])
    await rm(`${database}${suffix}`, { force: true });
// A start refused before any gateway handshake is a prerequisite block, not a
// native catalog failure.
const status = receipt.passed
  ? "PASS"
  : receipt.startFailure && exchanges.length === 0
    ? "BLOCKED"
    : "FAIL";
console.log(
  `${status}: ${harnessLabel[harness]} zero-prompt worker catalog; evidence ${output}`,
);
process.exitCode = status === "PASS" ? 0 : status === "BLOCKED" ? 2 : 1;
