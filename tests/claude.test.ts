import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readFile, rename, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { ClaudeAdapter } from "../src/server/adapters/claude.ts";
import type { SessionEvent } from "../src/server/adapters/contract.ts";
import {
  type ClaudeSdkFixtureOptions,
  claudeSdkFixture,
} from "./helpers/claude-sdk-fixture.ts";
import { fakeSessionInput } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

const authKeys = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_AUTH_TOKEN",
] as const;
const originalAuth = new Map(authKeys.map((key) => [key, process.env[key]]));
before(() => {
  for (const key of authKeys) delete process.env[key];
  process.env.ANTHROPIC_API_KEY = "inert-sdk-consumer-fixture-not-a-real-key";
});
after(() => {
  for (const [key, value] of originalAuth) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
async function collect(
  events: AsyncIterable<SessionEvent>,
): Promise<SessionEvent[]> {
  const result: SessionEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
async function fixture(config: ClaudeSdkFixtureOptions = {}) {
  const git = await createGitFixture();
  const sdk = claudeSdkFixture(config);
  const directory = join(dirname(git.directory), "adapter-state");
  const options = {
    query: sdk.factory,
    spawn: sdk.spawn,
    executable: process.execPath,
  };
  const adapter = new ClaudeAdapter(directory, options);
  const input = {
    ...fakeSessionInput(),
    cwd: git.directory,
    model: "fixture-sonnet",
    thinking: "high",
  };
  return { git, sdk, directory, options, adapter, input };
}

test("Claude discovers and initializes without a model prompt, streams whitespace once, and requires clean owned exit", async () => {
  const f = await fixture();
  await f.git.verify(async () => {
    const capabilities = await f.adapter.discover();
    assert.equal(capabilities.installed, true);
    assert.equal(capabilities.adapter, "claude-code");
    assert.equal(capabilities.authenticated, "unknown");
    assert.equal(capabilities.version, "0.0.0-fixture");
    assert.deepEqual(
      capabilities.models[0]?.thinking.map((level) => level.id),
      ["high", "max"],
    );
    assert.equal(capabilities.supportsLiveSteer, false);
    const session = await f.adapter.startSession(f.input);
    assert.equal(f.sdk.prompts.length, 0);
    assert.ok(session.processId && f.sdk.pids.includes(session.processId));
    assert.equal(
      await f.adapter.steer(session, "Not delivered"),
      "unsupported",
    );
    const events = await collect(f.adapter.prompt(session, "Inspect"));
    assert.equal(f.sdk.submitted[0]?.client_composed, true);
    assert.equal(f.sdk.submitted[0]?.origin, undefined);
    assert.equal(
      events
        .flatMap((event) => (event.type === "text_delta" ? [event.text] : []))
        .join(""),
      " \nHello ",
    );
    assert.deepEqual(events.slice(-2), [
      {
        type: "settings_verified",
        model: "fixture-sonnet",
        thinking: "high",
        source: "Claude init model; effort from native init report",
      },
      { type: "turn_completed", nativeStatus: "completed" },
    ]);
    assert.deepEqual(await f.adapter.exit(session), { code: 0, signal: null });
    await assert.rejects(collect(f.adapter.prompt(session, "Do not replay")), {
      code: "CONFLICT",
    });
    assert.equal(f.sdk.prompts.length, 1);
    await f.adapter.dispose(session);
  });
});

for (const mode of [
  "is_error",
  "error_subtype",
  "missing_result",
  "nonzero_exit",
  "disconnect",
] as const) {
  test(`Claude cannot report success for ${mode}`, async () => {
    const f = await fixture({
      exitCode: mode === "nonzero_exit" ? 7 : 0,
      script: async function* (context) {
        if (mode === "disconnect")
          throw new Error("private token value must not escape");
        if (mode !== "missing_result")
          yield context.result(
            mode === "is_error"
              ? { is_error: true }
              : mode === "error_subtype"
                ? { subtype: "error_during_execution" }
                : {},
          );
      },
    });
    await f.git.verify(async () => {
      const session = await f.adapter.startSession(f.input);
      const events = await collect(f.adapter.prompt(session, "Inspect"));
      assert.deepEqual(events.at(-1), {
        type: "turn_completed",
        nativeStatus: "failed",
      });
      assert.equal(JSON.stringify(events).includes("private token"), false);
      assert.equal(
        (await f.adapter.exit(session)).code,
        mode === "nonzero_exit" ? 7 : 0,
      );
      await assert.rejects(
        new ClaudeAdapter(f.directory, f.options).resume(
          session.nativeSessionId,
          f.input,
        ),
        { code: "POLICY_DENIED" },
      );
      await f.adapter.dispose(session);
    });
  });
}

test("Claude ignores foreign roots/subagents and unknown contents, maps tools, and redacts unknown headers", async () => {
  const f = await fixture({
    script: async function* (context) {
      yield context.header("assistant", {
        session_id: randomUUID(),
        message: {
          id: "foreign",
          model: context.model,
          content: [{ type: "text", text: "foreign secret" }],
        },
      });
      yield context.header("assistant", {
        parent_tool_use_id: "subagent",
        message: {
          id: "child",
          model: context.model,
          content: [{ type: "text", text: "child secret" }],
        },
      });
      yield context.header("future_private_token_header", {
        payload: "unknown secret",
      });
      yield context.header("assistant", {
        message: {
          id: "root",
          model: context.model,
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "private input" },
            },
            { type: "text", text: "root only" },
          ],
        },
      });
      yield context.header("user", {
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "private tool output",
            },
          ],
        },
      });
      yield context.result();
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession(f.input);
    const events = await collect(f.adapter.prompt(session, "Inspect"));
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta"),
      [{ type: "text_delta", text: "root only" }],
    );
    assert.equal(
      events.filter((event) => event.type === "tool_started").length,
      1,
    );
    assert.equal(
      events.filter((event) => event.type === "tool_finished").length,
      1,
    );
    const visible = JSON.stringify([events, f.adapter.diagnostics(session)]);
    for (const secret of [
      "foreign secret",
      "child secret",
      "unknown secret",
      "private input",
      "private tool output",
      "future_private_token_header",
    ])
      assert.equal(visible.includes(secret), false);
    await f.adapter.dispose(session);
  });
});

