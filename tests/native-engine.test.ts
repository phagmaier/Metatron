import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import { Store } from "../src/server/storage/store.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

async function fixture(scenario = "success") {
  const repo = await createGitFixture();
  const data = await mkdtemp("/tmp/lao-native-engine-");
  const store = new Store(join(data, "state.sqlite"));
  const pi = new PiAdapter(data, (args, cwd, env) => {
    assert.ok(args.includes("--no-mcp"));
    assert.ok(args.includes("--no-context-files"));
    assert.ok(!args.includes("--continue"));
    assert.equal(env.PI_CODING_AGENT_DIR, join(data, "pi"));
    return new PiRpc(
      process.execPath,
      [fileURLToPath(new URL("./helpers/pi-rpc-fixture.ts", import.meta.url))],
      cwd,
      {
        ...env,
        LAO_FIXTURE_SCENARIO: scenario,
        ...(scenario === "no-guard" ? { LAO_FIXTURE_NO_GUARD: "1" } : {}),
      },
    );
  });
  const engine = new Engine(store, data, pi);
  const project = await engine.openProject(
    { name: "Protocol fixture", repositoryPath: repo.directory },
    "project",
  );
  const input = {
    projectId: project.id,
    title: "Protocol fixture run",
    initialPrompt: "Native boundary fixture",
    model: "fixture/model",
    thinking: "off",
    permission: "workspace_write",
  };
  return {
    repo,
    data,
    store,
    engine,
    input,
    async close() {
      await engine.close();
      store.close();
    },
  };
}
test("native execution persists real worktree ownership, report, exit code and evidence without duplicate dispatch", async () => {
  const f = await fixture();
  try {
    const run = await f.engine.startNativeRun(f.input, "run");
    assert.equal((await f.engine.startNativeRun(f.input, "run")).id, run.id);
    await f.engine.idle();
    const task = f.store.listTasks(run.id)[0];
    assert.ok(task);
    assert.equal(task.status, "AWAITING_REVIEW");
    const attempt = f.store.listAttempts()[0];
    assert.ok(attempt?.worktreePath);
    assert.equal(f.store.listAttempts().length, 1);
    assert.equal(f.store.listSessions()[0]?.exitCode, 0);
    assert.equal(
      (await f.engine.reports(task.id))[0]?.content,
      "Protocol fixture report",
    );
    assert.ok(
      f.store
        .events({ runId: run.id, limit: 500 })
        .some((e) => e.type === "worktree.captured"),
    );
    assert.equal(
      await readFile(join(attempt.worktreePath, "fixture-result.txt"), "utf8"),
      "Protocol fixture result\n",
    );
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
  } finally {
    await f.close();
  }
});
for (const scenario of ["exit", "auth"]) {
  test(`native ${scenario} requires a retry decision and preserves worktree/history`, async () => {
    const f = await fixture(scenario);
    try {
      const run = await f.engine.startNativeRun(f.input, "run");
      await f.engine.idle();
      const task = f.store.listTasks(run.id)[0];
      assert.ok(task);
      assert.equal(task.status, "RETRY_DECISION");
      assert.equal(f.store.listAttempts().length, 1);
      assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
      assert.equal(
        f.store.db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
        0,
      );
      assert.equal(
        JSON.stringify(f.store.events({ runId: run.id, limit: 500 })).includes(
          "fixture-secret",
        ),
        false,
      );
      await f.engine.pump();
      assert.equal(f.store.listAttempts().length, 1);
    } finally {
      await f.close();
    }
  });
}
test("native owner cancellation interrupts a silent turn and releases reservations without waiting for text", async () => {
  const f = await fixture("hold");
  try {
    const run = await f.engine.startNativeRun(f.input, "run");
    const task = f.store.listTasks(run.id)[0];
    assert.ok(task);
    for (let i = 0; i < 200 && !f.engine.nativeStops.has(task.id); i++) {
      await f.engine.pump();
      await delay(10);
    }
    assert.ok(f.engine.nativeStops.has(task.id));
    f.engine.cancel(task.id, "cancel");
    await f.engine.idle();
    assert.equal(f.store.getTask(task.id).status, "CANCELLED");
    assert.equal(f.store.listAttempts()[0]?.status, "cancelled");
    assert.equal(f.store.listSessions()[0]?.state, "exited");
    assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
      0,
    );
  } finally {
    await f.close();
  }
});
test("native model/thinking validation refuses unsupported choices before creating a run", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.engine.startNativeRun(
        { ...f.input, model: "invented/model" },
        "bad-model",
      ),
      /unavailable/,
    );
    await assert.rejects(
      f.engine.startNativeRun(
        { ...f.input, thinking: "invented" },
        "bad-thinking",
      ),
      /unavailable/,
    );
    assert.equal(f.store.listRuns().length, 0);
    assert.equal(f.store.listAttempts().length, 0);
  } finally {
    await f.close();
  }
});
test("native startup fails closed when the policy extension is missing", async () => {
  const f = await fixture("no-guard");
  try {
    const run = await f.engine.startNativeRun(f.input, "run");
    await f.engine.idle();
    assert.equal(f.store.listTasks(run.id)[0]?.status, "RETRY_DECISION");
    assert.equal(
      f.store
        .events({ runId: run.id, limit: 500 })
        .some(
          (e) => e.type === "pi.text_delta" || e.type === "pi.turn_completed",
        ),
      false,
    );
    assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
  } finally {
    await f.close();
  }
});
test("switching a queued native run to Chat/Plan prevents attempts and Git worktree creation", async () => {
  const f = await fixture();
  try {
    const run = await f.engine.startNativeRun(f.input, "run");
    f.engine.updateRun({ id: run.id, mode: "chat_plan" }, "plan");
    await f.engine.idle();
    assert.equal(f.store.listAttempts().length, 0);
    assert.equal(f.engine.worktrees.list().length, 0);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    await f.close();
  }
});
