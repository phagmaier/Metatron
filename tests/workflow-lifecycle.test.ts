import assert from "node:assert/strict";
import { test } from "node:test";
import { executeFakeTurn } from "../src/server/orchestration/execute.ts";
import {
  decideRecovery,
  recheckRecovery,
} from "../src/server/orchestration/recovery-decisions.ts";
import { getWorkflowRun } from "../src/server/storage/workflows.ts";
import { defaultLimits } from "../src/shared/domain/entities.ts";
import {
  readerId,
  synthId,
  workflowSchedulingFixture,
} from "./helpers/workflow-scheduling-fixture.ts";

for (const funding of ["funded", "budget-admitted"] as const) {
  test(`the pump waits for an owner-approved ${funding} retry instead of consuming its historical failure`, async (context) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const f = await workflowSchedulingFixture({
      ...defaultLimits,
      maxTotalWorkerLaunchesPerRun: funding === "funded" ? 4 : 2,
    });
    try {
      const workflow = f.engine.workflows.start(f.input, "start");
      await f.engine.workflows.reconcile();
      const [child = "", sibling = ""] = workflow.stages[0]?.taskIds ?? [];
      const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
      const original = f.engine.scheduling
        .list()
        .find((d) => d.taskId === child);
      assert.ok(original);
      const failed = f.engine.scheduling.reserve(original);
      assert.ok(failed);
      f.engine.fail(child, failed, "Confirmed FAKE reader failure");
      f.engine.scheduling.release(original);
      const check = await recheckRecovery(f.engine, { taskId: child }, "check");
      const retry = await decideRecovery(
        f.engine,
        {
          taskId: child,
          checkId: check.id,
          profileId: synthId,
          contextPolicy: "fresh",
          acceptUnverified: true,
        },
        "owner-retry",
      );
      assert.equal(retry.state, funding === "funded" ? "queued" : "blocked");
      assert.ok(retry.sequence > original.sequence);
      assert.equal(retry.attemptId, null);
      f.engine.cancel(sibling, "cancel-unstarted-sibling");
      await f.engine.pump();
      assert.equal(
        getWorkflowRun(f.store, workflow.id).stages[0]?.status,
        "queued",
      );
      assert.equal(f.store.getTask(synthesis).status, "BACKLOG");
      assert.equal(f.store.getTask(child).status, "RUNNING");
      await f.engine.idle();
      const attempts = f.store.listAttempts().filter((a) => a.taskId === child);
      assert.deepEqual(
        attempts.map((a) => a.status),
        ["failed", "completed"],
      );
      assert.equal(attempts[1]?.profileId, synthId);
      assert.equal(f.store.getTask(child).ownerPinned, true);
      assert.equal(
        f.engine.scheduling.list().find((d) => d.taskId === child)?.sequence,
        retry.sequence,
      );
      assert.equal(f.engine.scheduling.reserve(original), null);
      assert.equal(
        f.engine.scheduling.committedLaunches(f.run.id),
        funding === "funded" ? 3 : 2,
      );
      const result = getWorkflowRun(f.store, workflow.id);
      assert.equal(result.stages[0]?.status, "partial");
      if (funding === "funded") {
        assert.equal(f.store.getTask(synthesis).status, "AWAITING_REVIEW");
        const packet = JSON.parse(
          f.store.getTask(synthesis).objective.split("\n\n").at(-1) ?? "",
        );
        const report = (await f.engine.reports(child)).find(
          (r) =>
            r.artifact.attemptId === attempts[1]?.id &&
            r.artifact.kind === "report",
        );
        assert.ok(report);
        assert.equal(packet.upstream[0].artifactId, report.artifact.id);
        assert.equal(packet.upstream[0].status, "completed");
      } else {
        assert.equal(
          f.engine.scheduling.list().find((d) => d.taskId === synthesis)
            ?.blockedReason,
          "launch_budget",
        );
        assert.equal(f.store.listAttempts().length, 2);
      }
    } finally {
      await f.close();
    }
  });
}

