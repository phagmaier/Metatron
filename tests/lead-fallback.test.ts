import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ClaudeAdapter } from "../src/server/adapters/claude.ts";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import type { StartSessionInput } from "../src/server/adapters/contract.ts";
import { OpenCodeAdapter } from "../src/server/adapters/opencode.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";
import { createTeamRun } from "../src/server/orchestration/team-run.ts";
import { createTeam } from "../src/server/storage/teams.ts";
import { defaultLimits } from "../src/shared/domain/entities.ts";
import { claudeSdkFixture } from "./helpers/claude-sdk-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";
import { opencodeFixtureOptions } from "./helpers/opencode-fixture.ts";

const authKeys = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_AUTH_TOKEN",
] as const;
const originalAuth = Object.fromEntries(
  authKeys.map((key) => [key, process.env[key]]),
);
before(() => {
  for (const key of authKeys) delete process.env[key];
  process.env.ANTHROPIC_API_KEY = "inert-lead-fallback-fixture-not-a-real-key";
});
after(() => {
  for (const [key, value] of Object.entries(originalAuth)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

for (const harness of ["pi", "claude-code", "opencode"] as const) {
  test(`${harness} refuses coordinator authority; a saved Codex-Lead team instead dispatches its reader and consumes the report`, async () => {
    const repo = await createGitFixture();
    const directory = await mkdtemp(join(tmpdir(), "lao-lead-fallback-"));
    const baseline = await repo.git("rev-parse", "HEAD");
    const sdk = claudeSdkFixture({
      script: async function* (context) {
        const server = z
          .object({
            url: z.string(),
            headers: z.record(z.string(), z.string()),
          })
          .parse(context.options.mcpServers?.lao);
        for (const [name, args] of [
          ["read_assignment", {}],
          [
            "submit_result",
            {
              outcome: "completed",
              summary: "Claude SDK fixture reader evidence",
              changedFiles: [],
              tests: [{ command: "Fixture only", result: "not_run" }],
            },
          ],
        ] as const) {
          const permission = await context.tool(`mcp__lao__${name}`, args);
          assert.equal(permission.behavior, "allow");
          const response = await fetch(server.url, {
            method: "POST",
            headers: { ...server.headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: randomUUID(),
              method: "tools/call",
              params: { name, arguments: args },
            }),
          });
          assert.equal(response.status, 200);
          assert.equal(
            z
              .object({ result: z.object({ isError: z.boolean() }) })
              .parse(await response.json()).result.isError,
            false,
          );
        }
        yield context.result();
      },
    });
    const adapters = {
      codex: new CodexAdapter(
        directory,
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
            { ...env, LAO_CODEX_FIXTURE_SCENARIO: "deny" },
          ),
      ),
      pi: new PiAdapter(
        directory,
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
      "claude-code": new ClaudeAdapter(directory, {
        executable: process.execPath,
        query: sdk.factory,
        spawn: sdk.spawn,
      }),
      opencode: new OpenCodeAdapter(
        directory,
        opencodeFixtureOptions("engine"),
      ),
    };
    const app = await startApp({
      development: false,
      port: 0,
      databasePath: join(directory, "state.sqlite"),
      adapters: {
        codex: adapters.codex,
        pi: adapters.pi,
        claude: adapters["claude-code"],
        opencode: adapters.opencode,
      },
    });
    const { engine } = app;
    const { store } = engine;
    try {
      const input: StartSessionInput = {
        runId: randomUUID(),
        taskId: randomUUID(),
        attemptId: randomUUID(),
        cwd: repo.directory,
        roleInstructions: "No model call: coordinator refusal probe",
        model: "unused-probe",
        thinking: null,
        permission: "coordinator",
        contextPolicy: "fresh",
        contextPacket: "Inert probe",
        toolEndpoint: engine.gatewayUrl,
        environment: { LAO_GATEWAY_TOKEN: "inert-probe" },
      };
      await assert.rejects(adapters[harness].startSession(input), {
        code: "UNSUPPORTED",
      });
      assert.equal(store.listRuns().length, 0);
      assert.equal(sdk.pids.length, 0);
      const roles = engine.presets().roles;
      const leadRole = roles.find((r) => r.name === "Lead");
      const readerRole = roles.find((r) => r.name === "Reader");
      assert.ok(leadRole && readerRole);
      const workerModel =
        harness === "claude-code" ? "fixture-sonnet" : "fixture/model";
      const workerThinking = harness === "claude-code" ? "high" : "low";
      const content = {
        name: "Protocol fixture worker",
        roleId: readerRole.id,
        harness,
        model: workerModel,
        thinking: workerThinking,
        permission: "read_only",
        instructionOverride: null,
      };
      await assert.rejects(
        engine.profiles.create(
          { ...content, permission: "coordinator" },
          "refused",
        ),
        { code: "UNSUPPORTED" },
      );
      const lead = await engine.profiles.create(
        {
          ...content,
          name: "Protocol fixture Codex Lead",
          roleId: leadRole.id,
          harness: "codex",
          model: "fixture-model",
          thinking: "low",
          permission: "coordinator",
        },
        "lead",
      );
      const reader = await engine.profiles.create(content, "reader");
      const team = createTeam(
        store,
        {
          name: `Protocol fixture Codex Lead + ${harness}`,
          leadProfileId: lead.id,
          workerProfileIds: [reader.id],
          workflowTemplateIds: [],
          mode: "autonomous_bounded",
          limits: { ...defaultLimits, maxTotalWorkerLaunchesPerRun: 1 },
        },
        "team",
      );
      const project = await engine.openProject(
        {
          name: "Disposable fallback fixture, no native models",
          repositoryPath: repo.directory,
        },
        "project",
      );
      const run = await createTeamRun(
        engine,
        {
          projectId: project.id,
          teamId: team.id,
          teamVersion: team.version,
          title: "Protocol fixture fallback",
          initialPrompt: "Delegate the README heading to the Reader",
        },
        "run",
      );
      await engine.idle();
      const tasks = store.listTasks(run.id);
      const worker = tasks.find((t) => t.kind === "work");
      assert.ok(worker);
      assert.equal(worker.status, "AWAITING_REVIEW");
      assert.equal(tasks.filter((t) => t.kind === "lead").length, 2);
      assert.ok(tasks.every((t) => t.status === "AWAITING_REVIEW"));
      const attempt = store.listAttempts().find((a) => a.taskId === worker.id);
      assert.equal(attempt?.adapter, harness);
      assert.notEqual(attempt?.cwd, repo.directory);
      const events = store.events({ runId: run.id, limit: 500 });
      const result = events.find((e) => e.type === "worker.result");
      const report = z
        .object({ report: z.object({ summary: z.string() }) })
        .parse(result?.payload).report;
      assert.ok(
        events.some(
          (e) =>
            e.type === "lead.message" &&
            String(e.payload.text).includes(report.summary),
        ),
      );
      assert.equal(events.filter((e) => e.type === "lead.wakeup").length, 1);
      assert.ok(
        events.some(
          (e) =>
            e.type === "gateway.denied" &&
            e.payload.tool === "submit_result" &&
            e.payload.code === "POLICY_DENIED",
        ),
      );
      assert.equal(engine.scheduling.committedLaunches(run.id), 1);
      assert.ok(
        events.some(
          (e) =>
            e.type === "worktree.captured" &&
            Array.isArray(e.payload.files) &&
            e.payload.files.length === 0,
        ),
      );
    } finally {
      await app.close();
      await repo.verify(async () => {
        assert.equal(await repo.git("status", "--porcelain"), "");
        assert.equal(await repo.git("rev-parse", "HEAD"), baseline);
        assert.equal(
          await readFile(join(repo.directory, "README.md"), "utf8"),
          "# Disposable fixture\n",
        );
      });
      await rm(directory, { recursive: true });
    }
  });
}
