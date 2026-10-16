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
    const queue = [1, 2, 3].map((n) => {
      const task = f.store.createTask(
        { runId: run.id, title: `Writer ${n}`, objective: "Simulate" },
        `task-${n}`,
      );
      const input = { taskId: task.id, profileId: writer.id };
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
    const first = scheduler.reserve(at(queue, 0));
    assert.ok(first);
    assert.equal(scheduler.reserve(at(queue, 0)), first);
    assert.equal(scheduler.reserve(at(queue, 1)), null);
    assert.equal(f.store.listAttempts().length, 1);
    scheduler.release(at(queue, 0).taskId);
    assert.ok(scheduler.reserve(at(queue, 1)));
    scheduler.release(at(queue, 1).taskId);
    assert.throws(() => scheduler.reserve(at(queue, 2)), {
      code: "BUDGET_EXCEEDED",
    });
    assert.equal(f.store.listAttempts().length, 2);
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
    scheduler.release(at(queue, 0).taskId);
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
    scheduler.release(lead.id);
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
    assert.ok(scheduler.reserve(queued));
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
  } finally {
    await f.close();
  }
});
