import assert from "node:assert/strict";
import { test } from "node:test";
import { denyCodexPermission } from "../src/server/adapters/codex-permissions.ts";
import { recordNativePermissionDenial } from "../src/server/orchestration/native-permissions.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { humanRequestActions } from "../src/web/human-request-actions.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

test("native denial evidence is session-bound, atomic, durable and idempotent; acknowledgement never resumes work", async () => {
  const f = await domainFixture();
  try {
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Permissions",
        initialPrompt: "Fixture",
        execution: "native",
        teamSnapshot: fakeTeamSnapshot,
      },
      "permission-run",
    );
    const task = f.store.createTask(
      { runId: run.id, title: "Lead", objective: "Fixture", kind: "lead" },
      "lead",
    );
    const attempt = f.store.createAttempt(
      {
        taskId: task.id,
        adapter: "codex",
        intendedOperation: "Fixture only",
        cwd: f.directory,
      },
      "attempt",
    );
    const session = f.store.createSession({ attemptId: attempt.id }, "session");
    const denial = denyCodexPermission(
      "item/fileChange/requestApproval",
      "fixture-request",
    ).event.permission;
    const before = f.store.events({ limit: 500 });
    f.store.db.exec(
      "CREATE TRIGGER reject_denial BEFORE INSERT ON events WHEN NEW.type='native_permission.denied' BEGIN SELECT RAISE(ABORT,'fixture'); END;",
    );
    assert.throws(
      () => recordNativePermissionDenial(f.store, session.id, denial),
      { code: "STORAGE" },
    );
    assert.deepEqual(f.store.listHumanRequests(), []);
    assert.deepEqual(f.store.events({ limit: 500 }), before);
    f.store.db.exec("DROP TRIGGER reject_denial");
    const request = recordNativePermissionDenial(f.store, session.id, denial);
    assert.deepEqual(
      recordNativePermissionDenial(f.store, session.id, denial),
      request,
    );
    assert.equal(f.store.listHumanRequests().length, 1);
    const foreign = f.store.createTask(
      { runId: run.id, title: "Worker", objective: "Fixture" },
      "worker",
    );
    const foreignAttempt = f.store.createAttempt(
      {
        taskId: foreign.id,
        adapter: "codex",
        intendedOperation: "Fixture only",
        cwd: f.directory,
      },
      "worker-attempt",
    );
    const foreignSession = f.store.createSession(
      { attemptId: foreignAttempt.id },
      "worker-session",
    );
    assert.throws(
      () => recordNativePermissionDenial(f.store, foreignSession.id, denial),
      { code: "INVALID_REFERENCE" },
    );
    assert.deepEqual(f.store.listTaskBlockers(task.id), []);
    f.store.updateHumanRequest(
      { id: request.id, expectedStatus: "open", status: "completed" },
      "ack",
    );
    f.reopen().recoverInterrupted();
    assert.equal(
      f.store.getHumanRequest(request.id).nativePermission?.outcome,
      "denied_by_policy",
    );
    assert.equal(f.store.getHumanRequest(request.id).status, "completed");
    assert.equal(f.store.listAttempts().length, 2);
    assert.equal(f.store.getAttempt(attempt.id).status, "RECOVERY_REQUIRED");
    assert.deepEqual(
      recordNativePermissionDenial(f.store, session.id, denial),
      request,
    );
    assert.equal(f.store.listHumanRequests().length, 1);
    assert.throws(
      () =>
        recordNativePermissionDenial(f.store, session.id, {
          ...denial,
          method: "item/permissions/requestApproval",
        }),
      { code: "CONFLICT" },
    );
    assert.deepEqual(
      humanRequestActions("open", true).map((a) => a.status),
      ["completed", "deferred"],
    );
    assert.deepEqual(
      humanRequestActions("deferred", true).map((a) => a.status),
      ["completed"],
    );
    assert.deepEqual(humanRequestActions("completed", true), []);
  } finally {
    await f.close();
  }
});
