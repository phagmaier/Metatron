import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { Engine } from "../src/server/orchestration/engine.ts";
import {
  createWorkflowTemplate,
  getWorkflowRun,
  listWorkflowRuns,
} from "../src/server/storage/workflows.ts";
import {
  defaultLimits,
  type WorkflowTemplate,
} from "../src/shared/domain/entities.ts";
import { workflowContentSchema } from "../src/shared/domain/workflow.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

type Stage = WorkflowTemplate["stages"][number];
const readerId = "00000000-0000-4000-8000-000000000013";
const synthId = "00000000-0000-4000-8000-000000000014";
function stage(id: string, overrides: Partial<Stage> = {}): Stage {
  return {
    id,
    type: "single_agent",
    profileId: readerId,
    instructions: "Inspect the declared inputs",
    inputs: [{ name: "target", source: "parameter", ref: "target" }],
    result: "Findings with file locations and gaps",
    dependsOn: [],
    count: 1,
    partitions: [],
    partialFailure: "stop",
    ...overrides,
  };
}
function content(stages: Stage[]) {
  return {
    name: "Fixture static workflow",
    inputs: [{ name: "target", description: "Subsystem to inspect" }],
    results: [{ name: "findings", stageId: stages.at(-1)?.id }],
    stages,
  };
}
async function fixture(stages: Stage[], limits = defaultLimits) {
  const f = await domainFixture();
  const git = await createGitFixture();
  let engine = new Engine(f.store, f.directory);
  const project = await engine.openProject(
    { name: "Workflow fixture", repositoryPath: git.directory },
    "workflow-project",
  );
  const template = createWorkflowTemplate(f.store, content(stages), "template");
  const snapshot = structuredClone(fakeTeamSnapshot);
  snapshot.preset.workflowTemplateIds = [template.id];
  snapshot.workflows = [template];
  const run = f.store.createRun(
    {
      projectId: project.id,
      title: "FAKE workflow",
      initialPrompt: "Exercise saved recipe",
      teamSnapshot: snapshot,
      repository: project.repository,
      limits,
    },
    "workflow-run",
  );
  const input = {
    runId: run.id,
    templateId: template.id,
    parameters: { target: "src/engine" },
  };
  return {
    ...f,
    run,
    template,
    input,
    get store() {
      return f.store;
    },
    get engine() {
      return engine;
    },
    async restart() {
      await engine.close();
      f.reopen();
      engine = new Engine(f.store, f.directory);
    },
    async close() {
      await engine.close();
      await git.verify(async () =>
        assert.equal(await git.git("status", "--porcelain"), ""),
      );
      await f.close();
    },
  };
}
const fanIn = (policy: "stop" | "include_partial"): Stage[] => [
  stage("read", {
    type: "parallel_agents",
    count: 2,
    partitions: ["Entry points and callers", "State and data flow"],
  }),
  stage("synthesis", {
    type: "synthesize",
    profileId: synthId,
    dependsOn: ["read"],
    inputs: [{ name: "readers", source: "stage", ref: "read" }],
    partialFailure: policy,
  }),
];

test("workflow contracts reject cycles, undeclared inputs/results, duplicate identities and unbounded or ambiguous stage shapes", () => {
  const valid = content(fanIn("include_partial"));
  assert.equal(workflowContentSchema.safeParse(valid).success, true);
  const invalid = [
    { ...valid, inputs: [...valid.inputs, ...valid.inputs] },
    { ...valid, results: [{ name: "findings", stageId: "missing" }] },
    {
      ...valid,
      stages: [
        stage("first", { dependsOn: ["second"] }),
        stage("second", { dependsOn: ["first"] }),
      ],
    },
    { ...valid, stages: [stage("same"), stage("same")] },
    {
      ...valid,
      stages: [
        stage("bad", {
          inputs: [{ name: "secret", source: "parameter", ref: "undeclared" }],
        }),
      ],
    },
    {
      ...valid,
      stages: [
        stage("bad", {
          inputs: [{ name: "source", source: "stage", ref: "read" }],
        }),
      ],
    },
    { ...valid, stages: [stage("bad", { type: "synthesize" })] },
    { ...valid, stages: [stage("bad", { count: 2 })] },
    {
      ...valid,
      stages: [
        stage("bad", {
          type: "parallel_agents",
          count: 3,
          partitions: ["Only one partition"],
        }),
      ],
    },
    { ...valid, stages: [stage("bad", { instructions: "x".repeat(4001) })] },
    {
      ...valid,
      stages: [stage("bad"), { ...stage("nested"), type: "run_workflow" }],
    },
  ];
  for (const candidate of invalid)
    assert.equal(workflowContentSchema.safeParse(candidate).success, false);
});