for (const prior of ["completed", "interrupted"] as const) {
  test(`cancelling a reader with a ${prior} attempt waits for release then follows include_partial`, async (context) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const f = await workflowSchedulingFixture();
    try {
      const workflow = f.engine.workflows.start(f.input, "start");
      await f.engine.workflows.reconcile();
      const child = workflow.stages[0]?.taskIds[0] ?? "";
      const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
      const dispatch = f.engine.scheduling
        .list()
        .find((d) => d.taskId === child);
      assert.ok(dispatch);
      const attempt = f.engine.scheduling.reserve(dispatch);
      assert.ok(attempt);
      if (prior === "completed")
        await executeFakeTurn(f.engine, dispatch, attempt);
      else
        f.engine.fail(
          child,
          attempt,
          "Ambiguous FAKE disconnect",
          "disconnected",
        );
      f.engine.cancel(child, "owner-cancel");
      await f.engine.workflows.reconcile();
      assert.equal(
        getWorkflowRun(f.store, workflow.id).stages[0]?.status,
        "queued",
      );
      assert.equal(f.store.getTask(synthesis).status, "BACKLOG");
      assert.equal(
        f.store.db.prepare("SELECT COUNT(*) n FROM reservations").get()?.n,
        1,
      );
      f.engine.scheduling.release(dispatch);
      await f.engine.idle();
      assert.equal(f.store.getTask(child).status, "CANCELLED");
      assert.equal(f.store.getAttempt(attempt).status, prior);
      assert.equal(
        f.store.listAttempts().filter((a) => a.taskId === child).length,
        1,
      );
      assert.equal(getWorkflowRun(f.store, workflow.id).status, "partial");
      assert.equal(f.store.getTask(synthesis).status, "AWAITING_REVIEW");
      const packet = JSON.parse(
        f.store.getTask(synthesis).objective.split("\n\n").at(-1) ?? "",
      );
      assert.equal(packet.upstream[0].status, "failed");
      assert.equal(packet.upstream[0].artifactId, null);
      assert.equal(packet.upstream[0].excerpt, "");
      assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 3);
      if (prior === "completed")
        assert.equal(
          (await f.engine.reports(child)).filter(
            (r) => r.artifact.kind === "report",
          ).length,
          1,
        );
    } finally {
      await f.close();
    }
  });
}

test("cancelling during preparation preserves sibling dispatch and the declared partial result", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    const [cancelled = "", sibling = ""] = workflow.stages[0]?.taskIds ?? [];
    const preparing = f.engine.workflows.reconcile();
    f.engine.cancel(cancelled, "cancel-during-preparation");
    await preparing;
    assert.equal(f.store.getTask(cancelled).status, "CANCELLED");
    assert.equal(f.store.getTask(sibling).status, "QUEUED");
    assert.equal(
      f.engine.scheduling.list().some((d) => d.taskId === cancelled),
      false,
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(sibling).status, "AWAITING_REVIEW");
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "partial");
    assert.equal(
      f.store.listAttempts().some((a) => a.taskId === cancelled),
      false,
    );
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 2);
    const cancellation = f.store
      .events({ runId: f.run.id, limit: 500 })
      .find(
        (event) =>
          event.taskId === cancelled &&
          event.type === "task.transitioned" &&
          event.payload.to === "CANCELLED",
      );
    assert.ok(cancellation);
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    const source = f.engine.workflows
      .evidence(workflow.id)
      .children.find((child) => child.task.id === synthesis)?.handoff
      ?.sources[0];
    assert.equal(source?.failure, "cancelled");
    assert.equal(source?.attemptId, null);
    assert.equal(source?.artifactId, null);
    assert.equal(source?.failureEventId, cancellation.id);
    const packet = JSON.parse(
      f.store.getTask(synthesis).objective.split("\n\n").at(-1) ?? "",
    );
    assert.equal(packet.upstream[0].failure, "cancelled");
    assert.equal(packet.upstream[0].attemptId, null);
    assert.equal(packet.upstream[0].artifactId, null);
    assert.equal(packet.upstream[0].failureEventId, cancellation.id);
  } finally {
    await f.close();
  }
});

