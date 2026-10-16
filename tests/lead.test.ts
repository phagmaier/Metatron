import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import type { Run } from "../src/shared/domain/entities.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`./helpers/${name}`, import.meta.url));
async function leadFixture(
  options: {
    scenario?: string;
    pi?: string;
    codexEnv?: Record<string, string>;
  } = {},
) {
  const repo = await createGitFixture();
  const data = await mkdtemp("/tmp/lao-lead-");
  const log = join(data, "codex-fixture.log");
  const piArgs: string[][] = [];
  const pi = new PiAdapter(data, (args, cwd, env) => {
    piArgs.push(args);
    return new PiRpc(
      process.execPath,
      [fixturePath("pi-rpc-fixture.ts")],
      cwd,
      {
        ...env,
        LAO_FIXTURE_SCENARIO: options.pi ?? "success",
      },
    );
  });
  const codex = new CodexAdapter(data, (args, cwd, env) => {
    assert.ok(args.includes("multi_agent"));
    assert.equal(env.CODEX_HOME, join(data, "codex"));
    return new CodexRpc(
      process.execPath,
      [fixturePath("codex-fixture.ts"), ...args],
      cwd,
      {
        ...env,
        LAO_CODEX_FIXTURE_SCENARIO: options.scenario ?? "delegate",
        LAO_CODEX_FIXTURE_LOG: log,
        ...options.codexEnv,
      },
    );
  });
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: { pi, codex },
  });
  const engine = app.engine;
  assert.ok(engine);
  const project = await engine.openProject(
    { name: "Lead fixture", repositoryPath: repo.directory },
    "project",
  );
  const readme = await readFile(join(repo.directory, "README.md"), "utf8");
  return {
    app,
    engine,
    store: engine.store,
    piArgs,
    async log() {
      return (await readFile(log, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    start(
      mode: Run["mode"],
      limits: Partial<Run["limits"]> = {},
      thinking = "low",
    ) {
      return engine.startLeadRun(
        {
          projectId: project.id,
          title: "Lead fixture run",
          initialPrompt: "Find the README heading",
          mode,
          limits: {
            maxConcurrentWriters: 2,
            maxConcurrentReadersReviewers: 4,
            maxConcurrentAgentsIncludingLead: 7,
            maxTotalWorkerLaunchesPerRun: 24,
            maxParallelReadersPerWorkflow: 4,
            maxRevisionCyclesPerTask: 2,
            maxAutomaticLeadWakeupsPerRun: 40,
            ...limits,
          },
          lead: { model: "fixture-model", thinking },
          worker: { model: "fixture/model", thinking: "off" },
        },
        `start:${mode}:${crypto.randomUUID()}`,
      );
    },
    events(runId: string, type: string) {
      return engine.store
        .events({ runId, limit: 500 })
        .filter((e) => e.type === type);
    },
    async close() {
      await app.close();
      await repo.verify(async () => {
        assert.equal(await repo.git("status", "--porcelain"), "");
        assert.equal(
          await readFile(join(repo.directory, "README.md"), "utf8"),
          readme,
        );
      });
    },
  };
}
const leadSessions = (
  f: Awaited<ReturnType<typeof leadFixture>>,
  runId: string,
) =>
  f.store.listSessions().filter((s) => {
    const task = f.store.getTask(f.store.getAttempt(s.attemptId).taskId);
    return task.runId === runId && task.kind === "lead";
  });

test("Codex Lead assigns a Pi worker, is woken with the structured report and resumes its own thread", async () => {
  const f = await leadFixture();
  try {
    const run = await f.start("autonomous_bounded");
    await f.engine.idle();
    const work = f.store.listTasks(run.id).filter((t) => t.kind === "work");
    assert.equal(work.length, 1);
    assert.equal(work[0]?.status, "AWAITING_REVIEW");
    assert.equal(work[0]?.origin, "lead");
    const sessions = leadSessions(f, run.id);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0]?.contextPolicy, "fresh");
    assert.equal(sessions[1]?.contextPolicy, "resume");
    assert.equal(sessions[0]?.nativeSessionId, sessions[1]?.nativeSessionId);
    const log = await f.log();
    assert.equal(log.filter((l) => l.method === "thread/start").length, 1);
    assert.deepEqual(
      log.filter((l) => l.method === "thread/resume").map((l) => l.threadId),
      [sessions[0]?.nativeSessionId],
    );
    assert.deepEqual(
      log.filter((l) => l.turn === "start").map((l) => l.effort),
      ["low", "low"],
    );
    const result = f.events(run.id, "worker.result")[0];
    assert.ok(result);
    assert.equal(
      (result.payload.report as { summary: string }).summary,
      "Protocol fixture structured summary",
    );
    const messages = f
      .events(run.id, "lead.message")
      .map((e) => e.payload.text);
    assert.equal(messages.length, 2);
    assert.match(String(messages[0]), /assigned/);
    assert.match(
      String(messages[1]),
      /Protocol fixture structured summary \(tool-submitted true\)/,
    );
    assert.equal(f.events(run.id, "lead.wakeup").length, 1);
    assert.ok(
      f.piArgs.some(
        (args) =>
          args.includes("builtin:mcp") &&
          args.some((a) => a.endsWith(",mcp__lao__*")) &&
          !args.includes("--no-mcp"),
      ),
    );
    const report = (await f.engine.reports(work[0]?.id ?? ""))[0]?.content;
    assert.match(report ?? "", /^Structured report \(tool-submitted\)/);
    const stale = await fetch(`${f.app.origin}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${"a".repeat(43)}`,
      },
      body: "{}",
    });
    assert.equal(stale.status, 401);
  } finally {
    await f.close();
  }
});

