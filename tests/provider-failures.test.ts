import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type {
  ManagedSession,
  SessionEvent,
  StartSessionInput,
} from "../src/server/adapters/contract.ts";
import { FakeAdapter } from "../src/server/adapters/fake.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import { finishProviderFailure } from "../src/server/orchestration/provider-failures.ts";
import { Store } from "../src/server/storage/store.ts";
import { defaultLimits } from "../src/shared/domain/entities.ts";
import { providerFailureKindSchema } from "../src/shared/provider-failures.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

// FAKE playback through the native executor; no harness or provider is called.
class FailurePlayback extends FakeAdapter {
  starts = 0;
  shutdownFails = false;
  scratch = true;
  override async startSession(input: StartSessionInput) {
    this.starts++;
    const managed = await super.startSession(input);
    if (this.scratch && input.contextPacket !== "Healthy fixture")
      await writeFile(
        join(input.cwd, "unfinished.txt"),
        "Preserve unfinished work\n",
      );
    return managed;
  }
  override async *prompt(
    session: ManagedSession,
    text: string,
  ): AsyncIterable<SessionEvent> {
    if (session.input.contextPacket === "Healthy fixture") {
      yield { type: "text_delta", text: "FAKE healthy result" };
      yield { type: "turn_completed", nativeStatus: "completed" };
    } else yield* super.prompt(session, text);
  }
  override async dispose(session: ManagedSession) {
    await super.dispose(session);
    if (this.shutdownFails) throw new Error("FAKE shutdown uncertain");
  }
}

const errorEvent = (code: string): SessionEvent => ({
  type: "session_error",
  code,
  ...(providerFailureKindSchema.safeParse(code).success
    ? { providerFailureKind: providerFailureKindSchema.parse(code) }
    : {}),
  recoverable: false,
  message: "FAKE confirmed failure; no native error text copied",
});
const failed: SessionEvent = { type: "turn_completed", nativeStatus: "failed" };
const completed: SessionEvent = {
  type: "turn_completed",
  nativeStatus: "completed",
};

async function fixture(events: SessionEvent[], cap = 24) {
  const repo = await createGitFixture();
  const directory = await mkdtemp("/tmp/lao-provider-failure-");
  const path = join(directory, "state.sqlite");
  const playback = new FailurePlayback([events]);
  let store = new Store(path);
  let engine = new Engine(store, directory, playback);
  const project = await engine.openProject(
    { name: "FAKE provider failures", repositoryPath: repo.directory },
    "project",
  );
  const run = await engine.startNativeRun(
    {
      projectId: project.id,
      title: "FAKE failure boundary",
      initialPrompt: "Retain unfinished fixture work",
      model: "fake-deterministic",
      thinking: null,
      permission: "workspace_write",
      limits: { ...defaultLimits, maxTotalWorkerLaunchesPerRun: cap },
    },
    "run",
  );
  const task = store.listTasks(run.id)[0];
  assert.ok(task);
  return {
    repo,
    directory,
    run,
    task,
    playback,
    get store() {
      return store;
    },
    get engine() {
      return engine;
    },
    async restart() {
      await engine.close();
      store.close();
      store = new Store(path);
      store.recoverInterrupted();
      engine = new Engine(store, directory, playback);
    },
    async close() {
      await engine.close();
      store.close();
      await repo.verify(async () =>
        assert.equal(await repo.git("status", "--porcelain"), ""),
      );
      await rm(directory, { recursive: true });
    },
  };
}

