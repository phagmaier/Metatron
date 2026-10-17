import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { startApp } from "../src/server/app.ts";
import { createExploreSubsystemTemplate } from "../src/server/storage/workflows.ts";
import {
  artifactContentResponseSchema,
  eventsResponseSchema,
} from "../src/shared/api.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { workflowsResponseSchema } from "../src/shared/workflows.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";
import { readerId, synthId } from "./helpers/workflow-scheduling-fixture.ts";

// Two runs share one app; only the first run's reader is made to fail.
async function partialWorkflowApp(context: TestContext) {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-workflow-view-"));
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
  });
  const { engine } = app;
  const project = await engine.openProject(
    { name: "Workflow view", repositoryPath: repo.directory },
    "project",
  );
  const template = createExploreSubsystemTemplate(
    engine.store,
    {
      readerProfileId: readerId,
      synthesizerProfileId: synthId,
      readerCount: 2,
    },
    "template",
  );
  const snapshot = structuredClone(fakeTeamSnapshot);
  snapshot.preset.workflowTemplateIds = [template.id];
  snapshot.workflows = [template];
  const [run, other] = ["selected", "other"].map((title) =>
    engine.store.createRun(
      {
        projectId: project.id,
        title,
        initialPrompt: "Inspect fixture",
        repository: project.repository,
        teamSnapshot: snapshot,
      },
      `run:${title}`,
    ),
  );
  assert.ok(run && other);
  const start = (runId: string) =>
    engine.workflows.start(
      { runId, templateId: template.id, parameters: { target: "README.md" } },
      `start:${runId}`,
    );
  const workflow = start(run.id);
  start(other.id);
  await engine.workflows.reconcile();
  const [reader = "", failed = ""] = workflow.stages[0]?.taskIds ?? [];
  engine.scheduling.enqueue(
    { role: "owner" },
    { taskId: failed, profileId: readerId, scenario: "failure" },
    "fail-reader",
  );
  await engine.idle();
  const read = async (path: string) => {
    const response = await fetch(`${app.origin}/api/${path}`);
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  };
  return {
    app,
    run,
    workflow,
    reader,
    failed,
    read,
    async close() {
      await app.close();
      await rm(data, { recursive: true });
      await repo.verify(async () =>
        assert.equal(await repo.git("status", "--porcelain"), ""),
      );
    },
  };
}

test("workflow view returns one grouped item per run workflow with stages, child attempts, reports and explicit partial failure", async (context) => {
  const f = await partialWorkflowApp(context);
  try {
    const store = f.app.engine.store;
    const attempts = store.listAttempts().length;
    const journal = () =>
      store.db.prepare("SELECT max(sequence) AS last FROM events").get()?.last;
    const sequence = journal();
    const response = await f.read(`workflows?runId=${f.run.id}`);
    assert.equal(response.status, 200);
    const { workflows } = workflowsResponseSchema.parse(response.body);
    assert.deepEqual(
      workflows.map((view) => view.workflow.id),
      [f.workflow.id],
    );
    const [view] = workflows;
    assert.ok(view);
    assert.equal(view.workflow.status, "partial");
    assert.deepEqual(
      view.workflow.stages.map((stage) => [stage.stageId, stage.status]),
      [
        ["readers", "partial"],
        ["synthesis", "completed"],
      ],
    );
    assert.deepEqual(
      view.children.map((child) => child.stageId),
      ["readers", "readers", "synthesis"],
    );
    const failure = view.children.find((child) => child.task.id === f.failed);
    assert.equal(failure?.outcome.status, "failed");
    assert.equal(failure?.attempts.length, 1);
    assert.equal(
      failure?.attempts[0]?.artifacts.some((a) => a.kind === "report"),
      false,
    );
    assert.ok(failure?.attempts[0]?.diagnostics.length);
    const synthesis = view.children.find((c) => c.stageId === "synthesis");
    assert.deepEqual(
      synthesis?.handoff?.sources.map((source) => [
        source.taskId,
        source.status,
      ]),
      [
        [f.reader, "completed"],
        [f.failed, "failed"],
      ],
    );
    const report = synthesis?.attempts
      .at(-1)
      ?.artifacts.find((artifact) => artifact.kind === "report");
    assert.ok(report);
    const content = await f.read(`artifacts?id=${report.id}`);
    assert.equal(content.status, 200);
    assert.equal(
      artifactContentResponseSchema.parse(content.body).artifact.id,
      report.id,
    );
    // Reading the view never launches, retries or journals anything.
    assert.equal(store.listAttempts().length, attempts);
    assert.equal(journal(), sequence);
  } finally {
    await f.close();
  }
});

test("child log reads only that workflow child's persisted events in pages", async (context) => {
  const f = await partialWorkflowApp(context);
  try {
    const page = async (after: number, limit: number) => {
      const response = await f.read(
        `events?runId=${f.run.id}&taskId=${f.failed}&after=${after}&limit=${limit}`,
      );
      assert.equal(response.status, 200);
      return eventsResponseSchema.parse(response.body).events;
    };
    const all = await page(0, 500);
    const attempt = f.app.engine.store
      .listAttempts()
      .find((item) => item.taskId === f.failed);
    assert.ok(all.length > 2);
    assert.ok(all.every((event) => event.taskId === f.failed));
    assert.ok(all.some((event) => event.attemptId === attempt?.id));
    assert.ok(all.some((event) => event.type === "attempt.diagnostic"));
    const first = await page(0, 2);
    const rest = await page(first.at(-1)?.sequence ?? 0, 500);
    assert.deepEqual(
      [...first, ...rest].map((event) => event.id),
      all.map((event) => event.id),
    );
  } finally {
    await f.close();
  }
});

test("workflow and child log reads reject missing or malformed run and task IDs", async (context) => {
  const f = await partialWorkflowApp(context);
  try {
    for (const path of [
      "workflows",
      "workflows?runId=not-a-run",
      `workflows?runId=${f.run.id}&taskId=${f.failed}`,
      `events?taskId=not-a-task`,
    ])
      assert.equal((await f.read(path)).status, 400, path);
  } finally {
    await f.close();
  }
});
