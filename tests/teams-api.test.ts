import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import { runsResponseSchema } from "../src/shared/api.ts";
import {
  agentProfileSchema,
  defaultLimits,
  runSchema,
  teamPresetSchema,
} from "../src/shared/domain/entities.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { profileCapabilitiesSchema } from "../src/shared/profiles.ts";
import { teamsResponseSchema } from "../src/shared/teams.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`./helpers/${name}`, import.meta.url));

test("owner saves a native team over HTTP, starts a Codex Lead run that dispatches its custom Pi profile, and the run keeps its snapshot across edits, deletion and app restart", async () => {
  const repo = await createGitFixture();
  const data = await mkdtemp("/tmp/lao-teams-");
  const log = join(data, "codex-fixture.log");
  const piArgs: string[][] = [];
  const options = {
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: {
      pi: new PiAdapter(data, (args, cwd, env) => {
        piArgs.push(args);
        return new PiRpc(
          process.execPath,
          [fixturePath("pi-rpc-fixture.ts")],
          cwd,
          env,
        );
      }),
      codex: new CodexAdapter(
        data,
        (args, cwd, env) =>
          new CodexRpc(
            process.execPath,
            [fixturePath("codex-fixture.ts"), ...args],
            cwd,
            { ...env, LAO_CODEX_FIXTURE_LOG: log },
          ),
      ),
    },
  };
  let app = await startApp(options);
  try {
    const read = async (path: string) =>
      (await fetch(`${app.origin}/api/${path}`)).json() as Promise<unknown>;
    const write = async (
      path: string,
      input: unknown,
      method = "POST",
      status = 200,
      key: string = crypto.randomUUID(),
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
    const project = z.object({ id: z.string() }).parse(
      await write("projects", {
        name: "Teams",
        repositoryPath: repo.directory,
      }),
    );
    const [pi, codex] = await Promise.all(
      ["pi", "codex"].map(async (harness) =>
        profileCapabilitiesSchema.parse(
          await read(`agent-profiles/discover?harness=${harness}`),
        ),
      ),
    );
    const [leadRole, , , readerRole] = fakeTeamSnapshot.roles;
    assert.ok(leadRole && readerRole && pi && codex);
    const profile = async (content: object) =>
      agentProfileSchema.parse(await write("agent-profiles", content));
    const reader = await profile({
      name: "Ada",
      roleId: readerRole.id,
      harness: "pi",
      model: pi.models[0]?.id,
      thinking: "low",
      permission: "read_only",
      instructionOverride: "Worker override marker",
    });
    const lead = await profile({
      name: "Grace",
      roleId: leadRole.id,
      harness: "codex",
      model: codex.models[0]?.id,
      thinking: "low",
      permission: "coordinator",
      instructionOverride: "Lead override marker",
    });
    const content = {
      name: "Grace and Ada",
      leadProfileId: lead.id,
      workerProfileIds: [reader.id],
      workflowTemplateIds: [],
      mode: "autonomous_bounded",
      limits: { ...defaultLimits, maxTotalWorkerLaunchesPerRun: 3 },
    };
    const events = app.engine.store.events().length;
    for (const [path, method] of [
      ["team-presets", "POST"],
      ["team-presets", "PATCH"],
      ["team-presets", "DELETE"],
      ["runs/team", "POST"],
    ] as const) {
      for (const headers of [
        { "Content-Type": "application/json" },
        {
          "Content-Type": "application/json",
          Origin: "https://foreign.invalid",
        },
      ]) {
        const refused = await fetch(`${app.origin}/api/${path}`, {
          method,
          headers,
          body: JSON.stringify(content),
        });
        assert.equal(refused.status, 403);
      }
    }
    assert.equal(app.engine.store.events().length, events);
    await write("team-presets", { ...content, version: 1 }, "POST", 400);
    const team = teamPresetSchema.parse(await write("team-presets", content));
    const listed = teamsResponseSchema.parse(await read("team-presets"));
    assert.deepEqual(listed.teams.at(-1), team);
    assert.deepEqual(listed.demoTeamIds, [fakeTeamSnapshot.preset.id]);
    assert.deepEqual(listed.workflows, []);
    assert.equal(app.engine.scheduling.list().length, 0);

    const start = {
      projectId: project.id,
      teamId: team.id,
      teamVersion: 1,
      title: "Saved team run",
      initialPrompt: "Find the README heading",
    };
    await write("runs/team", { ...start, teamVersion: 2 }, "POST", 409);
    await write("runs/team", { ...start, mode: "chat_plan" }, "POST", 400);
    const run = runSchema.parse(await write("runs/team", start));
    assert.equal(run.execution, "native");
    assert.deepEqual(run.limits, content.limits);
    await app.engine.idle();
    const [work] = app.engine.store
      .listTasks(run.id)
      .filter((task) => task.kind === "work");
    assert.equal(work?.assignedProfileId, reader.id);
    assert.equal(work?.status, "AWAITING_REVIEW");
    assert.ok(
      piArgs.some((args) =>
        args[args.indexOf("--system-prompt") + 1]?.includes(
          "Worker override marker",
        ),
      ),
    );
    const codexLog = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.match(
      String(
        codexLog.find((entry) => entry.method === "thread/start")
          ?.developerInstructions,
      ),
      /Lead override marker/,
    );

    const {
      createdAt: _created,
      updatedAt: _updated,
      ...readerContent
    } = reader;
    await write(
      "agent-profiles",
      { ...readerContent, thinking: null, instructionOverride: null },
      "PATCH",
    );
    await write(
      "team-presets",
      { ...content, id: team.id, version: 1, mode: "supervised" },
      "PATCH",
    );
    await app.close();
    app = await startApp(options);
    const runs = async () =>
      runsResponseSchema.parse(await read(`runs?projectId=${project.id}`)).runs;
    assert.deepEqual(
      (await runs()).find((item) => item.id === run.id)?.teamSnapshot,
      run.teamSnapshot,
    );
    await write("team-presets", { id: team.id, version: 2 }, "DELETE");
    assert.deepEqual(
      (await runs()).find((item) => item.id === run.id)?.teamSnapshot,
      run.teamSnapshot,
    );
    assert.equal(
      teamsResponseSchema
        .parse(await read("team-presets"))
        .teams.some((item) => item.id === team.id),
      false,
    );
  } finally {
    await app.close();
    await repo.verify(async () =>
      assert.equal(await repo.git("status", "--porcelain"), ""),
    );
    await rm(data, { recursive: true, force: true });
  }
});
