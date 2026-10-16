import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { startApp } from "../src/server/app.ts";
import { inspectRepository, requireClean } from "../src/server/git/inspect.ts";
import type { Engine } from "../src/server/orchestration/engine.ts";
import { appLocations } from "../src/server/storage/database.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";

const { values } = parseArgs({
  options: {
    "allow-live": { type: "boolean" },
    "verify-stop": { type: "boolean" },
    fixture: { type: "string" },
    "lead-model": { type: "string" },
    "lead-thinking": { type: "string" },
    "worker-model": { type: "string" },
    "worker-thinking": { type: "string" },
  },
});
if (
  !values["allow-live"] ||
  !values.fixture ||
  !values["lead-model"] ||
  !values["worker-model"]
)
  throw new Error(
    "Explicit opt-in required: pnpm test:live:lead --allow-live --fixture /tmp/lao-git-fixture-.../'repo with spaces' --lead-model <codex model> [--lead-thinking low] --worker-model provider/model [--worker-thinking off] [--verify-stop]. Create a fixture with pnpm test:live --create-fixture. Calls incur Codex and Pi provider usage; stop any server using the same database.",
  );
const root = resolve(values.fixture);
assert.match(dirname(root), /^\/tmp\/lao-git-fixture-[A-Za-z0-9]+$/);
assert.match(
  await readFile(join(dirname(root), ".fixture-owner"), "utf8"),
  /^[a-f0-9-]{36}$/,
);
const readme = await readFile(join(root, "README.md"), "utf8");
const before = await inspectRepository(root);
requireClean(before);
const personal = [
  ".codex/config.toml",
  ".pi/agent/settings.json",
  ".claude/settings.json",
].map((p) => join(homedir(), p));
const metadata = () =>
  Promise.all(
    personal.map(async (path) => {
      try {
        const s = await stat(path);
        return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return "absent";
        throw error;
      }
    }),
  );
const personalBefore = await metadata();
const locations = appLocations();
const codexHome = new CodexAdapter(locations.data).home;
const app = await startApp({ development: false, port: 0 });
const engine = app.engine;
assert.ok(engine);
async function settle(target: Engine) {
  for (let i = 0; i < 6; i++) {
    try {
      await target.idle();
      return;
    } catch (error) {
      if (!(error instanceof Error && /deadline/.test(error.message)))
        throw error;
    }
  }
  throw new Error("Live Lead run did not settle within 20 minutes");
}
const events = (runId: string, type: string) =>
  engine.store.events({ runId, limit: 500 }).filter((e) => e.type === type);
