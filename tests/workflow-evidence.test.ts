import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { executeFakeTurn } from "../src/server/orchestration/execute.ts";
import {
  decideRecovery,
  recheckRecovery,
} from "../src/server/orchestration/recovery-decisions.ts";
import { getWorkflowRun } from "../src/server/storage/workflows.ts";
import { defaultLimits } from "../src/shared/domain/entities.ts";
import { handoffReportSchema } from "../src/shared/orchestration.ts";
import {
  readerId,
  synthId,
  workflowSchedulingFixture,
} from "./helpers/workflow-scheduling-fixture.ts";

test("partial synthesis pins exact reader attempts, originals and failure evidence independently of mutable task text", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const [reader = "", failed = ""] = workflow.stages[0]?.taskIds ?? [];
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: failed, profileId: readerId, scenario: "failure" },
      "fail-reader",
    );
    await f.engine.pump();
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
    await f.engine.idle();
    const original = (await f.engine.reports(reader)).find(
      (entry) => entry.artifact.kind === "report",
    );
    assert.ok(original);
    const content =
      "Fixture citation: src/module.ts:73\n" +
      "Detailed retained evidence. ".repeat(3000);
    await writeFile(original.artifact.path, content);
    f.store.updateRun({ id: f.run.id, status: "active" }, "resume");
    await f.engine.idle();
    const view = f.engine.workflows.evidence(workflow.id);
    const successful = view.children.find((child) => child.task.id === reader);
    const unsuccessful = view.children.find(
      (child) => child.task.id === failed,
    );
    const consumer = view.children.find((child) => child.task.id === synthesis);
    assert.ok(successful && unsuccessful && consumer?.handoff);
    const [success, failure] = consumer.handoff.sources;
    assert.equal(success?.attemptId, successful.attempts[0]?.attempt.id);
    assert.equal(success?.artifactId, original.artifact.id);
    assert.equal(
      success?.resultEventId,
      successful.attempts[0]?.resultEvent?.eventId,
    );
    assert.equal(failure?.status, "failed");
    assert.equal(failure?.failure, "failed");
    assert.equal(failure?.attemptId, unsuccessful.attempts[0]?.attempt.id);
    assert.equal(failure?.artifactId, null);
    assert.equal(failure?.resultEventId, null);
    assert.equal(
      failure?.failureEventId,
      unsuccessful.attempts[0]?.diagnostics.find(
        (event) => event.type === "attempt.diagnostic",
      )?.eventId,
    );
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "partial");
    const packet = JSON.parse(
      f.store.getTask(synthesis).objective.split("\n\n").at(-1) ?? "",
    );
    assert.match(packet.upstream[0].excerpt, /src\/module\.ts:73/);
    assert.ok(packet.upstream[0].excerpt.length < 2200);
    assert.equal(packet.upstream[1].attemptId, failure?.attemptId);
    assert.equal(packet.upstream[1].failureEventId, failure?.failureEventId);
    assert.equal(packet.upstream[1].excerpt, "");
    const handoff = consumer.handoff;
    f.engine.updateTask(
      { id: synthesis, objective: "Owner notes replaced the task text" },
      "edit-objective",
    );
    f.engine.cancel(reader, "cancel-after-consumption");
    const attempts = f.store.listAttempts();
    await f.restart();
    await f.engine.idle();
    const reopened = f.engine.workflows.evidence(workflow.id);
    assert.deepEqual(
      reopened.children.find((child) => child.task.id === synthesis)?.handoff,
      handoff,
    );
    assert.deepEqual(f.store.listAttempts(), attempts);
    assert.equal(await readFile(original.artifact.path, "utf8"), content);
    assert.equal(
      reopened.children.find((child) => child.task.id === reader)?.task.status,
      "CANCELLED",
    );
    assert.equal(
      reopened.children.find((child) => child.task.id === reader)?.attempts[0]
        ?.artifacts[0]?.id,
      original.artifact.id,
    );
    assert.throws(() =>
      f.store.db
        .prepare("UPDATE workflow_handoffs SET data=data WHERE task_id=?")
        .run(synthesis),
    );
    assert.throws(() =>
      f.store.db
        .prepare("DELETE FROM workflow_handoffs WHERE task_id=?")
        .run(synthesis),
    );
  } finally {
    await f.close();
  }
});

