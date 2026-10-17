import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { z } from "zod";
import { startApp } from "../src/server/app.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import { Store } from "../src/server/storage/store.ts";
import {
  createExploreSubsystemTemplate,
  listWorkflowRuns,
} from "../src/server/storage/workflows.ts";
import { defaultLimits, type Run } from "../src/shared/domain/entities.ts";
import { leadTeam } from "../src/shared/native.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { workflowsResponseSchema } from "../src/shared/workflows.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";
import { readerId, synthId } from "./helpers/workflow-scheduling-fixture.ts";

const explore = (store: Store, readerCount: number, key: string) =>
  createExploreSubsystemTemplate(
    store,
    { readerProfileId: readerId, synthesizerProfileId: synthId, readerCount },
    key,
  );
const counts = (store: Store, runId: string) => ({
  workflows: listWorkflowRuns(store, runId).length,
  children: store.listTasks(runId).filter((t) => t.workflowId).length,
  requests: store.listHumanRequests().filter((r) => r.runId === runId).length,
  dispatches: Number(
    store.db
      .prepare("SELECT count(*) AS n FROM dispatches WHERE run_id=?")
      .get(runId)?.n,
  ),
});

// A Lead session on a native run whose snapshot offers one saved workflow; a
// second library template exists but is outside the run's snapshot. The
// directory is not a Git repository and the pump is held, so nothing launches.
async function leadWorkflowFixture(
  context: TestContext,
  mode: Run["mode"],
  limits: Partial<Run["limits"]> = {},
) {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const directory = await mkdtemp(join(tmpdir(), "lao-workflow-invoke-"));
  const store = new Store(join(directory, "state.sqlite"));
  const engine = new Engine(store, directory);
  const server = createServer(
    (request, response) => void engine.gateway.handle(request, response),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const template = explore(store, 2, "template");
  const outside = explore(store, 1, "outside");
  const team = leadTeam({
    mode,
    lead: { model: "fixture-model", thinking: null },
    worker: { model: "fixture/model", thinking: null },
  });
  const project = store.createProject(
    { name: "Workflow invocation", repositoryPath: directory },
    "project",
  );
  const run = store.createRun(
    {
      projectId: project.id,
      title: "Workflow invocation",
      initialPrompt: "Explore the fixture",
      mode,
      limits: { ...defaultLimits, ...limits },
      execution: "native",
      repository: {
        root: directory,
        commonDirectory: join(directory, ".git"),
        baseSha: "a".repeat(40),
        branch: "main",
        clean: true,
      },
      teamSnapshot: {
        ...team,
        preset: { ...team.preset, workflowTemplateIds: [template.id] },
        workflows: [template],
      },
    },
    "run",
  );
  const live = (taskId: string) => {
    const dispatch = engine.scheduling.list().find((d) => d.taskId === taskId);
    assert.ok(dispatch);
    const attemptId = engine.scheduling.reserve(dispatch);
    assert.ok(attemptId);
    const session = store.createSession({ attemptId }, `s:${attemptId}`);
    for (const [from, to] of [
      ["not_started", "starting"],
      ["starting", "busy"],
    ] as const)
      store.updateSession(
        { id: session.id, expectedState: from, state: to },
        `s:${attemptId}:${to}`,
      );
    return { sessionId: session.id, attemptId, taskId, runId: run.id };
  };
  const leadTask = store.createTask(
    { runId: run.id, title: "Lead", objective: "Lead turn", kind: "lead" },
    "lead-task",
  );
  engine.scheduling.enqueueLead(leadTask.id, "success", "lead-dispatch");
  const lead = engine.gateway.issue({ role: "lead", ...live(leadTask.id) });
  const call = async (token: string, method: string, params: object = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return (await response.json()) as { result: Record<string, unknown> };
  };
  const tool = async (token: string, name: string, args: object) =>
    z
      .object({
        isError: z.boolean(),
        structuredContent: z.record(z.string(), z.any()),
      })
      .parse(
        (await call(token, "tools/call", { name, arguments: args })).result,
      );
  return {
    store,
    engine,
    run,
    template,
    outside,
    lead,
    live,
    call,
    tool,
    async close() {
      server.close();
      await engine.close();
      store.close();
      await rm(directory, { recursive: true });
    },
  };
}

test("an Autonomous Lead sees saved workflows and starts one only by snapshot template ID with exactly its declared inputs", async (context) => {
  const f = await leadWorkflowFixture(context, "autonomous_bounded");
  try {
    const listed = z
      .object({
        tools: z.array(
          z.object({
            name: z.string(),
            inputSchema: z.record(z.string(), z.any()),
          }),
        ),
      })
      .parse((await f.call(f.lead, "tools/list")).result)
      .tools.find((t) => t.name === "run_workflow");
    assert.deepEqual(Object.keys(listed?.inputSchema.properties ?? {}), [
      "templateId",
      "parameters",
    ]);
    assert.equal(listed?.inputSchema.additionalProperties, false);
    const status = await f.tool(f.lead, "get_run_status", {});
    assert.deepEqual(
      status.structuredContent.result.workflows.available.map(
        (t: { templateId: string; agents: number }) => [t.templateId, t.agents],
      ),
      [[f.template.id, 3]],
    );
    const before = counts(f.store, f.run.id);
    const target = { target: "README.md" };
    for (const [args, code] of [
      // A Lead cannot supply its own graph, only a saved template's values.
      [
        { templateId: f.template.id, parameters: target, stages: [] },
        "INVALID_INPUT",
      ],
      [{ templateId: f.outside.id, parameters: target }, "POLICY_DENIED"],
      [{ templateId: f.template.id, parameters: {} }, "INVALID_REFERENCE"],
      [
        {
          templateId: f.template.id,
          parameters: { ...target, readerCount: "64" },
        },
        "INVALID_REFERENCE",
      ],
      [
        { templateId: f.template.id, parameters: { target: "  " } },
        "INVALID_INPUT",
      ],
    ] as const) {
      const denied = await f.tool(f.lead, "run_workflow", args);
      assert.equal(denied.structuredContent.error.code, code);
    }
    assert.deepEqual(counts(f.store, f.run.id), before);
    const started = await f.tool(f.lead, "run_workflow", {
      templateId: f.template.id,
      parameters: target,
    });
    assert.equal(started.isError, false);
    const result = started.structuredContent.result;
    assert.equal(result.outcome, "started");
    const [workflow] = listWorkflowRuns(f.store, f.run.id);
    assert.equal(result.workflowId, workflow?.id);
    assert.deepEqual(workflow?.parameters, target);
    assert.equal(workflow?.template.version, f.template.version);
    assert.deepEqual(
      f.store
        .listTasks(f.run.id)
        .filter((t) => t.workflowId)
        .map((t) => t.origin),
      ["workflow", "workflow", "workflow"],
    );
    const event = f.store
      .events({ runId: f.run.id, limit: 500 })
      .find((e) => e.type === "workflow.started");
    assert.equal(event?.payload.invokedBy, "lead");
    const after = await f.tool(f.lead, "get_run_status", {});
    assert.deepEqual(
      after.structuredContent.result.workflows.runs.map(
        (w: { workflowId: string }) => w.workflowId,
      ),
      [workflow?.id],
    );
  } finally {
    await f.close();
  }
});

test("a Lead workflow must fit the remaining launch budget, while the owner may still start held children", async (context) => {
  const f = await leadWorkflowFixture(context, "autonomous_bounded", {
    maxTotalWorkerLaunchesPerRun: 2,
  });
  try {
    const input = { templateId: f.template.id, parameters: { target: "x" } };
    const denied = await f.tool(f.lead, "run_workflow", input);
    assert.equal(denied.structuredContent.error.code, "BUDGET_EXCEEDED");
    assert.equal(counts(f.store, f.run.id).workflows, 0);
    const owner = f.engine.workflows.start(
      { runId: f.run.id, ...input },
      "owner-start",
    );
    assert.equal(owner.status, "running");
  } finally {
    await f.close();
  }
});

test("a Supervised Lead's validated workflow proposal waits for the owner and creates no workflow, task or dispatch", async (context) => {
  const f = await leadWorkflowFixture(context, "supervised");
  try {
    const before = counts(f.store, f.run.id);
    const invalid = await f.tool(f.lead, "run_workflow", {
      templateId: f.template.id,
      parameters: { subsystem: "x" },
    });
    assert.equal(invalid.structuredContent.error.code, "INVALID_REFERENCE");
    assert.deepEqual(counts(f.store, f.run.id), before);
    const proposed = await f.tool(f.lead, "run_workflow", {
      templateId: f.template.id,
      parameters: { target: "src/server" },
    });
    assert.equal(
      proposed.structuredContent.result.outcome,
      "awaiting_owner_approval",
    );
    assert.deepEqual(counts(f.store, f.run.id), {
      ...before,
      requests: before.requests + 1,
    });
    const request = f.store
      .listHumanRequests()
      .find((r) => r.id === proposed.structuredContent.result.humanRequestId);
    assert.equal(request?.blocking, false);
    assert.match(request?.reason ?? "", new RegExp(f.template.id));
    assert.match(request?.reason ?? "", /src\/server/);
    await f.engine.pump();
    assert.equal(counts(f.store, f.run.id).workflows, 0);
    const owner = f.engine.workflows.start(
      {
        runId: f.run.id,
        templateId: f.template.id,
        parameters: { target: "src/server" },
      },
      "owner-approves",
    );
    assert.equal(listWorkflowRuns(f.store, f.run.id)[0]?.id, owner.id);
  } finally {
    await f.close();
  }
});

test("Chat/Plan cannot run workflows for the Lead or the owner", async (context) => {
  const plan = await leadWorkflowFixture(context, "chat_plan");
  try {
    const tools = z
      .object({ tools: z.array(z.object({ name: z.string() })) })
      .parse((await plan.call(plan.lead, "tools/list")).result)
      .tools.map((t) => t.name);
    assert.ok(!tools.includes("run_workflow"));
    const input = { templateId: plan.template.id, parameters: { target: "x" } };
    const denied = await plan.tool(plan.lead, "run_workflow", input);
    assert.equal(denied.structuredContent.error.code, "POLICY_DENIED");
    assert.throws(
      () =>
        plan.engine.workflows.start({ runId: plan.run.id, ...input }, "owner"),
      /Chat\/Plan cannot dispatch/,
    );
    assert.equal(counts(plan.store, plan.run.id).workflows, 0);
  } finally {
    await plan.close();
  }
});

test("workers can never run workflows, through the gateway or the engine", async (context) => {
  const f = await leadWorkflowFixture(context, "autonomous_bounded");
  try {
    const task = f.engine.createTask(
      { runId: f.run.id, title: "Worker", objective: "Read the fixture" },
      "worker-task",
    );
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId: readerId },
      "worker-assign",
    );
    const binding = f.live(task.id);
    const worker = f.engine.gateway.issue({ role: "worker", ...binding });
    const input = { templateId: f.template.id, parameters: { target: "x" } };
    const denied = await f.tool(worker, "run_workflow", input);
    assert.equal(denied.structuredContent.error.code, "POLICY_DENIED");
    assert.throws(
      () =>
        f.engine.tool(
          { role: "worker", sessionId: binding.sessionId },
          f.run.id,
          { name: "run_workflow", ...input },
          "worker-direct",
        ),
      /Worker cannot schedule/,
    );
    assert.equal(counts(f.store, f.run.id).workflows, 0);
  } finally {
    await f.close();
  }
});