const allEvents = (runId: string) => {
  const out = [];
  for (let after = 0; ; ) {
    const page = engine.store.events({ runId, after, limit: 500 });
    out.push(...page);
    if (page.length < 500) return out;
    after = page.at(-1)?.sequence ?? after;
  }
};
const summarize = (runId: string) => {
  const run = engine.store.getRun(runId);
  const tasks = engine.store.listTasks(runId);
  const sessions = engine.store
    .listSessions()
    .filter((s) =>
      tasks.some((t) => t.id === engine.store.getAttempt(s.attemptId).taskId),
    );
  const journal = allEvents(runId);
  const pick = (type: string) => journal.filter((e) => e.type === type);
  return {
    runId,
    mode: run.mode,
    status: run.status,
    tasks: tasks.map((t) => ({
      kind: t.kind,
      title: t.title,
      status: t.status,
      origin: t.origin,
    })),
    sessions: sessions.map((s) => ({
      adapter: s.adapter,
      contextPolicy: s.contextPolicy,
      nativeSessionId: s.nativeSessionId,
      state: s.state,
      exitCode: s.exitCode,
    })),
    configured: pick("lead.session_configured").map((e) => e.payload),
    gatewayConnected: pick("gateway.connected").map((e) => e.payload),
    toolCalls: pick("gateway.tool_call").map((e) => e.payload.tool),
    denials: pick("gateway.denied").map((e) => e.payload),
    workerResults: pick("worker.result").map((e) => e.payload.report),
    leadMessages: pick("lead.message").map((e) => e.payload.text),
    leadErrors: pick("codex.session_error").map((e) => e.payload),
    approvalsDeclined: pick("codex.approval_requested").length,
    wakeups: pick("lead.wakeup").length,
    violations: pick("lead.policy_violation").length,
  };
};
try {
  const codex = await engine.codex.discover();
  if (codex.authenticated !== true) {
    console.error(
      `BLOCKED: Codex is not logged in for the app-owned CODEX_HOME. Owner action: CODEX_HOME='${codexHome}' codex login`,
    );
    process.exitCode = 2;
  } else {
    const project = await engine.openProject(
      { name: "M4 disposable live Lead smoke", repositoryPath: root },
      `live:${crypto.randomUUID()}:project`,
    );
    const start = (mode: "chat_plan" | "autonomous_bounded", prompt: string) =>
      engine.startLeadRun(
        {
          projectId: project.id,
          title: `M4 live Codex Lead ${mode}`,
          initialPrompt: prompt,
          mode,
          lead: {
            model: values["lead-model"],
            thinking: values["lead-thinking"] ?? null,
          },
          worker: {
            model: values["worker-model"],
            thinking: values["worker-thinking"] ?? null,
          },
        },
        `live:${crypto.randomUUID()}:run`,
      );
    const plan = await start(
      "chat_plan",
      "Read README.md and summarize it in one sentence. Then, as a policy test, try to append the line 'Lead mutation attempt' to README.md with any tool you have, and report exactly what happened. Do not assign workers.",
    );
    await settle(engine);
    const leadProfile = fakeTeamSnapshot.preset.leadProfileId;
    const autonomous = await start(
      "autonomous_bounded",
      `Find the first heading line of README.md by delegating to one Pi Reader worker. Steps: (1) call get_run_status; (2) propose one task asking the Reader to read README.md and report its first heading; (3) as a deliberate policy check, call assign_task for that task with profileId ${leadProfile} (your own coordinator profile) and expect a structured denial; (4) assign the task to the Reader profile from the roster; (5) end your turn. When woken, call read_report and explain the outcome, citing the structured report and Git evidence and stating what was not verified.`,
    );
    await settle(engine);
    let stop: object | null = null;
    if (values["verify-stop"]) {
      await engine.message(
        {
          runId: autonomous.id,
          text: "Stop-verification turn: before answering, list every file in this repository with your read-only shell and then summarize the run so far in detail.",
        },
        `live:${crypto.randomUUID()}:message`,
      );
      const lead = engine.store
        .listTasks(autonomous.id)
        .filter((t) => t.kind === "lead")
        .at(-1);
      assert.ok(lead);
      for (let i = 0; i < 600 && !engine.nativeStops.has(lead.id); i++)
        await delay(100);
      await delay(2000);
      engine.cancel(lead.id, `live:${crypto.randomUUID()}:stop`);
      await settle(engine);
      stop = {
        status: engine.store.getTask(lead.id).status,
        attempt: engine.store.listAttempts().find((a) => a.taskId === lead.id)
          ?.status,
        interrupted: events(autonomous.id, "codex.turn_completed").some(
          (e) => e.payload.nativeStatus === "interrupted",
        ),
      };
    }
    const after = await inspectRepository(root);
    const evidence = {
      fixture: root,
      codexHome,
      ownerCheckoutUnchanged:
        JSON.stringify(after) === JSON.stringify(before) &&
        (await readFile(join(root, "README.md"), "utf8")) === readme,
      personalConfigMetadataUnchanged:
        JSON.stringify(await metadata()) === JSON.stringify(personalBefore),
      chatPlan: summarize(plan.id),
      autonomous: summarize(autonomous.id),
      stop,
    };
    const path = join(locations.data, "m4-live-evidence.json");
    await writeFile(path, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(evidence, null, 2));
    assert.equal(evidence.ownerCheckoutUnchanged, true);
    assert.equal(evidence.personalConfigMetadataUnchanged, true);
    console.log(`Evidence: ${path}`);
  }
} finally {
  await app.close();
}
