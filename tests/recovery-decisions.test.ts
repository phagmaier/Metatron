import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type {
  HarnessAdapter,
  ManagedSession,
  SessionEvent,
  StartSessionInput,
} from "../src/server/adapters/contract.ts";
import { FakeAdapter } from "../src/server/adapters/fake.ts";
import { Worktrees } from "../src/server/git/worktrees.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import {
  decideRecovery,
  recheckRecovery,
} from "../src/server/orchestration/recovery-decisions.ts";
import { Store } from "../src/server/storage/store.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";
import { worktreeFixture } from "./helpers/worktree-fixture.ts";

const conflict = (pattern: RegExp) => (error: unknown) =>
  error instanceof DomainError &&
  error.code === "CONFLICT" &&
  pattern.test(error.message);

test("a fake disconnect records its cause; recheck observes only and the owner's retry runs one fresh attempt", async () => {
  const f = await domainFixture();
  const repo = await createGitFixture();
  const engine = new Engine(f.store, f.directory);
  try {
    const project = await engine.openProject(
      { name: "Fixture", repositoryPath: repo.directory },
      "project-open",
    );
    const run = await engine.startRun(
      {
        projectId: project.id,
        title: "Recovery",
        initialPrompt: "Plan one task",
        mode: "supervised",
        leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
      },
      "start",
    );
    await engine.idle();
    const task = f.store.listTasks(run.id).find((t) => t.kind === "work");
    assert.ok(task);
    const profileId = fakeTeamSnapshot.preset.workerProfileIds[0] ?? "";
    engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId, scenario: "disconnect" },
      "assign",
    );
    await engine.idle();
    assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
    const [first] = f.store.listAttempts().filter((a) => a.taskId === task.id);
    assert.equal(first?.recovery?.cause, "disconnected");
    assert.match(first?.recovery?.reason ?? "", /disconnect/);

    const check = await recheckRecovery(engine, { taskId: task.id }, "check");
    assert.deepEqual(
      [check.repository.state, check.worktree.state, check.process.state],
      ["verified", "not_isolated", "not_recorded"],
    );
    await engine.pump();
    assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
    assert.equal(f.store.listAttempts().length, 2);

    const decision = {
      taskId: task.id,
      checkId: check.id,
      profileId,
      scenario: "success",
    };
    const queued = await decideRecovery(engine, decision, "retry");
    assert.equal(queued.state, "queued");
    await engine.idle();
    assert.equal(f.store.getTask(task.id).status, "AWAITING_REVIEW");
    const attempts = f.store.listAttempts().filter((a) => a.taskId === task.id);
    assert.deepEqual(
      attempts.map((a) => a.status),
      ["interrupted", "completed"],
    );
    assert.equal(attempts[0]?.recovery?.decision?.profileId, profileId);
    assert.deepEqual(await decideRecovery(engine, decision, "retry"), queued);
    assert.equal(f.store.listAttempts().length, 3);
  } finally {
    await engine.close();
    await repo.verify(async () =>
      assert.equal(await repo.git("status", "--porcelain"), ""),
    );
    await f.close();
  }
});

// A native writer that lost its control channel while its process survives.
// The engine is closed first: nothing in these tests may dispatch or spawn.
async function survivor() {
  const f = await worktreeFixture();
  const engine = new Engine(f.store, f.data, new FakeAdapter());
  await engine.close();
  const queued = f.queue("survivor");
  const tree = await engine.worktrees.prepare(queued.id);
  const worker = spawn("sleep", ["60"], { stdio: "ignore" });
  assert.ok(worker.pid);
  const { store } = f;
  const session = store.createSession({ attemptId: queued.id }, "session");
  store.updateSession(
    { id: session.id, expectedState: "not_started", state: "starting" },
    "session:starting",
  );
  store.updateSession(
    {
      id: session.id,
      expectedState: "starting",
      state: "busy",
      nativeSessionId: "native-survivor",
      processId: worker.pid,
    },
    "session:busy",
  );
  store.updateSession(
    { id: session.id, expectedState: "busy", state: "disconnected" },
    "session:disconnected",
  );
  engine.fail(
    queued.task.id,
    queued.id,
    "Pi RPC protocol failed; no automatic replay",
    "disconnected",
  );
  const dispatch = engine.scheduling
    .list()
    .find((d) => d.taskId === queued.task.id);
  assert.ok(dispatch);
  engine.scheduling.release(dispatch);
  const profileId = dispatch.profileId;
  return {
    f,
    engine,
    tree,
    worker,
    profileId,
    taskId: queued.task.id,
    attemptId: queued.id,
    // Same path and branch, new directory: Git and the marker still match.
    async replaceSamePath() {
      await f.repo.git("worktree", "remove", "--force", "--", tree.path);
      await f.repo.git("worktree", "add", "--", tree.path, tree.branch);
    },
    async snapshot() {
      return {
        task: f.store.getTask(queued.task.id),
        attempts: f.store
          .listAttempts()
          .map(({ recovery: _, updatedAt: __, ...a }) => a),
        dispatches: engine.scheduling.list(),
        worktrees: engine.worktrees.list(),
        gitWorktrees: await f.repo.git("worktree", "list", "--porcelain"),
        files: await readdir(tree.path).catch(() => null),
      };
    },
    async close() {
      worker.kill("SIGKILL");
      f.close();
      await rm(f.data, { recursive: true, force: true });
    },
  };
}
const alive = (pid: number | undefined) => {
  try {
    process.kill(pid ?? 0, 0);
    return true;
  } catch {
    return false;
  }
};

