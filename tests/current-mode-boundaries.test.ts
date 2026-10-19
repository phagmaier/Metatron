import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import {
  decideRecovery,
  recheckRecovery,
} from "../src/server/orchestration/recovery-decisions.ts";
import { pauseTask } from "../src/server/orchestration/stops.ts";
import { getIntegration } from "../src/server/storage/integrations.ts";
import type { ApplyPlan } from "../src/shared/integration.ts";
import {
  approvedPreview,
  owner,
  reviewed,
} from "./helpers/integration-fixture.ts";

type Fixture = Awaited<ReturnType<typeof reviewed>>;
const confirm = (plan: ApplyPlan) => ({
  integrationId: plan.integrationId,
  confirm: {
    method: plan.method,
    checkoutPath: plan.checkoutPath,
    expectedSha: plan.expectedSha,
    resultSha: plan.resultSha,
  },
});

async function unchanged(f: Fixture, id: string) {
  assert.deepEqual(getIntegration(f.store, id).applications, []);
  assert.equal(
    f.store
      .events({ limit: 500 })
      .filter((e) => e.type === "integration.application_started").length,
    0,
  );
  assert.equal(await f.repo.git("rev-parse", "HEAD"), f.candidate.baseSha);
  assert.equal(await f.repo.git("status", "--porcelain"), "");
  assert.ok(existsSync(getIntegration(f.store, id).worktreePath));
}

test("Chat/Plan committed during approval Git checks prevents a decision; explicit later approval and replay remain valid", async () => {
  const f = await reviewed();
  try {
    const preview = f.engine.integrations.request(
      owner,
      { taskId: f.original.id },
      "preview",
    );
    await f.engine.integrations.idle();
    const input = { integrationId: preview.id, decision: "approve" };
    const decision = f.engine.integrations.decide(owner, input, "approve");
    f.engine.updateRun({ id: f.run.id, mode: "chat_plan" }, "chat-plan");
    await assert.rejects(decision, { code: "POLICY_DENIED" });
    assert.equal(getIntegration(f.store, preview.id).decision, null);
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    await unchanged(f, preview.id);
    f.engine.updateRun({ id: f.run.id, mode: "supervised" }, "supervised");
    const approved = await f.engine.integrations.decide(
      owner,
      input,
      "approve",
    );
    assert.equal(approved.decision?.outcome, "approved");
    assert.deepEqual(
      await f.engine.integrations.decide(owner, input, "approve"),
      approved,
    );
  } finally {
    await f.app.close();
  }
});

test("Chat/Plan committed during application planning prevents a claim and destination mutation", async () => {
  const f = await reviewed();
  try {
    const approved = await approvedPreview(f, "preview");
    const plan = await f.engine.integrations.plan(approved.id);
    const application = f.engine.integrations.apply(
      owner,
      confirm(plan),
      "apply",
    );
    f.engine.updateRun({ id: f.run.id, mode: "chat_plan" }, "chat-plan");
    await assert.rejects(application, { code: "POLICY_DENIED" });
    const events = f.store.events({ limit: 500 });
    assert.ok(
      events.some(
        (e) => e.type === "run.updated" && e.payload.mode === "chat_plan",
      ),
    );
    assert.equal(f.store.getTask(f.original.id).status, "READY_TO_INTEGRATE");
    assert.deepEqual(getIntegration(f.store, approved.id), approved);
    await unchanged(f, approved.id);
    f.engine.updateRun({ id: f.run.id, mode: "supervised" }, "supervised");
    const applied = await f.engine.integrations.apply(
      owner,
      confirm(plan),
      "apply",
    );
    assert.equal(applied.applications.at(-1)?.status, "applied");
    assert.deepEqual(
      await f.engine.integrations.apply(owner, confirm(plan), "apply"),
      applied,
    );
  } finally {
    await f.app.close();
  }
});

for (const boundary of ["chat_plan", "shutdown"] as const) {
  test(`${boundary} after the completed plan snapshot is enforced at the application claim`, async (context) => {
    const f = await reviewed();
    let closing: Promise<void> | undefined;
    try {
      const approved = await approvedPreview(f, "preview");
      const plan = await f.engine.integrations.plan(approved.id);
      const listTasks = f.store.listTasks.bind(f.store);
      const snapshot = context.mock.method(
        f.store,
        "listTasks",
        (...args: Parameters<typeof listTasks>) => {
          const tasks = listTasks(...args);
          snapshot.mock.restore();
          // Eligibility at the end of planning sees the old snapshot. This runs
          // before apply's continuation, so only the transactional guard can win.
          queueMicrotask(() => {
            if (boundary === "chat_plan")
              f.engine.updateRun(
                { id: f.run.id, mode: "chat_plan" },
                "chat-plan",
              );
            else closing = f.engine.close();
          });
          return tasks;
        },
      );
      await assert.rejects(
        f.engine.integrations.apply(owner, confirm(plan), "apply"),
        {
          code: boundary === "chat_plan" ? "POLICY_DENIED" : "CONFLICT",
        },
      );
      await closing;
      await unchanged(f, approved.id);
    } finally {
      await closing;
      await f.app.close();
    }
  });
}