test("sequential stages consume prior saved results only after authoritative completion, retain review state and replay without duplicate launches", async () => {
  const f = await fixture([
    stage("first"),
    stage("second", {
      dependsOn: ["first"],
      inputs: [{ name: "prior", source: "stage", ref: "first" }],
    }),
  ]);
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    const first = workflow.stages[0]?.taskIds[0] ?? "";
    const second = workflow.stages[1]?.taskIds[0] ?? "";
    assert.throws(
      () =>
        f.engine.scheduling.enqueue(
          { role: "owner" },
          { taskId: second, profileId: readerId },
          "bypass",
        ),
      { code: "POLICY_DENIED" },
    );
    await f.engine.workflows.reconcile();
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: first, profileId: synthId },
      "owner-override",
    );
    await f.engine.pump();
    assert.equal(f.store.getTask(first).status, "RUNNING");
    assert.equal(f.store.getTask(second).status, "BACKLOG");
    assert.equal(
      f.store.listAttempts().find((attempt) => attempt.taskId === first)
        ?.profileId,
      synthId,
    );
    await f.engine.idle();
    const completed = getWorkflowRun(f.store, workflow.id);
    assert.equal(completed.status, "completed");
    assert.deepEqual(
      completed.stages.map((state) => state.status),
      ["completed", "completed"],
    );
    assert.equal(f.store.getTask(first).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(second).status, "AWAITING_REVIEW");
    const reports = await f.engine.reports(first);
    const artifactId = reports.find(
      (report) => report.artifact.kind === "report",
    )?.artifact.id;
    assert.ok(artifactId);
    const packet = JSON.parse(
      f.store.getTask(second).objective.split("\n\n").at(-1) ?? "",
    );
    assert.equal(packet.upstream[0].artifactId, artifactId);
    assert.equal(packet.upstream[0].status, "completed");
    assert.match(packet.upstream[0].excerpt, /FAKE report/);
    const events = f.store.events({ runId: f.run.id, limit: 500 });
    assert.ok(
      (events.find(
        (event) => event.type === "report.saved" && event.taskId === first,
      )?.sequence ?? Infinity) <
        (events.find(
          (event) =>
            event.type === "attempt.created" && event.taskId === second,
        )?.sequence ?? 0),
    );
    assert.deepEqual(f.engine.workflows.results(workflow.id), [
      {
        name: "findings",
        stageId: "second",
        status: "completed",
        taskIds: [second],
      },
    ]);
    const attempts = f.store.listAttempts();
    await f.restart();
    assert.deepEqual(f.engine.workflows.start(f.input, "start"), workflow);
    await f.engine.idle();
    assert.deepEqual(f.store.listAttempts(), attempts);
    assert.equal(listWorkflowRuns(f.store, f.run.id).length, 1);
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "completed");
  } finally {
    await f.close();
  }
});

