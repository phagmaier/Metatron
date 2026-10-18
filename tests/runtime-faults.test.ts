import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ManagedSession,
  ResumeInput,
  SessionEvent,
  StartSessionInput,
} from "../src/server/adapters/contract.ts";
import { FakeAdapter } from "../src/server/adapters/fake.ts";
import { startApp } from "../src/server/app.ts";
import {
  decideRecovery,
  recheckRecovery,
} from "../src/server/orchestration/recovery-decisions.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

// Exercise the native executor with FAKE events and a controllable tool wait.
// No native harness, provider or personal session is involved.
class FaultPlayback extends FakeAdapter {
  readonly calls: string[] = [];
  readonly gate = Promise.withResolvers<void>();
  scratch = false;
  healthy = false;
  override async startSession(input: StartSessionInput) {
    this.calls.push("start");
    // Playback does not call tools through the real app's MCP endpoint.
    const managed = await super.startSession({
      ...input,
      toolEndpoint: null,
      environment: {},
    });
    if (this.scratch)
      await writeFile(
        join(input.cwd, "unfinished.txt"),
        "Unresolved fixture work\n",
      );
    return managed;
  }
  override async resume(id: string, input: ResumeInput) {
    this.calls.push("resume");
    return super.resume(id, { ...input, toolEndpoint: null, environment: {} });
  }
  override async *prompt(
    session: ManagedSession,
    text: string,
  ): AsyncIterable<SessionEvent> {
    this.calls.push("prompt");
    if (this.healthy || session.input.contextPacket === "Healthy fixture") {
      yield { type: "text_delta", text: "FAKE independent result" };
      yield { type: "turn_completed", nativeStatus: "completed" };
      return;
    }
    for await (const event of super.prompt(session, text)) {
      yield event;
      if (
        event.type === "tool_started" &&
        session.input.contextPacket === "Delayed tool fixture"
      )
        await this.gate.promise;
    }
  }
  override async cancel(session: ManagedSession) {
    this.calls.push("cancel");
    if (session.input.contextPacket === "Delayed tool fixture")
      this.gate.resolve();
    await super.cancel(session);
  }
}

async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail("Fault fixture did not reach the expected state");
}

async function fixture(
  events: SessionEvent[],
  objective: string,
  scratch = false,
) {
  const repo = await createGitFixture();
  const directory = await mkdtemp(join(tmpdir(), "lao-runtime-fault-"));
  const playback = new FaultPlayback([events]);
  playback.scratch = scratch;
  const options = {
    development: false,
    port: 0,
    databasePath: join(directory, "state.sqlite"),
    adapters: { pi: playback, codex: playback },
  };
  let app = await startApp(options);
  const project = await app.engine.openProject(
    { name: "FAKE fault fixture", repositoryPath: repo.directory },
    "project",
  );
  const run = await app.engine.startNativeRun(
    {
      projectId: project.id,
      title: "FAKE fault boundary",
      initialPrompt: objective,
      model: "fake-deterministic",
      thinking: null,
      permission: scratch ? "workspace_write" : "read_only",
    },
    "run",
  );
  const task = app.engine.store.listTasks(run.id)[0];
  assert.ok(task);
  return {
    repo,
    playback,
    run,
    task,
    get app() {
      return app;
    },
    get engine() {
      return app.engine;
    },
    get store() {
      return app.engine.store;
    },
    async restart() {
      await app.close();
      app = await startApp(options);
    },
    async close() {
      playback.gate.resolve();
      await app.close();
      await repo.verify(async () =>
        assert.equal(await repo.git("status", "--porcelain"), ""),
      );
      await rm(directory, { recursive: true });
    },
  };
}

test("a delayed FAKE tool stays busy without tokens while unrelated work finishes; pausing and inspecting never stops it", async () => {
  const f = await fixture(
    [
      {
        type: "tool_started",
        toolId: "slow-read",
        summary: "FAKE delayed read",
      },
      {
        type: "tool_finished",
        toolId: "slow-read",
        summary: "FAKE read completed",
      },
      { type: "text_delta", text: "FAKE delayed result" },
      { type: "turn_completed", nativeStatus: "completed" },
    ],
    "Delayed tool fixture",
  );
  try {
    await until(() =>
      f.store.events({ limit: 500 }).some((e) => e.type === "pi.tool_started"),
    );
    const [attempt] = f.store.listAttempts();
    const [session] = f.store.listSessions();
    assert.ok(attempt?.profileId && session);
    const independent = f.engine.createTask(
      { runId: f.run.id, title: "Independent", objective: "Healthy fixture" },
      "other",
    );
    const downstream = f.engine.createTask(
      {
        runId: f.run.id,
        title: "Dependent",
        objective: "Wait for completion",
        dependencyIds: [f.task.id],
      },
      "dependent",
    );
    for (const task of [independent, downstream])
      f.engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: task.id, profileId: attempt.profileId },
        `assign:${task.id}`,
      );
    await until(
      () => f.store.getTask(independent.id).status === "AWAITING_REVIEW",
    );
    assert.equal(f.store.getTask(f.task.id).status, "RUNNING");
    assert.equal(f.store.getTask(downstream.id).status, "WAITING_DEPENDENCY");
    assert.equal(f.store.getSession(session.id).state, "busy");
    assert.equal(f.store.getAttempt(attempt.id).recovery, null);
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
      1,
    );
    assert.deepEqual(f.store.listHumanRequests(), []);
    assert.deepEqual(
      f.store
        .events({ limit: 500 })
        .filter(
          (e) =>
            e.attemptId === attempt.id &&
            ["pi.text_delta", "pi.tool_finished", "pi.turn_completed"].includes(
              e.type,
            ),
        ),
      [],
    );

    f.engine.updateRun({ id: f.run.id, status: "paused" }, "pause");
    const before = f.store.getSession(session.id);
    for (const path of ["sessions", "tasks", "sessions"])
      assert.equal((await fetch(`${f.app.origin}/api/${path}`)).status, 200);
    await f.engine.pump();
    assert.deepEqual(f.store.getSession(session.id), before);
    assert.equal(f.store.getTask(f.task.id).status, "RUNNING");
    assert.equal(f.store.listAttempts().length, 2);

    f.playback.gate.resolve();
    await f.engine.idle();
    assert.equal(f.store.getTask(f.task.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(downstream.id).status, "WAITING_DEPENDENCY");
    assert.equal(f.store.getAttempt(attempt.id).status, "completed");
    assert.deepEqual(f.store.getSession(session.id).stops, []);
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
      0,
    );
  } finally {
    await f.close();
  }
});

