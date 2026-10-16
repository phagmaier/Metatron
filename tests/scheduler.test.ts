import assert from "node:assert/strict";
import { test } from "node:test";
import { Scheduling } from "../src/server/storage/scheduling.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

function at<T>(items: T[], index: number): T {
  const item = items[index];
  assert.ok(item);
  return item;
}

test("scheduler reserves caps atomically, retries queued work later, and counts launches durably", async () => {
  const f = await domainFixture();
  try {
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Bounded",
        initialPrompt: "Fake",
        teamSnapshot: fakeTeamSnapshot,
        limits: {
          ...fakeTeamSnapshot.preset.limits,
          maxConcurrentWriters: 1,
          maxTotalWorkerLaunchesPerRun: 2,
        },
      },
      "bounded",
    );
    const scheduler = new Scheduling(f.store, f.directory);
    const writer = fakeTeamSnapshot.profiles.find(
      (profile) => profile.permission === "workspace_write",
    );
    assert.ok(writer);
    const [one, two, three] = [1, 2, 3].map((n) => {
      const task = f.store.createTask(
        { runId: run.id, title: `Writer ${n}`, objective: "Simulate" },
        `task-${n}`,
      );
      return { taskId: task.id, profileId: writer.id };
    });
    assert.ok(one && two && three);
    const queue = [one, two].map((input, n) => {
      const dispatch = scheduler.enqueue(
        { role: "owner" },
        input,
        `assign-${n}`,
      );
      assert.deepEqual(
        scheduler.enqueue({ role: "owner" }, input, `assign-${n}`),
        dispatch,
      );
      return dispatch;
    });
    assert.throws(
      () => scheduler.enqueue({ role: "owner" }, three, "assign-over"),
      { code: "BUDGET_EXCEEDED" },
    );
    assert.equal(f.store.getTask(three.taskId).status, "BACKLOG");
    const first = scheduler.reserve(at(queue, 0));
    assert.ok(first);
    assert.equal(scheduler.reserve(at(queue, 0)), first);
    assert.equal(scheduler.reserve(at(queue, 1)), null);
    assert.equal(f.store.listAttempts().length, 1);
    scheduler.release(at(queue, 0));
    assert.ok(scheduler.reserve(at(queue, 1)));
    scheduler.release(at(queue, 1));
    assert.equal(f.store.listAttempts().length, 2);
    assert.equal(scheduler.committedLaunches(run.id), 2);
  } finally {
    await f.close();
  }
});
test("one writable path has one owner even when writer slots are available", async () => {
  const f = await domainFixture();
  try {
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Lock",
        initialPrompt: "Fake",
        teamSnapshot: fakeTeamSnapshot,
      },
      "lock-run",
    );
    const scheduler = new Scheduling(f.store, f.directory);
    const writer = fakeTeamSnapshot.profiles.find(
      (profile) => profile.permission === "workspace_write",
    );
    assert.ok(writer);
    const queue = [1, 2].map((n) => {
      const task = f.store.createTask(
        {
          runId: run.id,
          title: `Writer ${n}`,
          objective: "Same simulated path",
        },
        `task-${n}`,
      );
      return scheduler.enqueue(
        { role: "owner" },
        { taskId: task.id, profileId: writer.id },
        `assign-${n}`,
      );
    });
    f.store.db
      .prepare("UPDATE dispatches SET cwd=? WHERE task_id=?")
      .run(at(queue, 0).cwd, at(queue, 1).taskId);
    assert.ok(scheduler.reserve(at(queue, 0)));
    assert.equal(scheduler.reserve(at(queue, 1)), null);
    scheduler.release(at(queue, 0));
    assert.ok(scheduler.reserve(at(queue, 1)));
  } finally {
    await f.close();
  }
});
test("Chat/Plan, missing profiles and unmet dependencies cannot dispatch workers", async () => {
  const f = await domainFixture();
  try {
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Plan",
        initialPrompt: "Fake",
        teamSnapshot: fakeTeamSnapshot,
        mode: "chat_plan",
      },
      "plan",
    );
    const task = f.store.createTask(
      { runId: run.id, title: "Blocked", objective: "No dispatch" },
      "blocked",
    );
    const scheduler = new Scheduling(f.store, f.directory);
    const profileId = at(fakeTeamSnapshot.preset.workerProfileIds, 0);
    assert.throws(
      () =>
        scheduler.enqueue(
          { role: "owner" },
          { taskId: task.id, profileId },
          "deny",
        ),
      { code: "POLICY_DENIED" },
    );
    assert.equal(f.store.listAttempts().length, 0);
    f.store.updateRun({ id: run.id, mode: "autonomous_bounded" }, "mode");
    const dependent = f.store.createTask(
      {
        runId: run.id,
        title: "Dependent",
        objective: "Wait",
        dependencyIds: [task.id],
      },
      "dependent",
    );
    const dispatch = scheduler.enqueue(
      { role: "owner" },
      { taskId: dependent.id, profileId },
      "waiting",
    );
    assert.equal(scheduler.reserve(dispatch), null);
    assert.equal(f.store.getTask(dependent.id).status, "QUEUED");
  } finally {
    await f.close();
  }
});

