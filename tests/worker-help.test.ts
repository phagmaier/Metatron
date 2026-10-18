import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import { pendingWorkerHelp } from "../src/server/orchestration/worker-help.ts";
import { Store } from "../src/server/storage/store.ts";
import { defaultLimits } from "../src/shared/domain/entities.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

async function fixture(scenario: string, permission = "workspace_write") {
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-worker-help-"));
  let sessions = 0;
  const pi = new PiAdapter(
    data,
    (args, cwd, env) =>
      new PiRpc(
        process.execPath,
        [
          fileURLToPath(
            new URL("./helpers/pi-rpc-fixture.ts", import.meta.url),
          ),
        ],
        cwd,
        {
          ...env,
          LAO_FIXTURE_SCENARIO:
            args.includes("--session-dir") && sessions++ === 0
              ? scenario
              : "tracked",
        },
      ),
  );
  const options = {
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: { pi },
  };
  let app = await startApp(options);
  const engine = app.engine;
  assert.ok(engine);
  const project = await engine.openProject(
    { name: "Worker help protocol fixture", repositoryPath: repo.directory },
    "project",
  );
  const run = await engine.startNativeRun(
    {
      projectId: project.id,
      title: "Worker help fixture",
      initialPrompt: "Inspect the disposable fixture",
      model: "fixture/model",
      thinking: "off",
      permission,
      limits: { ...defaultLimits, maxConcurrentWriters: 1 },
    },
    "run",
  );
  return {
    repo,
    data,
    run,
    get app() {
      return app;
    },
    get engine() {
      assert.ok(app.engine);
      return app.engine;
    },
    get store() {
      return this.engine.store;
    },
    async restart() {
      await app.close();
      app = await startApp(options);
    },
    async close() {
      await app.close();
    },
  };
}

