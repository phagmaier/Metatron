import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileDependencyWaits } from "../src/server/storage/dependencies.ts";
import { Scheduling } from "../src/server/storage/scheduling.ts";
import type { Store } from "../src/server/storage/store.ts";
import type { TaskStatus } from "../src/shared/domain/states.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

function transition(store: Store, id: string, status: TaskStatus) {
  return store.transitionTask(
    {
      id,
      expectedStatus: store.getTask(id).status,
      status,
      reason: "Fixture decision",
    },
    `${id}:${status}`,
  );
}

function finish(store: Store, id: string) {
  for (const status of [
    "READY",
    "QUEUED",
    "RUNNING",
    "AWAITING_REVIEW",
    "READY_TO_INTEGRATE",
    "INTEGRATING",
    "DONE",
  ] as const)
    transition(store, id, status);
}

async function fixture(maxLaunches = 20) {
  const f = await domainFixture();
  const run = f.store.createRun(
    {
      projectId: f.project.id,
      title: "Dependency waits",
      initialPrompt: "Fixture",
      teamSnapshot: fakeTeamSnapshot,
      limits: {
        ...fakeTeamSnapshot.preset.limits,
        maxTotalWorkerLaunchesPerRun: maxLaunches,
        maxConcurrentWriters: 1,
      },
    },
    "dependency-run",
  );
  const profileId = fakeTeamSnapshot.profiles.find(
    (p) => p.permission === "workspace_write",
  )?.id;
  assert.ok(profileId);
  const create = (title: string, dependencyIds: string[] = []) =>
    f.store.createTask(
      { runId: run.id, title, objective: title, dependencyIds },
      title.replaceAll(" ", "-"),
    );
  const scheduler = () => new Scheduling(f.store, f.directory);
  const assign = (id: string, key = `assign:${id}`) =>
    scheduler().enqueue(
      { role: "owner" },
      { taskId: id, profileId, scenario: "failure" },
      key,
    );
  return {
    ...f,
    get store() {
      return f.store;
    },
    run,
    profileId,
    create,
    scheduler,
    assign,
  };
}

test("human waits hold dependency chains and diamonds while unrelated assignments reserve normally", async () => {
  const f = await fixture();
  try {
    const root = f.create("Root");
    const left = f.create("Left", [root.id]);
    const right = f.create("Right", [root.id]);
    const leaf = f.create("Leaf", [left.id, right.id]);
    const backlog = f.create("Unpromoted", [root.id]);
    const unrelated = f.create("Unrelated");
    const queued = [left, right, leaf].map((t) => f.assign(t.id));
    const other = f.assign(unrelated.id);
    const request = f.store.createHumanRequest(
      {
        runId: f.run.id,
        affectedTaskIds: [root.id],
        type: "environment",
        urgency: "high",
        reason: "Needs setup",
        suggestedAction: "Check fixture",
        blocking: true,
      },
      "human-wait",
    );
    assert.equal(f.store.getTask(root.id).status, "WAITING_HUMAN");
    for (const task of [left, right, leaf])
      assert.equal(f.store.getTask(task.id).status, "WAITING_DEPENDENCY");
    assert.equal(f.store.getTask(backlog.id).status, "BACKLOG");
    for (const dispatch of queued)
      assert.equal(f.scheduler().reserve(dispatch), null);
    assert.equal(f.store.listAttempts().length, 0);
    assert.ok(f.scheduler().reserve(other));
    f.store.updateHumanRequest(
      { id: request.id, expectedStatus: "open", status: "deferred" },
      "defer",
    );
    f.store.updateHumanRequest(
      { id: request.id, expectedStatus: "deferred", status: "completed" },
      "complete",
    );
    assert.equal(f.store.getTask(root.id).status, "WAITING_HUMAN");
    assert.equal(f.store.getTask(left.id).status, "WAITING_DEPENDENCY");
    finish(f.store, root.id);
    assert.equal(f.store.getTask(left.id).status, "QUEUED");
    assert.equal(f.store.getTask(right.id).status, "QUEUED");
    assert.equal(f.store.getTask(leaf.id).status, "WAITING_DEPENDENCY");
    for (const task of [left, right]) {
      transition(f.store, task.id, "RUNNING");
      for (const status of [
        "AWAITING_REVIEW",
        "READY_TO_INTEGRATE",
        "INTEGRATING",
        "DONE",
      ] as const)
        transition(f.store, task.id, status);
      assert.equal(
        f.store.getTask(leaf.id).status,
        task.id === right.id ? "QUEUED" : "WAITING_DEPENDENCY",
      );
    }
    assert.equal(f.store.getTask(backlog.id).status, "BACKLOG");
  } finally {
    await f.close();
  }
});

