import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHumanRequestTransition,
  humanRequestStatusSchema,
} from "../src/shared/domain/states.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

type Fixture = Awaited<ReturnType<typeof domainFixture>>;
const input = (f: Fixture) => ({
  runId: f.run.id,
  affectedTaskIds: [f.task.id],
  type: "environment" as const,
  urgency: "high" as const,
  reason: "A fixture dependency needs owner attention",
  suggestedAction: "Check the fixture dependency",
  blocking: true,
});

test("human request transitions allow deferral/reopening and one final owner decision", () => {
  const edges: Record<string, string[]> = {
    open: ["deferred", "answered", "completed", "declined"],
    deferred: ["open", "answered", "completed", "declined"],
    answered: [],
    completed: [],
    declined: [],
  };
  for (const from of humanRequestStatusSchema.options)
    for (const to of humanRequestStatusSchema.options)
      if (edges[from]?.includes(to))
        assert.doesNotThrow(() => assertHumanRequestTransition(from, to));
      else
        assert.throws(() => assertHumanRequestTransition(from, to), {
          code: "INVALID_TRANSITION",
        });
});

test("blocking creation atomically links affected tasks and leaves unrelated tasks alone; nonblocking urgency is recorded without a wait", async () => {
  const f = await domainFixture();
  try {
    const unrelated = f.store.createTask(
      { runId: f.run.id, title: "Unrelated", objective: "Continue" },
      "unrelated",
    );
    for (const urgency of ["low", "normal", "high", "urgent"] as const) {
      const request = f.store.createHumanRequest(
        { ...input(f), urgency, blocking: false },
        urgency,
      );
      assert.equal(request.urgency, urgency);
      assert.equal(f.store.getTask(f.task.id).status, "BACKLOG");
      const event = f.store
        .events({ limit: 500 })
        .find(
          (e) =>
            e.type === "human_request.created" &&
            e.payload.requestId === request.id,
        );
      assert.equal(event?.payload.urgency, urgency);
    }
    const affected = f.store.createTask(
      { runId: f.run.id, title: "Also affected", objective: "Wait" },
      "affected",
    );
    const blocking = { ...input(f), affectedTaskIds: [f.task.id, affected.id] };
    const request = f.store.createHumanRequest(blocking, "block");
    assert.equal(f.store.getTask(f.task.id).status, "WAITING_HUMAN");
    assert.equal(f.store.getTask(affected.id).status, "WAITING_HUMAN");
    assert.deepEqual(f.store.getTask(unrelated.id), unrelated);
    assert.deepEqual(f.store.listTaskBlockers(f.task.id), [request]);
    assert.equal(
      f.store.db
        .prepare(
          "SELECT COUNT(*) n FROM human_request_tasks WHERE request_id=?",
        )
        .get(request.id)?.n,
      2,
    );
    const events = f.store.events({ limit: 500 });
    assert.deepEqual(f.store.createHumanRequest(blocking, "block"), request);
    f.reopen();
    assert.deepEqual(f.store.getHumanRequest(request.id), request);
    assert.deepEqual(f.store.listTaskBlockers(f.task.id), [request]);
    assert.deepEqual(f.store.events({ limit: 500 }), events);
  } finally {
    await f.close();
  }
});

test("every open or deferred blocker must resolve, and owner replies never resume or complete a task", async () => {
  const f = await domainFixture();
  try {
    const one = f.store.createHumanRequest(input(f), "one");
    const two = f.store.createHumanRequest(input(f), "two");
    const deferred = f.store.updateHumanRequest(
      {
        id: one.id,
        expectedStatus: "open",
        status: "deferred",
        ownerResponse: "Later",
      },
      "defer",
    );
    assert.equal(deferred.resolvedAt, null);
    assert.equal(f.store.listTaskBlockers(f.task.id).length, 2);
    const resume = (key: string) =>
      f.store.transitionTask(
        {
          id: f.task.id,
          expectedStatus: "WAITING_HUMAN",
          status: "READY",
          reason: "Explicit resume",
        },
        key,
      );
    assert.throws(() => resume("blocked"), { code: "CONFLICT" });
    const answer = {
      id: two.id,
      expectedStatus: "open",
      status: "answered",
      ownerResponse: "Try the fixture",
    };
    const answered = f.store.updateHumanRequest(answer, "answer");
    assert.ok(answered.resolvedAt);
    assert.throws(() => resume("still-blocked"), { code: "CONFLICT" });
    f.store.updateHumanRequest(
      { id: one.id, expectedStatus: "deferred", status: "open" },
      "reopen",
    );
    const declined = f.store.updateHumanRequest(
      {
        id: one.id,
        expectedStatus: "open",
        status: "declined",
        ownerResponse: "Use an alternative",
      },
      "decline",
    );
    assert.ok(declined.resolvedAt);
    assert.deepEqual(f.store.listTaskBlockers(f.task.id), []);
    assert.equal(f.store.getTask(f.task.id).status, "WAITING_HUMAN");
    assert.equal(f.store.listAttempts().length, 0);
    assert.throws(
      () =>
        f.store.createAttempt(
          {
            taskId: f.task.id,
            adapter: "fake",
            intendedOperation: "Implicit retry",
            cwd: f.directory,
          },
          "implicit-attempt",
        ),
      { code: "CONFLICT" },
    );
    assert.equal(resume("explicit-resume").status, "READY");
    assert.deepEqual(f.store.updateHumanRequest(answer, "answer"), answered);
    assert.throws(
      () =>
        f.store.updateHumanRequest(
          { id: two.id, expectedStatus: "answered", status: "completed" },
          "late",
        ),
      { code: "INVALID_TRANSITION" },
    );
    assert.throws(
      () =>
        f.store.updateHumanRequest(
          { ...answer, ownerResponse: "Changed" },
          "answer",
        ),
      { code: "CONFLICT" },
    );
    const history = f.store
      .events({ limit: 500 })
      .filter((e) => e.type === "human_request.updated");
    assert.equal(history.length, 4);
    assert.equal(
      history.find((e) => e.payload.requestId === two.id)?.payload
        .ownerResponse,
      "Try the fixture",
    );
  } finally {
    await f.close();
  }
});

