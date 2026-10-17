import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { StartSessionInput } from "../src/server/adapters/contract.ts";
import { FakeAdapter } from "../src/server/adapters/fake.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import type { Dispatch } from "../src/shared/orchestration.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

async function setup() {
  const f = await domainFixture();
  const git = await createGitFixture();
  const engine = new Engine(f.store, f.directory);
  const project = await engine.openProject(
    { name: "Fixture", repositoryPath: git.directory },
    "git-project",
  );
  const input = {
    projectId: project.id,
    title: "FAKE flow",
    initialPrompt: "Inspect the disposable fixture",
    leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
  };
  return {
    ...f,
    git,
    engine,
    input,
    async close() {
      await engine.close();
      await git.verify(async () =>
        assert.equal(await git.git("status", "--porcelain"), ""),
      );
      await f.close();
    },
  };
}
test("owner → fake Lead → validated worker → durable report survives restart without replay", async () => {
  const f = await setup();
  try {
    const before = await readFile(join(f.git.directory, "README.md"), "utf8");
    const run = await f.engine.startRun(f.input, "start");
    assert.deepEqual(await f.engine.startRun(f.input, "start"), run);
    await f.engine.idle();
    const workers = f.store
      .listTasks(run.id)
      .filter((task) => task.kind === "work");
    assert.equal(workers.length, 1);
    const worker = workers[0];
    assert.ok(worker);
    assert.equal(worker.status, "AWAITING_REVIEW");
    const reports = await f.engine.reports(worker.id);
    assert.equal(reports.length, 1);
    assert.match(reports[0]?.content ?? "", /FAKE report/);
    assert.equal(
      await readFile(join(f.git.directory, "README.md"), "utf8"),
      before,
    );
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) count FROM reservations").get()
        ?.count,
      0,
    );
    const types = f.store
      .events({ runId: run.id, limit: 500 })
      .map((event) => event.type);
    for (const type of [
      "owner.message",
      "lead.message",
      "task.assigned",
      "worker.result",
      "report.saved",
    ])
      assert.ok(types.includes(type));
    await f.engine.close();
    const count = f.store.listAttempts().length;
    f.store.recoverInterrupted();
    assert.equal(f.store.listAttempts().length, count);
  } finally {
    await f.close();
  }
});
test("Chat/Plan discusses the owner prompt without worker dispatch or source changes", async () => {
  const f = await setup();
  try {
    const run = await f.engine.startRun(
      {
        ...f.input,
        mode: "chat_plan",
        initialPrompt: "Write source and dispatch workers now",
      },
      "start",
    );
    await f.engine.idle();
    assert.equal(
      f.store.listTasks(run.id).filter((task) => task.kind === "work").length,
      0,
    );
    assert.equal(
      f.store
        .listAttempts()
        .filter((a) => f.store.getTask(a.taskId).runId === run.id).length,
      1,
    );
    const task = f.engine.createTask(
      {
        runId: run.id,
        title: "Owner task",
        objective: "Cannot dispatch in chat",
      },
      "manual",
    );
    assert.throws(
      () =>
        f.engine.scheduling.enqueue(
          { role: "owner" },
          {
            taskId: task.id,
            profileId: fakeTeamSnapshot.preset.workerProfileIds[0],
          },
          "dispatch",
        ),
      { code: "POLICY_DENIED" },
    );
  } finally {
    await f.close();
  }
});
test("Supervised proposals wait for owner assignment; worker sessions cannot schedule or impersonate Lead", async () => {
  const f = await setup();
  try {
    const run = await f.engine.startRun(
      { ...f.input, mode: "supervised" },
      "start",
    );
    await f.engine.idle();
    const task = f.store.listTasks(run.id).find((task) => task.kind === "work");
    assert.ok(task);
    assert.equal(task.status, "BACKLOG");
    const leadSession = f.store
      .listSessions()
      .find(
        (s) =>
          f.store.getTask(f.store.getAttempt(s.attemptId).taskId).runId ===
          run.id,
      );
    assert.ok(leadSession);
    const assignment = {
      name: "assign_task",
      taskId: task.id,
      profileId: fakeTeamSnapshot.preset.workerProfileIds[0],
    };
    assert.deepEqual(
      f.engine.tool(
        { role: "lead", sessionId: leadSession.id },
        run.id,
        assignment,
        "lead-proposal",
      ),
      {
        outcome: "awaiting_owner_approval",
        taskId: task.id,
        profileId: assignment.profileId,
      },
    );
    assert.equal(
      f.store.getTask(task.id).proposedProfileId,
      assignment.profileId,
    );
    assert.equal(f.store.getTask(task.id).status, "BACKLOG");
    assert.equal(
      f.engine.scheduling.list().some((d) => d.taskId === task.id),
      false,
    );
    assert.throws(
      () =>
        f.engine.scheduling.enqueue(
          { role: "lead", sessionId: leadSession.id },
          { taskId: task.id, profileId: assignment.profileId },
          "lead-direct-dispatch",
        ),
      { code: "POLICY_DENIED" },
    );
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId: assignment.profileId },
      "owner-assign",
    );
    await f.engine.idle();
    const workerSession = f.store
      .listSessions()
      .find((s) => f.store.getAttempt(s.attemptId).taskId === task.id);
    assert.ok(workerSession);
    assert.throws(
      () =>
        f.engine.tool(
          { role: "worker", sessionId: workerSession.id },
          run.id,
          assignment,
          "worker-deny",
        ),
      { code: "POLICY_DENIED" },
    );
    assert.throws(
      () =>
        f.engine.tool(
          { role: "lead", sessionId: workerSession.id },
          run.id,
          assignment,
          "impersonate",
        ),
      { code: "POLICY_DENIED" },
    );
    assert.equal(f.store.getTask(task.id).ownerPinned, true);
    f.engine.updateRun(
      { id: run.id, mode: "autonomous_bounded" },
      "autonomous-now",
    );
    assert.throws(
      () =>
        f.engine.tool(
          { role: "lead", sessionId: leadSession.id },
          run.id,
          assignment,
          "pinned-deny",
        ),
      { code: "POLICY_DENIED" },
    );
    assert.throws(
      () =>
        f.engine.tool(
          { role: "worker", sessionId: workerSession.id },
          f.run.id,
          { name: "submit_result", taskId: task.id, report: "Cross-run" },
          "cross-run",
        ),
      { code: "POLICY_DENIED" },
    );
  } finally {
    await f.close();
  }
});

