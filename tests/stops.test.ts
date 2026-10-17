import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  HarnessAdapter,
  ManagedSession,
  SessionEvent,
  StartSessionInput,
} from "../src/server/adapters/contract.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import { emergencyStop, stopRun } from "../src/server/orchestration/stops.ts";
import { Store } from "../src/server/storage/store.ts";
import { sessionsResponseSchema } from "../src/shared/api.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

async function until(check: () => boolean) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail("Stop fixture did not reach the expected state");
}
function stopsFor(store: Store, taskId: string) {
  return store
    .listSessions()
    .filter((s) => store.getAttempt(s.attemptId).taskId === taskId)
    .flatMap((s) => s.stops);
}
const settled = (store: Store, taskId: string) => () => {
  const stops = stopsFor(store, taskId);
  return stops.length > 0 && stops.every((s) => s.status !== "pending");
};
function nativeInput(projectId: string, title: string) {
  return {
    projectId,
    title,
    initialPrompt: "Hold until the owner stops this worker",
    model: "fixture/model",
    thinking: "off",
    permission: "read_only",
  };
}

// Pi protocol subprocesses: real app-owned children, no model or provider.
async function fixture() {
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-stops-"));
  const pi = new PiAdapter(
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
        {
          ...env,
          LAO_FIXTURE_SCENARIO: "hold",
          LAO_FIXTURE_CONTROL_LOG: join(data, "controls.txt"),
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
  const engine = () => {
    assert.ok(app.engine);
    return app.engine;
  };
  const project = await engine().openProject(
    { name: "Stop protocol fixture", repositoryPath: repo.directory },
    "project",
  );
  return {
    repo,
    project,
    async controls() {
      return (
        await readFile(join(data, "controls.txt"), "utf8").catch(() => "")
      )
        .split("\n")
        .filter(Boolean);
    },
    get engine() {
      return engine();
    },
    get store() {
      return engine().store;
    },
    async start(key: string) {
      const run = await engine().startNativeRun(
        nativeInput(project.id, key),
        key,
      );
      const task = engine().store.listTasks(run.id)[0];
      assert.ok(task);
      await until(() => engine().nativeStops.has(task.id));
      return { run, task };
    },
    async request(
      method: string,
      path: string,
      body: unknown,
      key: string,
      withToken = true,
    ) {
      const token = z
        .object({ token: z.string() })
        .parse(
          await (await fetch(`${app.origin}/api/local-session`)).json(),
        ).token;
      return fetch(`${app.origin}/api/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          ...(withToken ? { "X-Local-Token": token } : {}),
        },
        body: JSON.stringify(body),
      });
    },
    async sessions() {
      return sessionsResponseSchema.parse(
        await (await fetch(`${app.origin}/api/sessions`)).json(),
      ).sessions;
    },
    async restart() {
      await app.close();
      app = await startApp(options);
    },
    async close() {
      await app.close();
      await rm(data, { recursive: true });
    },
  };
}

test("stop run cancels only its own live session, confirms exit from process evidence and keeps dispatch halted", async () => {
  const f = await fixture();
  try {
    const a = await f.start("run-a");
    const b = await f.start("run-b");
    const result = stopRun(f.engine, { runId: a.run.id }, "stop-a");
    assert.equal(result.sessionIds.length, 1);
    assert.deepEqual(
      stopsFor(f.store, a.task.id).map((s) => [s.scope, s.status]),
      [["run", "pending"]],
    );
    assert.equal(f.store.getRun(a.run.id).status, "stopped");
    assert.equal(f.store.getTask(a.task.id).status, "CANCELLED");
    await until(settled(f.store, a.task.id));
    const [stop] = stopsFor(f.store, a.task.id);
    assert.equal(stop?.status, "confirmed");
    assert.match(stop?.evidence ?? "", /Owned pi process exit observed/);
    assert.ok(stop?.processId);
    const attempt = f.store.listAttempts().find((x) => x.taskId === a.task.id);
    assert.equal(attempt?.status, "cancelled");
    assert.equal(
      f.engine.worktrees.list().find((w) => w.attemptId === attempt?.id)?.state,
      "retained",
    );
    const types = f.store
      .events({ runId: a.run.id, limit: 500 })
      .map((e) => e.type);
    const order = ["stop.requested", "pi.process_exit", "stop.outcome"].map(
      (type) => types.indexOf(type),
    );
    assert.ok(order.every((index, i) => index > (order[i - 1] ?? -1)));

    assert.deepEqual(await f.controls(), ["clear_queue", "abort"]);
    assert.equal(f.store.getTask(b.task.id).status, "RUNNING");
    assert.ok(f.engine.nativeStops.has(b.task.id));
    assert.deepEqual(stopsFor(f.store, b.task.id), []);

    assert.deepEqual(stopRun(f.engine, { runId: a.run.id }, "stop-a"), result);
    assert.throws(
      () => stopRun(f.engine, { runId: a.run.id }, "stop-a-again"),
      /already terminal/,
    );
    assert.throws(
      () => f.engine.updateRun({ id: a.run.id, status: "active" }, "reopen"),
      /terminal/,
    );
    const late = f.engine.createTask(
      { runId: a.run.id, title: "Late", objective: "Must not launch" },
      "late",
    );
    const profileId = f.store.getTask(a.task.id).assignedProfileId;
    assert.ok(profileId);
    assert.throws(
      () =>
        f.engine.scheduling.enqueue(
          { role: "owner" },
          { taskId: late.id, profileId },
          "late-assign",
        ),
      /paused or terminal/,
    );
    const attempts = f.store.listAttempts().length;
    await f.engine.pump();
    assert.equal(f.store.listAttempts().length, attempts);
  } finally {
    await f.close();
  }
});

test("pause scheduling lets a live worker continue while queued work waits; owner cancel records a task stop", async () => {
  const f = await fixture();
  try {
    const { run, task } = await f.start("run");
    const profileId = f.store.getTask(task.id).assignedProfileId;
    assert.ok(profileId);
    const queued = f.engine.createTask(
      { runId: run.id, title: "Queued", objective: "Wait for resume" },
      "queued",
    );
    // Same tick as the pause, so no pump can reserve it first.
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: queued.id, profileId },
      "queued-assign",
    );
    f.engine.updateRun({ id: run.id, status: "paused" }, "pause");
    for (let i = 0; i < 5; i++) {
      await f.engine.pump();
      await delay(20);
    }
    assert.equal(f.store.getTask(task.id).status, "RUNNING");
    assert.ok(f.engine.nativeStops.has(task.id));
    assert.deepEqual(
      f.store.listSessions().flatMap((s) => s.stops),
      [],
    );
    assert.equal(f.store.getTask(queued.id).status, "QUEUED");
    assert.equal(
      f.store.listAttempts().filter((a) => a.taskId === queued.id).length,
      0,
    );

    f.engine.cancel(task.id, "cancel");
    await until(settled(f.store, task.id));
    const [stop] = stopsFor(f.store, task.id);
    assert.equal(stop?.scope, "task");
    assert.equal(stop?.status, "confirmed");
    f.engine.cancel(queued.id, "cancel-queued");
    assert.deepEqual(stopsFor(f.store, queued.id), []);
  } finally {
    await f.close();
  }
});

test("emergency stop ends only app-owned sessions, pauses every active run and leaves explicit retry decisions", async () => {
  const f = await fixture();
  // Stands in for an owner's manual harness session outside the app.
  const manual = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e3)"], {
    stdio: "ignore",
  });
  try {
    const native = await f.start("native");
    const fake = await f.engine.startRun(
      {
        projectId: f.project.id,
        title: "FAKE run",
        initialPrompt: "Plan a fixture change",
        leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
      },
      "fake",
    );
    const lead = f.store.listTasks(fake.id)[0];
    assert.ok(lead);
    await until(() => f.engine.nativeStops.has(lead.id));

    const result = emergencyStop(f.engine, {}, "emergency");
    assert.deepEqual(
      new Set(result.pausedRunIds),
      new Set([native.run.id, fake.id]),
    );
    assert.equal(result.sessionIds.length, 2);
    await until(settled(f.store, native.task.id));
    await until(settled(f.store, lead.id));

    const [nativeStop] = stopsFor(f.store, native.task.id);
    assert.equal(nativeStop?.scope, "emergency");
    assert.equal(nativeStop?.status, "confirmed");
    assert.match(nativeStop?.evidence ?? "", /process exit observed/);
    const [fakeStop] = stopsFor(f.store, lead.id);
    assert.equal(fakeStop?.status, "confirmed");
    assert.match(fakeStop?.evidence ?? "", /FAKE playback closed/);
    for (const id of [native.task.id, lead.id]) {
      assert.equal(f.store.getTask(id).status, "RETRY_DECISION");
      assert.equal(
        f.store.listAttempts().find((a) => a.taskId === id)?.status,
        "interrupted",
      );
    }
    for (const id of [native.run.id, fake.id])
      assert.equal(f.store.getRun(id).status, "paused");
    assert.deepEqual(await f.controls(), []);

    assert.equal(manual.exitCode, null);
    assert.equal(manual.signalCode, null);
    assert.ok(manual.pid && process.kill(manual.pid, 0));

    f.engine.updateRun({ id: native.run.id, status: "active" }, "resume");
    const attempts = f.store.listAttempts().length;
    await f.engine.pump();
    assert.equal(f.store.listAttempts().length, attempts);
  } finally {
    manual.kill();
    await f.close();
  }
});

test("owner stop routes need the local token, a status-only stop is refused, and outcomes survive app restart", async () => {
  const f = await fixture();
  try {
    const { run, task } = await f.start("run");
    assert.equal(
      (
        await f.request(
          "POST",
          "runs/stop",
          { runId: run.id },
          "no-token",
          false,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          "POST",
          "emergency-stop",
          {},
          "emergency-no-token",
          false,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          "PATCH",
          "runs",
          { id: run.id, status: "stopped" },
          "label-only",
        )
      ).status,
      409,
    );
    assert.equal(f.store.getRun(run.id).status, "active");
    assert.deepEqual(stopsFor(f.store, task.id), []);

    const response = await f.request(
      "POST",
      "runs/stop",
      { runId: run.id },
      "stop",
    );
    assert.equal(response.status, 200);
    await until(settled(f.store, task.id));
    const before = (await f.sessions()).flatMap((s) => s.stops);
    assert.equal(before[0]?.status, "confirmed");

    await f.restart();
    assert.deepEqual(
      (await f.sessions()).flatMap((s) => s.stops),
      before,
    );
    assert.equal(f.store.getRun(run.id).status, "stopped");
    const emergency = await f.request("POST", "emergency-stop", {}, "idle");
    assert.equal(emergency.status, 200);
    assert.deepEqual(
      z
        .object({ sessionIds: z.array(z.string()) })
        .parse(await emergency.json()).sessionIds,
      [],
    );
  } finally {
    await f.close();
  }
});

// A harness without supervised process exit evidence (not a PiAdapter).
class StubHarness implements HarnessAdapter {
  cancels = 0;
  prompts = 0;
  starting = 0;
  // Holds startSession open so a stop can arrive before any stop function.
  gate: Promise<void> = Promise.resolve();
  private released = false;
  private wake = () => {};
  private readonly mode: "reject" | "silent" | "hang";
  constructor(mode: "reject" | "silent" | "hang") {
    this.mode = mode;
  }
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
      diagnostics: ["Test stub; no process"],
    };
  }
  async startSession(input: StartSessionInput): Promise<ManagedSession> {
    this.starting++;
    await this.gate;
    return { nativeSessionId: `stub-${input.attemptId}`, adapter: "pi", input };
  }
  async *prompt(): AsyncIterable<SessionEvent> {
    this.prompts++;
    yield { type: "text_delta", text: "Stub holding" };
    if (!this.released)
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
  }
  async resume(): Promise<ManagedSession> {
    throw new DomainError("UNSUPPORTED", "Stub cannot resume");
  }
  async steer() {
    return "unsupported" as const;
  }
  async cancel() {
    this.cancels++;
    if (this.mode !== "hang") this.finish();
    if (this.mode === "reject")
      throw new DomainError("NATIVE_TRANSPORT", "Stub refused cancellation");
  }
  finish() {
    this.released = true;
    this.wake();
  }
  async respondToApproval() {
    throw new DomainError("UNSUPPORTED", "Stub has no approvals");
  }
  async dispose() {}
}
async function stubFixture(
  mode: "reject" | "silent" | "hang",
  gate?: Promise<void>,
) {
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-stops-stub-"));
  const store = new Store(join(data, "state.sqlite"));
  const stub = new StubHarness(mode);
  if (gate) stub.gate = gate;
  const engine = new Engine(store, data, stub);
  const project = await engine.openProject(
    { name: "Stub fixture", repositoryPath: repo.directory },
    "project",
  );
  const run = await engine.startNativeRun(
    nativeInput(project.id, "Stub"),
    "run",
  );
  const task = store.listTasks(run.id)[0];
  assert.ok(task);
  await until(() =>
    gate ? stub.starting > 0 : engine.nativeStops.has(task.id),
  );
  return { data, store, stub, engine, run, task };
}

for (const [mode, status, pattern] of [
  ["reject", "failed", /did not acknowledge; no process exit was observed/],
  ["silent", "uncertain", /without process exit evidence/],
] as const)
  test(`a ${mode} stop without process exit evidence is recorded as ${status}, never confirmed`, async () => {
    const f = await stubFixture(mode);
    try {
      stopRun(f.engine, { runId: f.run.id }, "stop");
      await until(settled(f.store, f.task.id));
      const [stop] = stopsFor(f.store, f.task.id);
      assert.equal(stop?.status, status);
      assert.equal(stop?.evidence, null);
      assert.match(stop?.diagnostic ?? "", pattern);
      assert.equal(f.store.getTask(f.task.id).status, "CANCELLED");
      assert.ok(
        f.store
          .events({ runId: f.run.id, limit: 500 })
          .some((e) => e.type === "stop.outcome"),
      );
    } finally {
      await f.engine.close();
      f.store.close();
      await rm(f.data, { recursive: true });
    }
  });

test("a stop still pending at an app crash is reconciled as uncertain after restart without re-signalling or replay", async () => {
  const f = await stubFixture("hang");
  const snapshot = join(f.data, "crash.sqlite");
  try {
    stopRun(f.engine, { runId: f.run.id }, "stop");
    await delay(100);
    assert.equal(f.stub.cancels, 1);
    // A separate connection sees the durable pending stop, independent of
    // any in-memory view of the running app.
    const observer = new Store(join(f.data, "state.sqlite"));
    assert.equal(stopsFor(observer, f.task.id)[0]?.status, "pending");
    // The committed database at this instant is what a crashed app leaves.
    observer.db.exec(`VACUUM INTO '${snapshot}'`);
    observer.close();
  } finally {
    f.stub.finish();
    await f.engine.close();
    f.store.close();
  }
  let store = new Store(snapshot);
  store.recoverInterrupted();
  const stub = new StubHarness("hang");
  let engine = new Engine(store, f.data, stub);
  try {
    const [stop] = stopsFor(store, f.task.id);
    assert.equal(stop?.status, "uncertain");
    assert.match(
      stop?.diagnostic ?? "",
      /restarted before termination evidence/,
    );
    assert.equal(store.getTask(f.task.id).status, "CANCELLED");
    const attempt = store.listAttempts().find((a) => a.taskId === f.task.id);
    assert.equal(attempt?.status, "RECOVERY_REQUIRED");
    assert.equal(
      store.listSessions().find((s) => s.attemptId === attempt?.id)?.recovery,
      "RECOVERY_REQUIRED",
    );
    await engine.pump();
    assert.equal(store.listAttempts().length, 1);
    assert.equal(stub.cancels, 0);
    assert.equal(engine.nativeStops.size, 0);
    const saved = store.events({ limit: 500 });
    await engine.close();
    store.close();
    store = new Store(snapshot);
    store.recoverInterrupted();
    engine = new Engine(store, f.data, stub);
    assert.deepEqual(store.events({ limit: 500 }), saved);
  } finally {
    await engine.close();
    store.close();
    await rm(f.data, { recursive: true });
  }
});

test("an emergency stop during native startup is observed once the session exists, so no prompt is sent", async () => {
  let open = () => {};
  const f = await stubFixture(
    "silent",
    new Promise<void>((resolve) => {
      open = resolve;
    }),
  );
  try {
    assert.equal(f.engine.nativeStops.has(f.task.id), false);
    const result = emergencyStop(f.engine, {}, "emergency");
    assert.equal(result.sessionIds.length, 1);
    open();
    await until(settled(f.store, f.task.id));
    assert.equal(f.stub.prompts, 0);
    assert.equal(f.stub.cancels, 0);
    assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
    assert.equal(
      f.store
        .events({ runId: f.run.id, limit: 500 })
        .some((e) => e.type.startsWith("pi.text")),
      false,
    );
  } finally {
    await f.engine.close();
    f.store.close();
    await rm(f.data, { recursive: true });
  }
});
