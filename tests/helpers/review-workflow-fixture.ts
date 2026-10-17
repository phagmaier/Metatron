import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PiAdapter } from "../../src/server/adapters/pi.ts";
import { PiRpc } from "../../src/server/adapters/pi-rpc.ts";
import { startApp } from "../../src/server/app.ts";
import { listIntegrationCandidates } from "../../src/server/storage/candidates.ts";
import { createReviewImplementationTemplate } from "../../src/server/storage/workflows.ts";
import { nativeTeam } from "../../src/shared/native.ts";
import { createGitFixture } from "./git-fixture.ts";

export const reviewerId = "00000000-0000-4000-8000-000000000012";
export const writerId = "00000000-0000-4000-8000-000000000011";

// Only deterministic protocol subprocesses and a disposable Git checkout.
// The fixture starts no native harness and never contacts a provider.
export async function reviewWorkflowFixture(scenario = "review-findings") {
  const repo = await createGitFixture();
  const data = await mkdtemp("/tmp/lao-review-workflow-");
  const baseSha = await repo.git("rev-parse", "HEAD");
  const open = () =>
    startApp({
      development: false,
      port: 0,
      databasePath: join(data, "state.sqlite"),
      adapters: {
        pi: new PiAdapter(
          data,
          (_args, cwd, env) =>
            new PiRpc(
              process.execPath,
              [fileURLToPath(new URL("./pi-rpc-fixture.ts", import.meta.url))],
              cwd,
              {
                ...env,
                LAO_FIXTURE_SCENARIO:
                  env.LAO_PI_PERMISSION === "workspace_write"
                    ? "tracked"
                    : scenario,
              },
            ),
        ),
      },
    });
  let app = await open();
  const initialEngine = app.engine;
  assert.ok(initialEngine);
  const project = await initialEngine.openProject(
    {
      name: "Review workflow protocol fixture",
      repositoryPath: repo.directory,
    },
    "project",
  );
  const template = createReviewImplementationTemplate(
    initialEngine.store,
    { reviewerProfileId: reviewerId },
    "review-template",
  );
  const team = nativeTeam("fixture/model", "off");
  // Seed immutable owner-directed run snapshots; no model Lead is needed.
  const snapshot = {
    ...team,
    preset: { ...team.preset, workflowTemplateIds: [template.id] },
    workflows: [template],
  };
  const newRun = () => {
    assert.ok(app.engine);
    return app.engine.store.createRun(
      {
        projectId: project.id,
        title: "Review workflow (protocol fixture, not a live harness)",
        initialPrompt: "Independently inspect a captured implementation",
        mode: "supervised",
        execution: "native",
        repository: project.repository,
        teamSnapshot: snapshot,
      },
      `run:${randomUUID()}`,
    );
  };
  const run = newRun();
  const original = initialEngine.store.createTask(
    {
      runId: run.id,
      title: "Keep a project heading",
      objective: "Keep a Markdown project heading in README.md",
      acceptanceCriteria: ["README.md retains a Markdown heading"],
    },
    "implementation",
  );
  initialEngine.scheduling.enqueue(
    { role: "owner" },
    { taskId: original.id, profileId: writerId },
    "implementation:assign",
  );
  await initialEngine.idle();
  const candidate = listIntegrationCandidates(
    initialEngine.store,
    original.id,
  )[0];
  assert.ok(candidate);
  return {
    repo,
    data,
    baseSha,
    run,
    original,
    candidate,
    template,
    newRun,
    get app() {
      return app;
    },
    get engine() {
      assert.ok(app.engine);
      return app.engine;
    },
    get store() {
      assert.ok(app.engine);
      return app.engine.store;
    },
    input(runId = run.id) {
      return {
        runId,
        templateId: template.id,
        parameters: { candidate_id: candidate.id },
      };
    },
    async restart() {
      await app.close();
      app = await open();
    },
    async close() {
      await app.close();
      await repo.verify(async () => {
        assert.equal(await repo.git("status", "--porcelain"), "");
        assert.equal(await repo.git("rev-parse", "HEAD"), baseSha);
      });
      await rm(data, { recursive: true });
    },
  };
}
