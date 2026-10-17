import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Engine } from "../src/server/orchestration/engine.ts";
import { createTeamRun } from "../src/server/orchestration/team-run.ts";
import {
  createTeam,
  getTeam,
  listWorkflows,
} from "../src/server/storage/teams.ts";
import {
  createExploreSubsystemTemplate,
  getWorkflowRun,
} from "../src/server/storage/workflows.ts";
import {
  defaultLimits,
  type WorkflowTemplate,
} from "../src/shared/domain/entities.ts";
import {
  fakeExploreSubsystemTemplate,
  fakeTeamSnapshot,
} from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

const readerId = "00000000-0000-4000-8000-000000000013";
const synthesizerId = "00000000-0000-4000-8000-000000000014";
const config = {
  readerProfileId: readerId,
  synthesizerProfileId: synthesizerId,
};

async function fixture() {
  const f = await domainFixture();
  const git = await createGitFixture();
  let engine = new Engine(f.store, f.directory);
  const project = await engine.openProject(
    { name: "Explore fixture", repositoryPath: git.directory },
    "explore-project",
  );
  return {
    ...f,
    get engine() {
      return engine;
    },
    get store() {
      return f.store;
    },
    async run(template: WorkflowTemplate) {
      const key = randomUUID();
      const team = createTeam(
        f.store,
        {
          name: "Exploration team",
          leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
          workerProfileIds: [readerId, synthesizerId],
          workflowTemplateIds: [template.id],
          mode: "supervised",
          limits: defaultLimits,
        },
        `team:${key}`,
      );
      const run = await createTeamRun(
        engine,
        {
          projectId: project.id,
          teamId: team.id,
          teamVersion: team.version,
          title: "FAKE exploration",
          initialPrompt: "Wait for the owner's exploration",
        },
        `run:${key}`,
      );
      // The supervised FAKE Lead may propose work, but only the preset is assigned.
      await engine.idle();
      return run;
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

test("the saved Explore Subsystem preset runs four readers before one synthesizer and keeps every source reference after restart", async () => {
  const f = await fixture();
  try {
    const template = listWorkflows(f.store).find(
      (template) => template.id === fakeExploreSubsystemTemplate.id,
    );
    assert.ok(template);
    const run = await f.run(template);
    const input = {
      runId: run.id,
      templateId: template.id,
      parameters: { target: "src/runtime" },
    };
    const started = f.engine.workflows.start(input, "explore");
    const readers = started.stages[0]?.taskIds ?? [];
    const synth = started.stages[1]?.taskIds[0] ?? "";
    assert.equal(readers.length, 4);
    await f.engine.idle();
    const workflow = getWorkflowRun(f.store, started.id);
    assert.equal(workflow.status, "completed");
    const events = f.store.events({ runId: run.id, limit: 500 });
    const synthesisStart = events.find(
      (event) => event.type === "attempt.created" && event.taskId === synth,
    );
    assert.ok(synthesisStart);
    const packet = JSON.parse(
      f.store.getTask(synth).objective.split("\n\n").at(-1) ?? "",
    );
    assert.deepEqual(packet.parameters, { target: "src/runtime" });
    assert.deepEqual(
      packet.upstream.map((source: { taskId: string }) => source.taskId),
      readers,
    );
    for (const source of packet.upstream) {
      assert.equal(source.status, "completed");
      const original = (await f.engine.reports(source.taskId)).find(
        (entry) => entry.artifact.kind === "report",
      );
      assert.equal(source.artifactId, original?.artifact.id);
      const saved = events.find(
        (event) =>
          event.type === "report.saved" && event.taskId === source.taskId,
      );
      assert.ok(saved && saved.sequence < synthesisStart.sequence);
    }
    const attempts = f.store
      .listAttempts()
      .filter(
        (attempt) => f.store.getTask(attempt.taskId).workflowId === started.id,
      );
    assert.equal(attempts.length, 5);
    assert.ok(
      attempts
        .filter((attempt) => readers.includes(attempt.taskId))
        .every((attempt) => attempt.profileId === readerId),
    );
    assert.equal(
      attempts.find((attempt) => attempt.taskId === synth)?.profileId,
      synthesizerId,
    );
    assert.deepEqual(f.engine.workflows.results(started.id), [
      {
        name: "exploration",
        stageId: "synthesis",
        status: "completed",
        taskIds: [synth],
      },
    ]);
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(f.engine.workflows.start(input, "explore"), started);
    assert.deepEqual(getWorkflowRun(f.store, started.id), workflow);
    assert.equal(
      f.store
        .listAttempts()
        .filter(
          (attempt) =>
            f.store.getTask(attempt.taskId).workflowId === started.id,
        ).length,
      5,
    );
  } finally {
    await f.close();
  }
});

test("a three-reader saved exploration produces an explicit partial synthesis after one confirmed failure and can be reused without losing originals", async () => {
  const f = await fixture();
  try {
    const template = createExploreSubsystemTemplate(
      f.store,
      { ...config, readerCount: 3 },
      "three-readers",
    );
    const run = await f.run(template);
    const input = {
      runId: run.id,
      templateId: template.id,
      parameters: { target: "state transitions" },
    };
    const started = f.engine.workflows.start(input, "partial-explore");
    await f.engine.workflows.reconcile();
    const readers = started.stages[0]?.taskIds ?? [];
    const failed = readers[1] ?? "";
    const synth = started.stages[1]?.taskIds[0] ?? "";
    assert.equal(readers.length, 3);
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: failed, profileId: readerId, scenario: "failure" },
      "reader-failure",
    );
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, started.id).status, "partial");
    assert.equal(f.store.getTask(failed).status, "RETRY_DECISION");
    assert.equal(f.store.getTask(synth).status, "AWAITING_REVIEW");
    const packet = JSON.parse(
      f.store.getTask(synth).objective.split("\n\n").at(-1) ?? "",
    );
    assert.deepEqual(
      packet.upstream.map((source: { status: string }) => source.status),
      ["completed", "failed", "completed"],
    );
    assert.equal(packet.upstream[1].artifactId, null);
    assert.equal(packet.upstream[1].taskId, failed);
    assert.equal(packet.upstream[1].excerpt, "");
    const originalIds = packet.upstream
      .filter((source: { status: string }) => source.status === "completed")
      .map((source: { artifactId: string }) => source.artifactId);
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(
      createExploreSubsystemTemplate(
        f.store,
        { ...config, readerCount: 3 },
        "three-readers",
      ),
      template,
    );
    const nextRun = await f.run(template);
    const next = f.engine.workflows.start(
      { ...input, runId: nextRun.id },
      "next-explore",
    );
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, next.id).status, "completed");
    assert.equal(getWorkflowRun(f.store, started.id).status, "partial");
    const originals = (
      await Promise.all(
        readers.filter((id) => id !== failed).map((id) => f.engine.reports(id)),
      )
    )
      .flat()
      .filter((entry) => entry.artifact.kind === "report");
    assert.deepEqual(
      originals.map((entry) => entry.artifact.id),
      originalIds,
    );
    assert.equal(
      f.store.listAttempts().filter((attempt) => attempt.taskId === failed)
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("exploration configuration refuses missing or writable profiles and invalid counts without saving or dispatching, while a one-reader recipe still reaches synthesis", async () => {
  const f = await fixture();
  try {
    const before = listWorkflows(f.store);
    const events = f.store.events();
    for (const input of [
      { ...config, readerProfileId: randomUUID() },
      ...["readerProfileId", "synthesizerProfileId"].flatMap((field) => [
        { ...config, [field]: "00000000-0000-4000-8000-000000000011" },
        { ...config, [field]: fakeTeamSnapshot.preset.leadProfileId },
      ]),
      ...[0, 5, 1.5].map((readerCount) => ({ ...config, readerCount })),
      { ...config, model: "unvalidated-model" },
    ]) {
      assert.throws(() =>
        createExploreSubsystemTemplate(
          f.store,
          input,
          `invalid:${randomUUID()}`,
        ),
      );
      assert.deepEqual(listWorkflows(f.store), before);
      assert.deepEqual(f.store.events(), events);
    }
    assert.equal(f.store.listAttempts().length, 0);
    const template = createExploreSubsystemTemplate(
      f.store,
      { ...config, readerCount: 1 },
      "one-reader",
    );
    const run = await f.run(template);
    const count = f.store.listTasks(run.id).length;
    assert.throws(
      () =>
        f.engine.workflows.start(
          { runId: run.id, templateId: template.id, parameters: {} },
          "no-target",
        ),
      { code: "INVALID_REFERENCE" },
    );
    assert.equal(f.store.listTasks(run.id).length, count);
    const started = f.engine.workflows.start(
      {
        runId: run.id,
        templateId: template.id,
        parameters: { target: "README.md" },
      },
      "one-explore",
    );
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, started.id).status, "completed");
    assert.equal(
      f.store
        .listAttempts()
        .filter(
          (attempt) =>
            f.store.getTask(attempt.taskId).workflowId === started.id,
        ).length,
      2,
    );
  } finally {
    await f.close();
  }
});

test("startup preserves saved exploration edits and never adds workflow access to an existing owner's team", async () => {
  const f = await fixture();
  try {
    const team = createTeam(
      f.store,
      {
        name: "Owner's restricted team",
        leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
        workerProfileIds: [readerId, synthesizerId],
        workflowTemplateIds: [],
        mode: "supervised",
        limits: defaultLimits,
      },
      "restricted-team",
    );
    f.store.db
      .prepare(
        "UPDATE workflow_templates SET data=json_set(data,'$.name',?,'$.version',2) WHERE id=?",
      )
      .run("Owner's exploration", fakeExploreSubsystemTemplate.id);
    const saved = listWorkflows(f.store);
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(listWorkflows(f.store), saved);
    assert.deepEqual(getTeam(f.store, { id: team.id }), team);
    assert.equal(f.store.listAttempts().length, 0);
  } finally {
    await f.close();
  }
});