for (const policy of ["include_partial", "stop"] as const) {
  test(`parallel children execute independently and ${policy} governs a confirmed reader failure before synthesis`, async () => {
    const f = await fixture(fanIn(policy));
    try {
      const workflow = f.engine.workflows.start(f.input, "start");
      await f.engine.workflows.reconcile();
      const readers = workflow.stages[0]?.taskIds ?? [];
      const failed = readers[1] ?? "";
      const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
      f.engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: failed, profileId: readerId, scenario: "failure" },
        "fail-reader",
      );
      await f.engine.pump();
      assert.deepEqual(
        readers.map((id) => f.store.getTask(id).status),
        ["RUNNING", "RUNNING"],
      );
      assert.equal(f.store.getTask(synthesis).status, "BACKLOG");
      await f.engine.idle();
      const result = getWorkflowRun(f.store, workflow.id);
      assert.equal(
        result.status,
        policy === "include_partial" ? "partial" : "failed",
      );
      assert.equal(f.store.getTask(failed).status, "RETRY_DECISION");
      assert.equal(
        f.store.getTask(synthesis).status,
        policy === "include_partial" ? "AWAITING_REVIEW" : "BACKLOG",
      );
      if (policy === "include_partial") {
        const packet = JSON.parse(
          f.store.getTask(synthesis).objective.split("\n\n").at(-1) ?? "",
        );
        assert.deepEqual(
          packet.upstream.map((source: { status: string }) => source.status),
          ["completed", "failed"],
        );
        assert.equal(packet.upstream[1].artifactId, null);
        assert.equal(packet.upstream[1].excerpt, "");
        assert.equal(packet.upstream[1].taskId, failed);
      }
      const attempts = f.store.listAttempts();
      await f.restart();
      await f.engine.idle();
      assert.deepEqual(f.store.listAttempts(), attempts);
      assert.equal(getWorkflowRun(f.store, workflow.id).status, result.status);
    } finally {
      await f.close();
    }
  });
}

test("workflow launch validates snapshot membership, parameter names, mode, roster and fan-out atomically; pending inputs and queued children survive restart", async () => {
  const f = await fixture(fanIn("include_partial"), {
    ...defaultLimits,
    maxParallelReadersPerWorkflow: 1,
  });
  try {
    assert.throws(
      () =>
        createWorkflowTemplate(
          f.store,
          content([
            stage("lead", { profileId: fakeTeamSnapshot.preset.leadProfileId }),
          ]),
          "coordinator",
        ),
      { code: "POLICY_DENIED" },
    );
    const before = f.store.listTasks().length;
    for (const input of [
      f.input,
      { ...f.input, templateId: randomUUID() },
      { ...f.input, parameters: { wrong: "value" } },
      { ...f.input, parameters: { target: "x", extra: "y" } },
    ]) {
      assert.throws(() =>
        f.engine.workflows.start(input, `refused:${randomUUID()}`),
      );
      assert.equal(f.store.listTasks().length, before);
      assert.equal(listWorkflowRuns(f.store, f.run.id).length, 0);
    }
    f.store.updateRun({ id: f.run.id, mode: "chat_plan" }, "chat");
    assert.throws(() => f.engine.workflows.start(f.input, "chat-start"), {
      code: "POLICY_DENIED",
    });
    const single = createWorkflowTemplate(
      f.store,
      content([stage("one")]),
      "single-template",
    );
    const snapshot = structuredClone(fakeTeamSnapshot);
    snapshot.preset.workflowTemplateIds = [single.id];
    snapshot.workflows = [single];
    const run = f.store.createRun(
      {
        projectId: f.run.projectId,
        title: "Queued restart",
        initialPrompt: "Read fixture",
        teamSnapshot: snapshot,
        repository: f.run.repository,
      },
      "queued-run",
    );
    const input = { ...f.input, runId: run.id, templateId: single.id };
    const workflow = f.engine.workflows.start(input, "queued-start");
    f.store.updateRun({ id: run.id, status: "paused" }, "pause");
    await f.restart();
    await f.engine.idle();
    assert.equal(
      f.store.getTask(workflow.stages[0]?.taskIds[0] ?? "").status,
      "BACKLOG",
    );
    f.store.updateRun({ id: run.id, status: "active" }, "resume");
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "completed");
    assert.equal(
      f.store
        .listAttempts()
        .filter((attempt) => attempt.taskId === workflow.stages[0]?.taskIds[0])
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("ambiguous child disconnect never becomes partial success and restart never resubmits it", async () => {
  const f = await fixture(fanIn("include_partial"));
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    const disconnected = workflow.stages[0]?.taskIds[0] ?? "";
    const synthesis = workflow.stages[1]?.taskIds[0] ?? "";
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: disconnected, profileId: readerId, scenario: "disconnect" },
      "disconnect",
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(disconnected).status, "RETRY_DECISION");
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "blocked");
    assert.equal(f.store.getTask(synthesis).status, "BACKLOG");
    const attempts = f.store.listAttempts();
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(f.store.listAttempts(), attempts);
    assert.equal(f.store.getTask(synthesis).status, "BACKLOG");
  } finally {
    await f.close();
  }
});

