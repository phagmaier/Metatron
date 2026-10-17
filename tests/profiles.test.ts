import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import type { AdapterCapabilities } from "../src/server/adapters/contract.ts";
import { FakeAdapter } from "../src/server/adapters/fake.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import { createRole, deleteRole } from "../src/server/storage/roles.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

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
        { id: "fixture/plain", label: "Plain", thinking: [] },
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

async function fixture() {
  const f = await domainFixture();
  const pi = new CatalogAdapter("pi");
  const codex = new CatalogAdapter("codex");
  let engine = new Engine(f.store, f.directory, pi, { codex });
  const role = createRole(
    f.store,
    {
      name: "Evidence reader",
      instructions: "Cite file locations",
      expectedOutput: "Evidence and gaps",
    },
    "role",
  );
  const content = {
    name: "Ada",
    roleId: role.id,
    harness: "pi",
    model: "fixture/model",
    thinking: "low",
    permission: "read_only",
    instructionOverride: "Keep the report concise",
  };
  return {
    ...f,
    pi,
    codex,
    role,
    content,
    get engine() {
      return engine;
    },
    async restart() {
      await engine.close();
      f.reopen();
      engine = new Engine(f.store, f.directory, pi, { codex });
    },
    async close() {
      await engine.close();
      await f.close();
    },
  };
}

test("profile edits are version checked, idempotent and survive restart without altering run snapshots", async () => {
  const f = await fixture();
  try {
    const first = await f.engine.profiles.create(f.content, "create");
    const snapshot = {
      ...fakeTeamSnapshot,
      profiles: [...fakeTeamSnapshot.profiles, first],
      roles: [...fakeTeamSnapshot.roles, f.role],
    };
    const run = f.engine.store.createRun(
      {
        projectId: f.project.id,
        title: "Profile history",
        initialPrompt: "Read",
        teamSnapshot: snapshot,
      },
      "history",
    );
    const edit = {
      ...f.content,
      id: first.id,
      version: 1,
      name: "Ada writer",
      permission: "workspace_write",
    };
    // Profiles saved before versioned CRUD read as version 1 without a migration.
    f.engine.store.db
      .prepare(
        "UPDATE agent_profiles SET data=json_remove(data,'$.version') WHERE id=?",
      )
      .run(first.id);
    const second = await f.engine.profiles.update(edit, "edit");
    assert.equal(second.version, 2);
    assert.equal(second.createdAt, first.createdAt);
    const count = f.engine.store.events().length;
    await assert.rejects(
      f.engine.profiles.update({ ...edit, name: "Stale" }, "stale"),
      { code: "CONFLICT" },
    );
    assert.throws(
      () =>
        f.engine.profiles.delete({ id: first.id, version: 1 }, "stale-delete"),
      { code: "CONFLICT" },
    );
    assert.equal(f.engine.store.events().length, count);
    await f.restart();
    f.pi.catalog.installed = false;
    assert.deepEqual(
      await f.engine.profiles.create(f.content, "create"),
      first,
    );
    assert.deepEqual(await f.engine.profiles.update(edit, "edit"), second);
    await assert.rejects(
      f.engine.profiles.create({ ...f.content, name: "Different" }, "create"),
      { code: "CONFLICT" },
    );
    assert.deepEqual(f.engine.profiles.get({ id: first.id }), second);
    assert.deepEqual(f.engine.store.getRun(run.id).teamSnapshot, snapshot);
    f.engine.profiles.delete({ id: first.id, version: 2 }, "delete");
    await f.restart();
    assert.deepEqual(
      f.engine.profiles.delete({ id: first.id, version: 2 }, "delete"),
      { id: first.id },
    );
    assert.equal(
      f.engine.profiles.list().some((p) => p.id === first.id),
      false,
    );
    assert.deepEqual(f.engine.store.getRun(run.id).teamSnapshot, snapshot);
    deleteRole(f.engine.store, { id: f.role.id, version: 1 }, "delete-role");
    assert.equal(f.engine.store.listAttempts().length, 0);
  } finally {
    await f.close();
  }
});

test("profile writes use fresh server discovery and reject unsupported selections atomically", async () => {
  const f = await fixture();
  try {
    const first = await f.engine.profiles.create(f.content, "valid");
    const before = f.engine.store.events().length;
    const bad = [
      { model: "invented" },
      { thinking: "ultra" },
      { model: "fixture/plain", thinking: "low" },
      { harness: "claude-code" },
      { harness: "opencode" },
      { permission: "coordinator" },
      { harness: "codex", permission: "read_only" },
      { harness: "codex", permission: "workspace_write" },
      { roleId: randomUUID() },
    ];
    for (const [index, selection] of bad.entries()) {
      await assert.rejects(
        f.engine.profiles.create(
          { ...f.content, ...selection },
          `bad-create-${index}`,
        ),
      );
      await assert.rejects(
        f.engine.profiles.update(
          { ...f.content, id: first.id, version: 1, ...selection },
          `bad-edit-${index}`,
        ),
      );
    }
    for (const extra of [
      { supportsToolGateway: true },
      { capabilities: f.pi.catalog },
      { id: randomUUID() },
      { version: 99 },
    ])
      await assert.rejects(
        f.engine.profiles.create({ ...f.content, ...extra }, randomUUID()),
        z.ZodError,
      );
    for (const selection of [
      { name: " " },
      { name: "x".repeat(161) },
      { instructionOverride: "x".repeat(4001) },
    ])
      await assert.rejects(
        f.engine.profiles.create({ ...f.content, ...selection }, randomUUID()),
        z.ZodError,
      );
    f.pi.catalog.models = [];
    await assert.rejects(
      f.engine.profiles.update(
        { ...f.content, id: first.id, version: 1 },
        "drift",
      ),
      { code: "UNSUPPORTED" },
    );
    assert.equal(f.engine.store.events().length, before);
    assert.deepEqual(f.engine.profiles.get({ id: first.id }), first);
    assert.throws(
      () =>
        deleteRole(f.engine.store, { id: f.role.id, version: 1 }, "used-role"),
      { code: "CONFLICT" },
    );
    assert.equal(f.engine.store.listAttempts().length, 0);
  } finally {
    await f.close();
  }
});