test("recheck observes a surviving worker and same-path replacement without resubmitting, relinking or deleting", async () => {
  const s = await survivor();
  try {
    await s.replaceSamePath();
    const before = await s.snapshot();
    const check = await recheckRecovery(
      s.engine,
      { taskId: s.taskId },
      "recheck",
    );
    assert.equal(check.repository.state, "verified");
    assert.equal(check.worktree.state, "replaced");
    assert.equal(check.worktree.path, s.tree.path);
    assert.deepEqual(
      [check.process.state, check.process.processId],
      ["pid_present", s.worker.pid],
    );
    assert.deepEqual(await s.snapshot(), before);
    assert.ok(alive(s.worker.pid));
    assert.deepEqual(
      await recheckRecovery(s.engine, { taskId: s.taskId }, "recheck"),
      check,
    );
    const recovery = s.f.store.getAttempt(s.attemptId).recovery;
    assert.equal(recovery?.cause, "disconnected");
    assert.deepEqual(recovery?.checks, [check]);
    // The replacement cannot inherit the checkout's authority for capture.
    await assert.rejects(s.engine.worktrees.capture(s.attemptId), {
      code: "POLICY_DENIED",
    });
    assert.ok(
      s.f.store
        .events({ runId: s.f.run.id, limit: 500 })
        .some((e) => e.type === "recovery.rechecked"),
    );
  } finally {
    await s.close();
  }
});

test("a retry needs the newest recheck, unchanged facts and explicit acceptance of unverified facts", async () => {
  const s = await survivor();
  try {
    const input = { taskId: s.taskId, profileId: s.profileId };
    await assert.rejects(
      decideRecovery(
        s.engine,
        { ...input, checkId: crypto.randomUUID() },
        "unseen",
      ),
      conflict(/newest recheck/),
    );
    const before = await s.snapshot();
    const check = await recheckRecovery(s.engine, { taskId: s.taskId }, "c1");
    assert.deepEqual(
      [check.worktree.state, check.process.state],
      ["verified", "pid_present"],
    );
    await assert.rejects(
      decideRecovery(s.engine, { ...input, checkId: check.id }, "silent"),
      conflict(/accept the unverified prior process pid present/),
    );
    s.worker.kill("SIGKILL");
    await once(s.worker, "exit");
    await assert.rejects(
      decideRecovery(
        s.engine,
        { ...input, checkId: check.id, acceptUnverified: true },
        "stale",
      ),
      conflict(/facts changed/),
    );
    assert.deepEqual(await s.snapshot(), before);
    assert.equal(s.f.store.getAttempt(s.attemptId).recovery?.decision, null);
    // Once every fact is verified, no acceptance is needed.
    const ended = await recheckRecovery(s.engine, { taskId: s.taskId }, "c2");
    assert.equal(ended.process.state, "not_running");
    const queued = await decideRecovery(
      s.engine,
      { ...input, checkId: ended.id },
      "retry",
    );
    assert.equal(queued.state, "queued");
  } finally {
    await s.close();
  }
});

