import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkflowTemplate,
  getWorkflowRun,
} from "../src/server/storage/workflows.ts";
import { defaultLimits } from "../src/shared/domain/entities.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import {
  readerId,
  workflowSchedulingFixture,
  writerId,
} from "./helpers/workflow-scheduling-fixture.ts";

test("workflow children share global reader, writer and total slots with ordinary work and an active Lead across runs", async () => {
  const f = await workflowSchedulingFixture({
    ...defaultLimits,
    maxConcurrentWriters: 1,
    maxConcurrentReadersReviewers: 2,
    maxConcurrentAgentsIncludingLead: 3,
  });
  try {
    const base = {
      instructions: "Inspect a bounded partition",
      inputs: [],
      result: "Evidence",
      dependsOn: [],
      partialFailure: "stop",
    };
    const template = createWorkflowTemplate(
      f.store,
      {
        name: "Mixed workers",
        inputs: [],
        results: [
          { name: "reads", stageId: "readers" },
          { name: "writes", stageId: "writers" },
        ],
        stages: [
          {
            ...base,
            id: "readers",
            type: "parallel_agents",
            profileId: readerId,
            count: 3,
            partitions: ["Entry", "State", "Tests"],
          },
          {
            ...base,
            id: "writers",
            type: "parallel_agents",
            profileId: writerId,
            count: 2,
            partitions: ["First implementation", "Second implementation"],
          },
        ],
      },
      "mixed-template",
    );
    const snapshot = structuredClone(fakeTeamSnapshot);
    snapshot.preset.workflowTemplateIds = [template.id];
    snapshot.workflows = [template];
    const run = f.store.createRun(
      {
        projectId: f.run.projectId,
        title: "Mixed workflow",
        initialPrompt: "Bounded work",
        teamSnapshot: snapshot,
        repository: f.run.repository,
        limits: f.run.limits,
      },
      "mixed-run",
    );
    const workflow = f.engine.workflows.start(
      { runId: run.id, templateId: template.id, parameters: {} },
      "mixed",
    );
    await f.engine.workflows.reconcile();
    f.store.updateRun({ id: run.id, status: "paused" }, "setup-pause");
    const lead = f.store.createTask(
      { runId: f.run.id, title: "Lead", objective: "Discuss", kind: "lead" },
      "lead",
    );
    const leadDispatch = f.engine.scheduling.enqueueLead(
      lead.id,
      "success",
      "lead-queue",
    );
    const ordinary = [readerId, writerId].map((profileId) => {
      const task = f.engine.createTask(
        { runId: f.run.id, title: "Ordinary", objective: "Compete for a slot" },
        `task:${profileId}`,
      );
      return f.engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: task.id, profileId },
        `queue:${profileId}`,
      );
    });
    const reader = ordinary[0],
      writer = ordinary[1];
    assert.ok(reader && writer);
    assert.ok(f.engine.scheduling.reserve(leadDispatch));
    assert.ok(f.engine.scheduling.reserve(reader));
    assert.ok(f.engine.scheduling.reserve(writer));
    f.store.updateRun({ id: run.id, status: "active" }, "active");
    const readers = f.engine.scheduling
      .list()
      .filter((dispatch) =>
        workflow.stages[0]?.taskIds.includes(dispatch.taskId),
      );
    const writers = f.engine.scheduling
      .list()
      .filter((dispatch) =>
        workflow.stages[1]?.taskIds.includes(dispatch.taskId),
      );
    const [first, second, third] = readers;
    const [firstWriter, secondWriter] = writers;
    assert.ok(first && second && third && firstWriter && secondWriter);
    assert.equal(f.engine.scheduling.reserve(first), null);
    f.engine.scheduling.release(leadDispatch);
    assert.ok(f.engine.scheduling.reserve(first));
    assert.equal(f.engine.scheduling.reserve(second), null);
    assert.equal(f.engine.scheduling.reserve(firstWriter), null);
    f.engine.scheduling.release(reader);
    assert.ok(f.engine.scheduling.reserve(second));
    assert.equal(f.engine.scheduling.reserve(third), null);
    f.engine.scheduling.release(writer);
    assert.ok(f.engine.scheduling.reserve(firstWriter));
    assert.equal(f.engine.scheduling.reserve(secondWriter), null);
    assert.notEqual(firstWriter.cwd, secondWriter.cwd);
    f.engine.scheduling.release(first);
    assert.ok(f.engine.scheduling.reserve(third));
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) count FROM reservations").get()
        ?.count,
      3,
    );
    assert.equal(f.engine.scheduling.committedLaunches(run.id), 5);
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 2);
    assert.ok(
      [...readers, ...writers].every(
        (dispatch) => f.store.getTask(dispatch.taskId).status !== "BACKLOG",
      ),
    );
    for (const id of [run.id, f.run.id])
      f.store.updateRun({ id, status: "paused" }, `pause:${id}`);
  } finally {
    await f.close();
  }
});

test("children queued over the concurrency cap keep their dispatches across pause and restart and eventually all execute", async () => {
  const f = await workflowSchedulingFixture({
    ...defaultLimits,
    maxConcurrentReadersReviewers: 1,
    maxConcurrentAgentsIncludingLead: 1,
    maxTotalWorkerLaunchesPerRun: 3,
  });
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
    const queued = f.engine.scheduling.list();
    assert.equal(queued.length, 2);
    assert.ok(queued.every((dispatch) => dispatch.state === "queued"));
    await f.engine.idle();
    assert.equal(f.store.listAttempts().length, 0);
    await f.restart();
    assert.deepEqual(f.engine.scheduling.list(), queued);
    f.store.updateRun({ id: f.run.id, status: "active" }, "resume");
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "completed");
    assert.equal(f.store.listAttempts().length, 3);
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), 3);
    assert.equal(
      f.store.db.prepare("SELECT COUNT(*) count FROM reservations").get()
        ?.count,
      0,
    );
    assert.ok(
      workflow.stages
        .flatMap((stage) => stage.taskIds)
        .every((id) => f.store.getTask(id).status === "AWAITING_REVIEW"),
    );
  } finally {
    await f.close();
  }
});
