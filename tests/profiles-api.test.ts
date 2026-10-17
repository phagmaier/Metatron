import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import {
  agentProfileSchema,
  roleTemplateSchema,
} from "../src/shared/domain/entities.ts";
import {
  profileCapabilitiesSchema,
  profilesResponseSchema,
} from "../src/shared/profiles.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

test("owner profile HTTP CRUD uses native protocol discovery, protects mutation boundaries and survives app restart without dispatch", async () => {
  const f = await domainFixture();
  const adapters = {
    pi: new PiAdapter(
      f.directory,
      (_args, cwd, env) =>
        new PiRpc(
          process.execPath,
          [
            fileURLToPath(
              new URL("./helpers/pi-rpc-fixture.ts", import.meta.url),
            ),
          ],
          cwd,
          env,
        ),
    ),
    codex: new CodexAdapter(
      f.directory,
      (args, cwd, env) =>
        new CodexRpc(
          process.execPath,
          [
            fileURLToPath(
              new URL("./helpers/codex-fixture.ts", import.meta.url),
            ),
            ...args,
          ],
          cwd,
          env,
        ),
    ),
  };
  const options = {
    development: false,
    port: 0,
    databasePath: join(f.directory, "state.sqlite"),
    adapters,
  };
  let app = await startApp(options);
  try {
    const read = async (path: string) =>
      (await fetch(`${app.origin}/api/${path}`)).json() as Promise<unknown>;
    const write = async (
      input: unknown,
      method = "POST",
      key: string = crypto.randomUUID(),
      status = 200,
      path = "agent-profiles",
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
    const role = roleTemplateSchema.parse(
      await write(
        {
          name: "Custom reviewer",
          instructions: "Read evidence",
          expectedOutput: "Cited findings",
        },
        "POST",
        "role",
        200,
        "role-templates",
      ),
    );
    const catalog = profileCapabilitiesSchema.parse(
      await read("agent-profiles/discover?harness=pi"),
    );
    assert.equal(catalog.installed, true);
    assert.deepEqual(
      catalog.models[0]?.thinking.map((item) => item.id),
      ["off", "low"],
    );
    assert.deepEqual(catalog.permissions, ["read_only", "workspace_write"]);
    const content = {
      name: "Ada",
      roleId: role.id,
      harness: "pi",
      model: catalog.models[0]?.id,
      thinking: "low",
      permission: "read_only",
      instructionOverride: null,
    };
    const before = app.engine.store.events().length;
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const noToken = await fetch(`${app.origin}/api/agent-profiles`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content),
      });
      assert.equal(noToken.status, 403);
    }
    const foreign = await fetch(`${app.origin}/api/agent-profiles`, {
      method: "POST",
      headers: {
        Origin: "https://foreign.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(content),
    });
    assert.equal(foreign.status, 403);
    const foreignRead = await fetch(
      `${app.origin}/api/agent-profiles/discover?harness=pi`,
      { headers: { Origin: "https://foreign.invalid" } },
    );
    assert.equal(foreignRead.status, 403);
    await write({ ...content, capabilities: catalog }, "POST", "injected", 400);
    await write(
      { ...content, permission: "coordinator" },
      "POST",
      "bad-pi",
      409,
    );
    await write(
      { ...content, thinking: "not-discovered" },
      "POST",
      "bad-thinking",
      409,
    );
    await write({ ...content, model: "invented" }, "POST", "bad-model", 409);
    await write({ padding: "x".repeat(65_536) }, "POST", "too-large", 409);
    assert.equal(app.engine.store.events().length, before);
    const first = agentProfileSchema.parse(
      await write(content, "POST", "create"),
    );
    const changedRole = roleTemplateSchema.parse(
      await write(
        {
          name: "Other reader",
          instructions: "Read",
          expectedOutput: "Evidence",
        },
        "POST",
        "other-role",
        200,
        "role-templates",
      ),
    );
    const edit = {
      ...content,
      id: first.id,
      version: 1,
      name: "Ada writer",
      permission: "workspace_write",
      roleId: changedRole.id,
    };
    const second = agentProfileSchema.parse(await write(edit, "PATCH", "edit"));
    assert.equal(second.version, 2);
    await write(edit, "PATCH", "stale", 409);
    await write({ id: first.id, version: 1 }, "DELETE", "stale-delete", 409);
    await write(
      { id: changedRole.id, version: 1 },
      "DELETE",
      "referenced-role",
      409,
      "role-templates",
    );
    await write(
      { id: role.id, version: 1 },
      "DELETE",
      "old-role",
      200,
      "role-templates",
    );
    const codex = profileCapabilitiesSchema.parse(
      await read("agent-profiles/discover?harness=codex"),
    );
    assert.deepEqual(codex.permissions, ["coordinator"]);
    assert.equal(
      codex.models[0]?.thinking.some((level) => level.id === "ultra"),
      false,
    );
    const leadContent = {
      ...content,
      roleId: changedRole.id,
      harness: "codex",
      model: codex.models[0]?.id,
      thinking: null,
      permission: "coordinator",
    };
    const lead = agentProfileSchema.parse(
      await write(leadContent, "POST", "lead"),
    );
    await write(
      { ...leadContent, permission: "workspace_write" },
      "POST",
      "bad-codex",
      409,
    );
    for (const harness of ["claude-code", "opencode"]) {
      const missing = profileCapabilitiesSchema.parse(
        await read(`agent-profiles/discover?harness=${harness}`),
      );
      assert.equal(missing.implemented, false);
      await write(
        { ...content, roleId: changedRole.id, harness },
        "POST",
        `missing-${harness}`,
        409,
      );
    }
    const query = await fetch(
      `${app.origin}/api/agent-profiles/discover?harness=pi&permission=coordinator`,
    );
    assert.equal(query.status, 400);
    const token = z
      .strictObject({ token: z.string() })
      .parse(await read("local-session")).token;
    await app.close();
    app = await startApp(options);
    const saved = profilesResponseSchema.parse(await read("agent-profiles"));
    assert.equal(saved.demoProfileIds.length, 5);
    assert.deepEqual(
      saved.profiles.find((profile) => profile.id === first.id),
      second,
    );
    assert.deepEqual(
      saved.profiles.find((profile) => profile.id === lead.id),
      lead,
    );
    assert.deepEqual(
      agentProfileSchema.parse(await write(edit, "PATCH", "edit")),
      second,
    );
    // Replay succeeds even when its old role has since been deleted.
    assert.deepEqual(
      agentProfileSchema.parse(await write(content, "POST", "create")),
      first,
    );
    const oldToken = await fetch(`${app.origin}/api/agent-profiles`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-Local-Token": token,
        "Idempotency-Key": "old-token",
      },
      body: JSON.stringify({ id: first.id, version: 2 }),
    });
    assert.equal(oldToken.status, 403);
    await write({ id: first.id, version: 2 }, "DELETE", "delete");
    await app.close();
    app = await startApp(options);
    await write({ id: first.id, version: 2 }, "DELETE", "delete");
    assert.equal(
      profilesResponseSchema
        .parse(await read("agent-profiles"))
        .profiles.some((profile) => profile.id === first.id),
      false,
    );
    assert.equal(app.engine.store.listAttempts().length, 0);
    assert.equal(app.engine.store.listSessions().length, 0);
    assert.equal(app.engine.scheduling.list().length, 0);
  } finally {
    await app.close();
    await f.close();
  }
});