test("reader retries preserve failed evidence while synthesis binds only the successful successor", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const reader = workflow.stages[0]?.taskIds[0] ?? "";
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    const dispatch = f.engine.scheduling
      .list()
      .find((d) => d.taskId === reader);
    assert.ok(dispatch);
    const failed = f.engine.scheduling.reserve(dispatch);
    assert.ok(failed);
    f.engine.fail(
      reader,
      failed,
      "Fixture reader failure with retained diagnostic",
    );
    f.engine.scheduling.release(dispatch);
    const check = await recheckRecovery(f.engine, { taskId: reader }, "check");
    await decideRecovery(
      f.engine,
      {
        taskId: reader,
        checkId: check.id,
        profileId: synthId,
        contextPolicy: "fresh",
        acceptUnverified: true,
      },
      "retry",
    );
    await f.engine.idle();
    const view = f.engine.workflows.evidence(workflow.id);
    const history = view.children.find((child) => child.task.id === reader);
    const handoff = view.children.find(
      (child) => child.task.id === synthesis,
    )?.handoff;
    assert.ok(history && handoff);
    assert.deepEqual(
      history.attempts.map((item) => item.attempt.status),
      ["failed", "completed"],
    );
    assert.equal(history.attempts[0]?.attempt.id, failed);
    assert.equal(history.attempts[0]?.artifacts.length, 0);
    assert.equal(
      history.attempts[0]?.diagnostics[0]?.type,
      "attempt.diagnostic",
    );
    assert.equal(
      handoff.sources[0]?.attemptId,
      history.attempts[1]?.attempt.id,
    );
    assert.equal(
      handoff.sources[0]?.artifactId,
      history.attempts[1]?.artifacts.find(
        (artifact) => artifact.kind === "report",
      )?.id,
    );
    assert.equal(handoff.sources[0]?.failureEventId, null);
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 4);
  } finally {
    await f.close();
  }
});

test("an ambiguous reader retains diagnostics without creating synthesis evidence or partial success", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture(undefined, 1);
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const reader = workflow.stages[0]?.taskIds[0] ?? "";
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: reader, profileId: readerId, scenario: "disconnect" },
      "disconnect",
    );
    await f.engine.idle();
    const view = f.engine.workflows.evidence(workflow.id);
    const evidence = view.children.find((child) => child.task.id === reader);
    assert.equal(evidence?.attempts[0]?.attempt.status, "interrupted");
    assert.equal(
      evidence?.attempts[0]?.attempt.recovery?.cause,
      "disconnected",
    );
    assert.equal(evidence?.outcome.status, "blocked");
    assert.equal(
      view.children.find((child) => child.task.id === synthesis)?.handoff,
      null,
    );
    assert.equal(f.store.getTask(synthesis).status, "BACKLOG");
    const attempts = f.store.listAttempts();
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(f.store.listAttempts(), attempts);
    assert.equal(
      f.engine.workflows
        .evidence(workflow.id)
        .children.find((child) => child.task.id === synthesis)?.handoff,
      null,
    );
  } finally {
    await f.close();
  }
});

test("budget-held synthesis keeps its prepared source bindings without inventing an attempt or failure", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture(
    { ...defaultLimits, maxTotalWorkerLaunchesPerRun: 1 },
    1,
  );
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.idle();
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    const evidence = f.engine.workflows
      .evidence(workflow.id)
      .children.find((child) => child.task.id === synthesis);
    assert.ok(evidence?.handoff);
    assert.equal(evidence.task.status, "QUEUED");
    assert.equal(evidence.outcome.status, "blocked");
    assert.equal(evidence.attempts.length, 0);
    assert.equal(evidence.handoff.sources[0]?.status, "completed");
    assert.equal(evidence.handoff.sources[0]?.failure, null);
    const before = evidence.handoff;
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(
      f.engine.workflows
        .evidence(workflow.id)
        .children.find((child) => child.task.id === synthesis)?.handoff,
      before,
    );
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});

