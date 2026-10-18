import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type {
  HarnessAdapter,
  ManagedSession,
  SessionEvent,
} from "../src/server/adapters/contract.ts";
import { FakeAdapter } from "../src/server/adapters/fake.ts";
import { startApp } from "../src/server/app.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import {
  decideRecovery,
  recheckRecovery,
} from "../src/server/orchestration/recovery-decisions.ts";
import {
  observeRecovery,
  processIdentity,
} from "../src/server/orchestration/recovery-observe.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { unverifiedFacts } from "../src/shared/recovery.ts";
import { worktreeFixture } from "./helpers/worktree-fixture.ts";

// Counts every call that could launch, prompt, resume or signal native work.
class CountingHarness implements HarnessAdapter {
  calls: string[] = [];
  async discover() {
    this.calls.push("discover");
    return {
      adapter: "pi" as const,
      installed: true,
      authenticated: "unknown" as const,
      models: [],
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
  async startSession(): Promise<ManagedSession> {
    this.calls.push("startSession");
    throw new DomainError("UNSUPPORTED", "Restart must not launch");
  }
  // biome-ignore lint/correctness/useYield: prompting is itself the failure.
  async *prompt(): AsyncIterable<SessionEvent> {
    this.calls.push("prompt");
    throw new DomainError("UNSUPPORTED", "Restart must not prompt");
  }
  async resume(): Promise<ManagedSession> {
    this.calls.push("resume");
    throw new DomainError("UNSUPPORTED", "Restart must not resume");
  }
  async steer() {
    this.calls.push("steer");
    return "unsupported" as const;
  }
  async cancel() {
    this.calls.push("cancel");
  }
  async respondToApproval() {
    this.calls.push("respondToApproval");
  }
  async dispose() {
    this.calls.push("dispose");
  }
}

const alive = (pid: number | undefined) => {
  try {
    process.kill(pid ?? 0, 0);
    return true;
  } catch {
    return false;
  }
};

// A native writer attempt that was busy in its worktree when the app died:
// the committed database is all a restarted app has. The worker process may
// survive the app; nothing here owns it after the crash.
async function crashed(
  options: {
    identity?: (pid: number) => Promise<string | null>;
    tools?: { type: string; payload: Record<string, string> }[];
  } = {},
) {
  const f = await worktreeFixture();
  const engine = new Engine(f.store, f.data, new FakeAdapter());
  await engine.close();
  const queued = f.queue("unfinished");
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
      nativeSessionId: "native-unfinished",
      processId: worker.pid,
      processIdentity: await (options.identity ?? processIdentity)(worker.pid),
    },
    "session:busy",
  );
  const tools = options.tools ?? [
    {
      type: "pi.tool_started",
      payload: { toolId: "call-read", summary: "read" },
    },
    {
      type: "pi.tool_finished",
      payload: { toolId: "call-read", summary: "read" },
    },
    {
      type: "pi.tool_started",
      payload: { toolId: "call-edit", summary: "edit" },
    },
  ];
  for (const [index, tool] of tools.entries())
    store.recordEvent(
      {
        runId: f.run.id,
        taskId: queued.task.id,
        attemptId: queued.id,
        sessionId: session.id,
        type: tool.type,
        correlationId: queued.id,
        payload: tool.payload,
      },
      `tool:${index}`,
    );
  const crashedAt = store.events({ limit: 500 }).length;
  f.close();
  const harness = new CountingHarness();
  let app: Awaited<ReturnType<typeof startApp>> | null = null;
  return {
    f,
    tree,
    worker,
    harness,
    taskId: queued.task.id,
    attemptId: queued.id,
    profileId: queued.dispatch.profileId,
    async restart() {
      await app?.close();
      app = await startApp({
        development: false,
        port: 0,
        databasePath: join(f.data, "state.sqlite"),
        adapters: { pi: harness, codex: harness },
      });
      return app.engine;
    },
    newEventTypes(engine: Engine) {
      return engine.store
        .events({ limit: 500 })
        .slice(crashedAt)
        .map((e) => e.type);
    },
    async close() {
      await app?.close();
      worker.kill("SIGKILL");
      await rm(f.data, { recursive: true, force: true });
    },
  };
}