for (const change of [
  "chat_plan",
  "scheduling_pause",
  "cancel",
  "worker_pause",
  "shutdown",
] as const) {
  test(`${change} during initialized worker startup enforces first-prompt policy without discarding evidence`, async (context) => {
    const f = await reviewed();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let closing: Promise<void> | undefined;
    const start = f.engine.pi.startSession.bind(f.engine.pi);
    const prompt = f.engine.pi.prompt.bind(f.engine.pi);
    const prompts: string[] = [];
    context.mock.method(
      f.engine.pi,
      "startSession",
      async (...args: Parameters<typeof start>) => {
        const managed = await start(...args);
        entered.resolve();
        await release.promise;
        return managed;
      },
    );
    context.mock.method(
      f.engine.pi,
      "prompt",
      (...args: Parameters<typeof prompt>) => {
        prompts.push(args[0].input.attemptId);
        return prompt(...args);
      },
    );
    try {
      const task = f.engine.createTask(
        {
          runId: f.run.id,
          title: "Held writer",
          objective: "Keep the project heading",
        },
        "held-task",
      );
      const profileId = f.run.teamSnapshot?.profiles.find(
        (p) => p.permission === "workspace_write",
      )?.id;
      assert.ok(profileId);
      f.engine.scheduling.enqueue(
        owner,
        { taskId: task.id, profileId },
        "held-assign",
      );
      await f.engine.pump();
      await entered.promise;
      const attempt = f.store.listAttempts().find((a) => a.taskId === task.id);
      assert.ok(attempt?.worktreePath);
      if (change === "chat_plan")
        f.engine.updateRun({ id: f.run.id, mode: "chat_plan" }, "chat-plan");
      else if (change === "scheduling_pause")
        f.engine.updateRun(
          { id: f.run.id, status: "paused" },
          "pause-dispatch",
        );
      else if (change === "cancel") f.engine.cancel(task.id, "cancel");
      else if (change === "worker_pause")
        pauseTask(f.engine, { taskId: task.id }, "pause-worker");
      else closing = f.engine.close();
      release.resolve();
      await f.engine.idle();
      await closing;
      assert.deepEqual(
        prompts,
        change === "scheduling_pause" ? [attempt.id] : [],
      );
      const session = f.store
        .listSessions()
        .find((s) => s.attemptId === attempt.id);
      assert.ok(session?.nativeSessionId);
      assert.equal(session.state, "exited");
      assert.ok(existsSync(attempt.worktreePath));
      assert.equal(
        f.engine.worktrees.list().find((w) => w.attemptId === attempt.id)
          ?.state,
        "retained",
      );
      assert.equal(await f.repo.git("rev-parse", "HEAD"), f.candidate.baseSha);
      assert.equal(await f.repo.git("status", "--porcelain"), "");
      if (change === "chat_plan") {
        assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
        assert.equal(
          f.store.getAttempt(attempt.id).recovery?.cause,
          "interrupted",
        );
        const events = f.store.events({ limit: 500 });
        const mode = events.find(
          (e) => e.type === "run.updated" && e.payload.mode === "chat_plan",
        );
        const diagnostic = events.find(
          (e) => e.type === "attempt.diagnostic" && e.attemptId === attempt.id,
        );
        assert.ok(mode && diagnostic && mode.sequence < diagnostic.sequence);
        assert.ok(
          events.some(
            (e) => e.type === "worktree.captured" && e.attemptId === attempt.id,
          ),
        );
        f.engine.updateRun({ id: f.run.id, mode: "supervised" }, "supervised");
        await f.engine.idle();
        assert.deepEqual(prompts, []);
        assert.equal(
          f.store.listAttempts().filter((a) => a.taskId === task.id).length,
          1,
        );
        const check = await recheckRecovery(
          f.engine,
          { taskId: task.id },
          "recheck",
        );
        await decideRecovery(
          f.engine,
          {
            taskId: task.id,
            checkId: check.id,
            profileId,
            contextPolicy: "fresh",
          },
          "retry",
        );
        await f.engine.idle();
        const successor = f.store
          .listAttempts()
          .find((a) => a.taskId === task.id && a.id !== attempt.id);
        assert.ok(successor);
        assert.notEqual(successor.cwd, attempt.cwd);
        assert.deepEqual(prompts, [successor.id]);
        assert.ok(existsSync(attempt.worktreePath));
      }
    } finally {
      release.resolve();
      await closing;
      await f.app.close();
    }
  });
}