test("a preparation-time human hold survives journal rollback and restart until the owner explicitly continues", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    const [held = "", sibling = ""] = workflow.stages[0]?.taskIds ?? [];
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    const originalObjective = f.store.getTask(held).objective;
    const preparing = f.engine.workflows.reconcile();
    const request = f.store.createHumanRequest(
      {
        runId: f.run.id,
        affectedTaskIds: [held],
        type: "manual_check",
        reason: "Inspect the reader scope",
        suggestedAction: "Confirm the target",
        blocking: true,
      },
      "human-hold",
    );
    f.store.db.exec(
      "CREATE TRIGGER refuse_preparation BEFORE INSERT ON events WHEN NEW.type='task.assigned' BEGIN SELECT RAISE(ABORT, 'fixture preparation failure'); END;",
    );
    await assert.rejects(preparing, { code: "STORAGE" });
    assert.equal(
      getWorkflowRun(f.store, workflow.id).stages[0]?.status,
      "pending",
    );
    assert.equal(f.store.getTask(held).objective, originalObjective);
    assert.equal(f.store.getTask(held).status, "WAITING_HUMAN");
    assert.equal(f.engine.scheduling.list().length, 0);
    f.store.db.exec("DROP TRIGGER refuse_preparation");
    await f.engine.workflows.reconcile();
    const preparedObjective = f.store.getTask(held).objective;
    assert.notEqual(preparedObjective, originalObjective);
    assert.equal(f.store.getTask(held).status, "WAITING_HUMAN");
    assert.equal(f.store.getTask(sibling).status, "QUEUED");
    assert.equal(
      f.engine.scheduling.list().some((d) => d.taskId === held),
      false,
    );
    assert.throws(
      () =>
        f.engine.scheduling.enqueue(
          { role: "owner" },
          { taskId: held, profileId: readerId },
          "blocked-continue",
        ),
      { code: "CONFLICT" },
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(sibling).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(synthesis).status, "BACKLOG");
    f.store.updateHumanRequest(
      {
        id: request.id,
        expectedStatus: "open",
        status: "completed",
        ownerResponse: "Scope confirmed",
      },
      "resolve",
    );
    await f.restart();
    await f.engine.idle();
    assert.equal(f.store.getTask(held).status, "WAITING_HUMAN");
    assert.equal(f.store.listAttempts().length, 1);
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: held, profileId: synthId },
      "owner-continue",
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(held).objective, preparedObjective);
    assert.equal(f.store.getTask(held).assignedProfileId, synthId);
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "completed");
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 3);
  } finally {
    await f.close();
  }
});

test("resolving a downstream human hold cannot bypass unprepared workflow prerequisites", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    const request = f.store.createHumanRequest(
      {
        runId: f.run.id,
        affectedTaskIds: [synthesis],
        type: "manual_check",
        reason: "Inspect synthesis scope",
        suggestedAction: "Confirm the target",
        blocking: true,
      },
      "hold-synthesis",
    );
    f.store.updateHumanRequest(
      {
        id: request.id,
        expectedStatus: "open",
        status: "completed",
        ownerResponse: "Confirmed",
      },
      "resolve",
    );
    assert.throws(
      () =>
        f.engine.scheduling.enqueue(
          { role: "owner" },
          { taskId: synthesis, profileId: synthId },
          "early-continue",
        ),
      { code: "POLICY_DENIED" },
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(synthesis).status, "WAITING_HUMAN");
    assert.equal(f.store.listAttempts().length, 2);
    assert.equal(
      getWorkflowRun(f.store, workflow.id).stages[1]?.status,
      "queued",
    );
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: synthesis, profileId: synthId },
      "owner-continue",
    );
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "completed");
    assert.equal(f.store.listAttempts().length, 3);
  } finally {
    await f.close();
  }
});
