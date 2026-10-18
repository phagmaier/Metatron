import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startApp } from "../src/server/app.ts";
import { appLocations } from "../src/server/storage/database.ts";
import { harnessSchema } from "../src/shared/domain/entities.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { harnessLabel } from "../src/shared/native.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";
import {
  cancelAfterText,
  cancellationEvidence,
  settleSmoke,
  smokeEvents,
  streamEvidence,
} from "./native-smoke-evidence.ts";

// One owner-directed reader, optionally followed by one Pi cancellation turn.
// Without --allow-live, even lifecycle flags only discover (no prompt).
const { values } = parseArgs({
  options: {
    "allow-live": { type: "boolean" },
    "verify-cancel": { type: "boolean" },
    harness: { type: "string" },
    model: { type: "string" },
    thinking: { type: "string" },
    output: { type: "string" },
  },
});
const usage =
  "Usage: mise x -- env XDG_DATA_HOME=/tmp/<disposable> pnpm test:live:workers --harness codex|claude-code|opencode|pi --model <discovered model> [--thinking <level>] --output <new evidence.json> [--allow-live] [--verify-cancel]. Opt-in sends one paid reader turn; --verify-cancel is Pi-only and adds at most one paid turn.";
assert.ok(values.harness && values.model && values.output, usage);
const harness = harnessSchema.parse(values.harness);
assert.ok(
  !values["verify-cancel"] || harness === "pi",
  "--verify-cancel is Pi-only; use test:live:leads --verify-lifecycle for Codex",
);
const label = harnessLabel[harness];
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
// Codex's app-owned login lives in <data>/codex; never the owner's real app data.
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

const fixture = await createGitFixture();
const nonce = randomUUID();
await writeFile(join(fixture.directory, "native-proof.txt"), `${nonce}\n`);
await fixture.git("add", "--", "native-proof.txt");
await fixture.git(
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "commit",
  "-m",
  "Native proof",
);
const baseline = await fixture.git("rev-parse", "HEAD");
const personalBefore = await metadata();
const database = join(locations.data, `live-workers-${randomUUID()}.sqlite`);
const app = await startApp({
  development: false,
  port: 0,
  databasePath: database,
});
const { engine } = app;
let receipt: Record<string, unknown> = {};
let passed = false;
const worktreeRoots = new Set<string>();
try {
  const project = await engine.openProject(
    { name: `M8 live ${label} reader`, repositoryPath: fixture.directory },
    randomUUID(),
  );
  const discovery = await engine.profiles.discover({ harness });
  const selected = discovery.models.find((m) => m.id === model);
  const available =
    discovery.state === "available" &&
    discovery.permissions.includes("read_only") &&
    !!selected &&
    (thinking === null || selected.thinking.some((t) => t.id === thinking));
  receipt = {
    harness,
    liveAuthorized: !!values["allow-live"],
    selected: { model, thinking },
    requestedChecks: {
      streamedReader: true,
      activeCancellation: !!values["verify-cancel"],
    },
    maximumRequestedTurns: values["allow-live"]
      ? values["verify-cancel"]
        ? 2
        : 1
      : 0,
    discovery: {
      state: discovery.state,
      version: discovery.version,
      authenticated: discovery.authenticated,
      nextStep: discovery.nextStep,
      selectionAvailable: available,
      thinkingChoices: selected?.thinking.map((t) => t.id) ?? [],
    },
    submittedPrompts: 0,
  };
  if (!values["allow-live"] || !available) {
    passed = !values["allow-live"];
    receipt.blocked = available
      ? null
      : `Selection unavailable: ${discovery.nextStep ?? "model/thinking not in native discovery"}`;
  } else {
    const run = await engine.startNativeRun(
      {
        projectId: project.id,
        harness,
        title: `M8 live ${label} reader`,
        initialPrompt:
          "Read native-proof.txt in this worktree. Put the exact nonce it contains in your result summary. Do not create, change or delete any file.",
        model,
        thinking,
        permission: "read_only",
      },
      randomUUID(),
    );
    receipt.submittedPrompts = 1;
    await settleSmoke(engine);
    const { store } = engine;
    const [task] = store.listTasks(run.id);
    assert.ok(task);
    const attempt = store.listAttempts().find((a) => a.taskId === task.id);
    const session = store
      .listSessions()
      .find((s) => s.attemptId === attempt?.id);
    const events = smokeEvents(engine, run.id);
    const stream = streamEvidence(events, harness);
    const payloads = (type: string) =>
      events.filter((e) => e.type === type).map((e) => e.payload);
    const settings = payloads(`${harness}.settings_verified`);
    const report = payloads("worker.result").at(-1)?.report ?? null;
    const captured = payloads("worktree.captured").at(-1);
    const exitCode = session?.exitCode ?? null;
    const ownerClean =
      (await fixture.git("status", "--porcelain")) === "" &&
      (await fixture.git("rev-parse", "HEAD")) === baseline;
    const personalUnchanged =
      JSON.stringify(await metadata()) === JSON.stringify(personalBefore);
    // Claude resolves an alias such as "sonnet" to its native id; the adapter
    // checks membership, so only the other harnesses must match verbatim.
    const settingsMatch =
      settings.length === 1 &&
      (harness === "claude-code" || settings[0]?.model === model) &&
      (thinking === null || settings[0]?.thinking === thinking);
    receipt = {
      ...receipt,
      run: {
        taskStatus: store.getTask(task.id).status,
        attemptStatus: attempt?.status ?? null,
        adapter: attempt?.adapter ?? null,
        nativeSessionId: session?.nativeSessionId ?? null,
        sessionState: session?.state ?? null,
        exitCode,
        processExit: payloads(`${harness}.process_exit`),
      },
      settingsVerified: settings,
      stream,
      gatewayDenials: payloads("gateway.denied"),
      nonceReported: JSON.stringify(report).includes(nonce),
      report,
      gatewayTools: payloads("gateway.tool_call"),
      nativeTools: payloads(`${harness}.tool_started`).map((p) => p.summary),
      sessionErrors: payloads(`${harness}.session_error`),
      usage: payloads(`${harness}.usage`),
      worktree: {
        changedFiles: captured?.files ?? null,
        headUnchanged: captured?.headSha === baseline,
      },
      ownerCheckoutUnchanged: ownerClean,
      personalConfigMetadataUnchanged: personalUnchanged,
    };
    passed =
      store.getTask(task.id).status === "AWAITING_REVIEW" &&
      attempt?.adapter === harness &&
      session?.state === "exited" &&
      // The private OpenCode foreground server's verified normal shutdown is 130.
      exitCode === (harness === "opencode" ? 130 : 0) &&
      settingsMatch &&
      stream.streamedBeforeTerminal &&
      stream.terminals[0]?.nativeStatus === "completed" &&
      JSON.stringify(report).includes(nonce) &&
      Array.isArray(captured?.files) &&
      captured.files.length === 0 &&
      captured.headSha === baseline &&
      ownerClean &&
      personalUnchanged;
    if (passed && values["verify-cancel"]) {
      const cancelRun = await engine.startNativeRun(
        {
          projectId: project.id,
          harness,
          title: "M8 Pi active cancellation",
          initialPrompt:
            "Active cancellation smoke: do not call submit_result or change any file. Start emitting a long numbered explanation of read-only repository inspection (at least 500 numbered sentences). Keep generating until the owner interrupts this turn.",
          model,
          thinking,
          permission: "read_only",
        },
        randomUUID(),
      );
      receipt.submittedPrompts = 2;
      const [cancelTask] = store.listTasks(cancelRun.id);
      assert.ok(cancelTask);
      const request = await cancelAfterText(
        engine,
        cancelRun.id,
        cancelTask.id,
        harness,
      );
      await settleSmoke(engine);
      const cancellation = cancellationEvidence(
        engine,
        cancelRun.id,
        cancelTask.id,
        harness,
        request,
      );
      receipt.cancellation = cancellation;
      const captured = smokeEvents(engine, cancelRun.id).findLast(
        (e) => e.type === "worktree.captured",
      )?.payload;
      receipt.cancellationWorktree = captured ?? null;
      passed =
        Object.values(cancellation.checks).every(Boolean) &&
        Array.isArray(captured?.files) &&
        captured.files.length === 0 &&
        captured.headSha === baseline;
    }
  }
} catch (error) {
  passed = false;
  // Provider errors may contain secrets. Preserve owned state, not raw errors.
  receipt.failure = {
    code: error instanceof DomainError ? error.code : "SMOKE_FAILED",
    message:
      "Worker probe failed; inspect retained app-owned state, never replay automatically",
  };
} finally {
  for (const attempt of engine.store.listAttempts()) {
    if (
      attempt.worktreePath?.startsWith(`${join(locations.data, "worktrees")}/`)
    )
      worktreeRoots.add(dirname(attempt.worktreePath));
  }
  await app.close();
}
const ownerUnchanged =
  (await fixture.git("status", "--porcelain")) === "" &&
  (await fixture.git("rev-parse", "HEAD")) === baseline;
