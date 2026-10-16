import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { appLocations, openDatabase } from "../src/server/storage/database.ts";
import {
  defaultLimits,
  teamSnapshotSchema,
} from "../src/shared/domain/entities.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

test("state, native identity, worktree and ordered events survive reopen", async () => {
  const f = await domainFixture();
  try {
    const attempt = f.store.createAttempt(
      {
        taskId: f.task.id,
        adapter: "fake",
        intendedOperation: "Inspect",
        cwd: f.directory,
        worktreePath: join(f.directory, "retained"),
      },
      "attempt",
    );
    const session = f.store.createSession(
      { attemptId: attempt.id, nativeSessionId: "fake-session-7" },
      "session",
    );
    f.store.updateSession(
      { id: session.id, expectedState: "not_started", state: "starting" },
      "starting",
    );
    f.reopen();
    assert.equal(
      f.store.getSession(session.id).nativeSessionId,
      "fake-session-7",
    );
    assert.equal(
      f.store.getAttempt(attempt.id).worktreePath,
      join(f.directory, "retained"),
    );
    const events = f.store.events();
    assert.deepEqual(
      events.map((e) => e.sequence),
      [1, 2, 3, 4, 5, 6],
    );
    assert.deepEqual(
      f.store.events({ after: 3, runId: f.run.id }).map((e) => e.sequence),
      [4, 5, 6],
    );
    assert.ok(events.every((e) => e.createdAt && e.correlationId));
  } finally {
    await f.close();
  }
});
test("idempotency survives reopen, canonical input order and rejects conflicting reuse", async () => {
  const f = await domainFixture();
  try {
    const input = {
      runId: f.run.id,
      title: "Second",
      objective: "One operation",
    };
    const first = f.store.createTask(input, "repeat");
    f.reopen();
    assert.deepEqual(
      f.store.createTask(
        { objective: input.objective, title: input.title, runId: input.runId },
        "repeat",
      ),
      first,
    );
    assert.equal(f.store.listTasks().length, 2);
    assert.equal(
      f.store.events().filter((e) => e.correlationId === "repeat").length,
      1,
    );
    assert.throws(
      () => f.store.createTask({ ...input, title: "Changed" }, "repeat"),
      { code: "CONFLICT" },
    );
    assert.throws(
      () => f.store.updateRun({ id: f.run.id, mode: "supervised" }, "repeat"),
      { code: "CONFLICT" },
    );
  } finally {
    await f.close();
  }
});
test("invalid transitions and missing references roll back state, journal and idempotency key", async () => {
  const f = await domainFixture();
  try {
    const before = f.store.events();
    assert.throws(
      () =>
        f.store.transitionTask(
          {
            id: f.task.id,
            expectedStatus: "BACKLOG",
            status: "DONE",
            reason: "Invalid skip",
          },
          "change",
        ),
      { code: "INVALID_TRANSITION" },
    );
    assert.throws(
      () =>
        f.store.createTask(
          {
            runId: f.run.id,
            title: "Bad",
            objective: "Bad",
            dependencyIds: [randomUUID()],
          },
          "missing",
        ),
      { code: "NOT_FOUND" },
    );
    assert.deepEqual(f.store.events(), before);
    const ready = f.store.transitionTask(
      {
        id: f.task.id,
        expectedStatus: "BACKLOG",
        status: "READY",
        reason: "Owner promoted",
      },
      "change",
    );
    assert.equal(ready.status, "READY");
    assert.throws(
      () =>
        f.store.transitionTask(
          {
            id: ready.id,
            expectedStatus: "BACKLOG",
            status: "READY",
            reason: "Stale",
          },
          "stale",
        ),
      { code: "CONFLICT" },
    );
    assert.equal(f.store.listTasks().length, 1);
  } finally {
    await f.close();
  }
});
test("SQLite enforces WAL, foreign keys and append-only event history", async () => {
  const f = await domainFixture();
  const db = openDatabase(join(f.directory, "state.sqlite"));
  try {
    assert.equal(db.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.equal(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 2);
    assert.throws(
      () => db.exec("UPDATE events SET type = 'changed'"),
      /append-only/,
    );
    assert.throws(() => db.exec("DELETE FROM events"), /append-only/);
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO runs VALUES (?, ?, ?)")
          .run(randomUUID(), randomUUID(), "{}"),
      /FOREIGN KEY/,
    );
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO projects VALUES (?, ?, ?)").run(
      randomUUID(),
      "/tmp/rolled-back",
      "{}",
    );
    db.exec("ROLLBACK");
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM projects").get()?.count,
      1,
    );
  } finally {
    db.close();
    await f.close();
  }
});
test("ownership validation rejects dependencies, inbox and event references across runs", async () => {
  const f = await domainFixture();
  try {
    const otherRun = f.store.createRun(
      { projectId: f.project.id, title: "Other", initialPrompt: "Other" },
      "other",
    );
    assert.throws(
      () =>
        f.store.createTask(
          {
            runId: otherRun.id,
            title: "Cross",
            objective: "Cross",
            dependencyIds: [f.task.id],
          },
          "cross-task",
        ),
      { code: "INVALID_REFERENCE" },
    );
    assert.throws(
      () =>
        f.store.createHumanRequest(
          {
            runId: otherRun.id,
            affectedTaskIds: [f.task.id],
            type: "clarification",
            reason: "Question",
            suggestedAction: "Answer",
            blocking: true,
          },
          "cross-human",
        ),
      { code: "INVALID_REFERENCE" },
    );
    assert.throws(
      () =>
        f.store.recordEvent(
          {
            runId: otherRun.id,
            taskId: f.task.id,
            type: "bad",
            correlationId: "cross",
            payload: {},
          },
          "cross-event",
        ),
      { code: "INVALID_REFERENCE" },
    );
  } finally {
    await f.close();
  }
});
test("process exit never marks task complete; restart requires a decision without duplicate launches", async () => {
  const f = await domainFixture();
  try {
    for (const status of ["READY", "QUEUED", "RUNNING"] as const)
      f.store.transitionTask(
        {
          id: f.task.id,
          expectedStatus: f.store.getTask(f.task.id).status,
          status,
          reason: "FAKE demo",
        },
        status,
      );
    const attempt = f.store.createAttempt(
      {
        taskId: f.task.id,
        adapter: "fake",
        cwd: f.directory,
        intendedOperation: "Ambiguous write simulation",
      },
      "attempt",
    );
    f.store.updateAttempt({ id: attempt.id, status: "running" }, "running");
    const session = f.store.createSession(
      { attemptId: attempt.id, nativeSessionId: "fake-persisted" },
      "session",
    );
    f.store.updateSession(
      { id: session.id, expectedState: "not_started", state: "starting" },
      "starting",
    );
    f.store.updateSession(
      {
        id: session.id,
        expectedState: "starting",
        state: "exited",
        exitCode: 0,
      },
      "exited",
    );
    assert.equal(f.store.getTask(f.task.id).status, "RUNNING");
    f.reopen().recoverInterrupted();
    assert.equal(f.store.getTask(f.task.id).status, "RETRY_DECISION");
    assert.equal(f.store.getAttempt(attempt.id).status, "RECOVERY_REQUIRED");
    assert.equal(f.store.getSession(session.id).recovery, "RECOVERY_REQUIRED");
    const events = f.store.events();
    f.reopen().recoverInterrupted();
    assert.deepEqual(f.store.events(), events);
    assert.equal(f.store.listAttempts().length, 1);
    assert.equal(f.store.listSessions().length, 1);
  } finally {
    await f.close();
  }
});
test("human replies and run edits persist with immutable event history", async () => {
  const f = await domainFixture();
  try {
    const request = f.store.createHumanRequest(
      {
        runId: f.run.id,
        affectedTaskIds: [f.task.id],
        type: "clarification",
        reason: "Which fixture?",
        suggestedAction: "Give name",
        blocking: false,
      },
      "request",
    );
    f.store.updateHumanRequest(
      { id: request.id, status: "answered", ownerResponse: "Use toy" },
      "answer",
    );
    f.store.updateRun({ id: f.run.id, mode: "supervised" }, "mode");
    f.reopen();
    assert.equal(f.store.listHumanRequests()[0]?.ownerResponse, "Use toy");
    assert.equal(f.store.getRun(f.run.id).mode, "supervised");
    assert.throws(
      () =>
        f.store.updateHumanRequest(
          { id: request.id, status: "declined", ownerResponse: "Late" },
          "late",
        ),
      { code: "CONFLICT" },
    );
  } finally {
    await f.close();
  }
});
test("XDG defaults ignore relative overrides and use separate data/config/runtime locations", () => {
  assert.deepEqual(
    appLocations(
      {
        XDG_DATA_HOME: "relative",
        XDG_CONFIG_HOME: "/tmp/config",
        XDG_RUNTIME_DIR: "/tmp/runtime",
      },
      "/tmp/home",
    ),
    {
      data: "/tmp/home/.local/share/local-agent-orchestrator",
      database: "/tmp/home/.local/share/local-agent-orchestrator/state.sqlite",
      artifacts: "/tmp/home/.local/share/local-agent-orchestrator/artifacts",
      config: "/tmp/config/local-agent-orchestrator",
      runtime: "/tmp/runtime/local-agent-orchestrator",
    },
  );
});