test("dependency release preserves queue identity, pins and launch budget and rechecks mode and quotas", async () => {
  const f = await fixture(2);
  try {
    const root = f.create("Root");
    const child = f.create("Child", [root.id]);
    const first = f.assign(child.id);
    assert.equal(f.store.getTask(child.id).status, "WAITING_DEPENDENCY");
    assert.equal(f.scheduler().reserve(first), null);
    assert.equal(f.assign(child.id, "reassign").sequence, first.sequence);
    const unrelated = f.create("Other");
    const other = f.assign(unrelated.id);
    assert.equal(f.scheduler().committedLaunches(f.run.id), 2);
    const extra = f.create("Extra");
    assert.throws(() => f.assign(extra.id), { code: "BUDGET_EXCEEDED" });
    const active = f.scheduler().reserve(other);
    assert.ok(active);
    finish(f.store, root.id);
    assert.deepEqual(
      f
        .scheduler()
        .list()
        .find((d) => d.taskId === child.id),
      first,
    );
    assert.equal(f.store.getTask(child.id).ownerPinned, true);
    assert.equal(f.store.getTask(child.id).assignedProfileId, f.profileId);
    assert.equal(f.scheduler().reserve(first), null);
    f.scheduler().release(other);
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
    assert.equal(f.scheduler().reserve(first), null);
    f.store.updateRun(
      { id: f.run.id, status: "active", mode: "chat_plan" },
      "plan",
    );
    assert.equal(f.scheduler().reserve(first), null);
    f.store.updateRun({ id: f.run.id, mode: "autonomous_bounded" }, "execute");
    const attempt = f.scheduler().reserve(first);
    assert.ok(attempt);
    assert.equal(f.scheduler().reserve(first), attempt);
    assert.equal(f.store.listAttempts().length, 2);
    assert.equal(f.scheduler().committedLaunches(f.run.id), 2);
  } finally {
    await f.close();
  }
});

test("storage refuses dependency bypasses and preserves direct human waits, cancelled tasks and recovery decisions", async () => {
  const f = await fixture();
  try {
    const root = f.create("Root");
    const child = f.create("Child", [root.id]);
    f.assign(child.id);
    for (const status of ["READY", "QUEUED", "RUNNING"] as const)
      assert.throws(() => transition(f.store, child.id, status));
    assert.throws(
      () =>
        f.store.createAttempt(
          {
            taskId: child.id,
            adapter: "fake",
            intendedOperation: "Bypass",
            cwd: f.directory,
          },
          "bypass",
        ),
      { code: "CONFLICT" },
    );
    // The prerequisite check also protects older records with eligible labels.
    for (const [from, to] of [
      ["READY", "QUEUED"],
      ["QUEUED", "RUNNING"],
    ] as const) {
      f.store.db
        .prepare("UPDATE tasks SET data=json_set(data,'$.status',?) WHERE id=?")
        .run(from, child.id);
      assert.throws(
        () =>
          f.store.transitionTask(
            {
              id: child.id,
              expectedStatus: from,
              status: to,
              reason: "Legacy bypass",
            },
            `bypass:${to}`,
          ),
        { code: "CONFLICT" },
      );
      assert.throws(
        () =>
          f.store.createAttempt(
            {
              taskId: child.id,
              adapter: "fake",
              intendedOperation: "Legacy bypass",
              cwd: f.directory,
            },
            `attempt:${from}`,
          ),
        { code: "CONFLICT" },
      );
    }
    reconcileDependencyWaits(f.store, "repair-legacy-label");
    const direct = f.create("Direct wait", [root.id]);
    f.assign(direct.id);
    const request = f.store.createHumanRequest(
      {
        runId: f.run.id,
        affectedTaskIds: [direct.id],
        type: "clarification",
        reason: "Owner decision",
        suggestedAction: "Answer",
        blocking: true,
      },
      "direct-wait",
    );
    const cancelled = f.create("Cancelled", [root.id]);
    f.assign(cancelled.id);
    transition(f.store, cancelled.id, "CANCELLED");
    const recovery = f.create("Recovery", [root.id]);
    f.assign(recovery.id);
    // An older database may contain an ambiguous attempt with a pending label.
    f.store.db
      .prepare(
        "UPDATE tasks SET data=json_set(data,'$.status','RETRY_DECISION') WHERE id=?",
      )
      .run(recovery.id);
    finish(f.store, root.id);
    f.store.updateHumanRequest(
      {
        id: request.id,
        expectedStatus: "open",
        status: "answered",
        ownerResponse: "Verify first",
      },
      "answer",
    );
    assert.equal(f.store.getTask(direct.id).status, "WAITING_HUMAN");
    assert.equal(f.store.getTask(cancelled.id).status, "CANCELLED");
    assert.equal(f.store.getTask(recovery.id).status, "RETRY_DECISION");
    assert.equal(f.store.listAttempts().length, 0);
  } finally {
    await f.close();
  }
});

