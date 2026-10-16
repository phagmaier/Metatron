import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "../src/server/orchestration/engine.ts";
import { Scheduling } from "../src/server/storage/scheduling.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

test("restart reconciles completed journal-only revision children without replaying work or changing history", async () => {
  const f = await domainFixture();
  try {
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Legacy revisions",
        initialPrompt: "Simulation",
        teamSnapshot: fakeTeamSnapshot,
        limits: {
          ...fakeTeamSnapshot.preset.limits,
          maxRevisionCyclesPerTask: 1,
        },
      },
      "legacy-run",
    );
    const scheduler = new Scheduling(f.store, f.directory);
    function completed(key: string, parentTaskId: string | null = null) {
      const task = f.store.createTask(
        {
          runId: run.id,
          title: key,
          objective: "Simulated report",
          parentTaskId,
        },
        key,
      );
      const dispatch = scheduler.enqueue(
        { role: "owner" },
        {
          taskId: task.id,
          profileId: fakeTeamSnapshot.preset.workerProfileIds[0],
        },
        `${key}:queue`,
      );
      const attempt = scheduler.reserve(dispatch);
      assert.ok(attempt);
      f.store.updateAttempt(
        { id: attempt, status: "completed" },
        `${key}:completed`,
      );
      f.store.transitionTask(
        {
          id: task.id,
          expectedStatus: "RUNNING",
          status: "AWAITING_REVIEW",
          reason: "Legacy result ready",
        },
        `${key}:review`,
      );
      scheduler.release(dispatch);
      return task;
    }
    const umbrella = f.store.createTask(
      {
        runId: run.id,
        title: "Unrelated parent",
        objective: "Track the broader work",
      },
      "umbrella",
    );
    const original = completed("original", umbrella.id);
    f.store.transitionTask(
      {
        id: original.id,
        expectedStatus: "AWAITING_REVIEW",
        status: "CHANGES_REQUESTED",
        reason: "Legacy revision requested",
      },
      "changes",
    );
    const child = completed("child", original.id);
    f.store.recordEvent(
      {
        runId: run.id,
        taskId: original.id,
        type: "task.revision_requested",
        correlationId: "legacy-revision",
        payload: {
          rootTaskId: umbrella.id,
          revisionTaskId: child.id,
          cycle: 1,
          feedback: "Supply evidence",
        },
      },
      "legacy-link",
    );
    const attempts = f.store.listAttempts();
    f.reopen().recoverInterrupted();
    assert.equal(f.store.getTask(original.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(original.id).latestRevisionTaskId, child.id);
    assert.deepEqual(f.store.listAttempts(), attempts);
    assert.equal(f.store.getTask(umbrella.id).status, "BACKLOG");
    const engine = new Engine(f.store, f.directory);
    try {
      assert.throws(
        () =>
          engine.tool(
            { role: "owner" },
            run.id,
            {
              name: "request_revision",
              taskId: original.id,
              feedback:
                "Respect the earlier cycle despite legacy root metadata",
            },
            "over-budget",
          ),
        { code: "BUDGET_EXCEEDED" },
      );
    } finally {
      await engine.close();
    }
    const events = f.store.events({ limit: 500 });
    f.reopen().recoverInterrupted();
    assert.deepEqual(f.store.events({ limit: 500 }), events);
    assert.deepEqual(f.store.listAttempts(), attempts);
  } finally {
    await f.close();
  }
});