test("synthesis bounds large report excerpts and blocks on an unavailable original rather than fabricating evidence", async () => {
  const f = await fixture(fanIn("include_partial"));
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.workflows.reconcile();
    // Pause the run before the engine can prepare synthesis; complete only the readers.
    await f.engine.pump();
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
    await f.engine.idle();
    const first = workflow.stages[0]?.taskIds[0] ?? "";
    const reports = await f.engine.reports(first);
    const report = reports.find((report) => report.artifact.kind === "report");
    assert.ok(report);
    await writeFile(
      report.artifact.path,
      "Bounded source evidence. ".repeat(20_000),
    );
    f.store.updateRun({ id: f.run.id, status: "active" }, "resume");
    await f.engine.idle();
    const synth = f.store.getTask(workflow.stages[1]?.taskIds[0] ?? "");
    assert.ok(synth.objective.length <= 32_768);
    const packet = JSON.parse(synth.objective.split("\n\n").at(-1) ?? "");
    assert.match(packet.upstream[0].excerpt, /^Bounded source evidence/);
    assert.ok(packet.upstream[0].excerpt.length < 2200);
    assert.equal(
      (await f.engine.reports(first))[0]?.content.length,
      "Bounded source evidence. ".length * 20_000,
    );

    const missing = f.engine.workflows.start(f.input, "missing-start");
    await f.engine.pump();
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause-again");
    await f.engine.idle();
    const original = (
      await f.engine.reports(missing.stages[0]?.taskIds[0] ?? "")
    ).find((report) => report.artifact.kind === "report");
    assert.ok(original);
    await rm(original.artifact.path);
    f.store.updateRun({ id: f.run.id, status: "active" }, "resume-again");
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, missing.id).status, "blocked");
    assert.equal(
      f.store.getTask(missing.stages[1]?.taskIds[0] ?? "").status,
      "BACKLOG",
    );
  } finally {
    await f.close();
  }
});

test("a stage journal failure rolls back every child dispatch, input packet and prepared stage together", async () => {
  const f = await fixture(fanIn("include_partial"));
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    const second = workflow.stages[0]?.taskIds[1] ?? "";
    f.store.db.exec(
      `CREATE TRIGGER refuse_second_workflow_child BEFORE INSERT ON events WHEN NEW.type='task.assigned' AND NEW.task_id='${second}' BEGIN SELECT RAISE(ABORT, 'fixture journal failure'); END;`,
    );
    await assert.rejects(f.engine.workflows.reconcile(), { code: "STORAGE" });
    assert.equal(
      getWorkflowRun(f.store, workflow.id).stages[0]?.status,
      "pending",
    );
    assert.equal(
      f.engine.scheduling
        .list()
        .filter((dispatch) => dispatch.runId === f.run.id).length,
      0,
    );
    assert.deepEqual(
      (workflow.stages[0]?.taskIds ?? []).map(
        (id) => f.store.getTask(id).status,
      ),
      ["BACKLOG", "BACKLOG"],
    );
    f.store.db.exec("DROP TRIGGER refuse_second_workflow_child");
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, workflow.id).status, "completed");
    assert.equal(
      f.store
        .listAttempts()
        .filter(
          (attempt) =>
            f.store.getTask(attempt.taskId).workflowId === workflow.id,
        ).length,
      3,
    );
  } finally {
    await f.close();
  }
});
