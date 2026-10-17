import assert from "node:assert/strict";
import { test } from "node:test";
import { admitBudgetWaits } from "../src/server/storage/budget-waits.ts";
import { getWorkflowRun } from "../src/server/storage/workflows.ts";
import { defaultLimits } from "../src/shared/domain/entities.ts";
import {
  readerId,
  synthId,
  workflowSchedulingFixture,
} from "./helpers/workflow-scheduling-fixture.ts";

test("an over-budget stage retains every child in the scheduler, launches only the funded prefix and never reruns it after restart", async () => {
  const f = await workflowSchedulingFixture({
    ...defaultLimits,
    maxTotalWorkerLaunchesPerRun: 1,
  });
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const readers = workflow.stages[0]?.taskIds ?? [];
    assert.deepEqual(
      readers.map((id) => f.store.getTask(id).status),
      ["QUEUED", "QUEUED"],
    );
    const dispatches = f.engine.scheduling
      .list()
      .filter((dispatch) => readers.includes(dispatch.taskId));
    assert.equal(dispatches.length, 2);
    assert.deepEqual(
      dispatches.map((dispatch) => dispatch.state),
      ["queued", "blocked"],
    );
    assert.equal(dispatches[1]?.blockedReason, "launch_budget");
    assert.equal(dispatches[1]?.attemptId, null);
    assert.equal(f.store.listAttempts().length, 0);
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 1);
    await f.engine.idle();
    assert.equal(f.store.getTask(readers[0] ?? "").status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(readers[1] ?? "").status, "QUEUED");
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "blocked");
    const attempts = f.store.listAttempts();
    assert.equal(attempts.length, 1);
    const ordinary = f.engine.createTask(
      {
        runId: f.run.id,
        title: "Ordinary over budget",
        objective: "Do not dispatch",
      },
      "ordinary",
    );
    assert.throws(
      () =>
        f.engine.scheduling.enqueue(
          { role: "owner" },
          { taskId: ordinary.id, profileId: readerId },
          "ordinary-assign",
        ),
      { code: "BUDGET_EXCEEDED" },
    );
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(f.store.listAttempts(), attempts);
    const held = f.engine.scheduling
      .list()
      .find((dispatch) => dispatch.taskId === readers[1]);
    assert.equal(held?.state, "blocked");
    assert.equal(held?.blockedReason, "launch_budget");
    assert.equal(held?.sequence, dispatches[1]?.sequence);
    assert.deepEqual(f.engine.workflows.start(f.input, "start"), workflow);
  } finally {
    await f.close();
  }
});

test("synthesis itself consumes a launch and stays durably budget-held when only the readers fit", async () => {
  const f = await workflowSchedulingFixture({
    ...defaultLimits,
    maxTotalWorkerLaunchesPerRun: 2,
  });
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.idle();
    const readers = workflow.stages[0]?.taskIds ?? [];
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    assert.ok(
      readers.every((id) => f.store.getTask(id).status === "AWAITING_REVIEW"),
    );
    const held = f.engine.scheduling
      .list()
      .find((dispatch) => dispatch.taskId === synthesis);
    assert.equal(held?.blockedReason, "launch_budget");
    assert.equal(held?.attemptId, null);
    assert.equal(f.store.getTask(synthesis).status, "QUEUED");
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 2);
    assert.equal(f.store.listAttempts().length, 2);
    const packet = JSON.parse(
      f.store.getTask(synthesis).objective.split("\n\n").at(-1) ?? "",
    );
    assert.deepEqual(
      packet.upstream.map((source: { taskId: string }) => source.taskId),
      readers,
    );
    await f.restart();
    await f.engine.idle();
    assert.equal(f.store.listAttempts().length, 2);
    assert.equal(
      f.engine.scheduling
        .list()
        .find((dispatch) => dispatch.taskId === synthesis)?.sequence,
      held?.sequence,
    );
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "blocked");
  } finally {
    await f.close();
  }
});