test("a journal write failure rolls back the entity and leaves its mutation key reusable", async () => {
  const f = await domainFixture();
  const db = openDatabase(join(f.directory, "state.sqlite"));
  try {
    db.exec(
      "CREATE TRIGGER fail_journal BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;",
    );
    const input = {
      runId: f.run.id,
      title: "Atomic task",
      objective: "All or nothing",
    };
    assert.throws(() => f.store.createTask(input, "atomic-failure"), {
      code: "STORAGE",
    });
    assert.equal(f.store.listTasks().length, 1);
    assert.equal(f.store.events().length, 3);
    db.exec("DROP TRIGGER fail_journal");
    f.store.createTask(input, "atomic-failure");
    assert.equal(f.store.listTasks().length, 2);
    assert.equal(f.store.events().length, 4);
  } finally {
    db.close();
    await f.close();
  }
});

test("a process exiting before commit leaves no partial task or event after reopen", async () => {
  const f = await domainFixture();
  try {
    execFileSync(process.execPath, [
      "--input-type=module",
      "-e",
      `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      db.prepare("INSERT INTO tasks(id,run_id,parent_task_id,data) VALUES (?,?,NULL,?)").run(process.argv[2],process.argv[3],"{}");
      process.exit(0);
    `,
      join(f.directory, "state.sqlite"),
      randomUUID(),
      f.run.id,
    ]);
    f.reopen();
    assert.equal(f.store.listTasks().length, 1);
    assert.equal(f.store.events().length, 3);
  } finally {
    await f.close();
  }
});

