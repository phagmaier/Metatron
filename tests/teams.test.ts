import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import type { AdapterCapabilities } from "../src/server/adapters/contract.ts";
import { FakeAdapter } from "../src/server/adapters/fake.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import { createTeamRun } from "../src/server/orchestration/team-run.ts";
import {
  createRole,
  getRole,
  updateRole,
} from "../src/server/storage/roles.ts";
import {
  createTeam,
  deleteTeam,
  demoTeamIds,
  getTeam,
  updateTeam,
} from "../src/server/storage/teams.ts";
import {
  type AgentProfile,
  defaultLimits,
} from "../src/shared/domain/entities.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

class CatalogAdapter extends FakeAdapter {
  catalog: AdapterCapabilities;
  constructor(adapter: "pi" | "codex") {
    super();
    this.catalog = {
      adapter,
      installed: true,
      authenticated: adapter === "pi" ? "unknown" : true,
      models: [
        {
          id: "fixture/model",
          label: "Fixture",
          thinking: [{ id: "low", label: "Low" }],
        },
      ],
      supportsResume: false,
      supportsLiveSteer: false,
      supportsCancel: true,
      supportsPermissionPrompts: false,
      supportsToolGateway: true,
      diagnostics: ["Discovery fixture only; no provider contacted"],
    };
  }
  override async discover() {
    return this.catalog;
  }
}

const fake = (index: number) => {
  const profile = fakeTeamSnapshot.profiles[index];
  assert.ok(profile);
  return profile;
};
const fakeLead = fake(0);
const fakeWriter = fake(1);
const fakeReviewer = fake(2);
const fakeReader = fake(3);

