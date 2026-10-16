import assert from "node:assert/strict";
import { test } from "node:test";
import { Worktrees } from "../src/server/git/worktrees.ts";
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