test("the owner starts a snapshot workflow over authenticated HTTP; invalid or foreign requests create nothing", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-workflow-http-"));
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
  });
  try {
    const { engine } = app;
    const project = await engine.openProject(
      { name: "Workflow HTTP", repositoryPath: repo.directory },
      "project",
    );
    const template = explore(engine.store, 2, "template");
    const outside = explore(engine.store, 1, "outside");
    const snapshot = structuredClone(fakeTeamSnapshot);
    snapshot.preset.workflowTemplateIds = [template.id];
    snapshot.workflows = [template];
    const run = engine.store.createRun(
      {
        projectId: project.id,
        title: "Owner workflow",
        initialPrompt: "Inspect fixture",
        repository: project.repository,
        teamSnapshot: snapshot,
      },
      "run",
    );
    const { token } = z
      .object({ token: z.string() })
      .parse(await (await fetch(`${app.origin}/api/local-session`)).json());
    const post = async (body: object, key: string, auth = token) => {
      const response = await fetch(`${app.origin}/api/workflows`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Local-Token": auth,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: (await response.json()) as unknown,
      };
    };
    const valid = {
      runId: run.id,
      templateId: template.id,
      parameters: { target: "README.md" },
    };
    for (const [body, status, key, auth] of [
      [valid, 403, "no-token", "x"],
      [{ ...valid, templateId: outside.id }, 403, "outside", token],
      [{ ...valid, parameters: {} }, 409, "missing", token],
      [{ ...valid, stages: template.stages }, 400, "graph", token],
    ] as const) {
      assert.equal((await post(body, `http:${key}`, auth)).status, status);
    }
    assert.equal(counts(engine.store, run.id).workflows, 0);
    const started = await post(valid, "start");
    assert.equal(started.status, 200);
    const again = await post(valid, "start");
    assert.deepEqual(again.body, started.body);
    const view = workflowsResponseSchema.parse(
      await (await fetch(`${app.origin}/api/workflows?runId=${run.id}`)).json(),
    );
    assert.equal(view.workflows.length, 1);
    assert.equal(view.workflows[0]?.children.length, 3);
    const event = engine.store
      .events({ runId: run.id, limit: 500 })
      .find((e) => e.type === "workflow.started");
    assert.equal(event?.payload.invokedBy, "owner");
  } finally {
    await app.close();
    await rm(data, { recursive: true });
    await repo.verify(async () =>
      assert.equal(await repo.git("status", "--porcelain"), ""),
    );
  }
});