test("dependency transitions and their triggering completion roll back together on a journal failure", async () => {
  const f = await fixture();
  try {
    const root = f.create("Root");
    const child = f.create("Child", [root.id]);
    f.assign(child.id);
    for (const status of [
      "READY",
      "QUEUED",
      "RUNNING",
      "AWAITING_REVIEW",
      "READY_TO_INTEGRATE",
      "INTEGRATING",
    ] as const)
      transition(f.store, root.id, status);
    const tasks = f.store.listTasks();
    const events = f.store.events({ limit: 500 });
    f.store.db.exec(`CREATE TRIGGER fail_dependency_event BEFORE INSERT ON events
      WHEN NEW.type='task.transitioned' AND json_extract(NEW.payload,'$.from')='WAITING_DEPENDENCY'
      BEGIN SELECT RAISE(ABORT,'fixture'); END;`);
    assert.throws(() => transition(f.store, root.id, "DONE"), {
      code: "STORAGE",
    });
    assert.deepEqual(f.store.listTasks(), tasks);
    assert.deepEqual(f.store.events({ limit: 500 }), events);
    f.store.db.exec("DROP TRIGGER fail_dependency_event");
    transition(f.store, root.id, "DONE");
    assert.equal(f.store.getTask(child.id).status, "QUEUED");
    const after = f.store.events({ limit: 500 });
    reconcileDependencyWaits(f.store, "repeat");
    assert.deepEqual(f.store.events({ limit: 500 }), after);
  } finally {
    await f.close();
  }
});

test("restart repairs legacy queued waits without dispatching or replaying an ambiguous prerequisite", async () => {
  const f = await fixture();
  try {
    const root = f.create("Root");
    const child = f.create("Child", [root.id]);
    const rootDispatch = f.assign(root.id);
    const attempt = f.scheduler().reserve(rootDispatch);
    assert.ok(attempt);
    const queued = f.assign(child.id);
    f.store.db
      .prepare(
        "UPDATE tasks SET data=json_set(data,'$.status','QUEUED') WHERE id=?",
      )
      .run(child.id);
    f.reopen().recoverInterrupted();
    assert.equal(f.store.getTask(root.id).status, "RETRY_DECISION");
    assert.equal(f.store.getAttempt(attempt).status, "RECOVERY_REQUIRED");
    assert.equal(f.store.getTask(child.id).status, "WAITING_DEPENDENCY");
    assert.deepEqual(
      f
        .scheduler()
        .list()
        .find((d) => d.taskId === child.id),
      queued,
    );
    assert.equal(f.scheduler().reserve(queued), null);
    const events = f.store.events({ limit: 500 });
    f.reopen().recoverInterrupted();
    assert.deepEqual(f.store.events({ limit: 500 }), events);
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});

test("an unfinished legacy dependency wait requires recovery before a fresh assignment can wait and launch", async () => {
  const f = await fixture();
  try {
    const root = f.create("Root");
    const child = f.create("Legacy");
    const first = f.assign(child.id);
    const attempt = f.scheduler().reserve(first);
    assert.ok(attempt);
    assert.throws(() => transition(f.store, child.id, "WAITING_DEPENDENCY"), {
      code: "CONFLICT",
    });
    // Reproduce a pre-guard database whose wait still owned an active attempt.
    f.store.db
      .prepare(
        "UPDATE tasks SET data=json_set(data,'$.status','WAITING_DEPENDENCY','$.dependencyIds',json(?)) WHERE id=?",
      )
      .run(JSON.stringify([root.id]), child.id);
    f.store.db
      .prepare("INSERT INTO task_dependencies VALUES (?,?)")
      .run(child.id, root.id);
    f.reopen().recoverInterrupted();
    assert.equal(f.store.getTask(child.id).status, "RETRY_DECISION");
    assert.equal(f.store.getAttempt(attempt).status, "RECOVERY_REQUIRED");
    assert.equal(f.scheduler().reserve(first), null);
    assert.throws(() => f.assign(child.id, "before-decision"), {
      code: "CONFLICT",
    });
    transition(f.store, child.id, "READY");
    assert.equal(f.store.getTask(child.id).status, "WAITING_DEPENDENCY");
    const next = f.assign(child.id, "after-decision");
    assert.ok(next.sequence > first.sequence);
    finish(f.store, root.id);
    assert.equal(f.store.getTask(child.id).status, "QUEUED");
    assert.equal(f.scheduler().reserve(first), null);
    const fresh = f.scheduler().reserve(next);
    assert.ok(fresh);
    assert.notEqual(fresh, attempt);
    assert.equal(f.store.listAttempts().length, 2);
  } finally {
    await f.close();
  }
});

test("unassigned ready tasks wait without acquiring an assignment; cancelled prerequisites do not satisfy them", async () => {
  const f = await fixture();
  try {
    const root = f.create("Root");
    const child = f.create("Ready", [root.id]);
    transition(f.store, child.id, "READY");
    assert.equal(f.store.getTask(child.id).status, "WAITING_DEPENDENCY");
    assert.deepEqual(f.scheduler().list(), []);
    const other = f.create("Other root");
    const independent = f.create("Independent ready", [other.id]);
    transition(f.store, independent.id, "READY");
    transition(f.store, root.id, "CANCELLED");
    finish(f.store, other.id);
    assert.equal(f.store.getTask(child.id).status, "WAITING_DEPENDENCY");
    assert.equal(f.store.getTask(independent.id).status, "READY");
    assert.equal(f.store.getTask(independent.id).assignedProfileId, null);
    assert.deepEqual(f.scheduler().list(), []);
    assert.deepEqual(f.store.listAttempts(), []);
  } finally {
    await f.close();
  }
});