test("Chat/Plan Lead turn cannot dispatch: the direct call is denied, no worker launches and the checkout is unchanged", async () => {
  const f = await leadFixture();
  try {
    const run = await f.start("chat_plan");
    await f.engine.idle();
    assert.equal(
      f.store
        .listAttempts()
        .filter((a) => f.store.getTask(a.taskId).kind === "work").length,
      0,
    );
    const denied = f.events(run.id, "gateway.denied");
    assert.equal(denied[0]?.payload.tool, "assign_task");
    assert.equal(denied[0]?.payload.code, "POLICY_DENIED");
    assert.match(
      String(f.events(run.id, "lead.message")[0]?.payload.text),
      /assign POLICY_DENIED/,
    );
    const proposed = f.store.listTasks(run.id).filter((t) => t.kind === "work");
    assert.deepEqual(
      proposed.map((t) => t.status),
      ["BACKLOG"],
    );
  } finally {
    await f.close();
  }
});

test("an intentional Lead policy violation returns structured denials and the Lead continues within policy", async () => {
  const f = await leadFixture({ scenario: "deny" });
  try {
    const run = await f.start("autonomous_bounded");
    await f.engine.idle();
    const codes = f
      .events(run.id, "gateway.denied")
      .map((e) => [e.payload.tool, e.payload.code]);
    assert.deepEqual(codes, [
      ["submit_result", "POLICY_DENIED"],
      ["assign_task", "INVALID_REFERENCE"],
    ]);
    assert.match(
      String(f.events(run.id, "lead.message")[0]?.payload.text),
      /denied POLICY_DENIED, INVALID_REFERENCE; assigned/,
    );
    assert.equal(f.events(run.id, "worker.result").length, 1);
  } finally {
    await f.close();
  }
});

test("Supervised proposals wait; the owner's override is pinned and delivered to the next Lead turn", async () => {
  const f = await leadFixture();
  try {
    const run = await f.start("supervised");
    await f.engine.idle();
    const task = f.store.listTasks(run.id).find((t) => t.kind === "work");
    assert.ok(task);
    assert.equal(task.status, "BACKLOG");
    assert.ok(task.proposedProfileId);
    assert.equal(
      f.store.listAttempts().filter((a) => a.taskId === task.id).length,
      0,
    );
    const reviewer = "00000000-0000-4000-8000-000000000012";
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId: reviewer },
      "owner-approval",
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(task.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(task.id).ownerPinned, true);
    const delivered = f.events(run.id, "lead.turn.delivered");
    assert.equal(delivered.length, 2);
    assert.ok(Number(delivered[1]?.payload.items) >= 2);
    assert.equal(leadSessions(f, run.id).length, 2);
  } finally {
    await f.close();
  }
});