test("profile discovery reports actual adapter limits, missing/auth states and permits null reasoning", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(
      (await f.engine.profiles.discover({ harness: "pi" })).permissions,
      ["read_only", "workspace_write"],
    );
    assert.deepEqual(
      (await f.engine.profiles.discover({ harness: "codex" })).permissions,
      ["coordinator"],
    );
    await f.engine.profiles.create(
      { ...f.content, model: "fixture/plain", thinking: null },
      "plain",
    );
    await f.engine.profiles.create(
      { ...f.content, harness: "codex", permission: "coordinator" },
      "lead",
    );
    f.codex.catalog.authenticated = false;
    await assert.rejects(
      f.engine.profiles.create(
        { ...f.content, harness: "codex", permission: "coordinator" },
        "no-auth",
      ),
      { code: "UNSUPPORTED" },
    );
    f.pi.catalog.installed = false;
    await assert.rejects(f.engine.profiles.create(f.content, "missing"), {
      code: "UNSUPPORTED",
    });
    f.pi.catalog.installed = true;
    f.pi.catalog.adapter = "fake";
    await assert.rejects(f.engine.profiles.create(f.content, "fake-native"), {
      code: "UNSUPPORTED",
    });
    f.pi.discover = async () => {
      throw new Error("fixture-secret");
    };
    const failed = await f.engine.profiles.discover({ harness: "pi" });
    assert.equal(failed.installed, "unknown");
    assert.deepEqual(failed.models, []);
    assert.equal(JSON.stringify(failed).includes("fixture-secret"), false);
    await assert.rejects(
      f.engine.profiles.create(f.content, "discovery-error"),
      { code: "UNSUPPORTED" },
    );
    const demo = fakeTeamSnapshot.profiles[1];
    assert.ok(demo);
    await assert.rejects(
      f.engine.profiles.update(
        { ...f.content, id: demo.id, version: demo.version },
        "demo-edit",
      ),
      { code: "POLICY_DENIED" },
    );
    assert.throws(
      () =>
        f.engine.profiles.delete(
          { id: demo.id, version: demo.version },
          "demo-delete",
        ),
      { code: "POLICY_DENIED" },
    );
  } finally {
    await f.close();
  }
});

test("profile deletion checks saved team lead/worker and workflow references; role changes preserve relational ownership", async () => {
  const f = await fixture();
  try {
    const profile = await f.engine.profiles.create(f.content, "profile");
    const otherRole = fakeTeamSnapshot.roles[1];
    assert.ok(otherRole);
    const changed = await f.engine.profiles.update(
      { ...f.content, id: profile.id, version: 1, roleId: otherRole.id },
      "change-role",
    );
    deleteRole(f.engine.store, { id: f.role.id, version: 1 }, "old-role");
    assert.throws(
      () =>
        deleteRole(
          f.engine.store,
          { id: otherRole.id, version: 1 },
          "new-role",
        ),
      { code: "CONFLICT" },
    );
    const deletion = { id: profile.id, version: changed.version };
    for (const kind of ["lead", "worker", "workflow"]) {
      const id = randomUUID();
      if (kind === "workflow") {
        const data = {
          id,
          name: "Saved",
          version: 1,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          inputs: [],
          results: [{ name: "findings", stageId: "read" }],
          stages: [
            {
              id: "read",
              type: "single_agent",
              profileId: profile.id,
              instructions: "Read",
              inputs: [],
              result: "Evidence and gaps",
              partitions: [],
              dependsOn: [],
              count: 1,
              partialFailure: "stop",
            },
          ],
        };
        f.engine.store.db
          .prepare("INSERT INTO workflow_templates VALUES (?,?)")
          .run(id, JSON.stringify(data));
      } else {
        const data = {
          ...fakeTeamSnapshot.preset,
          id,
          leadProfileId:
            kind === "lead"
              ? profile.id
              : fakeTeamSnapshot.preset.leadProfileId,
          workerProfileIds: kind === "worker" ? [profile.id] : [],
        };
        f.engine.store.db
          .prepare("INSERT INTO team_presets VALUES (?,?,?)")
          .run(id, data.leadProfileId, JSON.stringify(data));
      }
      assert.throws(() => f.engine.profiles.delete(deletion, `ref-${kind}`), {
        code: "CONFLICT",
      });
      f.engine.store.db
        .prepare(
          kind === "workflow"
            ? "DELETE FROM workflow_templates WHERE id=?"
            : "DELETE FROM team_presets WHERE id=?",
        )
        .run(id);
    }
    f.engine.profiles.delete(deletion, "delete");
    assert.throws(() => f.engine.profiles.get({ id: profile.id }), {
      code: "NOT_FOUND",
    });
    await assert.rejects(
      f.engine.profiles.update(
        { ...f.content, roleId: otherRole.id, ...deletion },
        "gone",
      ),
      { code: "NOT_FOUND" },
    );
  } finally {
    await f.close();
  }
});
