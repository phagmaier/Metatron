import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import { startApp } from "../src/server/app.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

const fixturePath = fileURLToPath(
  new URL("./helpers/codex-fixture.ts", import.meta.url),
);

async function codexWorker(env: Record<string, string> = {}) {
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-codex-worker-"));
  const log = join(data, "codex-fixture.log");
  const baseline = await repo.git("rev-parse", "HEAD");
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: {
      codex: new CodexAdapter(
        data,
        (args, cwd, childEnv) =>
          new CodexRpc(process.execPath, [fixturePath, ...args], cwd, {
            ...childEnv,
            LAO_CODEX_FIXTURE_LOG: log,
            ...env,
          }),
      ),
    },
  });
  const engine = app.engine;
  const project = await engine.openProject(
    { name: "Codex worker fixture", repositoryPath: repo.directory },
    "project",
  );
  return {
    engine,
    store: engine.store,
    start(permission: "read_only" | "workspace_write" = "read_only") {
      return engine.startNativeRun(
        {
          projectId: project.id,
          harness: "codex",
          title: "Codex reader",
          initialPrompt: "Report the README heading",
          model: "fixture-model",
          thinking: "low",
          permission,
        },
        randomUUID(),
      );
    },
    async log() {
      return (await readFile(log, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    async close() {
      await app.close();
      await repo.verify(async () => {
        assert.equal(await repo.git("status", "--porcelain"), "");
        assert.equal(await repo.git("rev-parse", "HEAD"), baseline);
      });
      await rm(data, { recursive: true });
    },
  };
}

test("Codex runs as a gateway-connected read-only worker with its selected model and effort applied natively", async () => {
  const f = await codexWorker();
  try {
    const run = await f.start();
    await f.engine.idle();
    const [task] = f.store.listTasks(run.id);
    assert.equal(task?.status, "AWAITING_REVIEW");
    const [session] = f.store.listSessions();
    assert.equal(session?.adapter, "codex");
    assert.equal(session?.state, "exited");
    assert.equal(session?.exitCode, 0);
    const events = f.store.events({ runId: run.id, limit: 500 });
    assert.ok(events.some((e) => e.type === "worker.result"));
    assert.deepEqual(
      events.flatMap((e) =>
        e.type === "codex.settings_verified"
          ? [[e.payload.model, e.payload.thinking]]
          : [],
      ),
      [["fixture-model", "low"]],
    );
    const log = await f.log();
    assert.deepEqual(
      log.flatMap((entry) => (entry.configured ? [entry.configured] : [])),
      [{ sandbox: "read-only", approvalPolicy: "never", effort: "low" }],
    );
    assert.deepEqual(
      log.flatMap((entry) => (entry.tool ? [entry.tool] : [])),
      ["read_assignment", "submit_result"],
    );
    assert.deepEqual(
      log.flatMap((entry) => (entry.turn === "start" ? [entry.effort] : [])),
      ["low"],
    );
  } finally {
    await f.close();
  }
});

test("Codex writers are refused before any run or native process exists", async () => {
  const f = await codexWorker();
  try {
    await assert.rejects(f.start("workspace_write"), { code: "UNSUPPORTED" });
    assert.equal(f.store.listRuns().length, 0);
    assert.deepEqual(await f.log(), []);
  } finally {
    await f.close();
  }
});

test("Codex refuses every prompt when its native effort differs from the selected one", async () => {
  const f = await codexWorker({ LAO_CODEX_FIXTURE_EFFORT: "high" });
  try {
    const run = await f.start();
    await f.engine.idle();
    const [task] = f.store.listTasks(run.id);
    assert.equal(task?.status, "RETRY_DECISION");
    const log = await f.log();
    assert.ok(log.some((entry) => entry.method === "thread/start"));
    assert.equal(
      log.some((entry) => entry.method === "turn/start"),
      false,
    );
    assert.match(
      JSON.stringify(f.store.events({ runId: run.id, limit: 500 })),
      /did not apply the read-only model\/effort configuration/,
    );
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});

test("A native Codex model reroute interrupts the worker turn and is never success", async () => {
  const f = await codexWorker({ LAO_CODEX_FIXTURE_SCENARIO: "reroute" });
  try {
    const run = await f.start();
    await f.engine.idle();
    const [task] = f.store.listTasks(run.id);
    assert.equal(task?.status, "RETRY_DECISION");
    const events = f.store.events({ runId: run.id, limit: 500 });
    assert.ok(
      events.some(
        (e) =>
          e.type === "codex.session_error" &&
          JSON.stringify(e.payload).includes("model_rerouted"),
      ),
    );
    assert.equal(
      events.some((e) => e.type === "worker.result"),
      false,
    );
    assert.ok((await f.log()).some((e) => e.method === "turn/interrupt"));
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});