for (const identity of ["cwd", "model", "session", "effort"] as const) {
  test(`Claude refuses changed native ${identity} identity before authoritative output`, async () => {
    const f = await fixture({
      script: async function* (context) {
        yield context.header("system", {
          subtype: "init",
          cwd: identity === "cwd" ? "/tmp/other-checkout" : context.cwd,
          model: identity === "model" ? "silent-fallback" : context.model,
          session_id: identity === "session" ? randomUUID() : context.sessionId,
          permissionMode: "default",
          effort: identity === "effort" ? "low" : "high",
          tools: ["Read"],
          skills: [],
          plugins: [],
          mcp_servers: [],
        });
        if (identity === "session")
          yield context.header("result", {
            session_id: randomUUID(),
            subtype: "success",
            is_error: false,
          });
        else yield context.result();
      },
    });
    await f.git.verify(async () => {
      const session = await f.adapter.startSession(f.input);
      const events = await collect(f.adapter.prompt(session, "Inspect"));
      assert.deepEqual(events.at(-1), {
        type: "turn_completed",
        nativeStatus: "failed",
      });
      await f.adapter.dispose(session);
    });
  });
}

test("Claude accepts native message-delta metadata between tool use and authoritative completion", async () => {
  const f = await fixture({
    script: async function* (context) {
      yield context.header("assistant", {
        message: {
          id: "tool-message",
          model: context.model,
          content: [{ type: "tool_use", id: "read-1", name: "Read" }],
        },
      });
      yield context.header("stream_event", {
        event: {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
        },
      });
      await context.tool("Read", { file_path: join(context.cwd, "README.md") });
      yield context.header("user", {
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "read-1",
              content: "# Disposable fixture",
            },
          ],
        },
      });
      yield context.header("assistant", {
        message: {
          id: "answer-message",
          model: context.model,
          content: [{ type: "text", text: "# Disposable fixture" }],
        },
      });
      yield context.header("stream_event", {
        event: {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
        },
      });
      yield context.result();
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession(f.input);
    const events = await collect(
      f.adapter.prompt(session, "Read the fixture heading"),
    );
    assert.deepEqual(
      events.filter((event) => event.type === "text_delta"),
      [{ type: "text_delta", text: "# Disposable fixture" }],
    );
    assert.ok(
      events.some(
        (event) => event.type === "tool_finished" && event.toolId === "read-1",
      ),
    );
    assert.deepEqual(events.at(-1), {
      type: "turn_completed",
      nativeStatus: "completed",
    });
    await f.adapter.dispose(session);
  });
});