test("cancelling an unstarted commitment admits budget-held children by priority then FIFO, preserving owner reassignment and queue generation", async () => {
  const f = await workflowSchedulingFixture(
    { ...defaultLimits, maxTotalWorkerLaunchesPerRun: 1 },
    3,
  );
  try {
    const ordinary = f.engine.createTask(
      {
        runId: f.run.id,
        title: "Owner reservation",
        objective: "Hold one launch",
      },
      "ordinary",
    );
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: ordinary.id, profileId: readerId },
      "ordinary-queue",
    );
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
    const readers = workflow.stages[0]?.taskIds ?? [];
    assert.equal(
      f.engine.scheduling
        .list()
        .filter((dispatch) => dispatch.blockedReason === "launch_budget")
        .length,
      3,
    );
    const chosen = readers[2] ?? "";
    f.store.updateRun({ id: f.run.id, status: "active" }, "resume");
    f.engine.updateTask({ id: chosen, priority: 10 }, "priority");
    const queued = f.engine.scheduling
      .list()
      .find((dispatch) => dispatch.taskId === chosen);
    const override = f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: chosen, profileId: synthId },
      "owner-override",
    );
    assert.equal(override.sequence, queued?.sequence);
    f.engine.cancel(ordinary.id, "cancel-owner-reservation");
    admitBudgetWaits(f.store, f.engine.scheduling);
    const admitted = f.engine.scheduling
      .list()
      .find((dispatch) => dispatch.taskId === chosen);
    assert.equal(admitted?.state, "queued");
    assert.equal(admitted?.sequence, queued?.sequence);
    assert.equal(admitted?.profileId, synthId);
    assert.equal(f.store.getTask(chosen).ownerPinned, true);
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 1);
    assert.equal(f.store.listAttempts().length, 0);
    f.engine.cancel(chosen, "cancel-priority");
    admitBudgetWaits(f.store, f.engine.scheduling);
    assert.equal(
      f.engine.scheduling
        .list()
        .find((dispatch) => dispatch.taskId === readers[0])?.state,
      "queued",
    );
    assert.equal(
      f.engine.scheduling
        .list()
        .find((dispatch) => dispatch.taskId === readers[1])?.blockedReason,
      "launch_budget",
    );
    const admittedFirst = f.engine.scheduling
      .list()
      .find((dispatch) => dispatch.taskId === readers[0]);
    assert.ok(admittedFirst);
    const attempt = f.engine.scheduling.reserve(admittedFirst);
    assert.ok(attempt);
    f.engine.scheduling.release(admittedFirst);
    admitBudgetWaits(f.store, f.engine.scheduling);
    // Releasing an execution slot never refunds its already-spawned attempt.
    assert.equal(
      f.engine.scheduling
        .list()
        .find((dispatch) => dispatch.taskId === readers[1])?.blockedReason,
      "launch_budget",
    );
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 1);
    f.store.updateRun({ id: f.run.id, status: "paused" }, "end-pause");
  } finally {
    await f.close();
  }
});

test("budget admission respects pause, Chat/Plan and human holds while allowing an unrelated child to acquire a freed commitment", async () => {
  const f = await workflowSchedulingFixture({
    ...defaultLimits,
    maxTotalWorkerLaunchesPerRun: 1,
  });
  try {
    const ordinary = f.engine.createTask(
      { runId: f.run.id, title: "Reserved", objective: "Hold" },
      "ordinary",
    );
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: ordinary.id, profileId: readerId },
      "reserve",
    );
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const [blocked = "", other = ""] = workflow.stages[0]?.taskIds ?? [];
    const request = f.store.createHumanRequest(
      {
        runId: f.run.id,
        affectedTaskIds: [blocked],
        type: "clarification",
        urgency: "normal",
        reason: "Owner choice needed",
        suggestedAction: "Answer before continuing",
        blocking: true,
      },
      "human",
    );
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
    f.engine.cancel(ordinary.id, "cancel");
    admitBudgetWaits(f.store, f.engine.scheduling);
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 0);
    f.store.updateRun(
      { id: f.run.id, status: "active", mode: "chat_plan" },
      "chat",
    );
    admitBudgetWaits(f.store, f.engine.scheduling);
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 0);
    f.store.updateRun(
      { id: f.run.id, mode: "autonomous_bounded" },
      "autonomous",
    );
    admitBudgetWaits(f.store, f.engine.scheduling);
    assert.equal(
      f.engine.scheduling.list().find((dispatch) => dispatch.taskId === blocked)
        ?.blockedReason,
      "launch_budget",
    );
    assert.equal(
      f.engine.scheduling.list().find((dispatch) => dispatch.taskId === other)
        ?.state,
      "queued",
    );
    f.store.updateHumanRequest(
      {
        id: request.id,
        expectedStatus: "open",
        status: "answered",
        ownerResponse: "Use the declared scope",
      },
      "answer",
    );
    f.engine.cancel(other, "cancel-other");
    admitBudgetWaits(f.store, f.engine.scheduling);
    assert.equal(f.store.getTask(blocked).status, "WAITING_HUMAN");
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 0);
    const continued = f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: blocked, profileId: readerId },
      "owner-continue",
    );
    assert.equal(continued.state, "queued");
    assert.ok(f.engine.scheduling.reserve(continued));
    f.store.updateRun({ id: f.run.id, status: "paused" }, "end-pause");
  } finally {
    await f.close();
  }
});

