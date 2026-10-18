import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { findExecutable } from "../src/server/adapters/availability.ts";
import { ClaudeAdapter } from "../src/server/adapters/claude.ts";
import { spawnClaude } from "../src/server/adapters/claude-process.ts";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import { harnessEnvironment } from "../src/server/adapters/environment.ts";
import { OpenCodeAdapter } from "../src/server/adapters/opencode.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import { processIdentity } from "../src/server/orchestration/recovery-observe.ts";
import type { Harness } from "../src/shared/domain/entities.ts";

const { values } = parseArgs({ options: { output: { type: "string" } } });
assert.ok(
  values.output,
  "Usage: mise x -- pnpm smoke:isolation --output <new evidence.json>. No model prompts, no personal authentication, no session attachment.",
);
const output = resolve(values.output);
try {
  await access(output);
  throw new Error("Refusing to overwrite isolation evidence");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
const original = { ...process.env };
const realHome = homedir();
const runtime = harnessEnvironment();
const watched = {
  "Codex config": join(realHome, ".codex", "config.toml"),
  "Codex auth": join(realHome, ".codex", "auth.json"),
  "Codex sessions": join(realHome, ".codex", "sessions"),
  "Claude config": original.CLAUDE_CONFIG_DIR ?? join(realHome, ".claude"),
  "Pi config": original.PI_CODING_AGENT_DIR ?? join(realHome, ".pi", "agent"),
  "OpenCode config":
    original.OPENCODE_CONFIG_DIR ??
    join(original.XDG_CONFIG_HOME ?? join(realHome, ".config"), "opencode"),
  "OpenCode data": join(
    original.XDG_DATA_HOME ?? join(realHome, ".local", "share"),
    "opencode",
  ),
};
// lstat only: no personal credential/config/transcript contents are read, and
// symlinks are recorded rather than followed. atime is intentionally irrelevant.
async function metadata(path: string, result: Record<string, string> = {}) {
  try {
    const info = await lstat(path, { bigint: true });
    result[path] =
      `${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    if (info.isDirectory())
      for (const name of (await readdir(path)).sort())
        await metadata(join(path, name), result);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    result[path] = "absent";
  }
  return result;
}
async function personalSnapshot() {
  const result: Record<string, string> = {};
  for (const [label, path] of Object.entries(watched))
    result[label] = JSON.stringify(await metadata(path));
  return result;
}
async function nativeProcesses() {
  const result: Record<string, string> = {};
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const name = (await readFile(`/proc/${pid}/comm`, "utf8")).trim();
      if (!/^(?:codex|claude|pi|opencode)(?:$|-)/.test(name)) continue;
      const identity = await processIdentity(Number(pid));
      if (identity) result[pid] = identity;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
  }
  return result;
}
const personalBefore = await personalSnapshot();
const processesBefore = await nativeProcesses();
const root = await mkdtemp("/tmp/lao-isolation-");
const personal = join(root, "personal-home");
const data = join(root, "app");
const personalTokens = ["codex", "pi", "claude", "opencode"].map(
  (h) => `inert-personal-${h}-${randomUUID()}`,
);
const seed: Record<string, string> = {
  ".codex/config.toml": 'model = "inert-personal-model"\n',
  ".codex/auth.json": JSON.stringify({ OPENAI_API_KEY: personalTokens[0] }),
  ".pi/agent/settings.json": JSON.stringify({
    defaultProvider: "inert-personal-provider",
  }),
  ".pi/agent/auth.json": JSON.stringify({
    deepseek: { type: "api_key", key: personalTokens[1] },
  }),
  ".claude/settings.json": JSON.stringify({
    env: { ANTHROPIC_API_KEY: personalTokens[2] },
  }),
  ".claude/.credentials.json": JSON.stringify({
    claudeAiOauth: { accessToken: personalTokens[2] },
  }),
  ".config/opencode/opencode.json": JSON.stringify({ share: "disabled" }),
  ".local/share/opencode/auth.json": JSON.stringify({
    deepseek: { type: "api", key: personalTokens[3] },
  }),
};
for (const [name, content] of Object.entries(seed)) {
  const path = join(personal, name);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
}
const seededBefore = JSON.stringify(await metadata(personal));
let personalServiceRequests = 0;
const personalService = createServer((_request, response) => {
  personalServiceRequests++;
  response.writeHead(401).end();
});
await new Promise<void>((done) => personalService.listen(0, "127.0.0.1", done));
const serviceAddress = personalService.address();
assert.ok(serviceAddress && typeof serviceAddress !== "string");
const manual = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  env: runtime,
  stdio: "ignore",
});
assert.ok(manual.pid);
const manualIdentity = await processIdentity(manual.pid);
const manualClosed = new Promise<void>((done) =>
  manual.once("close", () => done()),
);
const preload = join(root, "preload.mjs");
const preloadMarker = join(root, "unexpected-preload");
await writeFile(
  preload,
  `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(preloadMarker)}, "executed");`,
);
const markers: Record<string, { value: string; allowed: Harness[] }> = {
  CLAUDE_CODE_OAUTH_TOKEN: {
    value: `inert-setup-token-${randomUUID()}`,
    allowed: ["claude-code"],
  },
  ANTHROPIC_API_KEY: {
    value: `inert-api-key-${randomUUID()}`,
    allowed: ["claude-code", "pi", "opencode"],
  },
  DEEPSEEK_API_KEY: {
    value: `inert-deepseek-${randomUUID()}`,
    allowed: ["pi", "opencode"],
  },
  GOOGLE_API_KEY: {
    value: `inert-google-${randomUUID()}`,
    allowed: ["opencode"],
  },
  GITHUB_TOKEN: { value: `inert-github-${randomUUID()}`, allowed: [] },
  AWS_UNRELATED_TOKEN: { value: `inert-aws-${randomUUID()}`, allowed: [] },
  GOOGLE_UNRELATED_TOKEN: { value: `inert-gcp-${randomUUID()}`, allowed: [] },
  AZURE_UNRELATED_TOKEN: { value: `inert-azure-${randomUUID()}`, allowed: [] },
};
type Launch = {
  harness: Harness;
  pid: number;
  environmentObserved: boolean;
  disallowedVariables: string[];
  intendedCredentialsPresent: boolean;
  appConfigSelected: boolean;
  exited: boolean;
  exitCode: number | null;
  signal: string | null;
};
const launches: Launch[] = [];
type ObservedChild = {
  kill: (signal: NodeJS.Signals) => boolean;
  pid?: number | undefined;
  exitCode: number | null;
  signalCode?: string | null | undefined;
  once: (
    event: "exit",
    listener: (code: number | null, signal: string | null) => void,
  ) => unknown;
};
const ownedChildren: ObservedChild[] = [];
function observe(harness: Harness, child: ObservedChild) {
  ownedChildren.push(child);
  const entry: Launch = {
    harness,
    pid: child.pid ?? 0,
    environmentObserved: false,
    disallowedVariables: [],
    intendedCredentialsPresent: false,
    appConfigSelected: false,
    exited: false,
    exitCode: null,
    signal: null,
  };
  launches.push(entry);
  try {
    const env = Object.fromEntries(
      readFileSync(`/proc/${child.pid}/environ`, "utf8")
        .split("\0")
        .filter(Boolean)
        .map((item) => {
          const equals = item.indexOf("=");
          return [item.slice(0, equals), item.slice(equals + 1)];
        }),
    );
    entry.environmentObserved = true;
    entry.disallowedVariables = Object.entries(markers)
      .filter(
        ([key, marker]) =>
          !marker.allowed.includes(harness) && env[key] !== undefined,
      )
      .map(([key]) => key);
    for (const key of [
      "NODE_OPTIONS",
      "GIT_DIR",
      "CODEX_THREAD_ID",
      "PI_SESSION_ID",
      "PI_SESSION_FILE",
      "CLAUDE_SESSION_ID",
      "OPENCODE_SERVER_URL",
      "LAO_GATEWAY_TOKEN",
      "LAO_GATEWAY_URL",
    ])
      if (env[key] !== undefined) entry.disallowedVariables.push(key);
    entry.intendedCredentialsPresent = Object.entries(markers).every(
      ([key, marker]) =>
        !marker.allowed.includes(harness) || env[key] === marker.value,
    );
    entry.appConfigSelected =
      harness === "codex"
        ? env.CODEX_HOME === join(data, "codex")
        : harness === "pi"
          ? env.PI_CODING_AGENT_DIR === join(data, "pi") &&
            env.PI_CODING_AGENT_SESSION_DIR?.startsWith(`${data}/`) === true
          : harness === "claude-code"
            ? env.CLAUDE_CONFIG_DIR === join(data, "claude-config")
            : env.HOME?.startsWith(`${data}/`) === true &&
              env.OPENCODE_CONFIG_DIR?.startsWith(`${data}/`) === true;
  } catch {
    // Missing /proc evidence is a failed check, never an inferred safe launch.
  }
  child.once("exit", (code, signal) => {
    entry.exited = true;
    entry.exitCode = code;
    entry.signal = signal;
  });
}
let receipt: Record<string, unknown> = {};
let passed = false;
try {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, runtime, {
    HOME: personal,
    CODEX_HOME: join(personal, ".codex"),
    PI_CODING_AGENT_DIR: join(personal, ".pi", "agent"),
    PI_CODING_AGENT_SESSION_DIR: join(personal, "sessions"),
    PI_SESSION_ID: "inert-personal-session",
    PI_SESSION_FILE: join(personal, "session.jsonl"),
    CLAUDE_CONFIG_DIR: join(personal, ".claude"),
    CLAUDE_SESSION_ID: "inert-personal-session",
    OPENCODE_CONFIG_DIR: join(personal, ".config", "opencode"),
    OPENCODE_SERVER_URL: `http://127.0.0.1:${serviceAddress.port}`,
    CODEX_THREAD_ID: "inert-personal-thread",
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    GIT_DIR: join(personal, "personal.git"),
    LAO_GATEWAY_TOKEN: "inert-unrelated-gateway",
    LAO_GATEWAY_URL: "http://127.0.0.1:1/unrelated",
  });
  const cleanApp = await startApp({
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
  });
  const clean: Record<string, unknown> = {};
  try {
    for (const harness of ["codex", "pi", "claude-code", "opencode"] as const) {
      const catalog = await cleanApp.engine.profiles.discover({ harness });
      clean[harness] = {
        installed: catalog.installed,
        version: catalog.version,
        state: catalog.state,
        authenticated: catalog.authenticated,
        modelCount: catalog.models.length,
      };
      assert.equal(catalog.installed, true);
      if (harness !== "opencode")
        assert.equal(
          catalog.authenticated,
          false,
          "Personal credentials must not enable a fresh app home",
        );
    }
  } finally {
    await cleanApp.close();
  }
  receipt.cleanDiscovery = clean;
  for (const [key, marker] of Object.entries(markers))
    process.env[key] = marker.value;
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: {
      codex: new CodexAdapter(data, async (args, cwd, env) => {
        const rpc = new CodexRpc(
          await findExecutable("codex", "Codex"),
          args,
          cwd,
          env,
        );
        observe("codex", rpc.child);
        return rpc;
      }),
      pi: new PiAdapter(data, async (args, cwd, env) => {
        const rpc = new PiRpc(await findExecutable("pi", "Pi"), args, cwd, env);
        observe("pi", rpc.child);
        return rpc;
      }),
      claude: new ClaudeAdapter(data, {
        spawn: (options) => {
          const child = spawnClaude(options);
          observe("claude-code", child);
          return child;
        },
      }),
      opencode: new OpenCodeAdapter(data, {
        spawn: (command, args, options) => {
          const child = spawn(command, args, {
            ...options,
            stdio: "pipe",
            detached: false,
          });
          observe("opencode", child);
          return child;
        },
      }),
    },
  });
  const credentialDiscovery: Record<string, unknown> = {};
  try {
    for (const harness of ["codex", "pi", "claude-code", "opencode"] as const) {
      const catalog = await app.engine.profiles.discover({ harness });
      credentialDiscovery[harness] = {
        installed: catalog.installed,
        state: catalog.state,
        authenticated: catalog.authenticated,
        modelCount: catalog.models.length,
      };
      assert.equal(catalog.installed, true);
      if (harness === "codex") assert.equal(catalog.authenticated, false);
      if (harness === "pi")
        assert.ok(
          catalog.models.some((model) => model.id.startsWith("deepseek/")),
        );
    }
    assert.equal(app.engine.store.listRuns().length, 0);
    assert.equal(app.engine.store.listSessions().length, 0);
  } finally {
    await app.close();
  }
  receipt.credentialDiscovery = credentialDiscovery;
  receipt.launches = launches;
  const leaks: string[] = [];
  async function scan(path: string) {
    const info = await lstat(path);
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await scan(join(path, name));
      return;
    }
    if (!info.isFile()) return;
    assert.ok(
      info.size <= 32 * 1024 * 1024,
      "Oversized app-owned evidence file; scan incomplete",
    );
    const content = await readFile(path);
    const name = relative(data, path);
    const harness = name.startsWith("codex/")
      ? "codex"
      : name.startsWith("pi/")
        ? "pi"
        : name.startsWith("claude-")
          ? "claude-code"
          : name.startsWith("opencode-hosts/")
            ? "opencode"
            : null;
    if (personalTokens.some((token) => content.includes(token)))
      leaks.push(`${name}:personal-auth-canary`);
    for (const [key, marker] of Object.entries(markers))
      if (
        content.includes(marker.value) &&
        (!harness || !marker.allowed.includes(harness))
      )
        leaks.push(`${name}:${key}`);
  }
  await scan(data);
  receipt.crossHarnessCredentialCopies = leaks;
  const sentinelUnchanged =
    JSON.stringify(await metadata(personal)) === seededBefore;
  let preloadAbsent = false;
  try {
    await access(preloadMarker);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    preloadAbsent = true;
  }
  receipt.seededPersonalConfigUnchanged = sentinelUnchanged;
  receipt.personalServiceRequests = personalServiceRequests;
  receipt.executablePreloadBlocked = preloadAbsent;
  receipt.unrelatedProcessPreserved =
    manual.exitCode === null &&
    manual.signalCode === null &&
    manualIdentity !== null &&
    (await processIdentity(manual.pid)) === manualIdentity;
  passed =
    launches.length === 4 &&
    launches.every(
      (launch) =>
        launch.environmentObserved &&
        launch.appConfigSelected &&
        launch.intendedCredentialsPresent &&
        launch.disallowedVariables.length === 0 &&
        launch.exited &&
        launch.signal === null &&
        launch.exitCode === (launch.harness === "opencode" ? 130 : 0),
    ) &&
    leaks.length === 0 &&
    sentinelUnchanged &&
    personalServiceRequests === 0 &&
    preloadAbsent &&
    receipt.unrelatedProcessPreserved === true;
} catch {
  receipt.failure =
    "Isolation smoke failed; retained disposable state for inspection (native errors/secret values not copied)";
} finally {
  for (const child of ownedChildren)
    if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, original);
  manual.kill("SIGTERM");
  await manualClosed;
  await new Promise<void>((done) => personalService.close(() => done()));
}
const personalAfter = await personalSnapshot();
const changedRoots = Object.keys(watched).filter(
  (label) => personalBefore[label] !== personalAfter[label],
);
const processesAfter = await nativeProcesses();
const preserved = Object.entries(processesBefore).filter(
  ([pid, identity]) => processesAfter[pid] === identity,
).length;
passed =
  passed &&
  changedRoots.length === 0 &&
  preserved === Object.keys(processesBefore).length;
