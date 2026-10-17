import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { listIntegrationCandidates } from "../src/server/storage/candidates.ts";
import {
  humanRequestSchema,
  runSchema,
} from "../src/shared/domain/entities.ts";
import { claudeEngineFixture } from "./helpers/claude-engine-fixture.ts";

test("owner HTTP launches a Claude reader in a real isolated worktree and retains its report without touching the owner checkout", async () => {
  const f = await claudeEngineFixture();
  try {
    const response = await f.send("runs/native", {
      projectId: f.project.id,
      harness: "claude-code",
      title: "SCRIPTED Claude reader",
      initialPrompt: "Read the disposable fixture only",
      model: "fixture/claude",
      thinking: "low",
      permission: "read_only",
    });
    assert.equal(response.status, 200);
    const run = runSchema.parse(await response.json());
    await f.engine.idle();
    const task = f.store.listTasks(run.id)[0];
    assert.ok(task);
    assert.equal(task.status, "AWAITING_REVIEW");
    const attempt = f.store
      .listAttempts()
      .find((attempt) => attempt.taskId === task.id);
    assert.ok(attempt?.worktreePath);
    assert.equal(attempt.adapter, "claude-code");
    assert.notEqual(attempt.cwd, f.repo.directory);
    assert.equal(
      await readFile(join(attempt.cwd, "README.md"), "utf8"),
      "# Disposable fixture\n",
    );
    const reports = await f.engine.reports(task.id);
    assert.ok(
      reports.some(({ content }) =>
        content.includes("Scripted file-operation result"),
      ),
    );
    assert.deepEqual(listIntegrationCandidates(f.store, task.id), []);
    const ids = f.store.listAttempts().map((attempt) => attempt.id);
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(
      f.store.listAttempts().map((attempt) => attempt.id),
      ids,
    );
    assert.equal(f.store.getTask(task.id).status, "AWAITING_REVIEW");
  } finally {
    await f.close();
  }
});