test("failed workflow attempts stay charged and an explicit retry gets a new generation only when another unstarted commitment is freed", async () => {
  const f = await workflowSchedulingFixture({
    ...defaultLimits,
    maxTotalWorkerLaunchesPerRun: 2,
  });
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const [first = "", other = ""] = workflow.stages[0]?.taskIds ?? [];
    const original = f.engine.scheduling
      .list()
      .find((dispatch) => dispatch.taskId === first);
    assert.ok(original);
    const failedAttempt = f.engine.scheduling.reserve(original);
    assert.ok(failedAttempt);
    f.engine.fail(first, failedAttempt, "Confirmed FAKE failure");
    f.engine.scheduling.release(original);
    f.store.transitionTask(
      {
        id: first,
        expectedStatus: "RETRY_DECISION",
        status: "READY",
        reason: "Explicit owner retry after inspecting failure",
      },
      "decision",
    );
    const retry = f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: first, profileId: readerId, contextPolicy: "fresh" },
      "retry",
    );
    assert.equal(retry.blockedReason, "launch_budget");
    assert.ok(retry.sequence > original.sequence);
    assert.equal(f.engine.scheduling.reserve(original), null);
    assert.equal(f.store.listAttempts().length, 1);
    f.engine.cancel(other, "cancel-unstarted");
    admitBudgetWaits(f.store, f.engine.scheduling);
    const admitted = f.engine.scheduling
      .list()
      .find((dispatch) => dispatch.taskId === first);
    assert.ok(admitted);
    const secondAttempt = f.engine.scheduling.reserve(admitted);
    assert.ok(secondAttempt);
    assert.notEqual(secondAttempt, failedAttempt);
    assert.equal(f.store.getAttempt(failedAttempt).status, "failed");
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 2);
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
  } finally {
    await f.close();
  }
});

test("budget hold and admission journal failures roll back their queue changes and keep the same decisions retryable", async () => {
  const f = await workflowSchedulingFixture({
    ...defaultLimits,
    maxTotalWorkerLaunchesPerRun: 1,
  });
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    f.store.db.exec(
      "CREATE TRIGGER refuse_budget_hold BEFORE INSERT ON events WHEN NEW.type='dispatch.budget_held' BEGIN SELECT RAISE(ABORT, 'fixture hold failure'); END;",
    );
    await assert.rejects(f.engine.workflows.reconcile(), { code: "STORAGE" });
    assert.equal(f.engine.scheduling.list().length, 0);
    assert.ok(
      (workflow.stages[0]?.taskIds ?? []).every(
        (id) => f.store.getTask(id).status === "BACKLOG",
      ),
    );
    f.store.db.exec("DROP TRIGGER refuse_budget_hold");
    await f.engine.workflows.reconcile();
    const [funded = "", held = ""] = workflow.stages[0]?.taskIds ?? [];
    f.engine.cancel(funded, "cancel-funded");
    f.store.db.exec(
      "CREATE TRIGGER refuse_budget_admit BEFORE INSERT ON events WHEN NEW.type='dispatch.budget_admitted' BEGIN SELECT RAISE(ABORT, 'fixture admission failure'); END;",
    );
    assert.throws(() => admitBudgetWaits(f.store, f.engine.scheduling), {
      code: "STORAGE",
    });
    assert.equal(
      f.engine.scheduling.list().find((dispatch) => dispatch.taskId === held)
        ?.blockedReason,
      "launch_budget",
    );
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 0);
    f.store.db.exec("DROP TRIGGER refuse_budget_admit");
    admitBudgetWaits(f.store, f.engine.scheduling);
    assert.equal(
      f.engine.scheduling.list().find((dispatch) => dispatch.taskId === held)
        ?.state,
      "queued",
    );
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 1);
    assert.equal(f.store.listAttempts().length, 0);
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
  } finally {
    await f.close();
  }
});

