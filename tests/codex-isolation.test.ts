import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import type {
  ManagedSession,
  StartSessionInput,
} from "../src/server/adapters/contract.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

async function fixture() {
  const repo = await createGitFixture();
  const other = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-codex-binding-"));
  // Only startup's MCP discovery is needed; no model turn is submitted.
  const gateway = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const { id, method } = JSON.parse(body) as { id: number; method: string };
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result:
          method === "tools/list"
            ? { tools: [{ name: "get_run_status" }] }
            : {},
      }),
    );
  });
  await new Promise<void>((done) => gateway.listen(0, "127.0.0.1", done));
  const address = gateway.address();
  assert.ok(address && typeof address !== "string");
  let launches = 0;
  const spawn = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => {
    launches++;
    return new CodexRpc(
      process.execPath,
      [
        fileURLToPath(new URL("./helpers/codex-fixture.ts", import.meta.url)),
        ...args,
      ],
      cwd,
      env,
    );
  };
  const sessions: { adapter: CodexAdapter; session: ManagedSession }[] = [];
  const input: StartSessionInput = {
    runId: randomUUID(),
    taskId: randomUUID(),
    attemptId: randomUUID(),
    cwd: repo.directory,
    roleInstructions: "Inert Lead startup fixture",
    model: "fixture-model",
    thinking: "low",
    permission: "coordinator",
    contextPolicy: "fresh",
    contextPacket: "No model prompts",
    toolEndpoint: `http://127.0.0.1:${address.port}/mcp`,
    environment: { LAO_GATEWAY_TOKEN: "inert-fixture" },
  };
  return {
    repo,
    other,
    input,
    get launches() {
      return launches;
    },
    adapter() {
      return new CodexAdapter(data, spawn);
    },
    async open(
      adapter: CodexAdapter,
      overrides: Partial<StartSessionInput> = {},
      id?: string,
    ) {
      const session = id
        ? await adapter.resume(id, {
            ...input,
            ...overrides,
            contextPolicy: "resume",
          })
        : await adapter.startSession({ ...input, ...overrides });
      sessions.push({ adapter, session });
      return session;
    },
    async dispose(session: ManagedSession) {
      const index = sessions.findIndex((entry) => entry.session === session);
      const [entry] = sessions.splice(index, 1);
      assert.ok(entry);
      await entry.adapter.dispose(session);
    },
    async close() {
      for (const { adapter, session } of sessions)
        await adapter.dispose(session);
      await new Promise<void>((done) => gateway.close(() => done()));
      for (const fixture of [repo, other])
        await fixture.verify(async () =>
          assert.equal(await fixture.git("status", "--porcelain"), ""),
        );
      await rm(data, { recursive: true });
    },
  };
}

test("Codex Lead resume survives reconstruction only in its own run and original checkout", async () => {
  const f = await fixture();
  try {
    const first = await f.open(f.adapter());
    await f.dispose(first);
    const next = f.adapter();
    const resumed = await f.open(
      next,
      { taskId: randomUUID(), attemptId: randomUUID() },
      first.nativeSessionId,
    );
    assert.equal(resumed.nativeSessionId, first.nativeSessionId);
    await f.dispose(resumed);
    const before = f.launches;
    for (const overrides of [
      { runId: randomUUID() },
      { cwd: f.other.directory },
    ]) {
      await assert.rejects(
        f.open(f.adapter(), overrides, first.nativeSessionId),
        { code: "POLICY_DENIED" },
      );
      assert.equal(
        f.launches,
        before,
        "A denied resume must not contact the native harness",
      );
    }
    await assert.rejects(
      f.open(f.adapter(), { permission: "read_only" }, first.nativeSessionId),
      { code: "UNSUPPORTED" },
    );
    await assert.rejects(f.open(f.adapter(), {}, randomUUID()), {
      code: "POLICY_DENIED",
    });
    assert.equal(f.launches, before);
  } finally {
    await f.close();
  }
});

test("Codex refuses a same-path replacement Git repository before resuming its old thread", async () => {
  const f = await fixture();
  const original = join(f.repo.directory, ".git-original");
  const replacement = join(f.repo.directory, ".git-replacement");
  try {
    const first = await f.open(f.adapter());
    await f.dispose(first);
    const before = f.launches;
    await rename(join(f.repo.directory, ".git"), original);
    await rename(
      join(f.other.directory, ".git"),
      join(f.repo.directory, ".git"),
    );
    try {
      await assert.rejects(f.open(f.adapter(), {}, first.nativeSessionId), {
        code: "POLICY_DENIED",
      });
      assert.equal(f.launches, before);
    } finally {
      await rename(join(f.repo.directory, ".git"), replacement);
      await rename(original, join(f.repo.directory, ".git"));
      await rename(replacement, join(f.other.directory, ".git"));
    }
  } finally {
    await f.close();
  }
});
