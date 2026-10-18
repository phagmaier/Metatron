import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import { pauseTask } from "../src/server/orchestration/stops.ts";
import { defaultLimits, type Task } from "../src/shared/domain/entities.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { leadTeam } from "../src/shared/native.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

const reader = "00000000-0000-4000-8000-000000000013";
const synthesizer = "00000000-0000-4000-8000-000000000014";

async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail("Pause fixture did not reach the expected state");
}

// Pi protocol subprocesses that hold until stopped: no model or provider. The
// run's Codex Lead has no automatic wake-up budget, so any wake-up attempt is
// journaled as suppressed and no Lead process can start.
async function fixture() {
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-pause-"));
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: {
      pi: new PiAdapter(
        data,
        (_args, cwd, env) =>
          new PiRpc(
            process.execPath,
            [
              fileURLToPath(
                new URL("./helpers/pi-rpc-fixture.ts", import.meta.url),
              ),
            ],
            cwd,
            { ...env, LAO_FIXTURE_SCENARIO: "hold" },
          ),
      ),
    },
  });
  const engine = app.engine;
  assert.ok(engine);
  const { store } = engine;
  const project = await engine.openProject(
    { name: "Pause protocol fixture", repositoryPath: repo.directory },
    "project",
  );
  const run = store.createRun(
    {
      projectId: project.id,
      title: "Owner pause (protocol fixture, not a live harness)",
      initialPrompt: "Owner takes over a worker",
      mode: "autonomous_bounded",
      execution: "native",
      repository: project.repository,
      limits: { ...defaultLimits, maxAutomaticLeadWakeupsPerRun: 0 },
      teamSnapshot: leadTeam({
        mode: "autonomous_bounded",
        lead: { model: "fixture/lead", thinking: "low" },
        worker: { model: "fixture/model", thinking: "off" },
      }),
    },
    "run",
  );
  const token = z
    .object({ token: z.string() })
    .parse(await (await fetch(`${app.origin}/api/local-session`)).json()).token;
  return {
    engine,
    store,
    run,
    async api(method: string, path: string, body: unknown, key: string) {
      const response = await fetch(`${app.origin}/api/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          "X-Local-Token": token,
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    async startWorker(title: string) {
      const task = store.createTask(
        { runId: run.id, title, objective: "Hold until the owner intervenes" },
        `task:${title}`,
      );
      engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: task.id, profileId: reader },
        `assign:${title}`,
      );
      await until(() => engine.nativeStops.has(task.id));
      return task;
    },
    attempts(task: Task) {
      return store.listAttempts().filter((a) => a.taskId === task.id);
    },
    stops(task: Task) {
      return store
        .listSessions()
        .filter((s) => store.getAttempt(s.attemptId).taskId === task.id)
        .flatMap((s) => s.stops.map((stop) => [stop.scope, stop.status]));
    },
    async close() {
      for (const task of store.listTasks(run.id))
        if (task.status === "RUNNING") engine.cancel(task.id, `end:${task.id}`);
      await engine.idle();
      await app.close();
      await rm(data, { recursive: true });
      await repo.verify(async () => {});
    },
  };
}

test("owner pause stops only that worker, leaves it for a recovery decision and notifies the Lead without waking it", async () => {
  const f = await fixture();
  try {
    const paused = await f.startWorker("paused");
    const other = await f.startWorker("other");
    const first = await f.api(
      "POST",
      "tasks/pause",
      { taskId: paused.id },
      "p",
    );
    assert.equal(first.status, 200);
    assert.equal(first.body.sessionIds.length, 1);
    const replay = await f.api(
      "POST",
      "tasks/pause",
      { taskId: paused.id },
      "p",
    );
    assert.deepEqual(replay.body, first.body);
    await until(
      () =>
        f.store.getTask(paused.id).status === "RETRY_DECISION" &&
        f.stops(paused).every(([, status]) => status !== "pending"),
    );
    assert.deepEqual(f.stops(paused), [["pause", "confirmed"]]);
    const [attempt] = f.attempts(paused);
    assert.equal(attempt?.status, "interrupted");
    assert.equal(attempt?.recovery?.cause, "interrupted");
    assert.match(attempt?.recovery?.reason ?? "", /^Owner paused this worker/);
    assert.equal(f.store.getTask(other.id).status, "RUNNING");
    assert.ok(f.engine.nativeStops.has(other.id));
    assert.deepEqual(f.stops(other), []);
    const events = f.store.events({ runId: f.run.id, limit: 500 });
    const notes = events.filter(
      (e) => e.type === "lead.notification" && e.taskId === paused.id,
    );
    assert.deepEqual(
      notes.map((e) => e.payload.kind),
      ["paused"],
    );
    assert.equal(
      events.filter((e) => e.type.startsWith("lead.wakeup")).length,
      0,
    );
    assert.equal(
      f.store.listTasks(f.run.id).filter((t) => t.kind === "lead").length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("a paused worker is reprioritized and reassigned by explicit decision into a new worktree while the old checkout is retained", async () => {
  const f = await fixture();
  try {
    const task = await f.startWorker("takeover");
    await f.api("POST", "tasks/pause", { taskId: task.id }, "pause");
    await until(() => f.store.getTask(task.id).status === "RETRY_DECISION");
    const [old] = f.attempts(task);
    assert.ok(old);
    const priority = await f.api(
      "PATCH",
      "tasks",
      { id: task.id, priority: 7 },
      "priority",
    );
    assert.equal(priority.status, 200);
    const check = await f.api(
      "POST",
      "recovery/recheck",
      { taskId: task.id },
      "recheck",
    );
    assert.equal(check.status, 200);
    const decision = await f.api(
      "POST",
      "recovery/decision",
      { taskId: task.id, checkId: check.body.id, profileId: synthesizer },
      "decision",
    );
    assert.equal(decision.status, 200, JSON.stringify(decision.body));
    await until(() => f.engine.nativeStops.has(task.id));
    const current = f.store.getTask(task.id);
    assert.equal(current.status, "RUNNING");
    assert.equal(current.priority, 7);
    assert.equal(current.assignedProfileId, synthesizer);
    const attempts = f.attempts(task);
    assert.equal(attempts.length, 2);
    const successor = attempts.find((a) => a.id !== old.id);
    assert.ok(successor);
    assert.notEqual(successor.cwd, old.cwd);
    await access(old.cwd);
    const oldSession = f.store
      .listSessions()
      .find((s) => s.attemptId === old.id);
    assert.equal(oldSession?.state, "exited");
    assert.equal(
      f.engine.worktrees.list().find((w) => w.attemptId === old.id)?.state,
      "retained",
    );
  } finally {
    await f.close();
  }
});

test("pause refuses queued, unknown and Lead tasks without journaling a stop", async () => {
  const f = await fixture();
  try {
    const backlog = f.store.createTask(
      { runId: f.run.id, title: "not started", objective: "Wait" },
      "backlog",
    );
    const lead = f.store.createTask(
      { runId: f.run.id, title: "lead", objective: "Plan", kind: "lead" },
      "lead",
    );
    const code = (taskId: string) => {
      try {
        pauseTask(f.engine, { taskId }, `pause:${taskId}`);
      } catch (error) {
        assert.ok(error instanceof DomainError);
        return error.code;
      }
      assert.fail("pause was accepted");
    };
    assert.equal(code(backlog.id), "CONFLICT");
    assert.equal(code(lead.id), "POLICY_DENIED");
    assert.equal(code(crypto.randomUUID()), "NOT_FOUND");
    assert.equal(f.store.getTask(backlog.id).status, "BACKLOG");
    assert.equal(
      f.store
        .events({ runId: f.run.id, limit: 500 })
        .filter((e) => e.type === "stop.requested").length,
      0,
    );
  } finally {
    await f.close();
  }
});
