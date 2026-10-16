import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { Engine } from "../src/server/orchestration/engine.ts";
import { Store } from "../src/server/storage/store.ts";
import { defaultLimits, type Run } from "../src/shared/domain/entities.ts";
import { leadTeam } from "../src/shared/native.ts";
import { workerTools } from "../src/shared/orchestration.ts";

const reader = "00000000-0000-4000-8000-000000000013";
// The project directory is not a Git repository, so the scheduler blocks any
// queued dispatch instead of launching a harness during these tests.
async function gatewayFixture(
  mode: Run["mode"],
  limits: Partial<Run["limits"]> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "lao-gateway-"));
  const store = new Store(join(directory, "state.sqlite"));
  const engine = new Engine(store, directory, undefined, {
    gatewayUrl: "http://127.0.0.1:1/mcp",
  });
  const server = createServer(
    (request, response) => void engine.gateway.handle(request, response),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/mcp`;
  const project = store.createProject(
    { name: "Gateway fixture", repositoryPath: directory },
    "project",
  );
  const newRun = (key: string) =>
    store.createRun(
      {
        projectId: project.id,
        title: "Gateway run",
        initialPrompt: "Coordinate the fixture",
        mode,
        limits: { ...defaultLimits, ...limits },
        execution: "native",
        teamSnapshot: leadTeam({
          mode,
          lead: { model: "fixture-model", thinking: null },
          worker: { model: "fixture/model", thinking: null },
        }),
      },
      key,
    );
  const run = newRun("run");
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
  const call = async (
    token: string | null,
    method: string,
    params: object = {},
  ) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return {
      status: response.status,
      body: response.status === 200 ? await response.json() : null,
    };
  };
  const tool = async (token: string, name: string, args: object = {}) => {
    const reply = await call(token, "tools/call", { name, arguments: args });
    return z
      .object({
        result: z.object({
          isError: z.boolean(),
          structuredContent: z.record(z.string(), z.any()),
        }),
      })
      .parse(reply.body).result;
  };
  const list = async (token: string) =>
    z
      .object({
        result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
      })
      .parse((await call(token, "tools/list")).body)
      .result.tools.map((t) => t.name);
  const worker = (key: string) => {
    const task = engine.createTask(
      { runId: run.id, title: `Worker ${key}`, objective: "Read the fixture" },
      `${key}:task`,
    );
    engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId: reader },
      `${key}:assign`,
    );
    return {
      task,
      token: engine.gateway.issue({ role: "worker", ...live(task.id) }),
    };
  };
  return {
    store,
    engine,
    run,
    url,
    lead,
    call,
    tool,
    list,
    worker,
    newRun,
    async close() {
      server.close();
      await engine.close();
      store.close();
      await rm(directory, { recursive: true });
    },
  };
}

test("gateway authenticates each session, lists role-scoped tools and revokes tokens", async () => {
  const f = await gatewayFixture("autonomous_bounded");
  try {
    assert.equal((await f.call(null, "tools/list")).status, 401);
    assert.equal((await f.call("x".repeat(43), "tools/list")).status, 401);
    assert.equal((await fetch(f.url)).status, 405);
    const init = await f.call(f.lead, "initialize", {
      protocolVersion: "2025-06-18",
    });
    assert.equal(init.body.result.protocolVersion, "2025-06-18");
    const leadTools = await f.list(f.lead);
    assert.ok(leadTools.includes("assign_task"));
    assert.ok(!leadTools.some((name) => name.startsWith("submit")));
    const { token } = f.worker("w");
    assert.deepEqual(await f.list(token), [...workerTools]);
    f.engine.gateway.revoke(token);
    assert.equal((await f.call(token, "tools/list")).status, 401);
  } finally {
    await f.close();
  }
});

test("worker tokens cannot schedule, impersonate the Lead or target another task; the Lead cannot submit results", async () => {
  const f = await gatewayFixture("autonomous_bounded");
  try {
    const one = f.worker("one");
    const two = f.worker("two");
    const denied = await f.tool(one.token, "assign_task", {
      taskId: two.task.id,
      profileId: reader,
    });
    assert.equal(denied.structuredContent.error.code, "POLICY_DENIED");
    const foreign = await f.tool(one.token, "read_assignment", {
      taskId: two.task.id,
    });
    assert.equal(foreign.structuredContent.error.code, "INVALID_INPUT");
    const assignment = await f.tool(one.token, "read_assignment");
    assert.equal(assignment.structuredContent.result.taskId, one.task.id);
    const report = {
      outcome: "completed",
      summary: "Fixture summary",
      tests: [{ command: "not run", result: "not_run" }],
    };
    assert.equal(
      (await f.tool(one.token, "submit_result", report)).isError,
      false,
    );
    const duplicate = await f.tool(one.token, "submit_result", report);
    assert.equal(duplicate.structuredContent.error.code, "CONFLICT");
    const lead = await f.tool(f.lead, "submit_result", report);
    assert.equal(lead.structuredContent.error.code, "POLICY_DENIED");
    const other = f.newRun("other-run");
    const outside = f.engine.createTask(
      { runId: other.id, title: "Outside", objective: "Other run" },
      "outside",
    );
    const cross = await f.tool(f.lead, "get_task", { taskId: outside.id });
    assert.equal(cross.structuredContent.error.code, "POLICY_DENIED");
    const results = f.store
      .events({ runId: f.run.id, limit: 500 })
      .filter((e) => e.type === "worker.result");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.taskId, one.task.id);
  } finally {
    await f.close();
  }
});

test("Chat/Plan lists no dispatch tools and denies a direct dispatch call; a mode change applies before the next call", async () => {
  const f = await gatewayFixture("chat_plan");
  try {
    const tools = await f.list(f.lead);
    assert.ok(!tools.includes("assign_task"));
    assert.ok(!tools.includes("request_revision"));
    const proposed = await f.tool(f.lead, "propose_task", {
      title: "Plan item",
      objective: "Only a proposal",
    });
    assert.equal(proposed.isError, false);
    const taskId = proposed.structuredContent.result.id;
    const denied = await f.tool(f.lead, "assign_task", {
      taskId,
      profileId: reader,
    });
    assert.equal(denied.structuredContent.error.code, "POLICY_DENIED");
    assert.equal(
      f.engine.scheduling.list().some((d) => d.taskId === taskId),
      false,
    );
    assert.ok(
      f.store
        .events({ runId: f.run.id, limit: 500 })
        .some((e) => e.type === "gateway.denied"),
    );
    f.engine.updateRun({ id: f.run.id, mode: "autonomous_bounded" }, "mode");
    assert.ok((await f.list(f.lead)).includes("assign_task"));
    assert.equal(
      (await f.tool(f.lead, "assign_task", { taskId, profileId: reader }))
        .isError,
      false,
    );
  } finally {
    await f.close();
  }
});

test("Supervised Lead assignment becomes a proposal; the owner's different choice is pinned and recorded as an override", async () => {
  const f = await gatewayFixture("supervised");
  try {
    const proposed = await f.tool(f.lead, "propose_task", {
      title: "Needs approval",
      objective: "Wait for the owner",
    });
    const taskId = proposed.structuredContent.result.id;
    const proposal = await f.tool(f.lead, "assign_task", {
      taskId,
      profileId: reader,
    });
    assert.equal(
      proposal.structuredContent.result.outcome,
      "awaiting_owner_approval",
    );
    assert.equal(f.store.getTask(taskId).status, "BACKLOG");
    assert.equal(f.store.getTask(taskId).proposedProfileId, reader);
    assert.equal(f.store.listAttempts().length, 1);
    const reviewer = "00000000-0000-4000-8000-000000000012";
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId, profileId: reviewer },
      "owner-approve",
    );
    const task = f.store.getTask(taskId);
    assert.equal(task.ownerPinned, true);
    assert.equal(task.assignedProfileId, reviewer);
    assert.equal(task.proposedProfileId, null);
    assert.ok(
      f.store
        .events({ runId: f.run.id, limit: 500 })
        .some((e) => e.type === "assignment.overridden"),
    );
  } finally {
    await f.close();
  }
});

test("Lead launch and revision budgets fail with structured BUDGET_EXCEEDED errors", async () => {
  const launches = await gatewayFixture("autonomous_bounded", {
    maxTotalWorkerLaunchesPerRun: 1,
  });
  try {
    const ids: string[] = [];
    for (const title of ["First", "Second"])
      ids.push(
        (
          await launches.tool(launches.lead, "propose_task", {
            title,
            objective: title,
          })
        ).structuredContent.result.id,
      );
    const first = await launches.tool(launches.lead, "assign_task", {
      taskId: ids[0],
      profileId: reader,
    });
    assert.equal(first.isError, false);
    const second = await launches.tool(launches.lead, "assign_task", {
      taskId: ids[1],
      profileId: reader,
    });
    assert.equal(second.structuredContent.error.code, "BUDGET_EXCEEDED");
  } finally {
    await launches.close();
  }
  const f = await gatewayFixture("autonomous_bounded", {
    maxRevisionCyclesPerTask: 1,
  });
  try {
    const review = (taskId: string) =>
      f.store.transitionTask(
        {
          id: taskId,
          expectedStatus: "RUNNING",
          status: "AWAITING_REVIEW",
          reason: "Fixture review",
        },
        `review:${taskId}`,
      );
    const original = f.worker("original");
    review(original.task.id);
    const revision = await f.tool(f.lead, "request_revision", {
      taskId: original.task.id,
      feedback: "Cite the line number",
    });
    assert.equal(revision.structuredContent.result.outcome, "queued");
    const revisionId = revision.structuredContent.result.revisionTaskId;
    assert.equal(f.store.getTask(original.task.id).status, "CHANGES_REQUESTED");
    assert.equal(f.store.getTask(revisionId).parentTaskId, original.task.id);
    const dispatch = f.engine.scheduling
      .list()
      .find((d) => d.taskId === revisionId);
    assert.ok(dispatch);
    assert.ok(f.engine.scheduling.reserve(dispatch));
    review(revisionId);
    const exhausted = await f.tool(f.lead, "request_revision", {
      taskId: revisionId,
      feedback: "Again",
    });
    assert.equal(exhausted.structuredContent.error.code, "BUDGET_EXCEEDED");
  } finally {
    await f.close();
  }
});

test("an urgent worker issue wakes the Lead in a separately queued turn", async () => {
  const f = await gatewayFixture("autonomous_bounded");
  try {
    const { token, task } = f.worker("urgent");
    const issue = await f.tool(token, "report_issue", {
      summary: "Credentials requested",
      details: "The task asks for a secret",
      urgency: "urgent",
    });
    assert.equal(issue.structuredContent.result.leadWoken, true);
    const leads = f.store.listTasks(f.run.id).filter((t) => t.kind === "lead");
    assert.equal(leads.length, 2);
    assert.equal(leads[0]?.status, "RUNNING");
    assert.equal(leads[1]?.status, "QUEUED");
    const notification = f.store
      .events({ runId: f.run.id, limit: 500 })
      .find((e) => e.type === "lead.notification");
    assert.equal(notification?.taskId, task.id);
    assert.equal(notification?.payload.kind, "urgent_issue");
  } finally {
    await f.close();
  }
});

test("Lead escalations and questions become non-blocking owner requests scoped to the run and session", async () => {
  const f = await gatewayFixture("chat_plan");
  try {
    const task = f.engine.createTask(
      { runId: f.run.id, title: "Asked", objective: "Backlog only" },
      "asked",
    );
    const escalation = await f.tool(f.lead, "escalate_issue", {
      summary: "Risky migration",
      details: "The objective implies deleting data",
      urgency: "high",
      taskIds: [task.id],
    });
    assert.equal(escalation.isError, false);
    const question = await f.tool(f.lead, "request_human_input", {
      summary: "Which branch?",
      details: "Two candidate branches exist",
    });
    assert.equal(question.isError, false);
    const requests = f.store.listHumanRequests();
    assert.deepEqual(
      requests.map((r) => [r.type, r.urgency, r.blocking, r.status]),
      [
        ["manual_check", "high", false, "open"],
        ["clarification", "normal", false, "open"],
      ],
    );
    assert.deepEqual(requests[0]?.affectedTaskIds, [task.id]);
    assert.ok(requests.every((r) => r.runId === f.run.id && r.sessionId));
    const other = f.engine.createTask(
      { runId: f.newRun("elsewhere").id, title: "Other", objective: "Other" },
      "other-task",
    );
    const crossRun = await f.tool(f.lead, "escalate_issue", {
      summary: "Cross run",
      details: "Should be refused",
      taskIds: [other.id],
    });
    assert.equal(crossRun.structuredContent.error.code, "POLICY_DENIED");
    assert.equal(f.store.listHumanRequests().length, 2);
  } finally {
    await f.close();
  }
});