test("active Lead turns consume total slots, idle sessions do not, and reader caps apply across runs", async () => {
  const f = await domainFixture();
  try {
    const limits = {
      ...fakeTeamSnapshot.preset.limits,
      maxConcurrentAgentsIncludingLead: 1,
      maxConcurrentReadersReviewers: 1,
    };
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Slots",
        initialPrompt: "Fake",
        teamSnapshot: fakeTeamSnapshot,
        limits,
      },
      "slots",
    );
    const scheduler = new Scheduling(f.store, f.directory);
    const lead = f.store.createTask(
      { runId: run.id, title: "Lead", objective: "Discuss", kind: "lead" },
      "lead",
    );
    const leadDispatch = scheduler.enqueueLead(
      lead.id,
      "success",
      "lead-queue",
    );
    const leadAttempt = scheduler.reserve(leadDispatch);
    assert.ok(leadAttempt);
    const session = f.store.createSession(
      { attemptId: leadAttempt },
      "lead-session",
    );
    f.store.updateSession(
      { id: session.id, expectedState: "not_started", state: "starting" },
      "lead-starting",
    );
    f.store.updateSession(
      { id: session.id, expectedState: "starting", state: "idle" },
      "lead-idle",
    );
    const otherRun = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Another run",
        initialPrompt: "Fake",
        teamSnapshot: fakeTeamSnapshot,
        limits: {
          ...fakeTeamSnapshot.preset.limits,
          maxConcurrentReadersReviewers: 1,
        },
      },
      "other-slots",
    );
    const reader = fakeTeamSnapshot.profiles.find(
      (p) => p.permission === "read_only",
    );
    assert.ok(reader);
    const worker = f.store.createTask(
      {
        runId: otherRun.id,
        title: "Reader",
        objective: "Wait for global total slot",
      },
      "reader",
    );
    const queued = scheduler.enqueue(
      { role: "owner" },
      { taskId: worker.id, profileId: reader.id },
      "reader-queue",
    );
    assert.equal(scheduler.reserve(queued), null);
    scheduler.release(leadDispatch);
    assert.ok(scheduler.reserve(queued));
    assert.equal(f.store.getSession(session.id).state, "idle");
    const second = f.store.createTask(
      { runId: otherRun.id, title: "Reader two", objective: "Reader cap" },
      "reader-two",
    );
    const secondDispatch = scheduler.enqueue(
      { role: "owner" },
      { taskId: second.id, profileId: reader.id },
      "reader-two-queue",
    );
    assert.equal(scheduler.reserve(secondDispatch), null);
  } finally {
    await f.close();
  }
});

