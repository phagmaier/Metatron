import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { startApp } from "../src/server/app.ts";
import {
  roleTemplateSchema,
  runSchema,
  teamSnapshotSchema,
} from "../src/shared/domain/entities.ts";
import { roleExportSchema, rolesResponseSchema } from "../src/shared/roles.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

test("owner role HTTP CRUD/import-export survives restart, snapshots future runs and protects mutation boundaries", async () => {
  const f = await domainFixture();
  const git = await createGitFixture();
  const options = {
    development: false,
    port: 0,
    databasePath: join(f.directory, "state.sqlite"),
  };
  let app = await startApp(options);
  try {
    const read = async (path: string) =>
      (await fetch(`${app.origin}/api/${path}`)).json() as Promise<unknown>;
    const write = async (
      path: string,
      input: unknown,
      method = "POST",
      key: string = crypto.randomUUID(),
      status = 200,
    ) => {
      const { token } = z
        .strictObject({ token: z.string() })
        .parse(await read("local-session"));
      const response = await fetch(`${app.origin}/api/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Local-Token": token,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(input),
      });
      assert.equal(response.status, status, await response.clone().text());
      return response.json() as Promise<unknown>;
    };
    const initial = rolesResponseSchema.parse(
      await read("role-templates"),
    ).roles;
    assert.equal(initial.length, 5);
    const original = initial[0];
    assert.ok(original);
    const content = {
      name: "Custom reader",
      instructions: "Cite evidence",
      expectedOutput: "Report gaps",
    };
    const unauthenticated = await fetch(`${app.origin}/api/role-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });
    assert.equal(unauthenticated.status, 403);
    const foreign = await fetch(`${app.origin}/api/role-templates`, {
      method: "POST",
      headers: {
        Origin: "https://foreign.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(content),
    });
    assert.equal(foreign.status, 403);
    await write(
      "role-templates",
      { ...content, model: "forbidden" },
      "POST",
      "bad-model",
      400,
    );
    const role = roleTemplateSchema.parse(
      await write("role-templates", content, "POST", "create-role"),
    );
    const json = roleExportSchema.parse(
      await read(`role-templates/export?id=${role.id}`),
    );
    const copy = roleTemplateSchema.parse(
      await write("role-templates/import", json, "POST", "import-role"),
    );
    assert.notEqual(copy.id, role.id);
    await write(
      "role-templates/import",
      { ...json, formatVersion: 99 },
      "POST",
      "bad-format",
      400,
    );
    await write(
      "role-templates/import",
      { ...json, role: { ...json.role, permission: "workspace_write" } },
      "POST",
      "bad-permission",
      400,
    );
    const changed = roleTemplateSchema.parse(
      await write(
        "role-templates",
        {
          ...content,
          instructions: "Updated guidance",
          id: role.id,
          version: 1,
        },
        "PATCH",
        "edit-role",
      ),
    );
    await write(
      "role-templates",
      { ...content, id: role.id, version: 1 },
      "PATCH",
      "stale-edit",
      409,
    );
    await write(
      "role-templates",
      { id: original.id, version: original.version },
      "DELETE",
      "used-delete",
      409,
    );
    await write(
      "role-templates",
      { id: role.id, version: 1 },
      "DELETE",
      "stale-delete",
      409,
    );
    await write(
      "role-templates",
      { id: role.id, version: changed.version },
      "DELETE",
      "delete-role",
    );
    assert.equal(
      (await fetch(`${app.origin}/api/role-templates/export?id=${role.id}`))
        .status,
      404,
    );

    const project = await app.engine.openProject(
      { name: "Roles fixture", repositoryPath: git.directory },
      "project-roles",
    );
    const input = {
      projectId: project.id,
      title: "Before role edit",
      initialPrompt: "Discuss only",
      mode: "chat_plan",
      leadProfileId: app.engine.presets().preset.leadProfileId,
    };
    const before = runSchema.parse(
      await write("runs", input, "POST", "before-run"),
    );
    const updated = roleTemplateSchema.parse(
      await write(
        "role-templates",
        { ...content, id: original.id, version: original.version },
        "PATCH",
        "built-in-edit",
      ),
    );
    const after = runSchema.parse(
      await write(
        "runs",
        { ...input, title: "After role edit" },
        "POST",
        "after-run",
      ),
    );
    assert.deepEqual(before.teamSnapshot?.roles[0], original);
    assert.deepEqual(after.teamSnapshot?.roles[0], updated);
    assert.deepEqual(
      after.teamSnapshot?.profiles,
      before.teamSnapshot?.profiles,
    );
    assert.deepEqual(
      runSchema.parse(await write("runs", input, "POST", "before-run")),
      before,
    );
    // Valid large escaped content must round-trip through the bounded HTTP body.
    const large = {
      ...content,
      instructions: "\u0001".repeat(12_000),
      expectedOutput: "\u0002".repeat(8000),
    };
    const largeRole = roleTemplateSchema.parse(
      await write("role-templates", large),
    );
    const largeJson = roleExportSchema.parse(
      await read(`role-templates/export?id=${largeRole.id}`),
    );
    const largeCopy = roleTemplateSchema.parse(
      await write("role-templates/import", largeJson),
    );
    assert.equal(largeCopy.instructions, largeRole.instructions);
    await write(
      "role-templates/import",
      { padding: "x".repeat(131_072) },
      "POST",
      "oversize",
      409,
    );
    await app.engine.idle();
    await app.close();
    app = await startApp(options);
    const saved = rolesResponseSchema.parse(await read("role-templates")).roles;
    assert.equal(
      saved.some((r) => r.id === role.id),
      false,
    );
    assert.deepEqual(
      saved.find((r) => r.id === copy.id),
      copy,
    );
    assert.deepEqual(
      saved.find((r) => r.id === original.id),
      updated,
    );
    assert.deepEqual(
      teamSnapshotSchema.parse(await read("presets")).roles[0],
      updated,
    );
    assert.deepEqual(
      roleExportSchema.parse(await read(`role-templates/export?id=${copy.id}`)),
      json,
    );
    assert.deepEqual(
      roleTemplateSchema.parse(
        await write("role-templates/import", json, "POST", "import-role"),
      ),
      copy,
    );
    assert.deepEqual(
      app.engine.store.getRun(before.id).teamSnapshot,
      before.teamSnapshot,
    );
    assert.deepEqual(
      app.engine.store.getRun(after.id).teamSnapshot,
      after.teamSnapshot,
    );
    assert.equal(
      app.engine.store
        .listAttempts()
        .filter((a) => app.engine.store.getTask(a.taskId).kind === "work")
        .length,
      0,
    );
  } finally {
    await app.close();
    await git.verify(async () =>
      assert.equal(await git.git("status", "--porcelain"), ""),
    );
    await f.close();
  }
});