test("a handoff journal failure rolls back synthesis bindings, input and dispatch as one retryable preparation", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    for (const taskId of workflow.stages[0]?.taskIds ?? []) {
      const dispatch = f.engine.scheduling
        .list()
        .find((d) => d.taskId === taskId);
      assert.ok(dispatch);
      const attempt = f.engine.scheduling.reserve(dispatch);
      assert.ok(attempt);
      await executeFakeTurn(f.engine, dispatch, attempt);
      f.engine.scheduling.release(dispatch);
    }
    const objective = f.store.getTask(synthesis).objective;
    f.store.db.exec(
      `CREATE TRIGGER refuse_handoff BEFORE INSERT ON events WHEN NEW.type='workflow.handoff_saved' AND NEW.task_id='${synthesis}' BEGIN SELECT RAISE(ABORT, 'fixture handoff failure'); END;`,
    );
    await assert.rejects(f.engine.workflows.reconcile(), { code: "STORAGE" });
    assert.equal(
      f.engine.workflows
        .evidence(workflow.id)
        .children.find((child) => child.task.id === synthesis)?.handoff,
      null,
    );
    assert.equal(f.store.getTask(synthesis).objective, objective);
    assert.equal(f.store.getTask(synthesis).status, "BACKLOG");
    assert.equal(
      f.engine.scheduling.list().some((d) => d.taskId === synthesis),
      false,
    );
    f.store.db.exec("DROP TRIGGER refuse_handoff");
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "completed");
    assert.equal(
      f.store.db
        .prepare("SELECT COUNT(*) n FROM workflow_handoffs WHERE workflow_id=?")
        .get(workflow.id)?.n,
      3,
    );
    assert.equal(f.store.listAttempts().length, 3);
  } finally {
    await f.close();
  }
});

test("cancellation during source reads cannot commit stale successful provenance", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const reader = workflow.stages[0]?.taskIds[0] ?? "";
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    for (const taskId of workflow.stages[0]?.taskIds ?? []) {
      const dispatch = f.engine.scheduling
        .list()
        .find((d) => d.taskId === taskId);
      assert.ok(dispatch);
      const attempt = f.engine.scheduling.reserve(dispatch);
      assert.ok(attempt);
      await executeFakeTurn(f.engine, dispatch, attempt);
      f.engine.scheduling.release(dispatch);
    }
    const preparing = f.engine.workflows.reconcile();
    f.engine.cancel(reader, "owner-cancel-during-read");
    await preparing;
    assert.equal(
      f.engine.workflows
        .evidence(workflow.id)
        .children.find((child) => child.task.id === synthesis)?.handoff,
      null,
    );
    await f.engine.idle();
    const source = f.engine.workflows
      .evidence(workflow.id)
      .children.find((child) => child.task.id === synthesis)?.handoff
      ?.sources[0];
    assert.equal(source?.taskId, reader);
    assert.equal(source?.status, "failed");
    assert.equal(source?.failure, "cancelled");
    assert.equal(source?.artifactId, null);
    assert.ok(source?.failureEventId);
  } finally {
    await f.close();
  }
});