for (const scenario of ["help-blocking", "issue-blocking", "issue-urgent"]) {
  test(`${scenario}: stopped worker waits with retained evidence while independent readers and queued writers finish`, async () => {
    const f = await fixture(scenario);
    let passed = false;
    try {
      const [blocked] = f.store.listTasks(f.run.id);
      assert.ok(blocked);
      const siblings = ["Reader", "Writer"].map((title, index) => {
        const task = f.engine.createTask(
          { runId: f.run.id, title, objective: "Independent work" },
          title,
        );
        f.engine.scheduling.enqueue(
          { role: "owner" },
          {
            taskId: task.id,
            profileId: `00000000-0000-4000-8000-0000000000${index === 0 ? "13" : "11"}`,
          },
          `${title}:assign`,
        );
        return task;
      });
      await f.engine.idle();
      assert.equal(f.store.getTask(blocked.id).status, "WAITING_HUMAN");
      for (const sibling of siblings)
        assert.equal(f.store.getTask(sibling.id).status, "AWAITING_REVIEW");
      const attempt = f.store
        .listAttempts()
        .find((a) => a.taskId === blocked.id);
      assert.ok(attempt?.worktreePath);
      assert.equal(attempt.status, "interrupted");
      const session = f.store
        .listSessions()
        .find((s) => s.attemptId === attempt.id);
      assert.ok(session?.nativeSessionId);
      assert.equal(session.state, "exited");
      const [request] = f.store.listTaskBlockers(blocked.id);
      assert.ok(request);
      assert.equal(request.sessionId, session.id);
      assert.equal(
        request.type,
        scenario === "help-blocking" ? "environment" : "manual_check",
      );
      assert.equal(
        request.urgency,
        scenario === "issue-urgent" ? "urgent" : "normal",
      );
      assert.equal(
        await readFile(join(attempt.worktreePath, "help-scratch.txt"), "utf8"),
        "Unfinished fixture work; preserve me\n",
      );
      assert.equal(
        f.engine.worktrees.list().find((w) => w.attemptId === attempt.id)
          ?.state,
        "retained",
      );
      assert.equal(
        f.store.db
          .prepare("SELECT count(*) n FROM reservations WHERE attempt_id=?")
          .get(attempt.id)?.n,
        0,
      );
      assert.equal(pendingWorkerHelp(f.store, attempt.id), null);
      const events = f.store.events({ runId: f.run.id, limit: 500 });
      assert.ok(
        events.some(
          (e) => e.type === "worktree.captured" && e.attemptId === attempt.id,
        ),
      );
      assert.ok(
        !events.some(
          (e) => e.type === "candidate.captured" && e.attemptId === attempt.id,
        ),
      );
      assert.throws(
        () =>
          f.engine.scheduling.enqueue(
            { role: "owner" },
            { taskId: blocked.id, profileId: attempt.profileId },
            "unsafe-resume",
          ),
        { code: "CONFLICT" },
      );
      f.store.updateHumanRequest(
        { id: request.id, expectedStatus: "open", status: "deferred" },
        "defer",
      );
      assert.equal(f.store.listTaskBlockers(blocked.id).length, 1);
      await f.restart();
      await f.engine.idle();
      assert.equal(f.store.getTask(blocked.id).status, "WAITING_HUMAN");
      assert.equal(f.store.getHumanRequest(request.id).status, "deferred");
      assert.equal(f.store.listAttempts().length, 3);
      assert.equal(
        await readFile(join(attempt.worktreePath, "help-scratch.txt"), "utf8"),
        "Unfinished fixture work; preserve me\n",
      );
      f.store.updateHumanRequest(
        {
          id: request.id,
          expectedStatus: "deferred",
          status: "answered",
          ownerResponse: "Setup recorded; continuation remains explicit",
        },
        "answer",
      );
      await f.engine.pump();
      assert.equal(f.store.getTask(blocked.id).status, "WAITING_HUMAN");
      assert.equal(f.store.listAttempts().length, 3);
      const saved = {
        requests: f.store.listHumanRequests(),
        attempts: f.store.listAttempts(),
        sessions: f.store.listSessions(),
        events: f.store.events({ limit: 500 }),
      };
      await f.restart();
      assert.deepEqual(f.store.listHumanRequests(), saved.requests);
      assert.deepEqual(f.store.listAttempts(), saved.attempts);
      assert.deepEqual(f.store.listSessions(), saved.sessions);
      assert.deepEqual(f.store.events({ limit: 500 }), saved.events);
      if (scenario === "help-blocking") {
        const input = {
          taskId: blocked.id,
          profileId: attempt.profileId,
          contextPolicy: "fresh",
        };
        const queued = f.engine.scheduling.enqueue(
          { role: "owner" },
          input,
          "continue",
        );
        await f.engine.idle();
        assert.equal(f.store.getTask(blocked.id).status, "AWAITING_REVIEW");
        assert.equal(f.store.listAttempts().length, 4);
        const successor = f.store
          .listAttempts()
          .findLast((a) => a.taskId === blocked.id);
        assert.ok(successor);
        assert.notEqual(successor.worktreePath, attempt.worktreePath);
        assert.equal(
          await readFile(
            join(attempt.worktreePath, "help-scratch.txt"),
            "utf8",
          ),
          "Unfinished fixture work; preserve me\n",
        );
        assert.deepEqual(
          f.engine.scheduling.enqueue({ role: "owner" }, input, "continue"),
          queued,
        );
        await f.restart();
        await f.engine.idle();
        assert.equal(f.store.listAttempts().length, 4);
        assert.equal(f.store.getTask(blocked.id).status, "AWAITING_REVIEW");
      }
      assert.equal(await f.repo.git("status", "--porcelain"), "");
      passed = true;
    } finally {
      await f.close();
      if (passed) {
        await f.repo.verify(async () => {});
        await rm(f.data, { recursive: true });
      }
    }
  });
}

for (const scenario of ["help-nonblocking", "issue-info"]) {
  test(`${scenario}: owner help or informational finding leaves native execution running to completion`, async () => {
    const f = await fixture(scenario, "read_only");
    try {
      await f.engine.idle();
      assert.equal(f.store.listTasks(f.run.id)[0]?.status, "AWAITING_REVIEW");
      assert.equal(f.store.listAttempts()[0]?.status, "completed");
      const requests = f.store.listHumanRequests();
      assert.equal(requests.length, scenario === "help-nonblocking" ? 1 : 0);
      if (requests[0]) assert.equal(requests[0].blocking, false);
      assert.ok(
        !f.store
          .events({ limit: 500 })
          .some((e) => e.type === "worker.help_requested"),
      );
    } finally {
      await f.close();
    }
  });
}