for (const kind of providerFailureKindSchema.options) {
  test(`FAKE ${kind} becomes one durable blocker; replies/restarts never resume and hard launch caps still apply`, async () => {
    const f = await fixture([errorEvent(kind), failed], 1);
    try {
      await f.engine.idle();
      const [attempt] = f.store.listAttempts();
      const [session] = f.store.listSessions();
      const [request] = f.store.listTaskBlockers(f.task.id);
      assert.ok(attempt?.worktreePath && session && request?.providerFailure);
      assert.equal(f.store.getTask(f.task.id).status, "WAITING_HUMAN");
      assert.equal(attempt.status, "failed");
      assert.equal(session.state, "exited");
      assert.equal(request.providerFailure.kind, kind);
      assert.equal(
        request.type,
        kind === "auth" ? "credential_setup" : "environment",
      );
      assert.equal(request.sessionId, session.id);
      assert.equal(request.providerFailure.inputTokens, null);
      assert.equal(request.providerFailure.outputTokens, null);
      assert.match(request.suggestedAction, /native authentication|provider/);
      assert.match(request.suggestedAction, /explicitly choose/);
      assert.equal(
        f.store
          .events({ limit: 500 })
          .find((e) => e.id === request.providerFailure?.evidenceEventId)
          ?.payload.code,
        kind,
      );
      assert.equal(
        await readFile(join(attempt.worktreePath, "unfinished.txt"), "utf8"),
        "Preserve unfinished work\n",
      );
      assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
      assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 1);
      assert.equal(
        f.store.db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
        0,
      );
      finishProviderFailure(f.engine, attempt.id, true);
      assert.equal(f.store.listHumanRequests().length, 1);
      assert.throws(
        () =>
          f.engine.scheduling.enqueue(
            { role: "owner" },
            { taskId: f.task.id, profileId: attempt.profileId },
            "blocked",
          ),
        /blocker/,
      );
      f.store.updateHumanRequest(
        { id: request.id, expectedStatus: "open", status: "deferred" },
        "defer",
      );
      await f.restart();
      assert.deepEqual(
        f.store.getHumanRequest(request.id).providerFailure,
        request.providerFailure,
      );
      assert.equal(f.store.listTaskBlockers(f.task.id).length, 1);
      f.store.updateHumanRequest(
        { id: request.id, expectedStatus: "deferred", status: "completed" },
        "done",
      );
      await f.engine.idle();
      assert.equal(f.store.getTask(f.task.id).status, "WAITING_HUMAN");
      assert.throws(
        () =>
          f.engine.scheduling.enqueue(
            { role: "owner" },
            { taskId: f.task.id, profileId: attempt.profileId },
            "cap",
          ),
        { code: "BUDGET_EXCEEDED" },
      );
      await f.restart();
      await f.engine.idle();
      assert.equal(f.playback.starts, 1);
      assert.equal(f.store.listAttempts().length, 1);
      assert.equal(f.store.getTask(f.task.id).status, "WAITING_HUMAN");
      assert.equal(f.store.listHumanRequests().length, 1);
      assert.equal(f.store.getHumanRequest(request.id).status, "completed");
    } finally {
      await f.close();
    }
  });
}

test("FAKE provider blocker holds descendants while an unrelated worker completes", async () => {
  const f = await fixture([errorEvent("credits_exhausted"), failed]);
  try {
    const writer = f.run.teamSnapshot?.profiles.find(
      (p) => p.permission === "workspace_write",
    );
    assert.ok(writer);
    const dependent = f.engine.createTask(
      {
        runId: f.run.id,
        title: "Dependent",
        objective: "Wait",
        dependencyIds: [f.task.id],
      },
      "dependent",
    );
    const healthy = f.engine.createTask(
      { runId: f.run.id, title: "FAKE healthy", objective: "Healthy fixture" },
      "healthy",
    );
    for (const task of [dependent, healthy])
      f.engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: task.id, profileId: writer.id },
        `assign:${task.id}`,
      );
    await f.engine.idle();
    assert.equal(f.store.getTask(f.task.id).status, "WAITING_HUMAN");
    assert.equal(f.store.getTask(dependent.id).status, "WAITING_DEPENDENCY");
    assert.equal(f.store.getTask(healthy.id).status, "AWAITING_REVIEW");
    assert.equal(f.playback.starts, 2);
  } finally {
    await f.close();
  }
});

test("FAKE unavailable/zero usage and unclassified errors do not establish provider exhaustion across restart", async () => {
  for (const usage of [
    null,
    {
      type: "usage",
      inputTokens: 0,
      outputTokens: 0,
      source: "FAKE zero sample",
    } as const,
  ]) {
    const f = await fixture([
      ...(usage ? [usage] : []),
      errorEvent("native_error"),
      failed,
    ]);
    try {
      await f.engine.idle();
      await f.restart();
      await f.engine.idle();
      assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
      assert.deepEqual(f.store.listHumanRequests(), []);
      assert.equal(f.playback.starts, 1);
    } finally {
      await f.close();
    }
  }
});