for (const delta of [{ text: "must not escape" }, { type: "text_delta" }]) {
  test(`Claude refuses malformed content deltas: ${"type" in delta ? "missing text" : "missing type"}`, async () => {
    const f = await fixture({
      script: async function* (context) {
        yield context.header("stream_event", {
          event: { type: "content_block_delta", delta },
        });
        yield context.result();
      },
    });
    await f.git.verify(async () => {
      const session = await f.adapter.startSession(f.input);
      const events = await collect(f.adapter.prompt(session, "Inspect"));
      assert.equal(
        events.some((event) => event.type === "text_delta"),
        false,
      );
      assert.deepEqual(events.at(-1), {
        type: "turn_completed",
        nativeStatus: "failed",
      });
      await f.adapter.dispose(session);
    });
  });
}

for (const mode of [
  "valid-read",
  "wrong-write",
  "missing-write",
  "unproven-result",
  "verified-stop",
] as const) {
  test(`Claude headless effort evidence: ${mode}`, async () => {
    const f = await fixture({
      omitInitEffort: true,
      hookEffort:
        mode === "wrong-write"
          ? "low"
          : mode === "missing-write"
            ? null
            : "high",
      script: async function* (context) {
        if (mode === "valid-read")
          await context.tool("Read", {
            file_path: join(context.cwd, "README.md"),
          });
        if (mode === "wrong-write" || mode === "missing-write")
          await context.tool("Write", {
            file_path: join(context.cwd, "unapproved.txt"),
            content: "Must not exist",
          });
        if (mode === "verified-stop")
          for (const matcher of context.options.hooks?.Stop ?? [])
            for (const hook of matcher.hooks)
              await hook(
                {
                  hook_event_name: "Stop",
                  session_id: context.sessionId,
                  cwd: context.cwd,
                  transcript_path: "fixture-owned",
                  stop_hook_active: false,
                  effort: { level: "high" },
                },
                undefined,
                { signal: new AbortController().signal },
              );
        yield context.result();
      },
    });
    await f.git.verify(async () => {
      const session = await f.adapter.startSession({
        ...f.input,
        permission: "workspace_write",
      });
      const events = await collect(f.adapter.prompt(session, "Inspect"));
      assert.deepEqual(events.at(-1), {
        type: "turn_completed",
        nativeStatus:
          mode === "valid-read" || mode === "verified-stop"
            ? "completed"
            : "failed",
      });
      assert.deepEqual(
        events.flatMap((event) =>
          event.type === "settings_verified" ? [event.source] : [],
        ),
        mode === "valid-read" || mode === "verified-stop"
          ? ["Claude init model; effort from native hook report"]
          : [],
      );
      assert.equal(
        events.some((event) => event.type === "approval_requested"),
        false,
      );
      await assert.rejects(access(join(f.git.directory, "unapproved.txt")));
      if (mode === "wrong-write" || mode === "missing-write")
        assert.equal(f.sdk.decisions[0]?.behavior, "deny");
      await f.adapter.dispose(session);
    });
  });
}

test("Claude validates exact discovered model and actual effort before any prompt", async () => {
  const f = await fixture();
  await f.git.verify(async () => {
    for (const change of [
      { model: "not-advertised" },
      { thinking: "medium" },
      { thinking: "off" },
    ])
      await assert.rejects(f.adapter.startSession({ ...f.input, ...change }), {
        code: "UNSUPPORTED",
      });
    assert.equal(f.sdk.prompts.length, 0);
  });
});

