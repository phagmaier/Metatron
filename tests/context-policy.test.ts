import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import { contextPlan } from "../src/server/orchestration/context-policy.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import {
  decideRecovery,
  recheckRecovery,
} from "../src/server/orchestration/recovery-decisions.ts";
import { requestRevision } from "../src/server/orchestration/revision.ts";
import { Store } from "../src/server/storage/store.ts";
import { defaultLimits, type Session } from "../src/shared/domain/entities.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { assignSchema } from "../src/shared/orchestration.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

const writer =
  fakeTeamSnapshot.profiles.find(
    (p) =>
      p.permission === "workspace_write" &&
      fakeTeamSnapshot.preset.workerProfileIds.includes(p.id),
  )?.id ?? "";
const refused = (code: DomainError["code"], pattern: RegExp) => (e: unknown) =>
  e instanceof DomainError && e.code === code && pattern.test(e.message);

async function fakeFixture() {
  const repo = await createGitFixture();
  const directory = await mkdtemp(join(tmpdir(), "lao-context-"));
  const path = join(directory, "state.sqlite");
  let store = new Store(path);
  let engine = new Engine(store, directory);
  const project = await engine.openProject(
    { name: "Context fixture", repositoryPath: repo.directory },
    "project",
  );
  const run = await engine.startRun(
    {
      projectId: project.id,
      title: "Context policies",
      initialPrompt: "Plan one task",
      mode: "supervised",
      leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
    },
    "run",
  );
  await engine.idle();
  return {
    run,
    get store() {
      return store;
    },
    get engine() {
      return engine;
    },
    task(title: string) {
      return engine.createTask(
        { runId: run.id, title, objective: `${title} objective` },
        title,
      );
    },
    assign(taskId: string, extra: object, key: string, scenario = "success") {
      return engine.scheduling.enqueue(
        { role: "owner" },
        { taskId, profileId: writer, scenario, ...extra },
        key,
      );
    },
    sessions(taskId: string) {
      return store
        .listSessions()
        .filter((s) => store.getAttempt(s.attemptId).taskId === taskId);
    },
    async restart() {
      await engine.close();
      store.close();
      store = new Store(path);
      engine = new Engine(store, directory);
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
type FakeFixture = Awaited<ReturnType<typeof fakeFixture>>;

// Stops a busy FAKE worker through its own help tool, as a blocked worker would.
async function stopForHelp(f: FakeFixture, taskId: string) {
  let session: Session | undefined;
  for (let i = 0; i < 300 && !session; i++) {
    session = f.sessions(taskId).find((s) => s.state === "busy");
    if (!session) await delay(10);
  }
  assert.ok(session);
  f.engine.tool(
    { role: "worker", sessionId: session.id },
    f.run.id,
    {
      name: "request_human_action",
      taskId,
      type: "environment",
      reason: "Install the fixture dependency",
      suggestedAction: "Install it and answer",
      blocking: true,
    },
    `help:${taskId}`,
  );
  await f.engine.idle();
  return f.store.getSession(session.id);
}

test("auto continues a task's cleanly ended session after an owner-continued human wait; unrelated work and revisions start fresh", async () => {
  const f = await fakeFixture();
  try {
    const task = f.task("Continue");
    f.engine.updateRun({ id: f.run.id, mode: "autonomous_bounded" }, "auto");
    const lead = f.store
      .listSessions()
      .find(
        (s) =>
          f.store.getTask(f.store.getAttempt(s.attemptId).taskId).kind ===
          "lead",
      );
    assert.ok(lead);
    // An unpinned Lead assignment, so only the wait rule refuses its continuation.
    const asLead = (key: string) =>
      f.engine.scheduling.enqueue(
        { role: "lead", sessionId: lead.id },
        { taskId: task.id, profileId: writer },
        key,
      );
    asLead("lead-assign");
    const first = await stopForHelp(f, task.id);
    assert.equal(first.state, "exited");
    assert.equal(f.store.getTask(task.id).status, "WAITING_HUMAN");
    const [request] = f.store.listTaskBlockers(task.id);
    assert.ok(request);
    assert.throws(() => f.assign(task.id, {}, "blocked"), {
      code: "CONFLICT",
    });
    f.store.updateHumanRequest(
      {
        id: request.id,
        expectedStatus: "open",
        status: "answered",
        ownerResponse: "Dependency installed",
      },
      "answer",
    );
    await f.engine.pump();
    assert.equal(f.store.getTask(task.id).status, "WAITING_HUMAN");
    assert.throws(
      () => asLead("lead-continue"),
      refused("POLICY_DENIED", /Only the owner continues/),
    );
    assert.equal(f.store.getTask(task.id).status, "WAITING_HUMAN");

    f.assign(task.id, {}, "continue");
    await f.engine.idle();
    assert.equal(f.store.getTask(task.id).status, "AWAITING_REVIEW");
    const [earlier, resumed] = f.sessions(task.id);
    assert.deepEqual(earlier, first);
    assert.equal(f.store.getAttempt(first.attemptId).status, "interrupted");
    assert.equal(resumed?.contextPolicy, "auto");
    assert.equal(resumed?.nativeSessionId, first.nativeSessionId);
    assert.deepEqual(resumed?.context, {
      effective: "resume",
      reason: "auto: continuing this task's cleanly ended session",
      predecessorAttemptId: first.attemptId,
      predecessorSessionId: first.id,
      checkpointArtifactId: null,
    });

    const other = f.task("Unrelated");
    f.assign(other.id, {}, "unrelated");
    await f.engine.idle();
    const [fresh] = f.sessions(other.id);
    assert.equal(fresh?.context?.effective, "fresh");
    assert.match(fresh?.context?.reason ?? "", /no earlier attempt/);
    assert.equal(fresh?.context?.predecessorSessionId, null);
    assert.notEqual(fresh?.nativeSessionId, first.nativeSessionId);

    requestRevision(
      f.engine,
      { role: "owner" },
      { taskId: task.id, feedback: "Tighten the result" },
      "revise",
    );
    await f.engine.idle();
    const revisionId = f.store.getTask(task.id).latestRevisionTaskId;
    assert.ok(revisionId && resumed);
    const [revised] = f.sessions(revisionId);
    assert.equal(revised?.context?.effective, "fresh");
    assert.match(revised?.context?.reason ?? "", /separate task/);
    assert.equal(revised?.context?.predecessorAttemptId, resumed.attemptId);
    assert.equal(revised?.context?.checkpointArtifactId, null);
    assert.notEqual(revised?.nativeSessionId, first.nativeSessionId);

    const saved = f.store.listSessions();
    await f.restart();
    assert.deepEqual(f.store.listSessions(), saved);
  } finally {
    await f.close();
  }
});

test("explicit resume names only the task's own cleanly ended session; refusals change nothing and fresh retries carry a checkpoint", async () => {
  const f = await fakeFixture();
  try {
    const base = { taskId: f.run.id, profileId: writer };
    assert.throws(() =>
      assignSchema.parse({ ...base, contextPolicy: "resume" }),
    );
    assert.throws(() =>
      assignSchema.parse({
        ...base,
        contextPolicy: "fresh",
        resumeSessionId: f.run.id,
      }),
    );
    const lost = f.task("Disconnected");
    f.assign(lost.id, {}, "lost", "disconnect");
    const failed = f.task("Failed");
    f.assign(failed.id, {}, "failed", "failure");
    await f.engine.idle();
    const [lostSession] = f.sessions(lost.id);
    const [failedSession] = f.sessions(failed.id);
    assert.ok(lostSession && failedSession);
    const decide = async (taskId: string, extra: object, key: string) => {
      const check = await recheckRecovery(f.engine, { taskId }, `${key}:check`);
      return decideRecovery(
        f.engine,
        { taskId, checkId: check.id, profileId: writer, ...extra },
        key,
      );
    };
    await assert.rejects(
      decide(
        lost.id,
        { contextPolicy: "resume", resumeSessionId: failedSession.id },
        "foreign",
      ),
      refused("POLICY_DENIED", /this task's latest earlier session/),
    );
    // A disconnected session's process may still be running.
    await assert.rejects(
      decide(
        lost.id,
        { contextPolicy: "resume", resumeSessionId: lostSession.id },
        "unclean",
      ),
      refused("UNSUPPORTED", /did not end cleanly.*fresh policy/),
    );
    assert.equal(f.store.getTask(lost.id).status, "RETRY_DECISION");
    assert.equal(f.sessions(lost.id).length, 1);

    await decide(lost.id, {}, "lost-retry");
    await decide(
      failed.id,
      { contextPolicy: "resume", resumeSessionId: failedSession.id },
      "failed-retry",
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(lost.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(failed.id).status, "AWAITING_REVIEW");
    const [, lostRetry] = f.sessions(lost.id);
    assert.equal(lostRetry?.context?.effective, "fresh");
    assert.match(
      lostRetry?.context?.reason ?? "",
      /^auto: The earlier session did not end cleanly.*checkpoint/,
    );
    assert.notEqual(lostRetry?.nativeSessionId, lostSession.nativeSessionId);
    const checkpoint = (await f.engine.reports(lost.id)).find(
      (r) => r.artifact.id === lostRetry?.context?.checkpointArtifactId,
    );
    assert.ok(checkpoint);
    assert.match(checkpoint.content, /not a transcript/);
    assert.ok(checkpoint.content.includes(lostSession.attemptId));
    assert.match(checkpoint.content, /disconnected/);
    const [, failedRetry] = f.sessions(failed.id);
    assert.equal(failedRetry?.contextPolicy, "resume");
    assert.equal(failedRetry?.context?.effective, "resume");
    assert.equal(failedRetry?.nativeSessionId, failedSession.nativeSessionId);
    assert.equal(failedRetry?.context?.predecessorSessionId, failedSession.id);
  } finally {
    await f.close();
  }
});

test("Pi never resumes into a new worktree: resume is refused, and the owner's continuation runs fresh with a checkpoint while both transcripts stay linked", async () => {
  const repo = await createGitFixture();
  const data = await mkdtemp("/tmp/lao-context-pi-");
  const prompts = join(data, "prompts.log");
  const launches: string[][] = [];
  const pi = new PiAdapter(data, (args, cwd, env) => {
    if (args.includes("--session-dir")) launches.push(args);
    return new PiRpc(
      process.execPath,
      [fileURLToPath(new URL("./helpers/pi-rpc-fixture.ts", import.meta.url))],
      cwd,
      {
        ...env,
        LAO_FIXTURE_SCENARIO:
          launches.length === 1 && args.includes("--session-dir")
            ? "help-blocking"
            : "tracked",
        LAO_FIXTURE_PROMPT_LOG: prompts,
      },
    );
  });
  const options = {
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: { pi },
  };
  let app = await startApp(options);
  let passed = false;
  try {
    let engine = app.engine;
    assert.ok(engine);
    const project = await engine.openProject(
      { name: "Context Pi fixture", repositoryPath: repo.directory },
      "project",
    );
    const run = await engine.startNativeRun(
      {
        projectId: project.id,
        title: "Context Pi fixture",
        initialPrompt: "Edit the disposable fixture",
        model: "fixture/model",
        thinking: "off",
        permission: "workspace_write",
        limits: { ...defaultLimits, maxConcurrentWriters: 1 },
      },
      "run",
    );
    await engine.idle();
    const { store } = engine;
    const [task] = store.listTasks(run.id);
    assert.ok(task);
    assert.equal(store.getTask(task.id).status, "WAITING_HUMAN");
    const [first] = store.listSessions();
    assert.ok(first);
    const prior = store.getAttempt(first.attemptId);
    assert.equal(first.transcriptPath, join(data, "pi-sessions", prior.id));
    const [request] = store.listTaskBlockers(task.id);
    assert.ok(request && prior.profileId && prior.worktreePath);
    store.updateHumanRequest(
      {
        id: request.id,
        expectedStatus: "open",
        status: "answered",
        ownerResponse: "Fixture dependency installed",
      },
      "answer",
    );
    const profileId = prior.profileId;
    assert.throws(
      () =>
        engine?.scheduling.enqueue(
          { role: "owner" },
          {
            taskId: task.id,
            profileId,
            contextPolicy: "resume",
            resumeSessionId: first.id,
          },
          "resume",
        ),
      refused("UNSUPPORTED", /does not reopen native sessions/),
    );
    assert.equal(store.getTask(task.id).status, "WAITING_HUMAN");

    engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId },
      "continue",
    );
    await engine.idle();
    assert.equal(store.getTask(task.id).status, "AWAITING_REVIEW");
    const [, successor] = store.listSessions();
    assert.ok(successor);
    const next = store.getAttempt(successor.attemptId);
    assert.equal(prior.status, "interrupted");
    assert.notEqual(next.worktreePath, prior.worktreePath);
    assert.notEqual(successor.nativeSessionId, first.nativeSessionId);
    assert.equal(successor.transcriptPath, join(data, "pi-sessions", next.id));
    assert.equal(successor.context?.effective, "fresh");
    assert.equal(
      successor.context?.reason,
      `auto: This Pi adapter does not reopen native sessions; fresh session with a checkpoint of attempt ${prior.id}`,
    );
    assert.equal(successor.context?.predecessorSessionId, first.id);
    assert.equal(successor.context?.predecessorAttemptId, prior.id);
    assert.ok(successor.context?.checkpointArtifactId);
    assert.equal(
      await readFile(join(prior.worktreePath, "help-scratch.txt"), "utf8"),
      "Unfinished fixture work; preserve me\n",
    );
    assert.deepEqual(
      launches.map((args) => args[args.indexOf("--session-dir") + 1]),
      [first.transcriptPath, successor.transcriptPath],
    );
    for (const args of launches)
      assert.ok(
        !args.some((a) => ["--session", "--continue", "--resume"].includes(a)),
      );
    const [before, after] = (await readFile(prompts, "utf8"))
      .trim()
      .split("\n")
      .map((line) => String(JSON.parse(line)));
    assert.doesNotMatch(before ?? "", /Context checkpoint/);
    assert.match(after ?? "", /Context checkpoint/);
    assert.ok(after?.includes(prior.id));
    assert.match(after ?? "", /Fixture dependency installed/);
    assert.match(after ?? "", /help-scratch\.txt/);

    const saved = store.listSessions();
    await app.close();
    app = await startApp(options);
    engine = app.engine;
    assert.deepEqual(engine?.store.listSessions(), saved);
    passed = true;
  } finally {
    await app.close();
    if (passed) {
      await repo.verify(async () => {});
      await rm(data, { recursive: true });
    }
  }
});

test("auto resumes only for the same profile, harness and checkout, and never a session with an unconfirmed stop or a foreign native ID", async () => {
  const f = await domainFixture();
  try {
    const profileId = randomUUID();
    const attempt = f.store.createAttempt(
      {
        taskId: f.task.id,
        profileId,
        adapter: "fake",
        intendedOperation: "Earlier",
        cwd: f.directory,
      },
      "earlier",
    );
    for (const status of ["running", "interrupted"])
      f.store.updateAttempt({ id: attempt.id, status }, `attempt:${status}`);
    const session = f.store.createSession(
      { attemptId: attempt.id, nativeSessionId: "fake-native" },
      "session",
    );
    for (const [from, to] of [
      ["not_started", "starting"],
      ["starting", "busy"],
      ["busy", "exited"],
    ])
      f.store.updateSession(
        { id: session.id, expectedState: from, state: to },
        `session:${to}`,
      );
    const plan = (overrides: object = {}) =>
      contextPlan(f.store, {
        task: f.store.getTask(f.task.id),
        profileId,
        adapter: "fake",
        cwd: f.directory,
        policy: "auto",
        resumeSessionId: null,
        attemptId: null,
        ...overrides,
      });
    assert.equal(plan().effective, "resume");
    assert.match(
      plan({ cwd: join(f.directory, "moved") }).reason,
      /new checkout/,
    );
    assert.match(plan({ profileId: randomUUID() }).reason, /profile changed/);
    assert.match(plan({ adapter: "pi" }).reason, /does not reopen/);
    assert.equal(plan({ policy: "fresh" }).effective, "fresh");

    const stops = JSON.stringify([
      {
        id: randomUUID(),
        scope: "task",
        requestedAt: new Date().toISOString(),
        processId: null,
        status: "pending",
        resolvedAt: null,
        evidence: null,
        diagnostic: null,
      },
    ]);
    const setStops = (value: string) =>
      f.store.db
        .prepare(
          "UPDATE sessions SET data=json_set(data,'$.stops',json(?)) WHERE id=?",
        )
        .run(value, session.id);
    setStops(stops);
    assert.match(plan().reason, /did not end cleanly/);
    setStops("[]");

    const other = f.store.createRun(
      { projectId: f.project.id, title: "Other", initialPrompt: "Other" },
      "other-run",
    );
    const otherTask = f.store.createTask(
      { runId: other.id, title: "Other", objective: "Other" },
      "other-task",
    );
    const foreign = f.store.createAttempt(
      {
        taskId: otherTask.id,
        adapter: "fake",
        intendedOperation: "Other",
        cwd: f.directory,
      },
      "foreign",
    );
    f.store.createSession(
      { attemptId: foreign.id, nativeSessionId: "fake-native" },
      "foreign-session",
    );
    assert.match(plan().reason, /another run or checkout/);
  } finally {
    await f.close();
  }
});
