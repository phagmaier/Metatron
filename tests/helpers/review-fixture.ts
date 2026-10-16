import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PiAdapter } from "../../src/server/adapters/pi.ts";
import { PiRpc } from "../../src/server/adapters/pi-rpc.ts";
import { startApp } from "../../src/server/app.ts";
import { requestReview } from "../../src/server/orchestration/review.ts";
import { listIntegrationCandidates } from "../../src/server/storage/candidates.ts";
import { createGitFixture } from "./git-fixture.ts";

// Real loopback gateway and Pi protocol subprocess; no provider/native harness.
export async function reviewFixture(scenario = "review-pass") {
  const repo = await createGitFixture();
  const data = await mkdtemp("/tmp/lao-review-result-");
  const pi = new PiAdapter(
    data,
    (_args, cwd, env) =>
      new PiRpc(
        process.execPath,
        [fileURLToPath(new URL("./pi-rpc-fixture.ts", import.meta.url))],
        cwd,
        {
          ...env,
          LAO_FIXTURE_SCENARIO:
            env.LAO_PI_PERMISSION === "workspace_write" ? "tracked" : scenario,
        },
      ),
  );
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: { pi },
  });
  const engine = app.engine;
  assert.ok(engine);
  const store = engine.store;
  const project = await engine.openProject(
    { name: "Review fixture", repositoryPath: repo.directory },
    "project",
  );
  const run = await engine.startNativeRun(
    {
      projectId: project.id,
      title: "Protocol fixture review",
      initialPrompt: "Keep a project heading in README",
      model: "fixture/model",
      thinking: "off",
      permission: "workspace_write",
    },
    "run",
  );
  await engine.idle();
  const original = store.listTasks(run.id)[0];
  assert.ok(original);
  const [candidate] = listIntegrationCandidates(store, original.id);
  assert.ok(candidate);
  const request = (key = "review") => {
    requestReview(
      engine,
      { role: "owner" },
      {
        taskId: original.id,
        profileId: "00000000-0000-4000-8000-000000000012",
      },
      key,
    );
    const task = store
      .listTasks(run.id)
      .findLast((t) => t.reviewCandidateId === candidate.id);
    assert.ok(task);
    return task;
  };
  return { repo, data, app, engine, store, run, original, candidate, request };
}