for (const decision of ["approve", "deny", "abort", "cancel"] as const) {
  test(`Claude safe mutation waits for one-shot ${decision} and never widens permission`, async () => {
    let requestFinished = false;
    let target = "";
    const f = await fixture({
      script: async function* (context) {
        await context.tool(
          "Write",
          { file_path: target, content: "private replacement text" },
          true,
        );
        requestFinished = true;
        yield context.result();
      },
    });
    target = join(f.git.directory, "owner-approved.txt");
    await f.git.verify(async () => {
      const session = await f.adapter.startSession({
        ...f.input,
        permission: "workspace_write",
      });
      const iterator = f.adapter
        .prompt(session, "Write safely")
        [Symbol.asyncIterator]();
      const first = await iterator.next();
      assert.equal(first.value?.type, "approval_requested");
      if (first.value?.type !== "approval_requested")
        throw new Error("Missing approval event");
      const id = first.value.nativeRequestId;
      assert.equal(
        first.value.details.includes("private replacement text"),
        false,
      );
      assert.equal(requestFinished, false);
      await assert.rejects(access(target));
      await assert.rejects(
        f.adapter.respondToApproval(session, randomUUID(), "approve"),
        { code: "CONFLICT" },
      );
      await assert.rejects(
        f.adapter.respondToApproval({ ...session }, id, "approve"),
        { code: "CONFLICT" },
      );
      if (decision === "cancel") await f.adapter.cancel(session);
      else if (decision === "abort") f.sdk.abort();
      else await f.adapter.respondToApproval(session, id, decision);
      await assert.rejects(
        f.adapter.respondToApproval(session, id, "approve"),
        { code: "CONFLICT" },
      );
      const remaining: SessionEvent[] = [];
      for (
        let next = await iterator.next();
        !next.done;
        next = await iterator.next()
      )
        remaining.push(next.value);
      assert.equal(
        f.sdk.decisions[0]?.behavior,
        decision === "approve" ? "allow" : "deny",
      );
      assert.equal(
        JSON.stringify(f.sdk.decisions).includes("updatedPermissions"),
        false,
      );
      if (decision === "approve")
        assert.equal(
          await readFile(target, "utf8"),
          "private replacement text",
        );
      else await assert.rejects(access(target));
      assert.deepEqual(await f.adapter.exit(session), {
        code: 0,
        signal: null,
      });
      assert.deepEqual(remaining.at(-1), {
        type: "turn_completed",
        nativeStatus:
          decision === "cancel" || decision === "abort"
            ? "interrupted"
            : "completed",
      });
      await f.adapter.dispose(session);
    });
  });
}

test("Claude revalidates a safe target replaced during owner approval", async () => {
  let target = "";
  const f = await fixture({
    script: async function* (context) {
      await context.tool("Write", {
        file_path: target,
        content: "must not escape",
      });
      yield context.result();
    },
  });
  await f.git.verify(async () => {
    const parent = join(f.git.directory, "safe-parent");
    const outside = join(dirname(f.git.directory), "outside");
    await mkdir(parent);
    await mkdir(outside);
    target = join(parent, "file.txt");
    const session = await f.adapter.startSession({
      ...f.input,
      permission: "workspace_write",
    });
    const iterator = f.adapter.prompt(session, "Write")[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.value?.type !== "approval_requested")
      throw new Error("Missing approval event");
    await rename(parent, `${parent}-old`);
    await symlink(outside, parent);
    await f.adapter.respondToApproval(
      session,
      first.value.nativeRequestId,
      "approve",
    );
    while (!(await iterator.next()).done) {
      /* Drain to authoritative exit. */
    }
    assert.equal(f.sdk.decisions[0]?.behavior, "deny");
    await assert.rejects(access(join(outside, "file.txt")));
    await f.adapter.dispose(session);
  });
});