const personalUnchanged =
  JSON.stringify(await metadata()) === JSON.stringify(personalBefore);
receipt.ownerCheckoutUnchanged = ownerUnchanged;
receipt.personalConfigMetadataUnchanged = personalUnchanged;
passed = passed && ownerUnchanged && personalUnchanged;
// A failed native turn is retained for inspection; nothing else needs keeping.
const retain = !passed;
receipt.passed = passed;
receipt.retained = retain
  ? { database, fixture: fixture.directory, worktrees: [...worktreeRoots] }
  : null;
receipt.limitations = [
  "Reader plus optional Pi active cancellation through the real engine/gateway/Git; no native writer, review, integration, Lead or gateway role-denial probe",
  "settingsVerified is the adapter's native confirmation of a completed turn; catalog presence is not entitlement",
  "Application file policy and, for Codex, its read-only sandbox are not an OS isolation boundary for reads",
];
const text = `${JSON.stringify(receipt, null, 2)}\n`;
// Exact secret values present in this environment must never reach evidence.
for (const [key, value] of Object.entries(process.env))
  if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && value && value.length >= 8)
    assert.equal(text.includes(value), false, `${key} value reached evidence`);
await writeFile(output, text, { mode: 0o600, flag: "wx" });
if (!retain) {
  await fixture.verify(async () => {});
  for (const root of worktreeRoots) await rm(root, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"])
    await rm(`${database}${suffix}`, { force: true });
}
const status = !values["allow-live"]
  ? "DISCOVERY ONLY (zero prompts)"
  : passed
    ? "PASS"
    : receipt.submittedPrompts
      ? "FAIL"
      : "BLOCKED";
console.log(`${status}: ${label} read-only worker; evidence ${output}`);
process.exitCode = passed ? 0 : receipt.submittedPrompts ? 1 : 2;