test("a native writer waits for explicit owner approval while an unrelated reader finishes; one approval writes only its isolated file and cannot be replayed", async () => {
  const f = await claudeEngineFixture();
  try {
    const run = await f.run("workspace_write");
    const request = await f.request(run.id);
    const taskId = request.affectedTaskIds[0];
    assert.ok(taskId && request.sessionId);
    const task = f.store.getTask(taskId);
    const session = f.store.getSession(request.sessionId);
    const attempt = f.store.getAttempt(session.attemptId);
    assert.equal(task.status, "WAITING_HUMAN");
    assert.equal(session.state, "waiting_permission");
    assert.equal(
      await readFile(join(attempt.cwd, "README.md"), "utf8"),
      "# Disposable fixture\n",
    );
    assert.equal(f.adapter.decisions.length, 0);
    const reader = await f.run("read_only");
    let readerFinished = false;
    for (let i = 0; i < 300; i++) {
      await f.engine.pump();
      readerFinished =
        f.store.listTasks(reader.id)[0]?.status === "AWAITING_REVIEW";
      if (readerFinished) break;
      await delay(10);
    }
    assert.equal(readerFinished, true);
    assert.equal(f.store.getTask(taskId).status, "WAITING_HUMAN");
    assert.equal(
      (
        await f.send(
          "native-approvals",
          { id: request.id, decision: "approve" },
          "bad-token",
          "POST",
          { "X-Local-Token": "" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.send(
          "native-approvals",
          { id: request.id, decision: "approve" },
          "foreign-origin",
          "POST",
          { Origin: "https://example.invalid" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.send(
          "human-requests",
          {
            id: request.id,
            expectedStatus: "open",
            status: "answered",
            ownerResponse: "approve",
          },
          "generic-reply",
          "PATCH",
        )
      ).status,
      403,
    );
    assert.equal(f.adapter.decisions.length, 0);
    assert.equal(f.store.getTask(taskId).status, "WAITING_HUMAN");
    const decision = { id: request.id, decision: "approve" };
    const approved = await f.send("native-approvals", decision, "approve-once");
    assert.equal(approved.status, 200);
    assert.equal(
      humanRequestSchema.parse(await approved.json()).nativeApproval?.state,
      "accepted",
    );
    await f.engine.idle();
    assert.equal(
      await readFile(join(attempt.cwd, "README.md"), "utf8"),
      "# Owner-approved fixture change\n",
    );
    assert.equal(f.store.getTask(taskId).status, "AWAITING_REVIEW");
    const [candidate] = listIntegrationCandidates(f.store, taskId);
    assert.ok(candidate);
    assert.equal(candidate.humanDecision, null);
    assert.equal(f.store.listAttempts().length, 2);
    assert.equal(
      (await f.send("native-approvals", decision, "approve-once")).status,
      200,
    );
    assert.equal(
      (
        await f.send(
          "native-approvals",
          { id: request.id, decision: "deny" },
          "approve-once",
        )
      ).status,
      409,
    );
    assert.equal(
      (await f.send("native-approvals", decision, "different-key")).status,
      409,
    );
    assert.equal(f.adapter.decisions.length, 1);
    const ids = f.store.listAttempts().map((attempt) => attempt.id);
    await f.restart();
    assert.equal(
      (await f.send("native-approvals", decision, "approve-once")).status,
      200,
    );
    await f.engine.idle();
    assert.equal(f.adapter.decisions.length, 1);
    assert.deepEqual(
      f.store.listAttempts().map((attempt) => attempt.id),
      ids,
    );
  } finally {
    await f.close();
  }
});

test("denying a native permission releases only its live callback and never changes the file or creates a candidate", async () => {
  const f = await claudeEngineFixture();
  try {
    const run = await f.run("workspace_write");
    const request = await f.request(run.id);
    const taskId = request.affectedTaskIds[0];
    assert.ok(taskId && request.sessionId);
    const attempt = f.store.getAttempt(
      f.store.getSession(request.sessionId).attemptId,
    );
    const response = await f.send("native-approvals", {
      id: request.id,
      decision: "deny",
    });
    assert.equal(response.status, 200);
    const saved = humanRequestSchema.parse(await response.json());
    assert.equal(saved.status, "declined");
    assert.equal(saved.nativeApproval?.decision, "deny");
    await f.engine.idle();
    assert.equal(
      await readFile(join(attempt.cwd, "README.md"), "utf8"),
      "# Disposable fixture\n",
    );
    assert.deepEqual(listIntegrationCandidates(f.store, taskId), []);
    assert.equal(f.store.getTask(taskId).status, "AWAITING_REVIEW");
  } finally {
    await f.close();
  }
});

test("paused and Chat/Plan work cannot approve a pending native mutation", async () => {
  const f = await claudeEngineFixture();
  try {
    const run = await f.run("workspace_write");
    const request = await f.request(run.id);
    for (const patch of [
      { status: "paused" },
      { status: "active", mode: "chat_plan" },
    ]) {
      f.engine.updateRun({ id: run.id, ...patch }, randomUUID());
      assert.equal(
        (
          await f.send("native-approvals", {
            id: request.id,
            decision: "approve",
          })
        ).status,
        403,
      );
      assert.equal(f.store.getHumanRequest(request.id).status, "open");
      assert.equal(f.adapter.decisions.length, 0);
    }
    assert.equal(
      (await f.send("native-approvals", { id: request.id, decision: "deny" }))
        .status,
      200,
    );
    await f.engine.idle();
  } finally {
    await f.close();
  }
});

test("cancel/restart expires an unanswered callback, retains its history and never grants or restarts it", async () => {
  const f = await claudeEngineFixture();
  try {
    const run = await f.run("workspace_write");
    const request = await f.request(run.id);
    const taskId = request.affectedTaskIds[0];
    assert.ok(taskId && request.sessionId);
    const attempt = f.store.getAttempt(
      f.store.getSession(request.sessionId).attemptId,
    );
    f.engine.cancel(taskId, "cancel-pending-native");
    await f.engine.idle();
    assert.equal(f.store.getTask(taskId).status, "CANCELLED");
    const saved = f.store.getHumanRequest(request.id);
    assert.equal(saved.status, "declined");
    assert.equal(saved.nativeApproval?.state, "expired");
    assert.equal(saved.nativeApproval?.decision, null);
    assert.equal(
      await readFile(join(attempt.cwd, "README.md"), "utf8"),
      "# Disposable fixture\n",
    );
    await f.restart();
    assert.equal(
      (
        await f.send("native-approvals", {
          id: request.id,
          decision: "approve",
        })
      ).status,
      409,
    );
    await f.engine.idle();
    assert.equal(f.store.listAttempts().length, 1);
    assert.equal(f.adapter.decisions.length, 0);
    assert.equal(f.store.getTask(taskId).status, "CANCELLED");
    assert.deepEqual(f.store.getHumanRequest(request.id), saved);
  } finally {
    await f.close();
  }
});

test("a failed owner-decision journal transaction leaves the native tool blocked and its callback usable", async () => {
  const f = await claudeEngineFixture();
  try {
    const run = await f.run("workspace_write");
    const request = await f.request(run.id);
    f.store.db.exec(
      "CREATE TRIGGER fail_native_decision BEFORE INSERT ON events WHEN NEW.type='native_approval.decided' BEGIN SELECT RAISE(ABORT, 'native decision fixture failure'); END;",
    );
    assert.equal(
      (
        await f.send(
          "native-approvals",
          { id: request.id, decision: "approve" },
          "failed-decision",
        )
      ).status,
      500,
    );
    assert.equal(f.store.getHumanRequest(request.id).status, "open");
    assert.equal(
      f.store.getTask(request.affectedTaskIds[0] ?? "").status,
      "WAITING_HUMAN",
    );
    assert.equal(f.adapter.decisions.length, 0);
    f.store.db.exec("DROP TRIGGER fail_native_decision");
    assert.equal(
      (
        await f.send(
          "native-approvals",
          { id: request.id, decision: "deny" },
          "failed-decision",
        )
      ).status,
      200,
    );
    await f.engine.idle();
    assert.equal(
      f.store.getHumanRequest(request.id).nativeApproval?.decision,
      "deny",
    );
  } finally {
    await f.close();
  }
});

test("native approval HTTP rejects malformed, unknown and caller-supplied session bindings without unblocking the worker", async () => {
  const f = await claudeEngineFixture();
  try {
    const run = await f.run("workspace_write");
    const request = await f.request(run.id);
    for (const input of [
      { id: request.id, decision: "always-approve" },
      { id: request.id, decision: "approve", nativeRequestId: "other-request" },
      { id: request.id, decision: "approve", sessionId: request.sessionId },
      { id: "README.md", decision: "approve" },
    ])
      assert.equal((await f.send("native-approvals", input)).status, 400);
    assert.equal(
      (
        await f.send("native-approvals", {
          id: randomUUID(),
          decision: "approve",
        })
      ).status,
      404,
    );
    assert.equal(f.store.getHumanRequest(request.id).status, "open");
    assert.equal(f.adapter.decisions.length, 0);
    assert.equal(
      (await f.send("native-approvals", { id: request.id, decision: "deny" }))
        .status,
      200,
    );
    await f.engine.idle();
  } finally {
    await f.close();
  }
});

test("missing Claude auth or unsupported model/effort is refused before creating a run or attempt", async () => {
  const f = await claudeEngineFixture();
  try {
    const before = f.store.listRuns();
    const input = {
      projectId: f.project.id,
      harness: "claude-code",
      title: "Refuse unavailable Claude",
      initialPrompt: "No prompt should run",
      model: "fixture/claude",
      thinking: "low",
      permission: "read_only",
    };
    f.adapter.authenticated = false;
    assert.equal((await f.send("runs/native", input)).status, 409);
    f.adapter.authenticated = true;
    for (const patch of [
      { model: "unsupported" },
      { thinking: "unsupported" },
      { harness: "opencode" },
    ])
      assert.ok(
        [400, 409].includes(
          (await f.send("runs/native", { ...input, ...patch })).status,
        ),
      );
    assert.deepEqual(f.store.listRuns(), before);
    assert.equal(f.store.listAttempts().length, 0);
  } finally {
    await f.close();
  }
});

test("a failed native permission callback is recorded, cancels the owned attempt and cannot grant on replay", async () => {
  const f = await claudeEngineFixture();
  try {
    const run = await f.run("workspace_write");
    const request = await f.request(run.id);
    assert.ok(request.sessionId);
    const session = f.store.getSession(request.sessionId);
    const attempt = f.store.getAttempt(session.attemptId);
    f.adapter.respondToApproval = async () => {
      throw new Error("private native callback failure");
    };
    const response = await f.send(
      "native-approvals",
      { id: request.id, decision: "approve" },
      "failed-native-callback",
    );
    assert.equal(response.status, 409);
    assert.equal(
      JSON.stringify(await response.json()).includes("private native"),
      false,
    );
    await f.engine.idle();
    assert.equal(f.adapter.cancelled.has(session.nativeSessionId ?? ""), true);
    assert.equal(
      f.store.getHumanRequest(request.id).nativeApproval?.state,
      "failed",
    );
    assert.equal(f.store.getTask(attempt.taskId).status, "RETRY_DECISION");
    assert.equal(
      await readFile(join(attempt.cwd, "README.md"), "utf8"),
      "# Disposable fixture\n",
    );
    await f.restart();
    assert.equal(
      (
        await f.send("native-approvals", {
          id: request.id,
          decision: "approve",
        })
      ).status,
      409,
    );
    assert.equal(f.adapter.decisions.length, 0);
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});

test("permission receipt journal failure still cancels execution and retains ambiguous work without replay", async () => {
  const f = await claudeEngineFixture();
  try {
    const run = await f.run("workspace_write");
    const request = await f.request(run.id);
    assert.ok(request.sessionId);
    const session = f.store.getSession(request.sessionId);
    f.store.db.exec(
      "CREATE TRIGGER fail_native_receipt BEFORE INSERT ON events WHEN NEW.type IN ('native_approval.accepted','native_approval.failed') BEGIN SELECT RAISE(ABORT, 'native receipt fixture failure'); END;",
    );
    assert.equal(
      (
        await f.send(
          "native-approvals",
          { id: request.id, decision: "approve" },
          "failed-native-receipt",
        )
      ).status,
      500,
    );
    await f.engine.idle();
    assert.equal(f.adapter.cancelled.has(session.nativeSessionId ?? ""), true);
    assert.equal(
      f.store.getTask(request.affectedTaskIds[0] ?? "").status,
      "RETRY_DECISION",
    );
    const saved = f.store.getHumanRequest(request.id);
    assert.equal(saved.status, "answered");
    assert.equal(saved.nativeApproval?.decision, "approve");
    assert.equal(saved.nativeApproval?.state, "expired");
    assert.equal(f.adapter.decisions.length, 1);
    f.store.db.exec("DROP TRIGGER fail_native_receipt");
    await f.restart();
    assert.equal(
      (
        await f.send("native-approvals", {
          id: request.id,
          decision: "approve",
        })
      ).status,
      409,
    );
    assert.equal(f.adapter.decisions.length, 1);
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});