test("legacy untyped auth codes are not reclassified as confirmed provider failures on restart", async () => {
  const f = await fixture([
    {
      type: "session_error",
      code: "auth",
      message: "Legacy broad classification",
      recoverable: false,
    },
    failed,
  ]);
  try {
    await f.engine.idle();
    await f.restart();
    await f.engine.idle();
    assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
    assert.deepEqual(f.store.listHumanRequests(), []);
    assert.equal(f.playback.starts, 1);
  } finally {
    await f.close();
  }
});

test("FAKE partial usage is retained as evidence; a transient error followed by success creates no blocker", async () => {
  for (const terminal of [failed, completed]) {
    const f = await fixture([
      errorEvent("rate_limit"),
      { type: "usage", inputTokens: 3, source: "FAKE partial sample" },
      terminal,
    ]);
    f.playback.scratch = false;
    try {
      await f.engine.idle();
      await f.restart();
      await f.engine.idle();
      if (terminal.nativeStatus === "completed") {
        assert.equal(f.store.getTask(f.task.id).status, "AWAITING_REVIEW");
        assert.deepEqual(f.store.listHumanRequests(), []);
      } else {
        const failure = f.store.listHumanRequests()[0]?.providerFailure;
        assert.equal(failure?.inputTokens, 3);
        assert.equal(failure?.outputTokens, null);
      }
      assert.equal(f.playback.starts, 1);
    } finally {
      await f.close();
    }
  }
});

test("FAKE confirmed provider error with uncertain shutdown preserves recovery instead of claiming suspension", async () => {
  const f = await fixture([errorEvent("auth"), failed]);
  f.playback.shutdownFails = true;
  try {
    await f.engine.idle();
    assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
    const [notice] = f.store.listHumanRequests();
    assert.equal(notice?.blocking, false);
    assert.equal(notice?.providerFailure?.kind, "auth");
    await f.restart();
    await f.engine.idle();
    assert.equal(f.playback.starts, 1);
    assert.equal(f.store.listHumanRequests().length, 1);
    assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
  } finally {
    await f.close();
  }
});

test("FAKE provider errors without terminal failure or superseded by another failure never claim a safe provider wait", async () => {
  for (const events of [
    [errorEvent("auth")],
    [errorEvent("auth"), errorEvent("native_error"), failed],
  ]) {
    const f = await fixture(events);
    try {
      await f.engine.idle();
      assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
      assert.deepEqual(f.store.listTaskBlockers(f.task.id), []);
      const requests = f.store.listHumanRequests();
      assert.equal(requests.length, events.length === 1 ? 1 : 0);
      await f.restart();
      await f.engine.idle();
      assert.equal(f.store.listHumanRequests().length, requests.length);
      assert.equal(f.playback.starts, 1);
    } finally {
      await f.close();
    }
  }
});

test("restart between a confirmed error and shutdown retains one notice without claiming a safe wait or replaying", async () => {
  const f = await fixture([errorEvent("auth"), failed]);
  try {
    const [dispatch] = f.engine.scheduling.list();
    assert.ok(dispatch);
    const attemptId = f.engine.scheduling.reserve(dispatch);
    assert.ok(attemptId);
    const session = f.store.createSession({ attemptId }, "pending-session");
    f.store.updateSession(
      { id: session.id, expectedState: "not_started", state: "starting" },
      "starting",
    );
    f.store.updateSession(
      {
        id: session.id,
        expectedState: "starting",
        state: "busy",
        nativeSessionId: "FAKE-unconfirmed",
      },
      "busy",
    );
    const evidence = f.store.recordEvent(
      {
        runId: f.run.id,
        taskId: f.task.id,
        attemptId,
        sessionId: session.id,
        type: "pi.session_error",
        correlationId: attemptId,
        payload: errorEvent("auth"),
      },
      "pending-error",
    );
    await f.restart();
    await f.engine.idle();
    const [request] = f.store.listHumanRequests();
    assert.equal(request?.providerFailure?.evidenceEventId, evidence.id);
    assert.equal(request?.blocking, false);
    assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
    assert.equal(f.store.getAttempt(attemptId).status, "RECOVERY_REQUIRED");
    assert.equal(
      f.store.getSession(session.id).nativeSessionId,
      "FAKE-unconfirmed",
    );
    await f.restart();
    await f.engine.idle();
    assert.equal(f.store.listHumanRequests().length, 1);
    assert.equal(f.playback.starts, 0);
  } finally {
    await f.close();
  }
});