test("restart releases reserved slots and retains ambiguous dispatch history without requeue", async () => {
  const f = await domainFixture();
  try {
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Crash",
        initialPrompt: "Fake",
        teamSnapshot: fakeTeamSnapshot,
        limits: {
          ...fakeTeamSnapshot.preset.limits,
          maxTotalWorkerLaunchesPerRun: 2,
        },
      },
      "crash-run",
    );
    const scheduler = new Scheduling(f.store, f.directory);
    const task = f.store.createTask(
      {
        runId: run.id,
        title: "Ambiguous",
        objective: "Reserved before app crash",
      },
      "reserved-task",
    );
    const queued = scheduler.enqueue(
      { role: "owner" },
      {
        taskId: task.id,
        profileId: fakeTeamSnapshot.preset.workerProfileIds[0],
      },
      "reserved-queue",
    );
    const first = scheduler.reserve(queued);
    assert.ok(first);
    f.reopen().recoverInterrupted();
    assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) count FROM reservations").get()
        ?.count,
      0,
    );
    const history = new Scheduling(f.store, f.directory).list();
    assert.equal(history.find((d) => d.taskId === task.id)?.state, "released");
    assert.equal(f.store.listAttempts().length, 1);
    const resumed = new Scheduling(f.store, f.directory);
    const input = { taskId: task.id, profileId: queued.profileId };
    assert.throws(
      () => resumed.enqueue({ role: "owner" }, input, "undecided-retry"),
      { code: "CONFLICT" },
    );
    f.store.transitionTask(
      {
        id: task.id,
        expectedStatus: "RETRY_DECISION",
        status: "READY",
        reason: "Owner chose a fresh attempt after recovery",
      },
      "retry-decision",
    );
    const retry = resumed.enqueue({ role: "owner" }, input, "retry-queue");
    assert.ok(retry.sequence > queued.sequence);
    assert.equal(retry.attemptId, null);
    assert.equal(retry.diagnostic, null);
    assert.deepEqual(
      resumed.enqueue({ role: "owner" }, input, "reserved-queue"),
      queued,
    );
    assert.equal(resumed.reserve(queued), null);
    assert.equal(resumed.release(queued, "Late recovery callback"), false);
    assert.equal(resumed.block(queued, "Late inspection callback"), false);
    assert.deepEqual(resumed.list(), [retry]);
    const reassigned = resumed.enqueue({ role: "owner" }, input, "reassign");
    assert.equal(reassigned.sequence, retry.sequence);
    const second = resumed.reserve(retry);
    assert.ok(second);
    assert.notEqual(second, first);
    assert.equal(resumed.reserve(retry), second);
    assert.equal(f.store.getTask(task.id).status, "RUNNING");
    assert.equal(f.store.getAttempt(first).status, "RECOVERY_REQUIRED");
    assert.equal(f.store.getAttempt(second).status, "running");
    assert.notEqual(
      f.store.getAttempt(first).dispatchId,
      f.store.getAttempt(second).dispatchId,
    );
    assert.equal(resumed.committedLaunches(run.id), 2);
    const extra = f.store.createTask(
      { runId: run.id, title: "Over budget", objective: "Cannot launch" },
      "extra-task",
    );
    assert.throws(
      () =>
        resumed.enqueue(
          { role: "owner" },
          { ...input, taskId: extra.id },
          "extra-queue",
        ),
      { code: "BUDGET_EXCEEDED" },
    );
    assert.equal(f.store.listAttempts().length, 2);
    assert.equal(resumed.release(retry), true);
    assert.equal(resumed.release(retry), true);
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) count FROM reservations").get()
        ?.count,
      0,
    );
  } finally {
    await f.close();
  }
});

test("a requeued blocked assignment has fresh mutation keys and ignores stale callbacks", async () => {
  const f = await domainFixture();
  try {
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Blocked assignments",
        initialPrompt: "Fake",
        teamSnapshot: fakeTeamSnapshot,
      },
      "blocked-run",
    );
    const task = f.store.createTask(
      { runId: run.id, title: "Blocked", objective: "Wait for inspection" },
      "blocked-task",
    );
    const scheduler = new Scheduling(f.store, f.directory);
    const input = {
      taskId: task.id,
      profileId: fakeTeamSnapshot.preset.workerProfileIds[0],
    };
    const first = scheduler.enqueue({ role: "owner" }, input, "first");
    assert.equal(scheduler.block(first, "First diagnostic"), true);
    assert.equal(scheduler.block(first, "First diagnostic"), true);
    const second = scheduler.enqueue({ role: "owner" }, input, "second");
    assert.ok(second.sequence > first.sequence);
    assert.equal(scheduler.release(first), false);
    assert.equal(scheduler.reserve(first), null);
    assert.equal(scheduler.block(second, "Different diagnostic"), true);
    assert.equal(scheduler.list()[0]?.state, "blocked");
    assert.equal(scheduler.list()[0]?.diagnostic, "Different diagnostic");
    assert.equal(
      f.store
        .events({ runId: run.id })
        .filter((e) => e.type === "dispatch.blocked").length,
      2,
    );
    assert.equal(f.store.listAttempts().length, 0);
    const third = scheduler.enqueue({ role: "owner" }, input, "third");
    assert.ok(third.sequence > second.sequence);
    const attempt = scheduler.reserve(third);
    assert.ok(attempt);
    assert.equal(scheduler.reserve(third), attempt);
    assert.equal(scheduler.release(third), true);
  } finally {
    await f.close();
  }
});
