import assert from "node:assert/strict";
import { test } from "node:test";
import { Scheduling } from "../src/server/storage/scheduling.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

const requestFields = {
  type: "environment" as const,
  urgency: "high" as const,
  reason: "A fixture dependency needs owner attention",
  suggestedAction: "Check the fixture dependency",
  blocking: true,
};

test("queued human waits cannot dispatch, including legacy links, while unrelated work reserves normally", async () => {
  const f = await domainFixture();
  try {
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Scheduled",
        initialPrompt: "Fixture",
        teamSnapshot: fakeTeamSnapshot,
      },
      "scheduled",
    );
    const scheduler = new Scheduling(f.store, f.directory);
    const profileId = fakeTeamSnapshot.preset.workerProfileIds[0];
    assert.ok(profileId);
    const tasks = ["blocked", "unrelated"].map((title) =>
      f.store.createTask({ runId: run.id, title, objective: title }, title),
    );
    const [blocked, unrelated] = tasks;
    assert.ok(blocked && unrelated);
    const assignment = { taskId: blocked.id, profileId };
    const queued = scheduler.enqueue(
      { role: "owner" },
      assignment,
      "queue-blocked",
    );
    const other = scheduler.enqueue(
      { role: "owner" },
      { taskId: unrelated.id, profileId },
      "queue-other",
    );
    const request = f.store.createHumanRequest(
      { ...requestFields, runId: run.id, affectedTaskIds: [blocked.id] },
      "wait",
    );
    assert.equal(f.store.getTask(blocked.id).status, "WAITING_HUMAN");
    assert.equal(scheduler.reserve(queued), null);
    // Older stored requests did not change the task status. The relation must
    // enforce the hold even when the queued status predates this implementation.
    f.store.db
      .prepare(
        "UPDATE tasks SET data=json_set(data,'$.status','QUEUED') WHERE id=?",
      )
      .run(blocked.id);
    assert.equal(scheduler.reserve(queued), null);
    assert.throws(
      () => scheduler.enqueue({ role: "owner" }, assignment, "reassign"),
      { code: "CONFLICT" },
    );
    assert.throws(
      () =>
        f.store.createAttempt(
          {
            taskId: blocked.id,
            adapter: "fake",
            intendedOperation: "Bypass",
            cwd: f.directory,
          },
          "bypass",
        ),
      { code: "CONFLICT" },
    );
    assert.ok(scheduler.reserve(other));
    assert.equal(f.store.listAttempts().length, 1);
    f.store.updateHumanRequest(
      { id: request.id, expectedStatus: "open", status: "completed" },
      "complete",
    );
    assert.equal(f.store.getTask(blocked.id).status, "WAITING_HUMAN");
    assert.equal(scheduler.reserve(queued), null);
    f.store.transitionTask(
      {
        id: blocked.id,
        expectedStatus: "WAITING_HUMAN",
        status: "READY",
        reason: "Explicit owner decision",
      },
      "resume",
    );
    const resumed = scheduler.enqueue(
      { role: "owner" },
      assignment,
      "assign-resumed",
    );
    assert.ok(scheduler.reserve(resumed));
  } finally {
    await f.close();
  }
});

test("a supported permission wait retains its session, worktree and execution reservation; replies cannot restart or fake a native resume", async () => {
  const f = await domainFixture();
  try {
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Wait",
        initialPrompt: "Fixture",
        teamSnapshot: fakeTeamSnapshot,
      },
      "wait-run",
    );
    const task = f.store.createTask(
      { runId: run.id, title: "Worker", objective: "Wait" },
      "worker",
    );
    const scheduler = new Scheduling(f.store, f.directory);
    const profileId = fakeTeamSnapshot.preset.workerProfileIds[0];
    assert.ok(profileId);
    const dispatch = scheduler.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId },
      "assign",
    );
    const attemptId = scheduler.reserve(dispatch);
    assert.ok(attemptId);
    const session = f.store.createSession(
      { attemptId, nativeSessionId: "fixture-session" },
      "session",
    );
    for (const [expectedState, state] of [
      ["not_started", "starting"],
      ["starting", "busy"],
    ] as const)
      f.store.updateSession({ id: session.id, expectedState, state }, state);
    const requestInput = {
      ...requestFields,
      runId: run.id,
      sessionId: session.id,
      affectedTaskIds: [task.id],
    };
    assert.throws(
      () => f.store.createHumanRequest(requestInput, "busy-request"),
      {
        code: "CONFLICT",
      },
    );
    assert.equal(f.store.getTask(task.id).status, "RUNNING");
    f.store.updateSession(
      { id: session.id, expectedState: "busy", state: "waiting_permission" },
      "permission",
    );
    const before = f.store.getSession(session.id);
    const request = f.store.createHumanRequest(requestInput, "waiting");
    assert.equal(f.store.getTask(task.id).status, "WAITING_HUMAN");
    assert.deepEqual(f.store.getSession(session.id), before);
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) n FROM reservations").get()?.n,
      1,
    );
    assert.equal(f.store.getAttempt(attemptId).cwd, dispatch.cwd);
    assert.deepEqual(scheduler.list()[0], {
      ...dispatch,
      state: "active",
      attemptId,
    });
    f.store.updateHumanRequest(
      { id: request.id, expectedStatus: "open", status: "completed" },
      "complete",
    );
    for (const status of ["READY", "RUNNING"] as const)
      assert.throws(
        () =>
          f.store.transitionTask(
            {
              id: task.id,
              expectedStatus: "WAITING_HUMAN",
              status,
              reason: "Unsafe resume",
            },
            status,
          ),
        { code: "CONFLICT" },
      );
    assert.equal(f.store.getSession(session.id).state, "waiting_permission");
    const unresolved = f.store.createHumanRequest(requestInput, "unresolved");
    f.reopen().recoverInterrupted();
    assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
    assert.equal(f.store.getAttempt(attemptId).status, "RECOVERY_REQUIRED");
    assert.equal(
      f.store.getSession(session.id).nativeSessionId,
      "fixture-session",
    );
    assert.equal(f.store.listAttempts().length, 1);
    assert.equal(f.store.getHumanRequest(request.id).status, "completed");
    assert.equal(f.store.getAttempt(attemptId).cwd, dispatch.cwd);
    assert.deepEqual(f.store.listTaskBlockers(task.id), [unresolved]);
    f.store.updateHumanRequest(
      {
        id: unresolved.id,
        expectedStatus: "open",
        status: "answered",
        ownerResponse: "Check before retrying",
      },
      "recovery-answer",
    );
    assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});