test("Claude keeps parallel pending permissions one-shot and session-scoped", async () => {
  const f = await fixture({
    script: async function* (context) {
      await Promise.all([
        context.tool("Write", {
          file_path: join(context.cwd, "first.txt"),
          content: "first",
        }),
        context.tool("Write", {
          file_path: join(context.cwd, "second.txt"),
          content: "second",
        }),
      ]);
      yield context.result();
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession({
      ...f.input,
      permission: "workspace_write",
    });
    const iterator = f.adapter
      .prompt(session, "Write two files")
      [Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    if (
      first.value?.type !== "approval_requested" ||
      second.value?.type !== "approval_requested"
    )
      throw new Error("Missing parallel approvals");
    assert.notEqual(first.value.nativeRequestId, second.value.nativeRequestId);
    await f.adapter.respondToApproval(
      session,
      second.value.nativeRequestId,
      "deny",
    );
    await f.adapter.respondToApproval(
      session,
      first.value.nativeRequestId,
      "approve",
    );
    while (!(await iterator.next()).done) {
      /* Drain to authoritative exit. */
    }
    assert.deepEqual(
      f.sdk.decisions.map((decision) => decision.behavior).sort(),
      ["allow", "deny"],
    );
    await f.adapter.dispose(session);
  });
});

test("Claude unconditionally denies shell and secret requests despite native auto-allow", async () => {
  const f = await fixture({
    script: async function* (context) {
      await context.tool("Bash", { command: "private command" }, true);
      await context.tool(
        "Write",
        { file_path: join(context.cwd, ".env"), content: "private secret" },
        true,
      );
      yield context.result();
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession({
      ...f.input,
      permission: "workspace_write",
    });
    const events = await collect(f.adapter.prompt(session, "Inspect"));
    assert.equal(
      events.some((event) => event.type === "approval_requested"),
      false,
    );
    assert.deepEqual(
      f.sdk.decisions.map((item) => item.behavior),
      ["deny", "deny"],
    );
    assert.equal(JSON.stringify(events).includes("private secret"), false);
    await f.adapter.dispose(session);
  });
});

test("Claude resumes only a clean owned same-task checkout after reconstruction, without automatic replay", async () => {
  const f = await fixture();
  await f.git.verify(async () => {
    const session = await f.adapter.startSession(f.input);
    await collect(f.adapter.prompt(session, "First turn"));
    const id = session.nativeSessionId;
    await f.adapter.dispose(session);
    const next = new ClaudeAdapter(f.directory, f.options);
    const resumed = await next.resume(id, {
      ...f.input,
      attemptId: randomUUID(),
      contextPolicy: "resume",
    });
    assert.equal(resumed.nativeSessionId, id);
    assert.equal(f.sdk.prompts.length, 1);
    await collect(next.prompt(resumed, "Explicit follow-up"));
    assert.equal(f.sdk.prompts.length, 2);
    await next.dispose(resumed);
    await assert.rejects(next.resume(randomUUID(), f.input), {
      code: "POLICY_DENIED",
    });
    await assert.rejects(
      next.resume(id, { ...f.input, taskId: randomUUID() }),
      { code: "POLICY_DENIED" },
    );
    await assert.rejects(next.resume(id, { ...f.input, runId: randomUUID() }), {
      code: "POLICY_DENIED",
    });
    const other = await createGitFixture();
    await other.verify(async () => {
      await assert.rejects(
        next.resume(id, { ...f.input, cwd: other.directory }),
        { code: "POLICY_DENIED" },
      );
    });
    await assert.rejects(
      next.resume(id, { ...f.input, permission: "workspace_write" }),
      { code: "POLICY_DENIED" },
    );
    await rename(
      join(f.git.directory, ".git"),
      join(f.git.directory, ".git-original"),
    );
    await f.git.git("init", "--initial-branch=main");
    await assert.rejects(next.resume(id, f.input), { code: "POLICY_DENIED" });
    assert.equal(f.sdk.prompts.length, 2);
  });
});

test("Claude cancellation yields only owned real exit evidence and interrupted work cannot resume or replay", async () => {
  const f = await fixture({
    script: async function* (context) {
      yield context.header("stream_event", {
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "started" },
        },
      });
      await context.exited;
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession(f.input);
    const iterator = f.adapter.prompt(session, "Wait")[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value?.type, "text_delta");
    await f.adapter.cancel(session);
    assert.deepEqual(await f.adapter.exit(session), { code: 0, signal: null });
    const events: SessionEvent[] = [];
    for (
      let next = await iterator.next();
      !next.done;
      next = await iterator.next()
    )
      events.push(next.value);
    assert.deepEqual(events.at(-1), {
      type: "turn_completed",
      nativeStatus: "interrupted",
    });
    await f.adapter.dispose(session);
    await assert.rejects(
      new ClaudeAdapter(f.directory, f.options).resume(
        session.nativeSessionId,
        f.input,
      ),
      { code: "POLICY_DENIED" },
    );
    assert.equal(f.sdk.prompts.length, 1);
  });
});

test("Claude exposes typed provider authentication failures without native error text", async () => {
  const f = await fixture({
    script: async function* (context) {
      yield context.header("assistant", {
        error: "authentication_failed",
        message: {
          id: "failure",
          model: "<synthetic>",
          content: [{ type: "text", text: "private provider error" }],
        },
      });
      yield context.result();
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession(f.input);
    const events = await collect(f.adapter.prompt(session, "Inspect"));
    assert.equal(
      events.some(
        (event) =>
          event.type === "session_error" &&
          event.providerFailureKind === "auth",
      ),
      true,
    );
    assert.deepEqual(events.at(-1), {
      type: "turn_completed",
      nativeStatus: "failed",
    });
    assert.equal(
      JSON.stringify(events).includes("private provider error"),
      false,
    );
    await f.adapter.dispose(session);
  });
});

test("Claude no-prompt discovery reports absent authentication and refuses model submission", async () => {
  const f = await fixture();
  await f.git.verify(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const capabilities = await f.adapter.discover();
      assert.equal(capabilities.installed, true);
      assert.equal(capabilities.authenticated, false);
      await assert.rejects(f.adapter.startSession(f.input), {
        code: "UNSUPPORTED",
      });
      assert.equal(f.sdk.prompts.length, 0);
    } finally {
      process.env.ANTHROPIC_API_KEY =
        "inert-sdk-consumer-fixture-not-a-real-key";
    }
  });
});

for (const mode of [
  "token",
  "key-over-token",
  "cloud-over-token",
  "rejected-token",
  "unsupported-bearer",
  "metadata-failure",
  "host-changed",
] as const) {
  test(`Claude authentication boundary: ${mode}`, async () => {
    const secret = "inert-private-route-fixture";
    const envBefore = new Map(authKeys.map((key) => [key, process.env[key]]));
    for (const key of authKeys) delete process.env[key];
    if (mode === "unsupported-bearer")
      process.env.ANTHROPIC_AUTH_TOKEN = secret;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = secret;
    if (mode === "key-over-token") process.env.ANTHROPIC_API_KEY = secret;
    if (mode === "cloud-over-token") process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    try {
      let accountCalls = 0;
      const f = await fixture({
        account: async (options) => {
          assert.equal(options.env?.ANTHROPIC_AUTH_TOKEN, undefined);
          assert.equal(
            options.env?.CLAUDE_CONFIG_DIR,
            join(f.directory, "claude-config"),
          );
          if (mode !== "unsupported-bearer")
            assert.equal(options.env?.CLAUDE_CODE_OAUTH_TOKEN, secret);
          if (mode === "host-changed" && ++accountCalls === 1)
            delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
          if (mode === "metadata-failure") throw new Error(secret);
          if (mode === "cloud-over-token") return { apiProvider: "bedrock" };
          if (mode === "key-over-token")
            return {
              apiProvider: "firstParty",
              apiKeySource: "ANTHROPIC_API_KEY",
              tokenSource: "CLAUDE_CODE_OAUTH_TOKEN",
            };
          return {
            apiProvider: "firstParty",
            apiKeySource: "none",
            tokenSource:
              mode === "rejected-token" ? "none" : "CLAUDE_CODE_OAUTH_TOKEN",
          };
        },
      });
      await f.git.verify(async () => {
        const caps = await f.adapter.discover();
        const denied =
          mode === "rejected-token" || mode === "unsupported-bearer";
        assert.equal(caps.authenticated, denied ? false : "unknown");
        assert.equal(JSON.stringify(caps).includes(secret), false);
        if (mode === "unsupported-bearer")
          assert.ok(caps.nextStep?.startsWith("AUTH_POLICY_UNSUPPORTED:"));
        if (mode === "rejected-token")
          assert.ok(caps.nextStep?.startsWith("AUTH_ROUTE_REJECTED:"));
        if (denied || mode === "metadata-failure") {
          await assert.rejects(f.adapter.startSession(f.input));
        } else {
          if (mode === "host-changed")
            process.env.CLAUDE_CODE_OAUTH_TOKEN = secret;
          const session = await f.adapter.startSession(f.input);
          await f.adapter.dispose(session);
        }
        assert.equal(f.sdk.prompts.length, 0);
        if (mode === "key-over-token")
          assert.ok(
            caps.diagnostics.some((line) => line.includes("selects api-key")),
          );
        if (mode === "cloud-over-token")
          assert.ok(
            caps.diagnostics.some((line) => line.includes("selects bedrock")),
          );
      });
    } finally {
      for (const [key, value] of envBefore) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
}

test("Claude final launch refuses changed authentication metadata without submitting a model", async () => {
  let accounts = 0;
  const f = await fixture({
    account: async () =>
      ++accounts === 1
        ? { apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" }
        : { apiProvider: "firstParty", apiKeySource: "none" },
  });
  await f.git.verify(async () => {
    await assert.rejects(f.adapter.startSession(f.input), {
      code: "UNSUPPORTED",
    });
    assert.equal(f.sdk.prompts.length, 0);
  });
});

test("Claude initialization failure never submits a model or leaks native credentials", async () => {
  const f = await fixture();
  const secret = "inert-initialization-secret";
  await f.git.verify(async () => {
    const adapter = new ClaudeAdapter(f.directory, {
      ...f.options,
      query: () => {
        throw new Error(secret);
      },
    });
    const caps = await adapter.discover();
    assert.equal(caps.installed, true);
    assert.equal(caps.authenticated, "unknown");
    assert.deepEqual(caps.models, []);
    assert.ok(caps.nextStep);
    assert.equal(JSON.stringify(caps).includes(secret), false);
    await assert.rejects(
      adapter.startSession(f.input),
      (error: Error) => !error.message.includes(secret),
    );
    assert.equal(f.sdk.prompts.length, 0);
  });
});

test("Claude bounds EOF and TERM shutdown before KILL and reports the actual owned signal", async () => {
  const f = await fixture({
    stubborn: true,
    script: async function* (context) {
      yield context.header("stream_event", {
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "started" },
        },
      });
      await context.exited;
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession(f.input);
    const iterator = f.adapter.prompt(session, "Wait")[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).value?.type, "text_delta");
    await f.adapter.cancel(session);
    assert.deepEqual(await f.adapter.exit(session), {
      code: null,
      signal: "SIGKILL",
    });
    const events: SessionEvent[] = [];
    for (
      let next = await iterator.next();
      !next.done;
      next = await iterator.next()
    )
      events.push(next.value);
    assert.deepEqual(events.at(-1), {
      type: "turn_completed",
      nativeStatus: "interrupted",
    });
    await f.adapter.dispose(session);
  });
});

test("Claude distinguishes actual streamed text from a header-only stream when completed text arrives", async () => {
  const f = await fixture({
    script: async function* (context) {
      yield context.header("stream_event", {
        event: {
          type: "message_start",
          message: { id: "header-only", model: context.model },
        },
      });
      yield context.header("assistant", {
        message: {
          id: "header-only",
          model: context.model,
          content: [{ type: "text", text: "completed fallback " }],
        },
      });
      yield context.header("stream_event", {
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "streamed once\n" },
        },
      });
      yield context.header("assistant", {
        message: {
          id: "missing-header",
          model: context.model,
          content: [{ type: "text", text: "streamed once\n" }],
        },
      });
      yield context.result();
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession(f.input);
    const events = await collect(f.adapter.prompt(session, "Inspect"));
    assert.equal(
      events
        .flatMap((event) => (event.type === "text_delta" ? [event.text] : []))
        .join(""),
      "completed fallback streamed once\n",
    );
    await f.adapter.dispose(session);
  });
});

test("Claude billing errors never claim confirmed exhausted credits", async () => {
  const f = await fixture({
    script: async function* (context) {
      yield context.header("assistant", {
        error: "billing_error",
        message: {
          id: "billing",
          model: "<synthetic>",
          content: [{ type: "text", text: "private billing explanation" }],
        },
      });
      yield context.result();
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession(f.input);
    const events = await collect(f.adapter.prompt(session, "Inspect"));
    assert.equal(
      events.some(
        (event) =>
          event.type === "session_error" &&
          event.providerFailureKind === "credits_exhausted",
      ),
      false,
    );
    assert.equal(
      events.some(
        (event) =>
          event.type === "session_error" && event.code === "native_error",
      ),
      true,
    );
    assert.deepEqual(events.at(-1), {
      type: "turn_completed",
      nativeStatus: "failed",
    });
    assert.equal(
      JSON.stringify(events).includes("private billing explanation"),
      false,
    );
    await f.adapter.dispose(session);
  });
});

test("Claude accepts only the strict app HTTP gateway allowlist without claiming in-process SDK provenance", async () => {
  const f = await fixture({
    script: async function* (context) {
      await context.tool("mcp__lao__read_assignment", {});
      await context.tool("mcp__personal__read_assignment", {});
      yield context.result();
    },
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession({
      ...f.input,
      toolEndpoint: "http://127.0.0.1:12345/mcp",
      environment: { LAO_GATEWAY_TOKEN: "inert-fixture-gateway-token" },
    });
    const events = await collect(f.adapter.prompt(session, "Read assignment"));
    assert.deepEqual(
      f.sdk.decisions.map((decision) => decision.behavior),
      ["allow", "deny"],
    );
    assert.equal(
      events.some((event) => event.type === "approval_requested"),
      false,
    );
    assert.deepEqual(events.at(-1), {
      type: "turn_completed",
      nativeStatus: "completed",
    });
    await f.adapter.dispose(session);
  });
});

for (const replaced of ["checkout", "git-directory"] as const) {
  test(`Claude revalidates real ${replaced} identity after awaited owner approval`, async () => {
    const f = await fixture({
      script: async function* (context) {
        await context.tool("Write", {
          file_path: join(context.cwd, "replacement-must-not-write.txt"),
          content: "must not execute",
        });
        yield context.result();
      },
    });
    await f.git.verify(async () => {
      const session = await f.adapter.startSession({
        ...f.input,
        permission: "workspace_write",
      });
      const iterator = f.adapter
        .prompt(session, "Write safely")
        [Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.value?.type !== "approval_requested")
        throw new Error("Missing approval event");
      if (replaced === "checkout") {
        const original = `${f.git.directory}-original`;
        await rename(f.git.directory, original);
        await mkdir(f.git.directory);
        await cp(join(original, ".git"), join(f.git.directory, ".git"), {
          recursive: true,
        });
      } else {
        const original = join(f.git.directory, ".git-original");
        await rename(join(f.git.directory, ".git"), original);
        await cp(original, join(f.git.directory, ".git"), { recursive: true });
      }
      await f.adapter.respondToApproval(
        session,
        first.value.nativeRequestId,
        "approve",
      );
      while (!(await iterator.next()).done) {
        /* Drain to authoritative exit. */
      }
      assert.equal(f.sdk.decisions[0]?.behavior, "deny");
      await assert.rejects(
        access(join(f.git.directory, "replacement-must-not-write.txt")),
      );
      await f.adapter.dispose(session);
    });
  });
}

test("Claude native hooks wait for validated initialization when control delivery overtakes stream consumption", async () => {
  const f = await fixture({
    earlyTool: (context) =>
      context.tool(
        "Write",
        {
          file_path: join(context.cwd, "early-approved.txt"),
          content: "owner approved after init",
        },
        true,
      ),
  });
  await f.git.verify(async () => {
    const session = await f.adapter.startSession({
      ...f.input,
      permission: "workspace_write",
    });
    const iterator = f.adapter
      .prompt(session, "Write safely")
      [Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.value?.type !== "approval_requested")
      throw new Error(
        "Early hook was denied instead of waiting for validated native initialization",
      );
    await assert.rejects(access(join(f.git.directory, "early-approved.txt")));
    await f.adapter.respondToApproval(
      session,
      first.value.nativeRequestId,
      "approve",
    );
    while (!(await iterator.next()).done) {
      /* Drain to authoritative exit. */
    }
    assert.equal(f.sdk.decisions[0]?.behavior, "allow");
    assert.equal(
      await readFile(join(f.git.directory, "early-approved.txt"), "utf8"),
      "owner approved after init",
    );
    await f.adapter.dispose(session);
  });
});

test("Claude rejects a missing assigned checkout with a typed policy error before native initialization or a prompt", async () => {
  const f = await fixture();
  await f.git.verify(async () => {
    await assert.rejects(
      f.adapter.startSession({
        ...f.input,
        cwd: join(f.git.directory, "missing-checkout"),
      }),
      { code: "POLICY_DENIED" },
    );
    assert.equal(f.sdk.pids.length, 0);
    assert.equal(f.sdk.prompts.length, 0);
  });
});