test("an accepted decision queues a fresh attempt in a new worktree and never adopts the prior checkout", async () => {
  const s = await survivor();
  try {
    await s.replaceSamePath();
    const prior = s.engine.scheduling.list()[0];
    const check = await recheckRecovery(s.engine, { taskId: s.taskId }, "c1");
    const input = {
      taskId: s.taskId,
      checkId: check.id,
      profileId: s.profileId,
      acceptUnverified: true,
    };
    const queued = await decideRecovery(s.engine, input, "retry");
    assert.equal(queued.state, "queued");
    assert.notEqual(queued.sequence, prior?.sequence);
    assert.notEqual(queued.cwd, s.tree.path);
    assert.equal(s.f.store.getTask(s.taskId).status, "QUEUED");
    const recovery = s.f.store.getAttempt(s.attemptId).recovery;
    assert.equal(recovery?.decision?.acceptedUnverified, true);
    assert.equal(recovery?.checks.length, 2);
    assert.deepEqual(s.engine.worktrees.list(), [s.tree]);
    assert.ok((await readdir(s.tree.path)).includes("README.md"));
    assert.ok(alive(s.worker.pid));
    assert.equal(s.f.store.listAttempts().length, 1);
    const decided = s.f.store
      .events({ runId: s.f.run.id, limit: 500 })
      .find((e) => e.type === "recovery.decided");
    assert.deepEqual(decided?.payload.unverified, [
      "worktree replaced",
      "process pid present",
    ]);
    s.f.store.transitionTask(
      {
        id: s.taskId,
        expectedStatus: "QUEUED",
        status: "CANCELLED",
        reason: "Replay must not re-validate",
      },
      "cancel",
    );
    assert.deepEqual(await decideRecovery(s.engine, input, "retry"), queued);
  } finally {
    await s.close();
  }
});

for (const [name, refusal, change] of [
  [
    "a moved repository HEAD",
    conflict(/Repository identity is not verified/),
    async (s: Awaited<ReturnType<typeof survivor>>) =>
      s.f.repo.git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "Owner moved HEAD",
      ),
  ],
  [
    "an exhausted launch budget",
    { code: "BUDGET_EXCEEDED" },
    async (s: Awaited<ReturnType<typeof survivor>>) =>
      s.f.store.db
        .prepare(
          "UPDATE runs SET data=json_set(data,'$.limits.maxTotalWorkerLaunchesPerRun',1) WHERE id=?",
        )
        .run(s.f.run.id),
  ],
] as const)
  test(`${name} refuses the retry decision and rolls it back`, async () => {
    const s = await survivor();
    try {
      await change(s);
      const check = await recheckRecovery(s.engine, { taskId: s.taskId }, "c");
      const before = await s.snapshot();
      await assert.rejects(
        decideRecovery(
          s.engine,
          {
            taskId: s.taskId,
            checkId: check.id,
            profileId: s.profileId,
            acceptUnverified: true,
          },
          "retry",
        ),
        refusal,
      );
      assert.deepEqual(await s.snapshot(), before);
      assert.deepEqual(s.f.store.getAttempt(s.attemptId).recovery?.checks, [
        check,
      ]);
    } finally {
      await s.close();
    }
  });

test("recovery facts survive restart and assignment alone cannot leave RETRY_DECISION", async () => {
  const s = await survivor();
  try {
    const check = await recheckRecovery(s.engine, { taskId: s.taskId }, "c1");
    const unfinished = s.f.queue("unfinished");
    s.f.reopen();
    const store = s.f.store;
    assert.equal(store.getAttempt(s.attemptId).recovery?.cause, "disconnected");
    assert.deepEqual(store.getAttempt(s.attemptId).recovery?.checks, [check]);
    assert.equal(
      store.getAttempt(unfinished.id).recovery?.cause,
      "recovery_required",
    );
    assert.equal(store.getTask(unfinished.task.id).status, "RETRY_DECISION");
    const engine = new Engine(store, s.f.data, new FakeAdapter());
    await engine.close();
    assert.throws(
      () =>
        engine.scheduling.enqueue(
          { role: "owner" },
          { taskId: s.taskId, profileId: s.profileId },
          "assign",
        ),
      conflict(/already dispatched/),
    );
    const restarted = await recheckRecovery(
      engine,
      { taskId: unfinished.task.id },
      "c2",
    );
    assert.equal(restarted.worktree.state, "missing");
    assert.equal(restarted.process.state, "not_recorded");
  } finally {
    await s.close();
  }
});

