import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { StartSessionInput } from "../src/server/adapters/contract.ts";
import { startApp } from "../src/server/app.ts";
import { createTeamRun } from "../src/server/orchestration/team-run.ts";
import { appLocations } from "../src/server/storage/database.ts";
import { createTeam } from "../src/server/storage/teams.ts";
import { defaultLimits } from "../src/shared/domain/entities.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";

// This is a support matrix, not four native Lead implementations. The current
// worker-only adapters must refuse coordinator inputs without any model prompt.
const { values } = parseArgs({
  options: {
    "allow-live": { type: "boolean" },
    model: { type: "string" },
    thinking: { type: "string" },
    output: { type: "string" },
  },
});
assert.ok(
  values.model && values.output,
  "Usage: mise x -- env XDG_DATA_HOME=/tmp/<disposable> pnpm test:live:leads --model <Codex model> [--thinking <level>] --output <new evidence.json> [--allow-live]. Opt-in sends one native Codex Lead turn; no workers.",
);
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
  "Set XDG_DATA_HOME to a disposable directory directly under /tmp, after mise x --",
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
const personalBefore = await metadata();
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
  "Native Lead proof",
);
const baseline = await fixture.git("rev-parse", "HEAD");
const database = join(locations.data, `live-leads-${randomUUID()}.sqlite`);
const app = await startApp({
  development: false,
  port: 0,
  databasePath: database,
});
const { engine } = app;
const { store } = engine;
let passed = false;
let submittedPrompts = 0;
let receipt: Record<string, unknown> = {
  liveAuthorized: !!values["allow-live"],
  selected: { harness: "codex", model, thinking },
};
try {
  const support: Record<string, unknown> = {};
  for (const harness of ["pi", "claude-code", "opencode", "codex"] as const) {
    const catalog = await engine.profiles.discover({ harness });
    let refusal: { code: string; message: string } | null = null;
    if (harness !== "codex") {
      const input: StartSessionInput = {
        runId: randomUUID(),
        taskId: randomUUID(),
        attemptId: randomUUID(),
        cwd: fixture.directory,
        roleInstructions: "No prompt: coordinator refusal probe",
        model: catalog.models[0]?.id ?? "unused-probe",
        thinking: null,
        permission: "coordinator",
        contextPolicy: "fresh",
        contextPacket: "No-model Lead capability check",
        toolEndpoint: engine.gatewayUrl,
        environment: { LAO_GATEWAY_TOKEN: "inert-coordinator-probe" },
      };
      try {
        const unexpected = await engine.adapters[harness].startSession(input);
        await engine.adapters[harness].dispose(unexpected);
        throw new Error(
          `${harness} unexpectedly accepted coordinator authority`,
        );
      } catch (error) {
        if (!(error instanceof DomainError && error.code === "UNSUPPORTED"))
          throw error;
        refusal = { code: error.code, message: error.message };
      }
      assert.equal(catalog.permissions.includes("coordinator"), false);
    }
    support[harness] = {
      version: catalog.version,
      state: catalog.state,
      authenticated: catalog.authenticated,
      lead:
        harness === "codex"
          ? "implemented; native turn requires --allow-live"
          : "unsupported by this application adapter",
      coordinatorRefusal: refusal,
      fallback:
        harness === "codex"
          ? null
          : "Codex Lead + this harness as a roster worker, or owner-directed workers without a live Lead",
    };
  }
  receipt.support = support;
  if (!values["allow-live"]) {
    passed = true;
  } else {
    const catalog = await engine.profiles.discover({ harness: "codex" });
    const selected = catalog.models.find((m) => m.id === model);
    if (
      catalog.authenticated !== true ||
      !selected ||
      (thinking !== null && !selected.thinking.some((t) => t.id === thinking))
    ) {
      receipt.blocked =
        catalog.nextStep ??
        "Requested Codex model/thinking is unavailable; refresh discovery";
    } else {
      const project = await engine.openProject(
        {
          name: "M8 native Lead disposable fixture",
          repositoryPath: fixture.directory,
        },
        randomUUID(),
      );
      const roles = engine.presets().roles;
      const leadRole = roles.find((r) => r.name === "Lead");
      const readerRole = roles.find((r) => r.name === "Reader");
      assert.ok(leadRole && readerRole);
      const common = {
        harness: "codex",
        model,
        thinking,
        instructionOverride: null,
      };
      const lead = await engine.profiles.create(
        {
          ...common,
          name: "M8 native Codex Lead",
          roleId: leadRole.id,
          permission: "coordinator",
        },
        randomUUID(),
      );
      const reader = await engine.profiles.create(
        {
          ...common,
          name: "Unused Codex Reader",
          roleId: readerRole.id,
          permission: "read_only",
        },
        randomUUID(),
      );
      const team = createTeam(
        store,
        {
          name: "M8 native Lead policy probe",
          leadProfileId: lead.id,
          workerProfileIds: [reader.id],
          workflowTemplateIds: [],
          mode: "autonomous_bounded",
          limits: { ...defaultLimits, maxTotalWorkerLaunchesPerRun: 1 },
        },
        randomUUID(),
      );
      const run = await createTeamRun(
        engine,
        {
          projectId: project.id,
          teamId: team.id,
          teamVersion: team.version,
          title: "M8 native Codex Lead gateway probe",
          initialPrompt: `Read native-proof.txt and quote its exact nonce in your final reply. Call get_run_status, then propose_task once for a read-only inspection of that file. For a deliberate policy-denial check, call assign_task on that proposed task with profileId ${lead.id} (your own coordinator profile, NOT a worker). Expect POLICY_DENIED; report it, do not retry. Do not assign any real worker or change any file. End this one turn with the nonce and denial outcome.`,
        },
        randomUUID(),
      );
      submittedPrompts = 1;
      for (let tries = 0; ; tries++) {
        try {
          await engine.idle();
          break;
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              /deadline/.test(error.message) &&
              tries < 5
            )
          )
            throw error;
        }
      }
      let page = store.events({ runId: run.id, limit: 500 });
      const events = page;
      while (page.length === 500) {
        const last = page.at(-1);
        assert.ok(last);
        page = store.events({
          runId: run.id,
          after: last.sequence,
          limit: 500,
        });
        events.push(...page);
      }
      const payloads = (type: string) =>
        events.filter((e) => e.type === type).map((e) => e.payload);
      const tasks = store.listTasks(run.id);
      const leadTask = tasks.find((t) => t.kind === "lead");
      const sessions = store.listSessions();
      const settings = payloads("codex.settings_verified");
      const denials = payloads("gateway.denied");
      const tools = payloads("gateway.tool_call");
      const messages = payloads("lead.message");
      const checks = {
        authoritativeCompletion:
          leadTask?.status === "AWAITING_REVIEW" &&
          sessions.length === 1 &&
          sessions[0]?.adapter === "codex" &&
          sessions[0]?.state === "exited" &&
          sessions[0]?.exitCode === 0,
        settingsMatch:
          settings.length === 1 &&
          settings[0]?.model === model &&
          (thinking === null || settings[0]?.thinking === thinking),
        gatewayReadAndProposal: ["get_run_status", "propose_task"].every(
          (name) => tools.some((t) => t.tool === name && t.outcome === "ok"),
        ),
        coordinatorAssignmentDenied: denials.some(
          (d) => d.tool === "assign_task" && d.code === "POLICY_DENIED",
        ),
        nonceReported: messages.some((m) => String(m.text).includes(nonce)),
        noWorkerLaunched:
          engine.scheduling.committedLaunches(run.id) === 0 &&
          store.listAttempts().length === 1 &&
          tasks.filter((t) => t.kind === "work").length === 1 &&
          tasks
            .filter((t) => t.kind === "work")
            .every((t) => t.status === "BACKLOG"),
        noSessionError:
          payloads("codex.session_error").length === 0 &&
          payloads("lead.policy_violation").length === 0,
      };
      receipt.nativeCodexLead = {
        runId: run.id,
        nativeSessionId: sessions[0]?.nativeSessionId ?? null,
        checks,
        settingsVerified: settings,
        gatewayConnected: payloads("gateway.connected"),
        tools,
        denials,
        messages,
        processExit: payloads("codex.process_exit"),
        sessionErrors: payloads("codex.session_error"),
        usage: payloads("codex.usage"),
        configured: payloads("lead.session_configured"),
      };
      passed = Object.values(checks).every(Boolean);
    }
  }
} catch (error) {
  // Native exceptions can contain secrets; retain state, not their raw text.
  receipt.failure = {
    code: error instanceof DomainError ? error.code : "SMOKE_FAILED",
    message: "Lead probe failed; inspect retained app-owned state",
  };
} finally {
  await app.close();
}
const ownerUnchanged =
  (await fixture.git("status", "--porcelain")) === "" &&
  (await fixture.git("rev-parse", "HEAD")) === baseline;