receipt = {
  ...receipt,
  submittedPrompts: 0,
  personalConfigMetadata: {
    contentsRead: false,
    watchedRoots: Object.keys(watched),
    changedRoots,
  },
  existingHarnessProcesses: {
    observed: Object.keys(processesBefore).length,
    preserved,
  },
  passed,
  retained: passed ? null : root,
  limitations: [
    "Metadata/process snapshots cannot attribute concurrent owner changes or explain the historical Pi observation",
    "Only direct app-owned native children are observed; descendant cleanup and active emergency-stop use separate fixture tests",
    "Inert credential canaries prove routing, not live provider entitlement; native cloud credential chains were not authenticated",
    "No syscall tracer is installed; this is bounded source review plus metadata, credential-canary, process-identity and native no-model evidence, not an OS sandbox or proof of every file access",
  ],
};
const text = `${JSON.stringify(receipt, null, 2)}\n`;
for (const [key, value] of Object.entries(original))
  if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && value && value.length >= 8)
    assert.equal(text.includes(value), false, `${key} value reached evidence`);
for (const marker of Object.values(markers))
  assert.equal(text.includes(marker.value), false);
for (const marker of personalTokens) assert.equal(text.includes(marker), false);
await writeFile(output, text, { flag: "wx", mode: 0o600 });
if (passed) await rm(root, { recursive: true });
console.log(
  `${passed ? "PASS" : "FAIL"}: four-harness zero-prompt isolation smoke; evidence ${output}`,
);
process.exitCode = passed ? 0 : 1;
