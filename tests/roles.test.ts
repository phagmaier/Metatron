import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { Engine } from "../src/server/orchestration/engine.ts";
import {
  createRole,
  deleteRole,
  exportRole,
  getRole,
  importRole,
  listRoles,
  updateRole,
} from "../src/server/storage/roles.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

const content = {
  name: "Evidence reader",
  instructions: "Read the scoped subsystem. Cite file locations.",
  expectedOutput: "Findings, evidence, gaps and limitations.",
};

test("role edits are version checked and idempotent across reopen; deleting retains snapshotted history", async () => {
  const f = await domainFixture();
  try {
    const first = createRole(f.store, content, "role");
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Role history",
        initialPrompt: "Read",
        teamSnapshot: {
          // A run snapshot has no live dependency on a library role row.
          ...fakeTeamSnapshot,
          roles: [...fakeTeamSnapshot.roles, first],
        },
      },
      "history",
    );
    const edit = {
      ...content,
      id: first.id,
      version: 1,
      instructions: "New guidance",
    };
    const second = updateRole(f.store, edit, "edit");
    assert.equal(second.version, 2);
    assert.equal(second.createdAt, first.createdAt);
    const count = f.store.events().length;
    assert.throws(
      () => updateRole(f.store, { ...edit, expectedOutput: "Stale" }, "stale"),
      { code: "CONFLICT" },
    );
    assert.throws(
      () => deleteRole(f.store, { id: first.id, version: 1 }, "stale-delete"),
      { code: "CONFLICT" },
    );
    assert.equal(f.store.events().length, count);
    f.reopen();
    assert.deepEqual(createRole(f.store, content, "role"), first);
    assert.deepEqual(updateRole(f.store, edit, "edit"), second);
    assert.deepEqual(getRole(f.store, { id: first.id }), second);
    assert.deepEqual(f.store.getRun(run.id).teamSnapshot?.roles.at(-1), first);
    const deletion = { id: first.id, version: 2 };
    deleteRole(f.store, deletion, "delete");
    f.reopen();
    assert.deepEqual(deleteRole(f.store, deletion, "delete"), { id: first.id });
    assert.equal(listRoles(f.store).length, 0);
    assert.deepEqual(f.store.getRun(run.id).teamSnapshot?.roles.at(-1), first);
    assert.throws(() => getRole(f.store, { id: first.id }), {
      code: "NOT_FOUND",
    });
    assert.throws(() => updateRole(f.store, { ...edit, version: 2 }, "gone"), {
      code: "NOT_FOUND",
    });
  } finally {
    await f.close();
  }
});

test("portable role imports create new identities without replacing names and reject authority/config fields atomically", async () => {
  const f = await domainFixture();
  try {
    const original = createRole(f.store, content, "source");
    const exported = exportRole(f.store, { id: original.id });
    assert.deepEqual(exported.role, content);
    assert.equal("id" in exported.role, false);
    assert.equal("version" in exported.role, false);
    const imported = importRole(f.store, exported, "import");
    assert.notEqual(imported.id, original.id);
    assert.equal(imported.name, original.name);
    assert.equal(imported.version, 1);
    assert.deepEqual(exportRole(f.store, { id: imported.id }), exported);
    assert.deepEqual(importRole(f.store, exported, "import"), imported);
    const before = f.store.events().length;
    for (const key of [
      "harness",
      "model",
      "thinking",
      "permission",
      "id",
      "version",
    ]) {
      assert.throws(
        () =>
          importRole(
            f.store,
            { ...exported, role: { ...content, [key]: "injected" } },
            `bad-${key}`,
          ),
        z.ZodError,
      );
      assert.throws(
        () =>
          createRole(
            f.store,
            { ...content, [key]: "injected" },
            `create-${key}`,
          ),
        z.ZodError,
      );
      assert.throws(
        () =>
          updateRole(
            f.store,
            { ...content, id: original.id, version: 1, [key]: "injected" },
            `edit-${key}`,
          ),
        z.ZodError,
      );
    }
    for (const bad of [
      { ...exported, formatVersion: 2 },
      { ...exported, format: "other" },
      { ...exported, role: { ...content, instructions: "  " } },
      { ...exported, role: { ...content, expectedOutput: "x".repeat(8001) } },
      { ...exported, profiles: [] },
    ])
      assert.throws(() => importRole(f.store, bad, "invalid"), z.ZodError);
    assert.throws(
      () =>
        importRole(
          f.store,
          { ...exported, role: { ...content, name: "Changed" } },
          "import",
        ),
      { code: "CONFLICT" },
    );
    assert.equal(f.store.events().length, before);
    assert.equal(listRoles(f.store).length, 2);
    assert.deepEqual(getRole(f.store, { id: original.id }), original);
    f.reopen();
    assert.deepEqual(importRole(f.store, exported, "import"), imported);
    assert.deepEqual(exportRole(f.store, { id: imported.id }), exported);
  } finally {
    await f.close();
  }
});

test("referenced role deletion is refused; editing roles never changes profile capabilities or persisted run snapshots", async () => {
  const f = await domainFixture();
  let engine = new Engine(f.store, f.directory);
  try {
    const snapshot = engine.presets();
    const role = snapshot.roles[0];
    assert.ok(role);
    const run = f.store.createRun(
      {
        projectId: f.project.id,
        title: "Original",
        initialPrompt: "Read",
        teamSnapshot: snapshot,
      },
      "old-run",
    );
    const profiles = f.store.db
      .prepare("SELECT * FROM agent_profiles ORDER BY id")
      .all();
    const count = f.store.events().length;
    assert.throws(
      () =>
        deleteRole(
          f.store,
          { id: role.id, version: role.version },
          "referenced",
        ),
      { code: "CONFLICT" },
    );
    assert.equal(f.store.events().length, count);
    const changed = updateRole(
      f.store,
      { ...content, id: role.id, version: role.version },
      "update-default",
    );
    assert.deepEqual(engine.presets().roles[0], changed);
    assert.deepEqual(f.store.getRun(run.id).teamSnapshot, snapshot);
    assert.deepEqual(
      f.store.db.prepare("SELECT * FROM agent_profiles ORDER BY id").all(),
      profiles,
    );
    await engine.close();
    f.reopen();
    engine = new Engine(f.store, f.directory);
    assert.deepEqual(engine.presets().roles[0], changed);
    assert.deepEqual(f.store.getRun(run.id).teamSnapshot, snapshot);
  } finally {
    await engine.close();
    await f.close();
  }
});