test("restart during a durable help intent creates one recovery diagnostic without replaying the stop or worker", async () => {
  const f = await domainFixture();
  const attempt = f.store.createAttempt(
    {
      taskId: f.task.id,
      adapter: "fake",
      intendedOperation: "Fixture help",
      cwd: f.directory,
    },
    "attempt",
  );
  f.store.transitionTask(
    {
      id: f.task.id,
      expectedStatus: "BACKLOG",
      status: "READY",
      reason: "Fixture",
    },
    "ready",
  );
  f.store.transitionTask(
    {
      id: f.task.id,
      expectedStatus: "READY",
      status: "QUEUED",
      reason: "Fixture",
    },
    "queue",
  );
  f.store.transitionTask(
    {
      id: f.task.id,
      expectedStatus: "QUEUED",
      status: "RUNNING",
      reason: "Fixture",
    },
    "running",
  );
  f.store.updateAttempt(
    { id: attempt.id, status: "running" },
    "running-attempt",
  );
  const session = f.store.createSession({ attemptId: attempt.id }, "session");
  f.store.recordEvent(
    {
      runId: f.run.id,
      taskId: f.task.id,
      attemptId: attempt.id,
      sessionId: session.id,
      type: "worker.help_requested",
      correlationId: "help-intent",
      payload: {
        runId: f.run.id,
        sessionId: session.id,
        affectedTaskIds: [f.task.id],
        type: "environment",
        urgency: "high",
        reason: "Fixture help before restart",
        suggestedAction: "Inspect before retry",
        blocking: true,
      },
    },
    "intent",
  );
  f.reopen().recoverInterrupted();
  let engine = new Engine(f.store, f.directory);
  try {
    assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
    const [request] = f.store.listHumanRequests();
    assert.ok(request);
    assert.equal(request.blocking, false);
    assert.equal(request.sessionId, session.id);
    assert.equal(f.store.getAttempt(attempt.id).status, "RECOVERY_REQUIRED");
    const saved = f.store.events({ limit: 500 });
    await engine.close();
    engine = new Engine(f.reopen(), f.directory);
    await delay(150);
    assert.equal(f.store.listAttempts().length, 1);
    assert.deepEqual(f.store.listHumanRequests(), [request]);
    assert.deepEqual(f.store.events({ limit: 500 }), saved);
  } finally {
    await engine.close();
    await f.close();
  }
});

test("owner cancellation during a fake worker's help stop keeps it cancelled and preserves its request", async () => {
  const repo = await createGitFixture();
  const directory = await mkdtemp(join(tmpdir(), "lao-fake-help-"));
  const store = new Store(join(directory, "state.sqlite"));
  const engine = new Engine(store, directory);
  try {
    const project = await engine.openProject(
      { name: "FAKE help fixture", repositoryPath: repo.directory },
      "project",
    );
    const run = await engine.startRun(
      {
        projectId: project.id,
        title: "FAKE help",
        initialPrompt: "Ask the owner",
        leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
      },
      "run",
    );
    let sessionId: string | undefined;
    let taskId: string | undefined;
    for (let i = 0; i < 150 && !sessionId; i++) {
      const session = store
        .listSessions()
        .find(
          (s) =>
            s.state === "busy" &&
            store.getTask(store.getAttempt(s.attemptId).taskId).kind === "work",
        );
      if (session) {
        sessionId = session.id;
        taskId = store.getAttempt(session.attemptId).taskId;
      } else await delay(10);
    }
    assert.ok(sessionId && taskId);
    engine.tool(
      { role: "worker", sessionId },
      run.id,
      {
        name: "request_human_action",
        taskId,
        type: "manual_check",
        reason: "FAKE action",
        suggestedAction: "Inspect fixture",
        blocking: true,
      },
      "help",
    );
    engine.cancel(taskId, "owner-cancel");
    await engine.idle();
    assert.equal(store.getTask(taskId).status, "CANCELLED");
    const [request] = store.listHumanRequests();
    assert.ok(request);
    assert.equal(request.blocking, false);
    assert.deepEqual(request.affectedTaskIds, [taskId]);
    assert.equal(store.getSession(sessionId).state, "exited");
    store.updateHumanRequest(
      { id: request.id, expectedStatus: "open", status: "completed" },
      "complete",
    );
    assert.equal(store.getTask(taskId).status, "CANCELLED");
    assert.equal(store.listAttempts().length, 2);
  } finally {
    await engine.close();
    store.close();
  }
});

test("a help finalization journal failure rolls back the wait and remains a recovery decision without replay", async () => {
  const f = await fixture("help-blocking");
  try {
    f.store.db.exec(`CREATE TRIGGER fail_help_finalization BEFORE INSERT ON events
      WHEN NEW.type='human_request.created' BEGIN SELECT RAISE(ABORT,'fixture'); END;`);
    await f.engine.idle();
    const [task] = f.store.listTasks(f.run.id);
    const [attempt] = f.store.listAttempts();
    assert.ok(task && attempt);
    assert.equal(f.store.db.isTransaction, false);
    assert.equal(task.status, "RETRY_DECISION");
    assert.deepEqual(f.store.listHumanRequests(), []);
    assert.ok(pendingWorkerHelp(f.store, attempt.id));
    assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
    f.store.db.exec("DROP TRIGGER fail_help_finalization");
    await f.restart();
    assert.equal(f.store.listAttempts().length, 1);
    assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
    assert.equal(f.store.listHumanRequests().length, 1);
    assert.equal(f.store.listHumanRequests()[0]?.blocking, false);
    assert.equal(pendingWorkerHelp(f.store, attempt.id), null);
  } finally {
    await f.close();
  }
});
