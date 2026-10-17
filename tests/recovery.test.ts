import assert from "node:assert/strict";
import { test } from "node:test";
import { Worktrees } from "../src/server/git/worktrees.ts";
import { executeFakeTurn } from "../src/server/orchestration/execute.ts";
import {
  decideRecovery,
  recheckRecovery,
} from "../src/server/orchestration/recovery-decisions.ts";
import { stopRun } from "../src/server/orchestration/stops.ts";
import {
  readerId,
  workflowSchedulingFixture,
} from "./helpers/workflow-scheduling-fixture.ts";
import { worktreeFixture } from "./helpers/worktree-fixture.ts";

for (const failure of ["ABORT", "ROLLBACK"] as const) {
  test(`recovery cleanup is atomic and reusable after a SQLite ${failure}`, async () => {
    const f = await worktreeFixture();
    try {
      const queued = f.queue("interrupted");
      const trees = new Worktrees(f.store, f.data);
      await trees.prepare(queued.id);
      const { db } = f.store;
      const snapshot = () => ({
        worktrees: trees.list(),
        reservations: db.prepare("SELECT * FROM reservations").all(),
        dispatches: queued.scheduler.list(),
      });
      const before = snapshot();
      // Fail the final cleanup statement after worktree and reservation changes.
      db.exec(`CREATE TRIGGER fail_cleanup BEFORE UPDATE ON dispatches
        WHEN OLD.state='active' AND NEW.state='released'
        BEGIN SELECT RAISE(${failure}, 'injected cleanup failure'); END;`);

      assert.throws(
        () => f.store.recoverInterrupted(),
        /injected cleanup failure/,
      );
      assert.equal(db.isTransaction, false);
      assert.deepEqual(snapshot(), before);
      assert.equal(f.store.getAttempt(queued.id).status, "RECOVERY_REQUIRED");
      assert.equal(f.store.getTask(queued.task.id).status, "RETRY_DECISION");
      const events = f.store.events();

      db.exec("DROP TRIGGER fail_cleanup");
      f.store.recoverInterrupted();
      assert.equal(db.isTransaction, false);
      assert.equal(trees.list()[0]?.state, "retained");
      assert.deepEqual(snapshot().reservations, []);
      assert.equal(queued.scheduler.list()[0]?.state, "released");
      assert.equal(f.store.listAttempts().length, 1);
      assert.deepEqual(f.store.events(), events);
      const recovered = snapshot();
      f.store.recoverInterrupted();
      assert.deepEqual(snapshot(), recovered);
    } finally {
      f.close();
    }
  });
}

for (const cause of ["failed", "interrupted"] as const) {
  test(`restart after ${cause} commits but before release permits only an explicit fresh retry`, async (context) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const f = await workflowSchedulingFixture();
    try {
      const task = f.engine.createTask(
        {
          runId: f.run.id,
          title: "FAKE terminal boundary",
          objective: "Disposable restart evidence",
        },
        "ordinary",
      );
      const dispatch = f.engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: task.id, profileId: readerId },
        "queue",
      );
      const attempt = f.engine.scheduling.reserve(dispatch);
      assert.ok(attempt);
      f.engine.fail(
        task.id,
        attempt,
        "Recorded before executor release",
        cause,
      );
      const terminal = f.store.getAttempt(attempt);
      await f.restart();
      const released = f.engine.scheduling
        .list()
        .find((d) => d.taskId === task.id);
      assert.equal(released?.state, "released");
      assert.equal(released?.attemptId, attempt);
      assert.equal(
        f.store.db.prepare("SELECT COUNT(*) n FROM reservations").get()?.n,
        0,
      );
      assert.deepEqual(f.store.getAttempt(attempt), terminal);
      assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
      const events = f.store.events({ runId: f.run.id, limit: 500 });
      f.store.recoverInterrupted();
      await f.engine.pump();
      assert.deepEqual(f.store.events({ runId: f.run.id, limit: 500 }), events);
      assert.equal(f.store.listAttempts().length, 1);
      assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 1);
      const check = await recheckRecovery(
        f.engine,
        { taskId: task.id },
        "owner-check",
      );
      const retry = await decideRecovery(
        f.engine,
        {
          taskId: task.id,
          checkId: check.id,
          profileId: readerId,
          contextPolicy: "fresh",
          acceptUnverified: true,
        },
        "owner-retry",
      );
      assert.ok(retry.sequence > dispatch.sequence);
      assert.equal(f.engine.scheduling.reserve(dispatch), null);
      assert.equal(f.engine.scheduling.release(dispatch), false);
      await f.engine.idle();
      assert.deepEqual(
        f.store.listAttempts().map((a) => a.status),
        [cause, "completed"],
      );
      assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 2);
      const attempts = f.store.listAttempts();
      await f.restart();
      await f.engine.idle();
      assert.deepEqual(f.store.listAttempts(), attempts);
    } finally {
      await f.close();
    }
  });
}

test("restart releases completed and cancelled dispatch bookkeeping without replaying or cancelling saved results", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const completed = f.engine.createTask(
      {
        runId: f.run.id,
        title: "FAKE saved result",
        objective: "Retain authoritative completion",
      },
      "completed-task",
    );
    const cancelled = f.engine.createTask(
      {
        runId: f.run.id,
        title: "FAKE cancelled result",
        objective: "Retain cancellation",
      },
      "cancelled-task",
    );
    for (const task of [completed, cancelled]) {
      const dispatch = f.engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: task.id, profileId: readerId },
        `queue:${task.id}`,
      );
      const attempt = f.engine.scheduling.reserve(dispatch);
      assert.ok(attempt);
      if (task.id === completed.id)
        await executeFakeTurn(f.engine, dispatch, attempt);
      else {
        f.engine.cancel(task.id, "owner-cancel");
        f.engine.fail(
          task.id,
          attempt,
          "Owner cancelled before release",
          "interrupted",
        );
      }
    }
    const attempts = f.store.listAttempts();
    await f.restart();
    assert.deepEqual(
      f.engine.scheduling.list().map((d) => d.state),
      ["released", "released"],
    );
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) n FROM reservations").get()?.n,
      0,
    );
    await f.engine.idle();
    assert.deepEqual(f.store.listAttempts(), attempts);
    assert.equal(f.store.getTask(completed.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(cancelled.id).status, "CANCELLED");
    assert.equal(
      (await f.engine.reports(completed.id)).filter(
        (r) => r.artifact.kind === "report",
      ).length,
      1,
    );
    stopRun(f.engine, { runId: f.run.id }, "stop-run");
    assert.equal(f.store.getTask(completed.id).status, "AWAITING_REVIEW");
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 2);
  } finally {
    await f.close();
  }
});