for (const [state, change] of [
  ["missing", (path: string) => rm(path, { recursive: true })],
  [
    "replaced",
    async (path: string) => {
      await rm(path, { recursive: true });
      await mkdir(path);
    },
  ],
  ["inaccessible", (path: string) => chmod(path, 0)],
] as const)
  test(`observation classifies a worktree as ${state} and changes nothing`, async () => {
    const f = await worktreeFixture();
    const trees = new Worktrees(f.store, f.data);
    const { id } = f.queue(state);
    const tree = await trees.prepare(id);
    try {
      assert.equal(
        (await trees.observe(f.store.getAttempt(id))).state,
        "verified",
      );
      await change(tree.path);
      const before = await f.repo.git("worktree", "list", "--porcelain");
      const observed = await trees.observe(f.store.getAttempt(id));
      assert.equal(observed.state, state);
      assert.equal(observed.path, tree.path);
      assert.deepEqual(trees.list(), [tree]);
      assert.equal(await f.repo.git("worktree", "list", "--porcelain"), before);
      await assert.rejects(trees.capture(id));
    } finally {
      await chmod(tree.path, 0o700).catch(() => {});
      f.close();
      await rm(f.data, { recursive: true, force: true });
    }
  });

// A native harness that completes after its worktree disappeared mid-turn.
class VanishingWorktree implements HarnessAdapter {
  async discover() {
    return {
      adapter: "pi" as const,
      installed: true,
      authenticated: "unknown" as const,
      models: [
        {
          id: "fixture/model",
          label: "Fixture",
          thinking: [{ id: "off", label: "off" }],
        },
      ],
      supportsResume: false,
      supportsLiveSteer: false,
      supportsCancel: true,
      supportsPermissionPrompts: false,
      supportsToolGateway: false,
      version: null,
      nextStep: null,
      diagnostics: ["Test stub; no process"],
    };
  }
  async startSession(input: StartSessionInput): Promise<ManagedSession> {
    return { nativeSessionId: `stub-${input.attemptId}`, adapter: "pi", input };
  }
  async *prompt(session: ManagedSession): AsyncIterable<SessionEvent> {
    await rm(session.input.cwd, { recursive: true });
    yield { type: "turn_completed", nativeStatus: "completed" };
  }
  async resume(): Promise<ManagedSession> {
    throw new DomainError("UNSUPPORTED", "Stub cannot resume");
  }
  async steer() {
    return "unsupported" as const;
  }
  async cancel() {}
  async respondToApproval() {
    throw new DomainError("UNSUPPORTED", "Stub has no approvals");
  }
  async dispose() {}
}

test("a worktree that vanishes during a native attempt is classified missing with path evidence, never captured", async () => {
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-recovery-"));
  const store = new Store(join(data, "state.sqlite"));
  const engine = new Engine(store, data, new VanishingWorktree());
  try {
    const project = await engine.openProject(
      { name: "Vanishing", repositoryPath: repo.directory },
      "project",
    );
    const run = await engine.startNativeRun(
      {
        projectId: project.id,
        title: "Vanishing",
        initialPrompt: "Write a file",
        model: "fixture/model",
        thinking: "off",
        permission: "workspace_write",
      },
      "run",
    );
    for (let i = 0; i < 500; i++) {
      if (store.listTasks(run.id)[0]?.status === "RETRY_DECISION") break;
      await delay(10);
    }
    const [task] = store.listTasks(run.id);
    assert.equal(task?.status, "RETRY_DECISION");
    const [attempt] = store.listAttempts();
    const recovery = attempt?.recovery;
    assert.equal(recovery?.cause, "recovery_required");
    assert.match(recovery?.reason ?? "", /^Worktree missing:/);
    assert.equal(recovery?.checks[0]?.worktree.state, "missing");
    assert.equal(recovery?.checks[0]?.worktree.path, attempt?.worktreePath);
    const types = store
      .events({ runId: run.id, limit: 500 })
      .map((e) => e.type);
    assert.ok(!types.includes("candidate.captured"));
    assert.ok(!types.includes("report.saved"));
  } finally {
    await engine.close();
    store.close();
    await repo.verify(async () =>
      assert.equal(await repo.git("status", "--porcelain"), ""),
    );
    await rm(data, { recursive: true, force: true });
  }
});
