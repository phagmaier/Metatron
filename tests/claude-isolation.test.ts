import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { ClaudeAdapter } from "../src/server/adapters/claude.ts";
import type {
  ManagedSession,
  StartSessionInput,
} from "../src/server/adapters/contract.ts";
import { claudeSdkFixture } from "./helpers/claude-sdk-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

const auth = {
  ANTHROPIC_API_KEY: "inert-claude-isolation-api-key",
  CLAUDE_CODE_OAUTH_TOKEN: "inert-claude-isolation-setup-token",
  CLAUDE_CODE_USE_BEDROCK: "0",
  CLAUDE_CODE_USE_VERTEX: "0",
  CLAUDE_CODE_USE_FOUNDRY: "0",
  GOOGLE_API_KEY: "inert-opencode-provider-key-not-for-claude",
  AWS_UNRELATED_TOKEN: "inert-unrelated-aws-token",
  GOOGLE_UNRELATED_TOKEN: "inert-unrelated-google-token",
  AZURE_UNRELATED_TOKEN: "inert-unrelated-azure-token",
  AWS_ACCESS_KEY_ID: "inert-bedrock-id",
  AWS_SECRET_ACCESS_KEY: "inert-bedrock-secret",
  GOOGLE_APPLICATION_CREDENTIALS: "/inert/vertex-credentials.json",
  GOOGLE_CLOUD_PROJECT: "inert-vertex-project",
  ANTHROPIC_VERTEX_PROJECT_ID: "inert-vertex-project",
  AZURE_CLIENT_ID: "inert-foundry-id",
  AZURE_TENANT_ID: "inert-foundry-tenant",
  AZURE_CLIENT_SECRET: "inert-foundry-secret",
  ANTHROPIC_FOUNDRY_API_KEY: "inert-foundry-api-key",
};
const original = Object.fromEntries(
  Object.keys(auth).map((key) => [key, process.env[key]]),
);
before(() => Object.assign(process.env, auth));
after(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

for (const route of [
  "firstParty",
  "bedrock",
  "vertex",
  "foundry",
  "all-enabled",
] as const) {
  test(`Claude ${route} receives only explicitly enabled cloud credentials, never unrelated prefixed secrets`, async () => {
    const repo = await createGitFixture();
    const directory = join(dirname(repo.directory), "app");
    Object.assign(process.env, auth, {
      CLAUDE_CODE_USE_BEDROCK:
        route === "bedrock" || route === "all-enabled" ? "1" : "0",
      CLAUDE_CODE_USE_VERTEX:
        route === "vertex" || route === "all-enabled" ? "1" : "0",
      CLAUDE_CODE_USE_FOUNDRY:
        route === "foundry" || route === "all-enabled" ? "1" : "0",
    });
    const environments: NodeJS.ProcessEnv[] = [];
    const sdk = claudeSdkFixture({
      account: async () => ({
        apiProvider: route === "all-enabled" ? "bedrock" : route,
        apiKeySource: "ANTHROPIC_API_KEY",
      }),
    });
    await repo.verify(async () => {
      const adapter = new ClaudeAdapter(directory, {
        executable: process.execPath,
        query: sdk.factory,
        spawn: (options) => {
          environments.push({ ...options.env });
          return sdk.spawn(options);
        },
      });
      const capability = await adapter.discover();
      assert.equal(capability.installed, true);
      assert.equal(capability.authenticated, "unknown");
      assert.equal(sdk.prompts.length, 0);
      assert.equal(environments.length, 1);
      const env = environments[0];
      assert.ok(env);
      for (const key of [
        "GOOGLE_API_KEY",
        "AWS_UNRELATED_TOKEN",
        "GOOGLE_UNRELATED_TOKEN",
        "AZURE_UNRELATED_TOKEN",
      ])
        assert.equal(env[key], undefined, `Claude received unrelated ${key}`);
      for (const [key, enabled] of [
        [
          "AWS_SECRET_ACCESS_KEY",
          route === "bedrock" || route === "all-enabled",
        ],
        [
          "GOOGLE_APPLICATION_CREDENTIALS",
          route === "vertex" || route === "all-enabled",
        ],
        ["AZURE_CLIENT_SECRET", route === "foundry" || route === "all-enabled"],
        [
          "ANTHROPIC_FOUNDRY_API_KEY",
          route === "foundry" || route === "all-enabled",
        ],
      ] as const)
        assert.equal(env[key], enabled ? auth[key] : undefined, key);
      assert.equal(env.ANTHROPIC_API_KEY, auth.ANTHROPIC_API_KEY);
      assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, auth.CLAUDE_CODE_OAUTH_TOKEN);
    });
  });
}

test("disposing a completed Claude session cannot release a successor's resume lease", async () => {
  Object.assign(process.env, auth);
  const repo = await createGitFixture();
  const directory = join(dirname(repo.directory), "app");
  const sdk = claudeSdkFixture();
  const options = {
    executable: process.execPath,
    query: sdk.factory,
    spawn: sdk.spawn,
  };
  const first = new ClaudeAdapter(directory, options);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const nextSdk = claudeSdkFixture({
    account: async () => {
      started.resolve();
      await release.promise;
      return { apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" };
    },
  });
  const next = new ClaudeAdapter(directory, {
    executable: process.execPath,
    query: nextSdk.factory,
    spawn: nextSdk.spawn,
  });
  const input: StartSessionInput = {
    runId: crypto.randomUUID(),
    taskId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    cwd: repo.directory,
    roleInstructions: "Disposable fixture",
    model: "fixture-sonnet",
    thinking: "high",
    permission: "read_only",
    contextPolicy: "fresh",
    contextPacket: "Inert SDK fixture",
    toolEndpoint: null,
    environment: {},
  };
  let completed: ManagedSession | undefined;
  let disposed = false;
  let resuming: Promise<ManagedSession> | undefined;
  await repo.verify(async () => {
    try {
      completed = await first.startSession(input);
      const statuses = [];
      for await (const event of first.prompt(
        completed,
        "Complete one fixture turn",
      ))
        if (event.type === "turn_completed") statuses.push(event.nativeStatus);
      assert.deepEqual(statuses, ["completed"]);
      resuming = next.resume(completed.nativeSessionId, {
        ...input,
        contextPolicy: "resume",
      });
      await started.promise;
      await first.dispose(completed);
      disposed = true;
      await access(
        join(directory, "claude-sessions", `${completed.nativeSessionId}.lock`),
      );
      const third = new ClaudeAdapter(directory, options);
      await assert.rejects(
        third.resume(completed.nativeSessionId, {
          ...input,
          contextPolicy: "resume",
        }),
        { code: "CONFLICT" },
      );
    } finally {
      release.resolve();
      if (resuming) {
        const [result] = await Promise.allSettled([resuming]);
        if (result?.status === "fulfilled") await next.dispose(result.value);
      }
      if (completed && !disposed) await first.dispose(completed);
    }
  });
});
