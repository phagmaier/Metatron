import assert from "node:assert/strict";
import { Engine } from "../../src/server/orchestration/engine.ts";
import { createExploreSubsystemTemplate } from "../../src/server/storage/workflows.ts";
import { defaultLimits } from "../../src/shared/domain/entities.ts";
import { fakeTeamSnapshot } from "../../src/shared/presets.ts";
import { domainFixture } from "./domain-fixture.ts";
import { createGitFixture } from "./git-fixture.ts";

export const readerId = "00000000-0000-4000-8000-000000000013";
export const synthId = "00000000-0000-4000-8000-000000000014";
export const writerId = "00000000-0000-4000-8000-000000000011";

export async function workflowSchedulingFixture(
  limits = defaultLimits,
  readerCount = 2,
) {
  const f = await domainFixture();
  const git = await createGitFixture();
  let engine = new Engine(f.store, f.directory);
  const project = await engine.openProject(
    { name: "Workflow scheduling", repositoryPath: git.directory },
    "workflow-project",
  );
  const template = createExploreSubsystemTemplate(
    f.store,
    { readerProfileId: readerId, synthesizerProfileId: synthId, readerCount },
    "template",
  );
  const snapshot = structuredClone(fakeTeamSnapshot);
  snapshot.preset.workflowTemplateIds = [template.id];
  snapshot.workflows = [template];
  const run = f.store.createRun(
    {
      projectId: project.id,
      title: "FAKE bounded workflow",
      initialPrompt: "Inspect fixture",
      repository: project.repository,
      teamSnapshot: snapshot,
      limits,
    },
    "workflow-run",
  );
  const input = {
    runId: run.id,
    templateId: template.id,
    parameters: { target: "README.md" },
  };
  return {
    ...f,
    run,
    input,
    template,
    get engine() {
      return engine;
    },
    get store() {
      return f.store;
    },
    async restart() {
      await engine.close();
      f.reopen();
      f.store.recoverInterrupted();
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