async function fixture() {
  const f = await domainFixture();
  const git = await createGitFixture();
  const pi = new CatalogAdapter("pi");
  const codex = new CatalogAdapter("codex");
  let engine = new Engine(f.store, f.directory, pi, { codex });
  const project = await engine.openProject(
    { name: "Teams", repositoryPath: git.directory },
    "git-project",
  );
  const role = createRole(
    f.store,
    {
      name: "Evidence reader",
      instructions: "Cite file locations",
      expectedOutput: "Evidence and gaps",
    },
    "role",
  );
  const profile = (name: string, harness: string, permission: string) =>
    engine.profiles.create(
      {
        name,
        roleId: role.id,
        harness,
        model: "fixture/model",
        thinking: "low",
        permission,
        instructionOverride: null,
      },
      `profile:${name}`,
    );
  const reader = await profile("Ada", "pi", "read_only");
  const writer = await profile("Bea", "pi", "workspace_write");
  const lead = await profile("Lead", "codex", "coordinator");
  return {
    ...f,
    git,
    pi,
    codex,
    project,
    role,
    reader,
    writer,
    lead,
    content: {
      name: "Native team",
      leadProfileId: lead.id,
      workerProfileIds: [reader.id],
      workflowTemplateIds: [],
      mode: "supervised",
      limits: { ...defaultLimits, maxTotalWorkerLaunchesPerRun: 3 },
    },
    get engine() {
      return engine;
    },
    get store() {
      return f.store;
    },
    async restart() {
      await engine.close();
      f.reopen();
      engine = new Engine(f.store, f.directory, pi, { codex });
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
function saveWorkflow(
  f: Awaited<ReturnType<typeof fixture>>,
  profileId: string,
  instructions = "Read the entry points",
) {
  const now = new Date().toISOString();
  const workflow = {
    id: randomUUID(),
    version: 1,
    name: "Saved workflow",
    createdAt: now,
    updatedAt: now,
    inputs: [],
    results: [{ name: "findings", stageId: "read" }],
    stages: [
      {
        id: "read",
        type: "single_agent",
        profileId,
        instructions,
        inputs: [],
        result: "Evidence and gaps",
        partitions: [],
        dependsOn: [],
        count: 1,
        partialFailure: "stop",
      },
    ],
  };
  f.store.db
    .prepare("INSERT INTO workflow_templates VALUES (?,?)")
    .run(workflow.id, JSON.stringify(workflow));
  return workflow;
}

test("team writes enforce roster policy atomically, are version checked, replay across restart and keep referenced profiles consistent", async () => {
  const f = await fixture();
  try {
    const first = createTeam(f.store, f.content, "create");
    assert.equal(first.version, 1);
    const before = f.store.events().length;
    // An unimplemented native harness can only exist as a pre-discovery row.
    const legacy = { ...f.reader, id: randomUUID(), harness: "claude-code" };
    f.store.db
      .prepare("INSERT INTO agent_profiles VALUES (?,?,?)")
      .run(legacy.id, legacy.roleId, JSON.stringify(legacy));
    const outside = saveWorkflow(f, f.writer.id);
    const refused: [Record<string, unknown>, string][] = [
      [{ leadProfileId: f.reader.id }, "POLICY_DENIED"],
      [{ workerProfileIds: [f.reader.id, f.lead.id] }, "POLICY_DENIED"],
      [{ workerProfileIds: [fakeReader.id] }, "POLICY_DENIED"],
      [{ leadProfileId: fakeLead.id }, "POLICY_DENIED"],
      [{ workerProfileIds: [legacy.id] }, "UNSUPPORTED"],
      [{ workerProfileIds: [randomUUID()] }, "NOT_FOUND"],
      [{ workflowTemplateIds: [randomUUID()] }, "NOT_FOUND"],
      [{ workflowTemplateIds: [outside.id] }, "INVALID_REFERENCE"],
    ];
    for (const [index, [change, code]] of refused.entries()) {
      assert.throws(
        () => createTeam(f.store, { ...f.content, ...change }, `bad-${index}`),
        { code },
      );
      assert.throws(
        () =>
          updateTeam(
            f.store,
            { ...f.content, ...change, id: first.id, version: 1 },
            `bad-edit-${index}`,
          ),
        { code },
      );
    }
    for (const change of [
      { workerProfileIds: [] },
      { workerProfileIds: [f.reader.id, f.reader.id] },
      { limits: { ...defaultLimits, maxConcurrentWriters: 0 } },
      { mode: "unbounded" },
      { name: "x".repeat(161) },
      { version: 1 },
      { roles: [] },
    ])
      assert.throws(
        () => createTeam(f.store, { ...f.content, ...change }, randomUUID()),
        z.ZodError,
      );
    const edit = {
      ...f.content,
      id: first.id,
      version: 1,
      workerProfileIds: [f.reader.id, f.writer.id],
      mode: "autonomous_bounded",
    };
    const second = updateTeam(f.store, edit, "edit");
    assert.equal(second.version, 2);
    assert.equal(second.createdAt, first.createdAt);
    const count = f.store.events().length;
    assert.equal(count, before + 1);
    assert.throws(() => updateTeam(f.store, edit, "stale"), {
      code: "CONFLICT",
    });
    assert.throws(
      () => deleteTeam(f.store, { id: first.id, version: 1 }, "stale-delete"),
      { code: "CONFLICT" },
    );
    for (const id of demoTeamIds) {
      assert.throws(
        () => updateTeam(f.store, { ...f.content, id, version: 1 }, "demo"),
        { code: "POLICY_DENIED" },
      );
      assert.throws(() => deleteTeam(f.store, { id, version: 1 }, "demo-x"), {
        code: "POLICY_DENIED",
      });
    }
    assert.equal(f.store.events().length, count);
    await f.restart();
    assert.deepEqual(createTeam(f.store, f.content, "create"), first);
    assert.deepEqual(updateTeam(f.store, edit, "edit"), second);
    assert.throws(
      () => createTeam(f.store, { ...f.content, name: "Other" }, "create"),
      { code: "CONFLICT" },
    );
    assert.deepEqual(getTeam(f.store, { id: first.id }), second);
    // Members keep their Lead/worker class; worker-to-worker changes are allowed.
    const profile = (base: AgentProfile, change: object, key: string) => {
      const { createdAt: _created, updatedAt: _updated, ...content } = base;
      return f.engine.profiles.update({ ...content, ...change }, key);
    };
    await assert.rejects(
      profile(f.reader, { harness: "codex", permission: "coordinator" }, "up"),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      profile(f.lead, { harness: "pi", permission: "read_only" }, "down"),
      { code: "CONFLICT" },
    );
    assert.throws(
      () =>
        f.engine.profiles.delete(
          { id: f.reader.id, version: f.reader.version },
          "used",
        ),
      { code: "CONFLICT" },
    );
    assert.equal(
      (await profile(f.reader, { permission: "workspace_write" }, "writer"))
        .version,
      2,
    );
    deleteTeam(f.store, { id: first.id, version: 2 }, "delete");
    assert.deepEqual(
      deleteTeam(f.store, { id: first.id, version: 2 }, "delete"),
      { id: first.id },
    );
    f.engine.profiles.delete({ id: f.lead.id, version: 1 }, "unused");
    assert.equal(f.store.listAttempts().length, 0);
    assert.equal(f.engine.scheduling.list().length, 0);
  } finally {
    await f.close();
  }
});

test("a FAKE team run owns an immutable snapshot; library edits, deletion and restart never change it and the next run uses the new version", async () => {
  const f = await fixture();
  try {
    const workflow = saveWorkflow(f, fakeReader.id);
    const content = {
      name: "FAKE readers",
      leadProfileId: fakeLead.id,
      workerProfileIds: [fakeReader.id],
      workflowTemplateIds: [workflow.id],
      mode: "autonomous_bounded",
      limits: { ...defaultLimits, maxTotalWorkerLaunchesPerRun: 5 },
    };
    assert.throws(
      () =>
        createTeam(
          f.store,
          { ...content, workerProfileIds: [fakeWriter.id] },
          "outside",
        ),
      { code: "INVALID_REFERENCE" },
    );
    const team = createTeam(f.store, content, "team");
    const start = {
      projectId: f.project.id,
      teamId: team.id,
      teamVersion: 1,
      title: "First team run",
      initialPrompt: "Inspect the fixture",
    };
    await assert.rejects(
      createTeamRun(f.engine, { ...start, teamVersion: 2 }, "stale"),
      { code: "CONFLICT" },
    );
    assert.equal(f.store.listRuns(f.project.id).length, 0);
    const run = await createTeamRun(f.engine, start, "start");
    assert.deepEqual(await createTeamRun(f.engine, start, "start"), run);
    assert.equal(run.execution, "fake");
    assert.equal(run.mode, "autonomous_bounded");
    assert.deepEqual(run.limits, content.limits);
    const snapshot = run.teamSnapshot;
    assert.ok(snapshot);
    assert.deepEqual(snapshot.preset, team);
    assert.deepEqual(
      snapshot.profiles.map((p) => p.id),
      [fakeLead.id, fakeReader.id],
    );
    assert.deepEqual(
      snapshot.roles,
      [fakeLead.roleId, fakeReader.roleId].map((id) =>
        getRole(f.store, { id }),
      ),
    );
    assert.deepEqual(snapshot.workflows, [workflow]);
    await f.engine.idle();
    const [work] = f.store
      .listTasks(run.id)
      .filter((task) => task.kind === "work");
    assert.equal(work?.assignedProfileId, fakeReader.id);
    assert.equal(work?.status, "AWAITING_REVIEW");

    const leadRole = getRole(f.store, { id: fakeLead.roleId });
    const role = updateRole(
      f.store,
      {
        id: leadRole.id,
        version: leadRole.version,
        name: leadRole.name,
        instructions: "Later Lead guidance",
        expectedOutput: leadRole.expectedOutput,
      },
      "lead-role",
    );
    const next = updateTeam(
      f.store,
      {
        ...content,
        id: team.id,
        version: 1,
        mode: "supervised",
        workerProfileIds: [fakeReviewer.id],
        workflowTemplateIds: [],
        limits: defaultLimits,
      },
      "edit",
    );
    f.store.db
      .prepare("UPDATE workflow_templates SET data=json_set(data,?,?)")
      .run("$.stages[0].instructions", "Changed later");
    await f.restart();
    assert.deepEqual(f.store.getRun(run.id).teamSnapshot, snapshot);
    const later = await createTeamRun(
      f.engine,
      { ...start, teamVersion: 2, title: "Second", scenario: "failure" },
      "second",
    );
    assert.equal(later.mode, "supervised");
    assert.deepEqual(later.limits, defaultLimits);
    assert.deepEqual(later.teamSnapshot?.preset, next);
    assert.deepEqual(
      later.teamSnapshot?.profiles.map((p) => p.id),
      [fakeLead.id, fakeReviewer.id],
    );
    assert.deepEqual(later.teamSnapshot?.roles[0], role);
    assert.deepEqual(later.teamSnapshot?.workflows, []);
    await f.engine.idle();
    deleteTeam(f.store, { id: team.id, version: 2 }, "delete");
    await f.restart();
    assert.deepEqual(f.store.getRun(run.id).teamSnapshot, snapshot);
    assert.deepEqual(f.store.getRun(later.id).teamSnapshot, later.teamSnapshot);
    // A Supervised FAKE Lead only proposes; nothing was dispatched for it.
    assert.equal(
      f.store.listTasks(later.id).filter((t) => t.kind === "work").length,
      1,
    );
    assert.equal(
      f.store
        .listAttempts()
        .filter((a) => f.store.getTask(a.taskId).runId === later.id).length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("native team starts re-check fresh discovery and login inside the start transaction and create nothing when refused", async () => {
  const f = await fixture();
  try {
    const team = createTeam(f.store, f.content, "team");
    const start = {
      projectId: f.project.id,
      teamId: team.id,
      teamVersion: 1,
      title: "Native",
      initialPrompt: "Read",
    };
    const events = f.store.events().length;
    await assert.rejects(
      createTeamRun(f.engine, { ...start, scenario: "failure" }, "scenario"),
      { code: "POLICY_DENIED" },
    );
    f.codex.catalog.authenticated = "unknown";
    await assert.rejects(createTeamRun(f.engine, start, "login"), {
      code: "UNSUPPORTED",
    });
    f.codex.catalog.authenticated = true;
    const models = f.pi.catalog.models;
    f.pi.catalog.models = [];
    await assert.rejects(createTeamRun(f.engine, start, "drift"), {
      code: "UNSUPPORTED",
    });
    f.pi.catalog.models = models;
    f.pi.catalog.installed = false;
    await assert.rejects(createTeamRun(f.engine, start, "missing"), {
      code: "UNSUPPORTED",
    });
    assert.equal(f.store.listRuns(f.project.id).length, 0);
    assert.equal(f.store.events().length, events);
    assert.equal(f.engine.scheduling.list().length, 0);
  } finally {
    await f.close();
  }
});