for (const state of ["missing", "inaccessible", "replaced"] as const)
  test(`restart observes a surviving worker with ${state} worktree state; recheck cannot resubmit, signal, relink or delete`, async () => {
    const c = await crashed();
    try {
      await writeFile(
        join(c.tree.path, "unfinished.txt"),
        "Retain survivor work\n",
      );
      const savedPath = `${c.tree.path}-preserved`;
      if (state === "inaccessible") await chmod(c.tree.path, 0);
      else {
        // Retain the original directory, including unfinished user work.
        await rename(c.tree.path, savedPath);
        if (state === "replaced") await mkdir(c.tree.path);
      }
      const gitBefore = await c.f.repo.git("worktree", "list", "--porcelain");
      const engine = await c.restart();
      const { store } = engine;
      assert.equal(store.getTask(c.taskId).status, "RETRY_DECISION");
      const recovery = store.getAttempt(c.attemptId).recovery;
      assert.equal(recovery?.cause, "recovery_required");
      assert.equal(recovery?.checks.length, 1);
      const [check] = recovery?.checks ?? [];
      // A missing folder does not prove the worker stopped.
      assert.deepEqual(
        [check?.worktree.state, check?.worktree.path, check?.worktree.git],
        [state, c.tree.path, null],
      );
      assert.deepEqual(
        [check?.process.state, check?.process.processId],
        ["pid_present", c.worker.pid],
      );
      assert.match(check?.process.reason ?? "", /still running/);
      assert.deepEqual(
        [check?.nativeSession?.id, check?.nativeSession?.state],
        ["native-unfinished", "recorded"],
      );
      assert.deepEqual(check?.unfinishedTools, [
        { toolId: "call-edit", summary: "edit" },
      ]);

      await engine.pump();
      assert.deepEqual(c.harness.calls, []);
      assert.equal(store.listAttempts().length, 1);
      assert.equal(store.listSessions().length, 1);
      assert.ok(alive(c.worker.pid));
      assert.equal(
        await c.f.repo.git("worktree", "list", "--porcelain"),
        gitBefore,
      );
      const types = c.newEventTypes(engine);
      assert.equal(types.filter((t) => t === "recovery.reconciled").length, 1);
      assert.deepEqual(
        types.filter((t) =>
          /^(pi|codex|worker|stop|worktree|session)\./.test(t),
        ),
        [],
      );
      const beforeRecheck = {
        attempts: store
          .listAttempts()
          .map(({ recovery: _, updatedAt: __, ...a }) => a),
        sessions: store.listSessions(),
        task: store.getTask(c.taskId),
        dispatches: engine.scheduling.list(),
        worktrees: engine.worktrees.list(),
      };
      const rechecked = await recheckRecovery(
        engine,
        { taskId: c.taskId },
        "recheck",
      );
      assert.equal(rechecked.worktree.state, state);
      assert.equal(rechecked.process.state, "pid_present");
      assert.deepEqual(
        {
          attempts: store
            .listAttempts()
            .map(({ recovery: _, updatedAt: __, ...a }) => a),
          sessions: store.listSessions(),
          task: store.getTask(c.taskId),
          dispatches: engine.scheduling.list(),
          worktrees: engine.worktrees.list(),
        },
        beforeRecheck,
      );
      await assert.rejects(engine.worktrees.capture(c.attemptId));
      await assert.rejects(
        decideRecovery(
          engine,
          { taskId: c.taskId, checkId: rechecked.id, profileId: c.profileId },
          "retry",
        ),
        (error: unknown) =>
          error instanceof DomainError &&
          new RegExp(
            `accept the unverified prior worktree ${state} and process pid present`,
          ).test(error.message),
      );
      const observed = store.getAttempt(c.attemptId).recovery;
      const restarted = await c.restart();
      await restarted.pump();
      assert.deepEqual(
        restarted.store.getAttempt(c.attemptId).recovery,
        observed,
      );
      assert.equal(restarted.store.listAttempts().length, 1);
      assert.equal(restarted.store.getTask(c.taskId).status, "RETRY_DECISION");
      assert.equal(
        await c.f.repo.git("worktree", "list", "--porcelain"),
        gitBefore,
      );
      assert.deepEqual(c.harness.calls, []);
      assert.ok(alive(c.worker.pid));
      if (state === "inaccessible") await chmod(c.tree.path, 0o700);
      assert.equal(
        await readFile(
          join(
            state === "inaccessible" ? c.tree.path : savedPath,
            "unfinished.txt",
          ),
          "utf8",
        ),
        "Retain survivor work\n",
      );
    } finally {
      if (state === "inaccessible") await chmod(c.tree.path, 0o700);
      await c.close();
    }
  });