test("wake-ups never overlap a Lead turn, coalesce while queued and stop at the automatic budget", async () => {
  const f = await leadFixture({ scenario: "fanout" });
  try {
    const run = await f.start("autonomous_bounded", {
      maxAutomaticLeadWakeupsPerRun: 1,
    });
    await f.engine.idle();
    await delay(200);
    await f.engine.idle();
    assert.equal(f.events(run.id, "lead.notification").length, 2);
    assert.equal(f.events(run.id, "lead.wakeup").length, 1);
    const leads = f.store.listTasks(run.id).filter((t) => t.kind === "lead");
    assert.equal(leads.length, 2);
    // Each Lead attempt's running interval (by journal sequence) is disjoint.
    const intervals = f.store
      .listAttempts()
      .filter((a) => leads.some((t) => t.id === a.taskId))
      .map((a) => {
        const updates = f.store
          .events({ runId: run.id, limit: 500 })
          .filter((e) => e.attemptId === a.id && e.type === "attempt.updated");
        return [updates[0]?.sequence ?? 0, updates.at(-1)?.sequence ?? 0];
      })
      .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
    assert.ok((intervals[0]?.[1] ?? 0) < (intervals[1]?.[0] ?? 0));
    const coalesced = Number(
      f.events(run.id, "lead.turn.delivered")[1]?.payload.items,
    );
    const suppressed = f.events(run.id, "lead.wakeup.suppressed").length;
    assert.ok(coalesced === 2 || suppressed === 1);
  } finally {
    await f.close();
  }
});

test("owner stop interrupts a silent Lead turn and nothing is retried", async () => {
  const f = await leadFixture({ scenario: "hold" });
  try {
    const run = await f.start("autonomous_bounded");
    const lead = f.store.listTasks(run.id).find((t) => t.kind === "lead");
    assert.ok(lead);
    for (let i = 0; i < 300 && !f.engine.nativeStops.has(lead.id); i++)
      await delay(10);
    assert.ok(f.engine.nativeStops.has(lead.id));
    f.engine.cancel(lead.id, "owner-stop");
    await f.engine.idle();
    assert.equal(f.store.getTask(lead.id).status, "CANCELLED");
    assert.equal(
      f.store.listAttempts().find((a) => a.taskId === lead.id)?.status,
      "cancelled",
    );
    assert.ok((await f.log()).some((l) => l.method === "turn/interrupt"));
    assert.equal(f.store.listTasks(run.id).length, 1);
  } finally {
    await f.close();
  }
});

test("Lead startup fails closed without app-owned login, with delegation enabled, for delegating efforts or native sub-agents", async () => {
  const unauthenticated = await leadFixture({
    codexEnv: { LAO_CODEX_FIXTURE_AUTH: "none" },
  });
  try {
    await assert.rejects(
      unauthenticated.start("autonomous_bounded"),
      /codex login/,
    );
    assert.equal(unauthenticated.store.listRuns().length, 0);
  } finally {
    await unauthenticated.close();
  }
  const features = await leadFixture({
    codexEnv: { LAO_CODEX_FIXTURE_FEATURES_ON: "1" },
  });
  try {
    const capabilities = await features.engine.codex.discover();
    assert.equal(capabilities.installed, false);
    assert.ok(capabilities.diagnostics.some((d) => /remained enabled/.test(d)));
    await assert.rejects(features.start("autonomous_bounded"));
  } finally {
    await features.close();
  }
  const delegating = await leadFixture({ scenario: "delegation_item" });
  try {
    const efforts = (await delegating.engine.codex.discover()).models[0]
      ?.thinking;
    assert.deepEqual(
      efforts?.map((e) => e.id),
      ["low"],
    );
    await assert.rejects(
      delegating.start("autonomous_bounded", {}, "ultra"),
      /unavailable/,
    );
    const run = await delegating.start("autonomous_bounded");
    await delegating.engine.idle();
    const lead = delegating.store
      .listTasks(run.id)
      .find((t) => t.kind === "lead");
    assert.equal(lead?.status, "RETRY_DECISION");
    assert.ok(
      delegating
        .events(run.id, "codex.session_error")
        .some((e) => e.payload.code === "delegation_blocked"),
    );
    assert.ok(
      (await delegating.log()).some((l) => l.method === "turn/interrupt"),
    );
    assert.equal(delegating.store.listTasks(run.id).length, 1);
  } finally {
    await delegating.close();
  }
});