for (const fault of [
  {
    name: "process crash",
    event: { type: "process_state", state: "crashed", exitCode: 139 },
    cause: "crashed",
  },
  {
    name: "clean exit without completion",
    event: { type: "process_state", state: "exited", exitCode: 0 },
    cause: "interrupted",
  },
  {
    name: "ambiguous disconnect",
    event: { type: "process_state", state: "disconnected", exitCode: null },
    cause: "disconnected",
  },
  {
    name: "stream ending without completion",
    event: null,
    cause: "interrupted",
  },
] as const)
  test(`FAKE ${fault.name} retains unresolved Git changes across app restart; only an owner decision launches again`, async () => {
    const f = await fixture(
      fault.event ? [fault.event] : [],
      "Unfinished fixture",
      true,
    );
    try {
      await f.engine.idle();
      const [attempt] = f.store.listAttempts();
      const [session] = f.store.listSessions();
      assert.ok(attempt?.worktreePath && attempt.profileId && session);
      assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
      assert.equal(attempt.recovery?.cause, fault.cause);
      if (fault.event) {
        assert.ok(
          f.store
            .events({ limit: 500 })
            .some(
              (e) =>
                e.attemptId === attempt.id &&
                e.type === "pi.process_state" &&
                e.payload.state === fault.event?.state &&
                e.payload.exitCode === fault.event.exitCode,
            ),
        );
      }
      assert.deepEqual(await f.engine.reports(f.task.id), []);
      assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
      const calls = [...f.playback.calls];
      const trees = await f.repo.git("worktree", "list", "--porcelain");
      await f.restart();
      await f.engine.idle();
      const recovered = f.store.getAttempt(attempt.id);
      assert.equal(recovered.recovery?.cause, fault.cause);
      assert.equal(recovered.recovery?.checks[0]?.worktree.state, "verified");
      assert.equal(
        recovered.recovery?.checks[0]?.worktree.git?.changedPaths,
        1,
      );
      assert.equal(
        f.store.getSession(session.id).nativeSessionId,
        session.nativeSessionId,
      );
      assert.deepEqual(f.playback.calls, calls);
      assert.equal(f.store.listAttempts().length, 1);
      assert.equal(await f.repo.git("worktree", "list", "--porcelain"), trees);

      const check = await recheckRecovery(
        f.engine,
        { taskId: f.task.id },
        "recheck",
      );
      assert.deepEqual(f.playback.calls, calls);
      assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
      f.playback.healthy = true;
      f.playback.scratch = false;
      const input = {
        taskId: f.task.id,
        checkId: check.id,
        profileId: attempt.profileId,
        contextPolicy: "fresh",
      };
      const queued = await decideRecovery(f.engine, input, "retry");
      await f.engine.idle();
      assert.equal(f.store.getTask(f.task.id).status, "AWAITING_REVIEW");
      assert.equal(f.store.listAttempts().length, 2);
      const successor = f.store.listAttempts()[1];
      assert.ok(successor?.worktreePath);
      assert.notEqual(successor.worktreePath, attempt.worktreePath);
      assert.equal(
        await readFile(join(attempt.worktreePath, "unfinished.txt"), "utf8"),
        "Unresolved fixture work\n",
      );
      assert.deepEqual(await decideRecovery(f.engine, input, "retry"), queued);
      await f.restart();
      await f.engine.idle();
      assert.equal(f.store.listAttempts().length, 2);
      assert.equal(f.playback.calls.filter((c) => c === "start").length, 2);
      assert.equal(f.playback.calls.filter((c) => c === "prompt").length, 2);
      assert.ok(!f.playback.calls.includes("resume"));
    } finally {
      await f.close();
    }
  });
