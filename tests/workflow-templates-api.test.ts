import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import {
  agentProfileSchema,
  workflowTemplateSchema,
} from "../src/shared/domain/entities.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { profileCapabilitiesSchema } from "../src/shared/profiles.ts";
import { teamsResponseSchema } from "../src/shared/teams.ts";

test("owner saves Explore Subsystem and Review Implementation templates for native read-only profiles over HTTP; writable profiles are refused", async () => {
  const data = await mkdtemp(join(tmpdir(), "lao-workflow-templates-"));
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: {
      pi: new PiAdapter(
        data,
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
    },
  });
  try {
    const read = async (path: string) =>
      (await fetch(`${app.origin}/api/${path}`)).json() as Promise<unknown>;
    const { token } = z
      .strictObject({ token: z.string() })
      .parse(await read("local-session"));
    const write = async (path: string, input: unknown, key: string) => {
      const response = await fetch(`${app.origin}/api/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Local-Token": token,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(input),
      });
      return { status: response.status, body: await response.json() };
    };
    const pi = profileCapabilitiesSchema.parse(
      await read("agent-profiles/discover?harness=pi"),
    );
    const [, writerRole, , readerRole, synthesizerRole] =
      fakeTeamSnapshot.roles;
    assert.ok(writerRole && readerRole && synthesizerRole);
    const profile = async (
      name: string,
      roleId: string,
      permission: string,
    ) => {
      const saved = await write(
        "agent-profiles",
        {
          name,
          roleId,
          harness: "pi",
          model: pi.models[0]?.id,
          thinking: "low",
          permission,
          instructionOverride: null,
        },
        `profile:${name}`,
      );
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      return agentProfileSchema.parse(saved.body);
    };
    const reader = await profile("Reader", readerRole.id, "read_only");
    const synthesizer = await profile(
      "Synthesizer",
      synthesizerRole.id,
      "read_only",
    );
    const writer = await profile("Writer", writerRole.id, "workspace_write");
    const explore = {
      readerProfileId: reader.id,
      synthesizerProfileId: synthesizer.id,
      readerCount: 2,
    };
    const saved = await write("workflow-templates/explore", explore, "explore");
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const template = workflowTemplateSchema.parse(saved.body);
    assert.deepEqual(
      (await write("workflow-templates/explore", explore, "explore")).body,
      saved.body,
    );
    const review = await write(
      "workflow-templates/review",
      { reviewerProfileId: reader.id },
      "review",
    );
    assert.equal(review.status, 200, JSON.stringify(review.body));
    const before = teamsResponseSchema.parse(await read("team-presets"));
    assert.ok(before.workflows.some((w) => w.id === template.id));
    assert.ok(before.workflows.some((w) => w.id === review.body.id));
    for (const [path, input] of [
      [
        "workflow-templates/explore",
        { ...explore, synthesizerProfileId: writer.id },
      ],
      ["workflow-templates/review", { reviewerProfileId: writer.id }],
    ] as const) {
      const refused = await write(path, input, `refused:${path}`);
      assert.ok(refused.status >= 400, JSON.stringify(refused.body));
    }
    assert.equal(
      (
        await write(
          "workflow-templates/explore",
          { ...explore, readerCount: 5 },
          "count",
        )
      ).status,
      400,
    );
    assert.deepEqual(
      teamsResponseSchema.parse(await read("team-presets")).workflows,
      before.workflows,
    );
  } finally {
    await app.close();
    await rm(data, { recursive: true });
  }
});
