import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startApp } from "../src/server/app.ts";
import { appLocations } from "../src/server/storage/database.ts";
import { harnessSchema, type Task } from "../src/shared/domain/entities.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { harnessLabel, nativeTeam } from "../src/shared/native.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";
import {
  cancelAfterText,
  cancellationEvidence,
  gatewayScopeEvidence,
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
    "verify-gateway-denial": { type: "boolean" },
    harness: { type: "string" },
    model: { type: "string" },
    thinking: { type: "string" },
    output: { type: "string" },
  },
});
const usage =
  "Usage: mise x -- env XDG_DATA_HOME=/tmp/<disposable> pnpm test:live:workers --harness codex|claude-code|opencode|pi --model <discovered model> [--thinking <level>] --output <new evidence.json> [--allow-live] [--verify-gateway-denial] [--verify-cancel]. Opt-in sends one paid reader turn; gateway denial is a cross-assignment schema-rejection probe in that turn. Pi-only --verify-cancel adds at most one paid turn.";
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
      crossAssignmentGatewayDenial: !!values["verify-gateway-denial"],
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
    gatewayScopeProbe: null,
  };
  if (!values["allow-live"] || !available) {
    passed = !values["allow-live"];
    receipt.blocked = available
      ? null
      : `Selection unavailable: ${discovery.nextStep ?? "model/thinking not in native discovery"}`;
  } else {
    let controlTask: Task | null = null;
    if (values["verify-gateway-denial"]) {
      // A real unassigned task gives the override a distinct target, but no
      // dispatch, process, worker tool or authority is added for this control.
      const controlRun = engine.store.createRun(
        {
          projectId: project.id,
          title: "M8 unassigned scope control (never dispatched)",
          initialPrompt:
            "Control task for a rejected cross-assignment override",
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
      controlTask = engine.createTask(
        {
          runId: controlRun.id,
          title: "Unassigned foreign scope control",
          objective:
            "This task must remain unassigned and unchanged throughout the gateway probe",
        },
        randomUUID(),
      );
    }
    const run = await engine.startNativeRun(
      {
        projectId: project.id,
        harness,
        title: `M8 live ${label} reader`,
        initialPrompt: [
          "Read native-proof.txt in this worktree. Put the exact nonce it contains in your result summary. Do not create, change or delete any file.",
          ...(controlTask
            ? [
                `Cross-assignment scope probe: after your normal read_assignment call, invoke that same worker gateway tool exactly once with the extra top-level argument taskId: "${controlTask.id}". This names an unassigned task in another run. Expect INVALID_INPUT because workers cannot choose an assignment. Do not use shell/HTTP, change tools, retry the malformed request or obtain another token. If the native client refuses before the gateway, report that limitation; do not claim the gateway denied it. Continue only your own read-only assignment and submit_result once with the nonce and observed outcome.`,
              ]
            : []),
        ].join("\n\n"),
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
    const target = controlTask;
    const gatewayScopeProbe =
      target && attempt && session
        ? {
            boundary:
              "caller-supplied taskId rejected by gateway schema; not Lead-role denial",
            foreignRunId: target.runId,
            foreignTaskId: target.id,
            targetUnchanged:
              JSON.stringify(store.getTask(target.id)) ===
              JSON.stringify(target),
            targetAttempts: store
              .listAttempts()
              .filter((a) => a.taskId === target.id).length,
            targetDispatches: engine.scheduling
              .list()
              .filter((d) => d.taskId === target.id).length,
            evidence: gatewayScopeEvidence(events, {
              taskId: task.id,
              attemptId: attempt.id,
              sessionId: session.id,
            }),
          }
        : null;
    const scopeProbePassed =
      gatewayScopeProbe?.targetUnchanged === true &&
      gatewayScopeProbe.targetAttempts === 0 &&
      gatewayScopeProbe.targetDispatches === 0 &&
      Object.values(gatewayScopeProbe.evidence.checks).every(Boolean);
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
      gatewayScopeProbe,
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
      (!values["verify-gateway-denial"] || scopeProbePassed) &&
      JSON.stringify(report).includes(nonce) &&
      Array.isArray(captured?.files) &&
      captured.files.length === 0 &&
      captured.headSha === baseline &&
      ownerClean &&
      personalUnchanged;
    if (passed && values["verify-cancel"]) {
      const cancellationPrompt =
        "Exercise active cancellation, not repository review. After read_assignment, immediately start an interim text message with a numbered explanation of read-only repository inspection: at least 500 sentences, one sentence per numbered item. Keep generating the explanation until the owner interrupts. Do not use file tools or change files. The explanation is the assigned work, not a final report; only after all 500 sentences could the task be complete and submit_result be appropriate.";
      const team = nativeTeam(model, thinking, harness);
      const reader = team.profiles.find(
        (p) =>
          p.permission === "read_only" &&
          team.roles.some((r) => r.id === p.roleId && r.name === "Reader"),
      );
      assert.ok(reader);
      // The generic launcher selects Reviewer and asks for a concise report.
      // Keep this exercise's narration guidance in its immutable run snapshot;
      // the normal worker policy and final-report requirement are unchanged.
      const roles = engine.presets().roles.map((role) =>
        role.id === reader.roleId
          ? {
              ...role,
              instructions:
                "Perform the owner's read-only cancellation exercise. Stream the requested long, numbered interim explanation before completing the task. Do not replace that explanation with repository review findings or submit a report before the explanation is finished.",
              expectedOutput:
                "At least 500 numbered explanatory sentences as in-progress text, followed only on completion by the usual structured final report. An owner interruption ends the exercise without a completion report.",
            }
          : role,
      );
      const cancelRun = store.createRun(
        {
          projectId: project.id,
          title: "M8 Pi active cancellation",
          initialPrompt: cancellationPrompt,
          mode: "supervised",
          execution: "native",
          repository: project.repository,
          teamSnapshot: { ...team, roles },
        },
        randomUUID(),
      );
      const cancelTask = engine.createTask(
        {
          runId: cancelRun.id,
          title: "Stream interim explanation until owner cancellation",
          objective: cancellationPrompt,
        },
        randomUUID(),
      );
      engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: cancelTask.id, profileId: reader.id },
        randomUUID(),
      );
      receipt.cancellationScenario = {
        profileId: reader.id,
        role: roles.find((r) => r.id === reader.roleId),
        permission: reader.permission,
        objective: cancellationPrompt,
      };
      receipt.submittedPrompts = 2;
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
  "Reader with optional cross-assignment gateway INVALID_INPUT probe and Pi cancellation; no native writer, review, integration, Lead or worker-to-Lead role-denial probe",
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