test("run snapshots validate role/profile references and preserve guidance independently of later edits", async () => {
  const f = await domainFixture();
  try {
    const now = new Date().toISOString();
    const meta = () => ({ id: randomUUID(), createdAt: now, updatedAt: now });
    const role = {
      ...meta(),
      version: 1,
      name: "Reader",
      instructions: "Original guidance",
      expectedOutput: "Report",
    };
    const profile = {
      ...meta(),
      name: "Ada",
      roleId: role.id,
      harness: "pi",
      model: "discovered-model",
      thinking: null,
      permission: "read_only",
      instructionOverride: null,
    };
    const snapshot = teamSnapshotSchema.parse({
      preset: {
        ...meta(),
        version: 1,
        name: "Readers",
        leadProfileId: profile.id,
        workerProfileIds: [],
        workflowTemplateIds: [],
        mode: "chat_plan",
        limits: defaultLimits,
      },
      roles: [role],
      profiles: [profile],
      workflows: [],
    });
    assert.equal(
      teamSnapshotSchema.safeParse({ ...snapshot, roles: [] }).success,
      false,
    );
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Snapshot run",
        initialPrompt: "Use saved guidance",
        teamSnapshot: snapshot,
      },
      "snapshot",
    );
    snapshot.roles[0] = {
      ...role,
      version: 2,
      instructions: "Edited afterwards",
    };
    f.reopen();
    assert.equal(
      f.store.getRun(run.id).teamSnapshot?.roles[0]?.instructions,
      "Original guidance",
    );
  } finally {
    await f.close();
  }
});

test("migration v2 preserves v1 runs while correcting legacy mode names and saved results", async () => {
  const f = await domainFixture();
  try {
    f.store.db.exec(
      "DROP INDEX one_writer; DROP INDEX one_lead; DROP TABLE reservations; DROP TABLE dispatches; PRAGMA user_version=1;",
    );
    f.store.db
      .prepare("UPDATE runs SET data=json_set(data,'$.mode','chat') WHERE id=?")
      .run(f.run.id);
    f.store.db
      .prepare(
        "UPDATE mutations SET result=json_set(result,'$.mode','chat') WHERE key='run'",
      )
      .run();
    const before = f.store.events();
    f.reopen();
    assert.equal(f.store.getRun(f.run.id).mode, "chat_plan");
    assert.equal(
      JSON.parse(
        String(
          f.store.db
            .prepare("SELECT result FROM mutations WHERE key='run'")
            .get()?.result,
        ),
      ).mode,
      "chat_plan",
    );
    assert.deepEqual(f.store.events(), before);
    assert.equal(
      f.store.db.prepare("PRAGMA user_version").get()?.user_version,
      2,
    );
  } finally {
    await f.close();
  }
});