test("v9 upgrade retains legacy reports and queued identities without inventing retrospective handoffs", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.idle();
    const queued = f.engine.workflows.start(f.input, "queued-start");
    await f.engine.workflows.reconcile();
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause-upgrade");
    const attempts = f.store.listAttempts();
    const dispatches = f.engine.scheduling.list();
    f.store.db.exec("DROP TABLE workflow_handoffs; PRAGMA user_version=9;");
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(f.store.listAttempts(), attempts);
    assert.deepEqual(f.engine.scheduling.list(), dispatches);
    for (const child of f.engine.workflows.evidence(workflow.id).children) {
      assert.equal(child.handoff, null);
      assert.equal(child.attempts[0]?.attempt.status, "completed");
      const report = child.attempts[0]?.artifacts.find(
        (artifact) => artifact.kind === "report",
      );
      assert.ok(report);
      assert.match(await readFile(report.path, "utf8"), /FAKE report/);
    }
    assert.deepEqual(f.engine.workflows.start(f.input, "start"), workflow);
    assert.ok(
      f.engine.scheduling
        .list()
        .some((dispatch) => dispatch.state === "queued"),
    );
    assert.ok(
      f.engine.workflows
        .evidence(queued.id)
        .children.every((child) => child.handoff === null),
    );
    f.store.updateRun({ id: f.run.id, status: "active" }, "resume-upgrade");
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, queued.id).status, "completed");
    assert.equal(
      f.engine.workflows
        .evidence(queued.id)
        .children.find((child) => child.stageId === "synthesis")?.handoff
        ?.sources.length,
      2,
    );
    const next = f.engine.workflows.start(f.input, "new-start");
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, next.id).status, "completed");
    assert.equal(
      f.engine.workflows
        .evidence(next.id)
        .children.find((child) => child.stageId === "synthesis")?.handoff
        ?.sources.length,
      2,
    );
  } finally {
    await f.close();
  }
});

test("a reader's provisional partial report remains evidence after failure, never a successful source report", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture(undefined, 1);
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const reader = workflow.stages[0]?.taskIds[0] ?? "";
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    const dispatch = f.engine.scheduling
      .list()
      .find((item) => item.taskId === reader);
    assert.ok(dispatch);
    const attempt = f.engine.scheduling.reserve(dispatch);
    assert.ok(attempt);
    const session = f.store.createSession(
      { attemptId: attempt },
      "reader-session",
    );
    f.store.updateSession(
      { id: session.id, expectedState: "not_started", state: "starting" },
      "session-starting",
    );
    f.store.updateSession(
      { id: session.id, expectedState: "starting", state: "busy" },
      "session-busy",
    );
    const report = {
      outcome: "partial",
      summary: "Fixture findings retained before the reader failed",
      findings: [
        {
          severity: "info",
          location: "src/fixture.ts:18",
          text: "Fixture citation; not a live harness observation",
        },
      ],
      knownRisks: ["The second partition could not be investigated"],
    };
    f.engine.tool(
      { role: "worker", sessionId: session.id },
      f.run.id,
      { name: "submit_result", taskId: reader, report },
      "partial-result",
    );
    f.engine.fail(
      reader,
      attempt,
      "Confirmed fixture failure after a provisional report",
    );
    f.engine.scheduling.release(dispatch);
    await f.engine.idle();
    const view = f.engine.workflows.evidence(workflow.id);
    const history = view.children.find((child) => child.task.id === reader)
      ?.attempts[0];
    const source = view.children.find((child) => child.task.id === synthesis)
      ?.handoff?.sources[0];
    assert.ok(history?.resultEvent);
    const retained = handoffReportSchema.parse(
      history.resultEvent.payload.report,
    );
    assert.equal(retained.outcome, "partial");
    assert.equal(retained.findings[0]?.location, "src/fixture.ts:18");
    assert.deepEqual(retained.knownRisks, [
      "The second partition could not be investigated",
    ]);
    assert.equal(history.artifacts.length, 0);
    assert.equal(source?.status, "failed");
    assert.equal(source?.artifactId, null);
    assert.equal(source?.resultEventId, history.resultEvent.eventId);
    assert.equal(source?.failureEventId, history.diagnostics[0]?.eventId);
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "partial");
    const snapshot = f.engine.workflows.evidence(workflow.id);
    await f.restart();
    assert.deepEqual(f.engine.workflows.evidence(workflow.id), snapshot);
  } finally {
    await f.close();
  }
});