test("owner cancellation interrupts an active fake worker and releases its reservation", async () => {
  const f = await setup();
  try {
    const run = await f.engine.startRun(
      { ...f.input, mode: "supervised" },
      "start",
    );
    await f.engine.idle();
    const task = f.store.listTasks(run.id).find((task) => task.kind === "work");
    assert.ok(task);
    f.engine.scheduling.enqueue(
      { role: "owner" },
      {
        taskId: task.id,
        profileId: fakeTeamSnapshot.preset.workerProfileIds[0],
      },
      "assign",
    );
    await f.engine.pump();
    assert.equal(f.store.getTask(task.id).status, "RUNNING");
    f.engine.cancel(task.id, "cancel-active");
    await f.engine.idle();
    const attempt = f.store
      .listAttempts()
      .find((attempt) => attempt.taskId === task.id);
    assert.ok(attempt);
    assert.equal(attempt.status, "cancelled");
    const session = f.store
      .listSessions()
      .find((session) => session.attemptId === attempt.id);
    assert.equal(session?.state, "exited");
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) count FROM reservations").get()
        ?.count,
      0,
    );
  } finally {
    await f.close();
  }
});

test("an owner reassignment during dispatch uses the committed profile and simulated cwd", async (context) => {
  const f = await setup();
  try {
    const run = await f.engine.startRun(
      { ...f.input, mode: "supervised" },
      "start",
    );
    await f.engine.idle();
    const task = f.store.listTasks(run.id).find((task) => task.kind === "work");
    assert.ok(task);
    const reader = fakeTeamSnapshot.profiles.find(
      (profile) => profile.permission === "read_only",
    );
    const writer = fakeTeamSnapshot.profiles.find(
      (profile) => profile.permission === "workspace_write",
    );
    assert.ok(reader && writer);
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId: reader.id },
      "reader-first",
    );
    const reserve = f.engine.scheduling.reserve.bind(f.engine.scheduling);
    context.mock.method(
      f.engine.scheduling,
      "reserve",
      (dispatch: Dispatch) => {
        if (dispatch.taskId === task.id)
          f.engine.scheduling.enqueue(
            { role: "owner" },
            { taskId: task.id, profileId: writer.id },
            "owner-reassigned",
          );
        return reserve(dispatch);
      },
    );
    const start = FakeAdapter.prototype.startSession;
    let actual: StartSessionInput | undefined;
    context.mock.method(
      FakeAdapter.prototype,
      "startSession",
      async function (this: FakeAdapter, input: StartSessionInput) {
        actual = input;
        return start.call(this, input);
      },
    );
    await f.engine.idle();
    assert.equal(actual?.permission, "workspace_write");
    assert.ok(actual?.cwd.startsWith(join(f.directory, "fake-workspaces")));
    assert.equal(f.store.getTask(task.id).assignedProfileId, writer.id);
  } finally {
    await f.close();
  }
});
test("fake failure and ambiguous disconnect require a retry decision and free all slots", async () => {
  for (const scenario of ["failure", "disconnect"] as const) {
    const f = await setup();
    try {
      const run = await f.engine.startRun({ ...f.input, scenario }, "start");
      await f.engine.idle();
      const task = f.store
        .listTasks(run.id)
        .find((task) => task.kind === "work");
      assert.ok(task);
      assert.equal(task.status, "RETRY_DECISION");
      assert.equal(
        f.store.db.prepare("SELECT COUNT(*) count FROM reservations").get()
          ?.count,
        0,
      );
      assert.deepEqual(await f.engine.reports(task.id), []);
      const count = f.store.listAttempts().length;
      await f.engine.pump();
      assert.equal(f.store.listAttempts().length, count);
    } finally {
      await f.close();
    }
  }
});
for (const scenario of ["failure", "disconnect"] as const) {
  test(`explicit retries after fake ${scenario} launch fresh attempts and release every reservation`, async () => {
    const f = await setup();
    try {
      const run = await f.engine.startRun(
        { ...f.input, mode: "supervised" },
        "start",
      );
      await f.engine.idle();
      const task = f.store.listTasks(run.id).find((t) => t.kind === "work");
      assert.ok(task);
      const input = {
        taskId: task.id,
        profileId: fakeTeamSnapshot.preset.workerProfileIds[0],
        scenario,
        contextPolicy: "fresh",
      };
      let previous = f.engine.scheduling.enqueue(
        { role: "owner" },
        input,
        "initial-assignment",
      );
      await f.engine.idle();
      const history = f.store
        .listAttempts()
        .filter((a) => a.taskId === task.id);
      for (const [index, outcome] of [scenario, "success"].entries()) {
        assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
        f.store.transitionTask(
          {
            id: task.id,
            expectedStatus: "RETRY_DECISION",
            status: "READY",
            reason: "Owner explicitly chose a fresh attempt",
          },
          `retry-${index}`,
        );
        const assignment = { ...input, scenario: outcome };
        const queued = f.engine.scheduling.enqueue(
          { role: "owner" },
          assignment,
          `retry-assignment-${index}`,
        );
        assert.notEqual(queued.sequence, previous.sequence);
        assert.equal(queued.attemptId, null);
        assert.deepEqual(
          f.engine.scheduling.enqueue(
            { role: "owner" },
            assignment,
            `retry-assignment-${index}`,
          ),
          queued,
        );
        await f.engine.idle();
        for (const attempt of history)
          assert.deepEqual(f.store.getAttempt(attempt.id), attempt);
        history.push(
          ...f.store
            .listAttempts()
            .filter(
              (a) =>
                a.taskId === task.id && !history.some((h) => h.id === a.id),
            ),
        );
        assert.equal(history.length, index + 2);
        assert.equal(
          f.store.db.prepare("SELECT COUNT(*) count FROM reservations").get()
            ?.count,
          0,
        );
        previous = queued;
      }
      assert.equal(f.store.getTask(task.id).status, "AWAITING_REVIEW");
      assert.equal(new Set(history.map((a) => a.dispatchId)).size, 3);
      const sessions = f.store
        .listSessions()
        .filter((s) => history.some((a) => a.id === s.attemptId));
      assert.equal(sessions.length, 3);
      assert.equal(new Set(sessions.map((s) => s.nativeSessionId)).size, 3);
      assert.deepEqual(
        (await f.engine.reports(task.id)).map((r) => r.artifact.summary),
        ["Context checkpoint", "Context checkpoint", "FAKE worker report"],
      );
      await f.engine.pump();
      assert.equal(
        f.store.listAttempts().filter((a) => a.taskId === task.id).length,
        3,
      );
    } finally {
      await f.close();
    }
  });
}
test("pause holds queued work, cancellation releases it, and changed HEAD blocks dispatch", async () => {
  const f = await setup();
  try {
    const run = await f.engine.startRun(
      { ...f.input, mode: "supervised" },
      "start",
    );
    await f.engine.idle();
    const task = f.store.listTasks(run.id).find((task) => task.kind === "work");
    assert.ok(task);
    f.engine.scheduling.enqueue(
      { role: "owner" },
      {
        taskId: task.id,
        profileId: fakeTeamSnapshot.preset.workerProfileIds[0],
      },
      "assign",
    );
    f.engine.updateRun({ id: run.id, status: "paused" }, "pause");
    const attempts = f.store.listAttempts().length;
    await f.engine.pump();
    assert.equal(f.store.listAttempts().length, attempts);
    f.engine.cancel(task.id, "cancel");
    f.engine.updateRun({ id: run.id, status: "active" }, "resume");
    await f.engine.idle();
    assert.equal(f.store.getTask(task.id).status, "CANCELLED");
    const other = f.engine.createTask(
      { runId: run.id, title: "Drift", objective: "Refuse drift" },
      "other",
    );
    f.engine.scheduling.enqueue(
      { role: "owner" },
      {
        taskId: other.id,
        profileId: fakeTeamSnapshot.preset.workerProfileIds[0],
      },
      "other-assign",
    );
    f.engine.updateRun({ id: run.id, status: "paused" }, "pause-drift");
    await f.git.git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Owner moved HEAD",
    );
    f.engine.updateRun({ id: run.id, status: "active" }, "resume-drift");
    await f.engine.idle();
    const dispatch = f.engine.scheduling
      .list()
      .find((d) => d.taskId === other.id);
    assert.equal(dispatch?.state, "blocked");
    assert.match(dispatch?.diagnostic ?? "", /HEAD changed/);
  } finally {
    await f.close();
  }
});
test("dirty checkout cannot be opened or started and is preserved for the owner", async () => {
  const f = await setup();
  try {
    await writeFile(
      join(f.git.directory, "README.md"),
      "Owner work retained\n",
    );
    await assert.rejects(f.engine.startRun(f.input, "dirty"), /dirty/);
    await assert.rejects(
      f.engine.openProject(
        { name: "Dirty", repositoryPath: f.git.directory },
        "dirty-open",
      ),
      /dirty/,
    );
    assert.equal(
      await readFile(join(f.git.directory, "README.md"), "utf8"),
      "Owner work retained\n",
    );
    // Restore only this disposable test file after checking preservation.
    await writeFile(
      join(f.git.directory, "README.md"),
      "# Disposable fixture\n",
    );
  } finally {
    await f.close();
  }
});