test("restart does not mistake a reused PID for the worker or a same-path checkout for the original", async () => {
  // The recorded worker had another boot/start identity: this live PID was reused.
  const c = await crashed({ identity: async () => "previous-boot:1" });
  try {
    await c.f.repo.git("worktree", "remove", "--force", "--", c.tree.path);
    await c.f.repo.git("worktree", "add", "--", c.tree.path, c.tree.branch);
    const engine = await c.restart();
    const check = engine.store.getAttempt(c.attemptId).recovery?.checks[0];
    assert.ok(check);
    assert.equal(check.process.state, "not_running");
    assert.match(check.process.reason, /different process/);
    assert.equal(check.worktree.state, "replaced");
    assert.deepEqual(unverifiedFacts(check), ["worktree replaced"]);
    await assert.rejects(engine.worktrees.capture(c.attemptId), {
      code: "POLICY_DENIED",
    });
    assert.ok(alive(c.worker.pid));
    assert.deepEqual(c.harness.calls, []);
  } finally {
    await c.close();
  }
});

test("restart records a verified retained checkout's uncommitted work once and leaves it intact", async () => {
  const c = await crashed();
  try {
    c.worker.kill("SIGKILL");
    await once(c.worker, "exit");
    const notes = join(c.tree.path, "notes.txt");
    await writeFile(notes, "unfinished work\n");
    let engine = await c.restart();
    const first = engine.store.getAttempt(c.attemptId).recovery?.checks[0];
    assert.equal(first?.worktree.state, "verified");
    assert.deepEqual(first?.worktree.git, {
      headSha: c.tree.repository.baseSha,
      startSha: c.tree.repository.baseSha,
      changedPaths: 1,
    });
    assert.equal(first?.process.state, "not_running");
    assert.deepEqual(first && unverifiedFacts(first), []);

    const events = engine.store.events({ limit: 500 });
    engine = await c.restart();
    // Already observed: a quiet second restart changes nothing.
    assert.deepEqual(engine.store.getAttempt(c.attemptId).recovery?.checks, [
      first,
    ]);
    assert.deepEqual(engine.store.events({ limit: 500 }), events);
    assert.equal(engine.store.getTask(c.taskId).status, "RETRY_DECISION");
    assert.equal(engine.store.listAttempts().length, 1);
    assert.equal(await readFile(notes, "utf8"), "unfinished work\n");
    assert.equal(
      engine.worktrees.list().find((w) => w.attemptId === c.attemptId)?.state,
      "retained",
    );
    assert.deepEqual(c.harness.calls, []);
  } finally {
    await c.close();
  }
});

test("an attempt whose facts cannot be observed is journaled and does not block startup", async () => {
  const c = await crashed({
    tools: [{ type: "pi.tool_started", payload: { summary: "no tool id" } }],
  });
  try {
    const engine = await c.restart();
    const { store } = engine;
    assert.deepEqual(store.getAttempt(c.attemptId).recovery?.checks, []);
    assert.equal(store.getTask(c.taskId).status, "RETRY_DECISION");
    assert.ok(c.newEventTypes(engine).includes("recovery.reconcile_failed"));
    assert.deepEqual(c.harness.calls, []);
  } finally {
    await c.close();
  }
});

test("a native session ID recorded for another checkout is a conflict, never matched to this attempt", async () => {
  const f = await worktreeFixture();
  const engine = new Engine(f.store, f.data, new FakeAdapter());
  await engine.close();
  try {
    const attempts = ["first", "second"].map((key) => {
      const { id } = f.queue(key);
      const session = f.store.createSession({ attemptId: id }, `${key}:s`);
      f.store.updateSession(
        { id: session.id, expectedState: "not_started", state: "starting" },
        `${key}:starting`,
      );
      f.store.updateSession(
        {
          id: session.id,
          expectedState: "starting",
          state: "busy",
          nativeSessionId: "shared-native",
        },
        `${key}:busy`,
      );
      return id;
    });
    const [first, second] = attempts;
    assert.ok(first && second);
    assert.notEqual(
      f.store.getAttempt(first).cwd,
      f.store.getAttempt(second).cwd,
    );
    const check = await observeRecovery(engine, first);
    assert.equal(check.nativeSession?.state, "conflict");
    assert.match(check.nativeSession?.reason ?? "", new RegExp(second));
  } finally {
    f.close();
    await rm(f.data, { recursive: true, force: true });
  }
});