test("upgrading a v8 queue preserves FIFO, idempotency and one launch per existing dispatch", async () => {
  const f = await workflowSchedulingFixture();
  try {
    const ordinary = f.engine.createTask(
      {
        runId: f.run.id,
        title: "Legacy queued task",
        objective: "Wait through upgrade",
      },
      "legacy",
    );
    const input = { taskId: ordinary.id, profileId: readerId };
    const queued = f.engine.scheduling.enqueue(
      { role: "owner" },
      input,
      "legacy-queue",
    );
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
    f.store.db.exec(
      "ALTER TABLE dispatches DROP COLUMN blocked_reason; UPDATE mutations SET result=json_remove(result,'$.blockedReason') WHERE key='legacy-queue'; PRAGMA user_version=8;",
    );
    await f.restart();
    const migrated = f.engine.scheduling
      .list()
      .find((dispatch) => dispatch.taskId === ordinary.id);
    assert.equal(migrated?.blockedReason, null);
    assert.equal(migrated?.sequence, queued.sequence);
    assert.deepEqual(
      f.engine.scheduling.enqueue({ role: "owner" }, input, "legacy-queue"),
      queued,
    );
    f.store.updateRun({ id: f.run.id, status: "active" }, "resume");
    assert.ok(migrated);
    const attempt = f.engine.scheduling.reserve(migrated);
    assert.ok(attempt);
    assert.equal(f.engine.scheduling.reserve(migrated), attempt);
    assert.equal(f.store.listAttempts().length, 1);
    f.store.updateRun({ id: f.run.id, status: "paused" }, "end-pause");
  } finally {
    await f.close();
  }
});

test("freeing budget never re-admits a repository-blocked child as though it were an unlaunched budget wait", async () => {
  const f = await workflowSchedulingFixture({
    ...defaultLimits,
    maxTotalWorkerLaunchesPerRun: 1,
  });
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
    const [blocked = "", waiting = ""] = workflow.stages[0]?.taskIds ?? [];
    const dispatch = f.engine.scheduling
      .list()
      .find((row) => row.taskId === blocked);
    assert.ok(dispatch);
    f.engine.scheduling.block(
      dispatch,
      "Repository identity needs owner inspection",
    );
    const quarantined = f.engine.scheduling
      .list()
      .find((row) => row.taskId === blocked);
    assert.equal(quarantined?.blockedReason, null);
    f.store.updateRun({ id: f.run.id, status: "active" }, "resume");
    admitBudgetWaits(f.store, f.engine.scheduling);
    assert.deepEqual(
      f.engine.scheduling.list().find((row) => row.taskId === blocked),
      quarantined,
    );
    assert.equal(f.engine.scheduling.reserve(dispatch), null);
    assert.equal(
      f.engine.scheduling.list().find((row) => row.taskId === waiting)?.state,
      "queued",
    );
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 1);
    f.store.updateRun({ id: f.run.id, status: "paused" }, "end-pause");
    await f.restart();
    assert.deepEqual(
      f.engine.scheduling.list().find((row) => row.taskId === blocked),
      quarantined,
    );
    assert.equal(f.store.listAttempts().length, 0);
  } finally {
    await f.close();
  }
});
