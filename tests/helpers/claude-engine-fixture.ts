import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type {
  AdapterCapabilities,
  HarnessAdapter,
  ManagedSession,
  SessionEvent,
  StartSessionInput,
} from "../../src/server/adapters/contract.ts";
import { startApp } from "../../src/server/app.ts";
import { DomainError } from "../../src/shared/domain/states.ts";
import { createGitFixture } from "./git-fixture.ts";

// Deterministic native-boundary fixture: real engine, HTTP gateway and Git, no SDK/model.
export class ScriptedClaude implements HarnessAdapter {
  readonly decisions: { id: string; decision: string }[] = [];
  readonly cancelled = new Set<string>();
  private readonly approvals = new Map<
    string,
    { sessionId: string; resolve: (decision: "approve" | "deny") => void }
  >();
  authenticated = true;
  async discover(): Promise<AdapterCapabilities> {
    return {
      adapter: "claude-code",
      installed: true,
      authenticated: this.authenticated,
      models: [
        {
          id: "fixture/claude",
          label: "Scripted Claude (not live)",
          thinking: [{ id: "low", label: "low" }],
        },
      ],
      supportsResume: false,
      supportsLiveSteer: false,
      supportsCancel: true,
      supportsPermissionPrompts: true,
      supportsToolGateway: true,
      version: null,
      nextStep: null,
      diagnostics: ["Scripted integration fixture, not a native harness"],
    };
  }
  async startSession(input: StartSessionInput): Promise<ManagedSession> {
    return { adapter: "claude-code", nativeSessionId: randomUUID(), input };
  }
  async *prompt(session: ManagedSession): AsyncIterable<SessionEvent> {
    const { input } = session;
    const call = async (name: string, args: object) => {
      assert.ok(input.toolEndpoint);
      const response = await fetch(input.toolEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.environment.LAO_GATEWAY_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const result = z
        .object({ result: z.object({ isError: z.boolean() }) })
        .parse(await response.json()).result;
      assert.equal(result.isError, false);
    };
    if (this.cancelled.has(session.nativeSessionId)) {
      yield { type: "turn_completed", nativeStatus: "interrupted" };
      return;
    }
    await call("read_assignment", {});
    yield {
      type: "text_delta",
      text: "SCRIPTED Claude integration fixture (no model).\n",
    };
    let changed = false;
    if (input.permission === "workspace_write") {
      const id = `write-${input.attemptId}`;
      const decision = new Promise<"approve" | "deny">((resolve) =>
        this.approvals.set(id, { sessionId: session.nativeSessionId, resolve }),
      );
      yield {
        type: "approval_requested",
        nativeRequestId: id,
        details:
          "SCRIPTED Claude requests one Write to README.md in the disposable worker checkout",
      };
      if (
        (await decision) === "approve" &&
        !this.cancelled.has(session.nativeSessionId)
      ) {
        await writeFile(
          join(input.cwd, "README.md"),
          "# Owner-approved fixture change\n",
        );
        changed = true;
      }
    }
    if (this.cancelled.has(session.nativeSessionId)) {
      yield { type: "turn_completed", nativeStatus: "interrupted" };
      return;
    }
    await call("submit_result", {
      outcome: "completed",
      summary: "Scripted file-operation result",
      changedFiles: changed ? ["README.md"] : [],
      tests: [
        { command: "Scripted fixture: no test execution", result: "not_run" },
      ],
    });
    yield { type: "process_state", state: "exited", exitCode: 0 };
    yield { type: "turn_completed", nativeStatus: "completed" };
  }
  async resume(): Promise<ManagedSession> {
    throw new DomainError("UNSUPPORTED", "Fixture never resumes");
  }
  async steer() {
    return "unsupported" as const;
  }
  async cancel(session: ManagedSession) {
    this.cancelled.add(session.nativeSessionId);
    for (const [id, request] of this.approvals)
      if (request.sessionId === session.nativeSessionId) {
        this.approvals.delete(id);
        request.resolve("deny");
      }
  }
  async respondToApproval(
    session: ManagedSession,
    id: string,
    decision: "approve" | "deny",
  ) {
    const request = this.approvals.get(id);
    if (!request || request.sessionId !== session.nativeSessionId)
      throw new DomainError(
        "CONFLICT",
        "Wrong or expired fixture native approval",
      );
    this.approvals.delete(id);
    this.decisions.push({ id, decision });
    request.resolve(decision);
  }
  async dispose(session: ManagedSession) {
    await this.cancel(session);
  }
}

export async function claudeEngineFixture() {
  const repo = await createGitFixture();
  const data = await mkdtemp(join(tmpdir(), "lao-claude-engine-"));
  const baseline = await repo.git("rev-parse", "HEAD");
  const adapter = new ScriptedClaude();
  const options = {
    development: false,
    port: 0,
    databasePath: join(data, "state.sqlite"),
    adapters: { claude: adapter },
  };
  let app = await startApp(options);
  assert.ok(app.engine);
  const project = await app.engine.openProject(
    {
      name: "SCRIPTED Claude disposable fixture",
      repositoryPath: repo.directory,
    },
    "project",
  );
  return {
    repo,
    data,
    adapter,
    project,
    get app() {
      return app;
    },
    get engine() {
      assert.ok(app.engine);
      return app.engine;
    },
    get store() {
      assert.ok(app.engine);
      return app.engine.store;
    },
    async run(
      permission: "read_only" | "workspace_write",
      key: string = randomUUID(),
    ) {
      assert.ok(app.engine);
      return app.engine.startNativeRun(
        {
          projectId: project.id,
          harness: "claude-code",
          title: `SCRIPTED Claude ${permission}`,
          initialPrompt:
            "Inspect or request one file operation in this disposable fixture",
          model: "fixture/claude",
          thinking: "low",
          permission,
        },
        key,
      );
    },
    async request(runId: string) {
      assert.ok(app.engine);
      for (let i = 0; i < 300; i++) {
        await app.engine.pump();
        const request = app.engine.store
          .listHumanRequests()
          .find(
            (request) =>
              request.runId === runId &&
              request.nativeApproval?.state === "pending",
          );
        if (request) return request;
        await delay(10);
      }
      throw new Error(
        "Scripted Claude did not reach its native permission pause",
      );
    },
    async send(
      path: string,
      input: unknown,
      key: string = randomUUID(),
      method = "POST",
      extraHeaders: Record<string, string> = {},
    ) {
      const token = z
        .object({ token: z.string() })
        .parse(
          await (await fetch(`${app.origin}/api/local-session`)).json(),
        ).token;
      return fetch(`${app.origin}/api/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Local-Token": token,
          "Idempotency-Key": key,
          ...extraHeaders,
        },
        body: JSON.stringify(input),
      });
    },
    async restart() {
      await app.close();
      app = await startApp(options);
    },
    async close() {
      await app.close();
      await repo.verify(async () => {
        assert.equal(await repo.git("status", "--porcelain"), "");
        assert.equal(await repo.git("rev-parse", "HEAD"), baseline);
        assert.equal(
          await readFile(join(repo.directory, "README.md"), "utf8"),
          "# Disposable fixture\n",
        );
      });
      await rm(data, { recursive: true });
    },
  };
}
