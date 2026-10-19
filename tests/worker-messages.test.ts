import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { SessionEvent } from "../src/server/adapters/contract.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import { leadDigest } from "../src/server/orchestration/lead-run.ts";
import { mutate } from "../src/server/storage/mutations.ts";
import { Store } from "../src/server/storage/store.ts";
import { workerMessageSchema } from "../src/shared/domain/entities.ts";
import { steeringUnsupported } from "../src/shared/native-controls.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { claudeEngineFixture } from "./helpers/claude-engine-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await delay(10);
  }
  assert.fail("Worker-message fixture did not reach expected state");
}
async function fixture(scenario = "message-hold") {
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-worker-messages-"));
  const logPath = join(data, "messages.jsonl");
  const controlLogPath = join(data, "controls.txt");
  let rpc: PiRpc | undefined;
  const pi = new PiAdapter(data, (_args, cwd, env) => {
    rpc = new PiRpc(
      process.execPath,
      [fileURLToPath(new URL("./helpers/pi-rpc-fixture.ts", import.meta.url))],
      cwd,
      {
        ...env,
        LAO_FIXTURE_SCENARIO: scenario,
        LAO_FIXTURE_MESSAGE_LOG: logPath,
        LAO_FIXTURE_CONTROL_LOG: controlLogPath,
      },
    );
    return rpc;
  });
  const options = {
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: { pi },
  };
  let app = await startApp(options);
  const engine = app.engine;
  assert.ok(engine);
  const store = engine.store;
  const project = await engine.openProject(
    { name: "Message protocol fixture", repositoryPath: repo.directory },
    "project",
  );
  const run = await engine.startNativeRun(
    {
      projectId: project.id,
      title: "Owner steering",
      initialPrompt: "Hold for owner input",
      model: "fixture/model",
      thinking: "off",
      permission: "read_only",
    },
    "run",
  );
  const task = store.listTasks(run.id)[0];
  assert.ok(task);
  await until(() =>
    store
      .events({ runId: run.id, limit: 500 })
      .some((event) => event.type === "pi.text_delta"),
  );
  const session = store.listSessions()[0];
  assert.ok(session);
  const input = {
    taskId: task.id,
    sessionId: session.id,
    kind: "steer" as const,
    text: "Inspect the parser before editing.",
  };
  const token = z
    .object({ token: z.string() })
    .parse(await (await fetch(`${app.origin}/api/local-session`)).json()).token;
  return {
    repo,
    data,
    engine,
    store,
    run,
    task,
    session,
    input,
    get app() {
      return app;
    },
    async post(value: unknown, key: string, headers = {}) {
      return fetch(`${app.origin}/api/worker-messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Local-Token": token,
          "Idempotency-Key": key,
          ...headers,
        },
        body: JSON.stringify(value),
      });
    },
    async messages() {
      return z
        .array(workerMessageSchema)
        .parse(
          await (
            await fetch(`${app.origin}/api/worker-messages?taskId=${task.id}`)
          ).json(),
        );
    },
    async log() {
      return (await readFile(logPath, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    async deliver() {
      assert.ok(rpc);
      await rpc.request("fixture_deliver");
    },
    async controls() {
      return (await readFile(controlLogPath, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean);
    },
    async restart(prepare?: () => void) {
      await app.close();
      prepare?.();
      app = await startApp(options);
    },
    async close() {
      await app.close();
    },
  };
}

test("owner HTTP steering and follow-up stay queued until matching native delivery; replay never resends and Lead sees the override", async () => {
  const f = await fixture("message-deliver");
  try {
    for (const kind of ["steer", "follow_up"] as const) {
      const input = { ...f.input, kind };
      const response = await f.post(input, kind);
      assert.equal(response.status, 200);
      const queued = workerMessageSchema.parse(await response.json());
      assert.equal(queued.status, "queued");
      assert.equal(queued.sessionId, f.session.id);
      assert.equal(queued.attemptId, f.session.attemptId);
      assert.equal(
        f.engine.workerMessages.list(f.task.id).find((m) => m.id === queued.id)
          ?.status,
        "queued",
      );
      await f.deliver();
      await until(
        () =>
          f.engine.workerMessages
            .list(f.task.id)
            .find((m) => m.id === queued.id)?.status === "delivered",
      );
      const replay = workerMessageSchema.parse(
        await (await f.post(input, kind)).json(),
      );
      assert.equal(replay.id, queued.id);
      assert.equal(replay.status, "delivered");
      assert.equal(
        (await f.post({ ...input, text: "Different" }, kind)).status,
        409,
      );
    }
    const log = await f.log();
    assert.deepEqual(
      log.map((line) => line.type),
      ["steer", "follow_up"],
    );
    for (const [index, message] of (await f.messages()).entries())
      assert.equal(
        log[index].message,
        `Owner ${message.kind} ${message.id}:\n${message.text}`,
      );
    const digest = leadDigest(f.engine, f.run.id).lines;
    assert.equal(
      digest.filter((line) => /^Owner (steer|follow_up)/.test(line)).length,
      2,
    );
    assert.match(
      digest.join("\n"),
      /Owner follow_up.*delivered.*Inspect the parser/,
    );
    assert.equal(f.store.getTask(f.task.id).status, "RUNNING");
    assert.equal(f.store.listAttempts().length, 1);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    const before = await f.messages();
    await f.restart();
    assert.deepEqual(await f.messages(), before);
    assert.equal((await f.log()).length, 2);
    assert.equal(f.app.engine?.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});

test("delivery arriving before the native command reply cannot be downgraded to queued", async () => {
  const f = await fixture("message-early");
  try {
    const result = workerMessageSchema.parse(
      await (await f.post(f.input, "early")).json(),
    );
    assert.equal(result.status, "delivered");
    assert.equal((await f.log()).length, 1);
  } finally {
    await f.close();
  }
});

test("owner-only worker messages refuse foreign sessions, Chat/Plan, paused, stopping and unavailable workers without native calls", async () => {
  const f = await fixture();
  try {
    for (const actor of [
      { role: "lead", sessionId: f.session.id },
      { role: "worker", sessionId: f.session.id },
    ] as const)
      await assert.rejects(
        f.engine.workerMessages.send(actor, f.input, randomUUID()),
        { code: "POLICY_DENIED" },
      );
    assert.equal(
      (await f.post(f.input, "no-token", { "X-Local-Token": "" })).status,
      403,
    );
    assert.equal(
      (
        await f.post(f.input, "foreign-origin", {
          Origin: "https://example.invalid",
        })
      ).status,
      403,
    );
    for (const patch of [
      { text: " " },
      { text: "x".repeat(4001) },
      { kind: "bad" },
      { actor: "owner" },
    ])
      assert.equal(
        (await f.post({ ...f.input, ...patch }, randomUUID())).status,
        400,
      );
    const other = f.engine.createTask(
      { runId: f.run.id, title: "Other", objective: "Other assignment" },
      "other",
    );
    assert.equal(
      (await f.post({ ...f.input, taskId: other.id }, "wrong-task")).status,
      409,
    );
    assert.equal((await f.messages()).length, 0);
    for (const change of [
      { mode: "chat_plan" },
      { mode: "supervised", status: "paused" },
    ] as const) {
      f.engine.updateRun({ id: f.run.id, ...change }, randomUUID());
      const result = workerMessageSchema.parse(
        await (await f.post(f.input, randomUUID())).json(),
      );
      assert.equal(result.status, "unsupported");
    }
    f.engine.updateRun(
      { id: f.run.id, status: "active", mode: "supervised" },
      "active",
    );
    const originalSteer = f.engine.pi.steer;
    f.engine.pi.steer = async () => "unsupported";
    const unsupported = workerMessageSchema.parse(
      await (await f.post(f.input, "adapter-unsupported")).json(),
    );
    assert.equal(unsupported.status, "unsupported");
    f.engine.pi.steer = originalSteer;
    f.engine.workerMessages.end(f.session.id);
    const unavailable = workerMessageSchema.parse(
      await (await f.post(f.input, "unavailable")).json(),
    );
    assert.equal(unavailable.status, "unsupported");
    assert.equal((await f.log()).length, 0);
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});

test("a busy worker on a harness without live input gets that harness's reason and the adapter is never asked to steer", async () => {
  const f = await claudeEngineFixture();
  let release = () => {};
  let steers = 0;
  f.adapter.prompt = async function* (): AsyncIterable<SessionEvent> {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    yield { type: "turn_completed", nativeStatus: "interrupted" };
  };
  f.adapter.steer = async () => {
    steers++;
    return "unsupported";
  };
  try {
    const run = await f.run("read_only");
    const task = f.store.listTasks(run.id)[0];
    assert.ok(task);
    await until(() => f.store.listSessions()[0]?.state === "busy");
    const session = f.store.listSessions()[0];
    assert.ok(session);
    const message = workerMessageSchema.parse(
      await (
        await f.send("worker-messages", {
          taskId: task.id,
          sessionId: session.id,
          kind: "steer",
          text: "Change direction",
        })
      ).json(),
    );
    assert.equal(message.status, "unsupported");
    assert.equal(
      message.diagnostic,
      `${steeringUnsupported["claude-code"]}. No message sent, task started or session resumed.`,
    );
    assert.equal(steers, 0);
    f.engine.cancel(task.id, "stop-held-worker");
  } finally {
    release();
    await f.engine.idle();
    await f.close();
  }
});

test("lost native acknowledgement is unconfirmed, survives restart, and the same operation is never submitted twice", async () => {
  const f = await fixture("message-lost");
  try {
    const result = workerMessageSchema.parse(
      await (await f.post(f.input, "lost")).json(),
    );
    assert.equal(result.status, "unconfirmed");
    await f.engine.idle();
    assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
    assert.deepEqual(await (await f.post(f.input, "lost")).json(), result);
    assert.equal((await f.log()).length, 1);
    await f.restart();
    const stored = await f.messages();
    assert.deepEqual(stored, [result]);
    assert.deepEqual(
      await f.app.engine?.workerMessages.send(
        { role: "owner" },
        f.input,
        "lost",
      ),
      result,
    );
    assert.equal((await f.log()).length, 1);
  } finally {
    await f.close();
  }
});

test("concurrent replay submits once, queued messages become unconfirmed on session end, and journal failure prevents submission", async () => {
  const f = await fixture();
  try {
    f.store.db.exec(
      "CREATE TRIGGER reject_owner_message BEFORE INSERT ON events WHEN NEW.type='owner.worker_message' BEGIN SELECT RAISE(ABORT, 'fixture'); END;",
    );
    await assert.rejects(
      f.engine.workerMessages.send({ role: "owner" }, f.input, "rollback"),
      { code: "STORAGE" },
    );
    assert.deepEqual(await f.messages(), []);
    assert.equal((await f.log()).length, 0);
    f.store.db.exec("DROP TRIGGER reject_owner_message");
    const responses = await Promise.all([
      f.post(f.input, "same"),
      f.post(f.input, "same"),
    ]);
    for (const response of responses) assert.equal(response.status, 200);
    const messages = await f.messages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.status, "queued");
    assert.equal((await f.log()).length, 1);
    f.engine.cancel(f.task.id, "cancel");
    await f.engine.idle();
    assert.deepEqual(await f.controls(), ["clear_queue", "abort"]);
    assert.equal((await f.messages())[0]?.status, "unconfirmed");
    assert.equal((await f.post(f.input, "same")).status, 200);
    assert.equal((await f.log()).length, 1);
    const before = await f.messages();
    await f.restart();
    assert.deepEqual(await f.messages(), before);
  } finally {
    await f.close();
  }
});

test("failed native queue clearing closes the owned worker without aborting queued work", async () => {
  const f = await fixture("message-clear-fail");
  try {
    const result = workerMessageSchema.parse(
      await (await f.post(f.input, "queued")).json(),
    );
    assert.equal(result.status, "queued");
    f.engine.cancel(f.task.id, "cancel");
    await f.engine.idle();
    assert.deepEqual(await f.controls(), ["clear_queue"]);
    assert.equal((await f.messages())[0]?.status, "unconfirmed");
    assert.equal(f.store.getTask(f.task.id).status, "CANCELLED");
    assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
    assert.equal(f.store.listAttempts().length, 1);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    await f.close();
  }
});

test("restart reconciles a durable sending intent without submitting it and preserves its idempotent result", async () => {
  const f = await fixture();
  try {
    const now = new Date().toISOString();
    const intent = workerMessageSchema.parse({
      ...f.input,
      id: randomUUID(),
      runId: f.run.id,
      attemptId: f.session.attemptId,
      createdAt: now,
      updatedAt: now,
      status: "sending",
      diagnostic: "Persisted before native submission",
    });
    await f.restart(() => {
      const store = new Store(join(f.data, "state.sqlite"));
      try {
        mutate(
          store.db,
          "crash-intent",
          "sendWorkerMessage",
          f.input,
          workerMessageSchema,
          () => {
            const session = store.getSession(f.session.id);
            store.db
              .prepare("UPDATE sessions SET data=? WHERE id=?")
              .run(
                JSON.stringify({ ...session, ownerMessages: [intent] }),
                session.id,
              );
            return intent;
          },
        );
      } finally {
        store.close();
      }
    });
    const [recovered] = await f.messages();
    assert.equal(recovered?.id, intent.id);
    assert.equal(recovered?.status, "unconfirmed");
    assert.deepEqual(
      await f.app.engine?.workerMessages.send(
        { role: "owner" },
        f.input,
        "crash-intent",
      ),
      recovered,
    );
    assert.equal((await f.log()).length, 0);
    const count = f.app.engine?.store.events({ limit: 500 }).length;
    await f.restart();
    assert.deepEqual(await f.messages(), [recovered]);
    assert.equal(f.app.engine?.store.events({ limit: 500 }).length, count);
  } finally {
    await f.close();
  }
});

test("fake worker exposes delivered steer and queued follow-up without changing assignment or reserving another slot", async () => {
  const f = await fixture();
  try {
    const run = await f.engine.startRun(
      {
        projectId: f.run.projectId,
        title: "FAKE worker input",
        initialPrompt: "Plan only",
        leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
        mode: "supervised",
      },
      "fake-run",
    );
    await until(() =>
      f.store
        .listTasks(run.id)
        .some(
          (task) => task.kind === "lead" && task.status === "AWAITING_REVIEW",
        ),
    );
    const task = f.engine.createTask(
      {
        runId: run.id,
        title: "FAKE direct input",
        objective: "Simulate receipt",
      },
      "fake-task",
    );
    const profile = fakeTeamSnapshot.profiles.find(
      (item) => item.permission === "read_only",
    );
    assert.ok(profile);
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId: profile.id },
      "fake-assign",
    );
    await until(() =>
      f.store
        .listSessions()
        .some(
          (session) =>
            session.state === "busy" &&
            f.store.getAttempt(session.attemptId).taskId === task.id,
        ),
    );
    const session = f.store
      .listSessions()
      .find((item) => f.store.getAttempt(item.attemptId).taskId === task.id);
    assert.ok(session);
    const send = (kind: "steer" | "follow_up") =>
      f.engine.workerMessages.send(
        { role: "owner" },
        {
          taskId: task.id,
          sessionId: session.id,
          kind,
          text: "FAKE owner input",
        },
        `fake-${kind}`,
      );
    assert.equal((await send("steer")).status, "delivered");
    assert.equal((await send("follow_up")).status, "queued");
    await until(() => f.store.getTask(task.id).status === "AWAITING_REVIEW");
    assert.deepEqual(
      f.engine.workerMessages.list(task.id).map((m) => m.status),
      ["delivered", "delivered"],
    );
    const events = f.store
      .events({ runId: run.id, limit: 500 })
      .filter((event) => event.taskId === task.id);
    const text = events.find((event) => event.type === "fake.text_delta");
    const delivered = events.find(
      (event) => event.type === "fake.owner_message_delivered",
    );
    assert.ok(text && delivered && text.sequence < delivered.sequence);
    assert.equal(
      f.store.listAttempts().filter((a) => a.taskId === task.id).length,
      1,
    );
    assert.equal(f.store.getTask(f.task.id).status, "RUNNING");
  } finally {
    await f.close();
  }
});