test("stale status, empty answers, duplicate/empty blockers and cross-run task/session links make no partial changes", async () => {
  const f = await domainFixture();
  try {
    const other = f.store.createRun(
      { projectId: f.project.id, title: "Other", initialPrompt: "Other" },
      "other-run",
    );
    const otherTask = f.store.createTask(
      { runId: other.id, title: "Other", objective: "Other" },
      "other-task",
    );
    const attempt = f.store.createAttempt(
      {
        taskId: otherTask.id,
        adapter: "fake",
        intendedOperation: "Fixture",
        cwd: f.directory,
      },
      "other-attempt",
    );
    const session = f.store.createSession(
      { attemptId: attempt.id },
      "other-session",
    );
    for (const patch of [
      { affectedTaskIds: [] },
      { affectedTaskIds: [f.task.id, f.task.id] },
      { affectedTaskIds: [f.task.id, otherTask.id] },
      { sessionId: session.id },
      { urgency: "invented" },
    ]) {
      assert.throws(() =>
        f.store.createHumanRequest({ ...input(f), ...patch }, "invalid"),
      );
      assert.equal(f.store.listHumanRequests().length, 0);
      assert.equal(f.store.getTask(f.task.id).status, "BACKLOG");
    }
    const request = f.store.createHumanRequest(input(f), "valid");
    const before = f.store.events({ limit: 500 });
    assert.throws(
      () =>
        f.store.updateHumanRequest(
          { id: request.id, expectedStatus: "deferred", status: "completed" },
          "stale",
        ),
      { code: "CONFLICT" },
    );
    for (const ownerResponse of [undefined, "   "])
      assert.throws(() =>
        f.store.updateHumanRequest(
          {
            id: request.id,
            expectedStatus: "open",
            status: "answered",
            ownerResponse,
          },
          "empty-answer",
        ),
      );
    assert.deepEqual(f.store.getHumanRequest(request.id), request);
    assert.deepEqual(f.store.events({ limit: 500 }), before);
  } finally {
    await f.close();
  }
});

for (const operation of ["create", "update"] as const) {
  test(`human request ${operation} rolls back request, links, task waits, events and idempotency on journal failure`, async () => {
    const f = await domainFixture();
    try {
      const request =
        operation === "update"
          ? f.store.createHumanRequest(input(f), "existing")
          : null;
      if (request)
        f.store.db
          .prepare(
            "UPDATE tasks SET data=json_set(data,'$.status','QUEUED') WHERE id=?",
          )
          .run(f.task.id);
      const task = f.store.getTask(f.task.id);
      const requests = f.store.listHumanRequests();
      const events = f.store.events({ limit: 500 });
      const eventType =
        operation === "create"
          ? "human_request.created"
          : "human_request.updated";
      f.store.db.exec(
        `CREATE TRIGGER fail_human_event BEFORE INSERT ON events WHEN NEW.type='${eventType}' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`,
      );
      const change = () =>
        request
          ? f.store.updateHumanRequest(
              { id: request.id, expectedStatus: "open", status: "completed" },
              "failed",
            )
          : f.store.createHumanRequest(input(f), "failed");
      assert.throws(change, { code: "STORAGE" });
      assert.equal(f.store.db.isTransaction, false);
      assert.deepEqual(f.store.getTask(f.task.id), task);
      assert.deepEqual(f.store.listHumanRequests(), requests);
      assert.deepEqual(f.store.events({ limit: 500 }), events);
      assert.equal(
        f.store.db.prepare("SELECT COUNT(*) n FROM human_request_tasks").get()
          ?.n,
        request ? 1 : 0,
      );
      assert.equal(
        f.store.db
          .prepare("SELECT COUNT(*) n FROM mutations WHERE key='failed'")
          .get()?.n,
        0,
      );
      f.store.db.exec("DROP TRIGGER fail_human_event");
      assert.ok(change());
    } finally {
      await f.close();
    }
  });
}

test("responding to an outstanding request after cancellation preserves the cancellation and its history", async () => {
  const f = await domainFixture();
  try {
    const request = f.store.createHumanRequest(input(f), "request");
    const cancelled = f.store.transitionTask(
      {
        id: f.task.id,
        expectedStatus: "WAITING_HUMAN",
        status: "CANCELLED",
        reason: "Owner cancelled",
      },
      "cancel",
    );
    f.store.updateHumanRequest(
      {
        id: request.id,
        expectedStatus: "open",
        status: "answered",
        ownerResponse: "No longer needed",
      },
      "answer",
    );
    f.reopen().recoverInterrupted();
    assert.deepEqual(f.store.getTask(f.task.id), cancelled);
    assert.equal(f.store.listAttempts().length, 0);
    assert.equal(f.store.getHumanRequest(request.id).status, "answered");
    assert.throws(() => f.store.createHumanRequest(input(f), "terminal"), {
      code: "CONFLICT",
    });
  } finally {
    await f.close();
  }
});