const personalUnchanged =
  JSON.stringify(await metadata()) === JSON.stringify(personalBefore);
passed = passed && ownerUnchanged && personalUnchanged;
const retained = !passed;
receipt = {
  ...receipt,
  submittedPrompts,
  ownerCheckoutUnchanged: ownerUnchanged,
  personalConfigMetadataUnchanged: personalUnchanged,
  passed,
  retained: retained ? { database, fixture: fixture.directory } : null,
  limitations: [
    "Only Codex has a coordinator executor and enforced Lead tool policy in this application; other refusals do not prove a native harness cannot implement one",
    "Native opt-in covers one Codex Lead turn and gateway policy denial, not live end-to-end delegation to the other harnesses",
    "Codex-Lead fallbacks for Pi, Claude and OpenCode use real engine/gateway/Git with inert protocol fixtures in tests/lead-fallback.test.ts; separate live worker receipts are under M8 item 5",
    "Personal-config evidence checks metadata of the listed files, not a complete isolation audit (M8 item 7)",
  ],
};
const text = `${JSON.stringify(receipt, null, 2)}\n`;
for (const [key, value] of Object.entries(process.env))
  if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && value && value.length >= 8)
    assert.equal(text.includes(value), false, `${key} value reached evidence`);
await writeFile(output, text, { mode: 0o600, flag: "wx" });
if (!retained) {
  await fixture.verify(async () => {});
  for (const suffix of ["", "-wal", "-shm"])
    await rm(`${database}${suffix}`, { force: true });
}
console.log(
  `${passed ? (values["allow-live"] ? "PASS" : "DISCOVERY/REFUSALS ONLY (zero prompts)") : submittedPrompts ? "FAIL" : "BLOCKED"}: Lead support matrix; evidence ${output}`,
);
process.exitCode = passed ? 0 : submittedPrompts ? 1 : 2;
