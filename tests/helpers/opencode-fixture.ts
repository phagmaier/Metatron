import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  ManagedSession,
  StartSessionInput,
} from "../../src/server/adapters/contract.ts";
import { OpenCodeAdapter } from "../../src/server/adapters/opencode.ts";
import type { OpenCodeHostOptions } from "../../src/server/adapters/opencode-host.ts";
import { createGitFixture } from "./git-fixture.ts";

export function opencodeFixtureOptions(scenario: string): OpenCodeHostOptions {
  return {
    executable: process.execPath,
    spawn: (_executable, _args, options) =>
      spawn(
        process.execPath,
        [
          fileURLToPath(
            new URL("./opencode-server-fixture.ts", import.meta.url),
          ),
          scenario,
        ],
        { ...options, stdio: "pipe" },
      ),
  };
}
export async function opencodeFixture(scenario = "read") {
  const repo = await createGitFixture();
  const directory = await mkdtemp("/tmp/lao-opencode-test-");
  const baseline = await repo.git("rev-parse", "HEAD");
  const options = opencodeFixtureOptions(scenario);
  const adapter = new OpenCodeAdapter(directory, options);
  const sessions: ManagedSession[] = [];
  const input: StartSessionInput = {
    runId: randomUUID(),
    taskId: randomUUID(),
    attemptId: randomUUID(),
    cwd: repo.directory,
    roleInstructions: "Inert disposable fixture only",
    model: "fixture/model",
    thinking: "low",
    permission: "read_only",
    contextPolicy: "fresh",
    contextPacket: "Inert HTTP protocol fixture",
    toolEndpoint: null,
    environment: {},
  };
  return {
    repo,
    directory,
    adapter,
    options,
    input,
    sessions,
    async start(overrides: Partial<StartSessionInput> = {}) {
      const session = await adapter.startSession({ ...input, ...overrides });
      sessions.push(session);
      return session;
    },
    async close() {
      for (const session of sessions) await adapter.dispose(session);
      await repo.verify(async () => {
        assert.equal(await repo.git("rev-parse", "HEAD"), baseline);
      });
      await rm(directory, { recursive: true });
    },
  };
}
