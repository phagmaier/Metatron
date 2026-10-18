import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ClaudeAdapter } from "../src/server/adapters/claude.ts";
import { spawnClaude } from "../src/server/adapters/claude-process.ts";
import type {
  ManagedSession,
  SessionEvent,
  StartSessionInput,
} from "../src/server/adapters/contract.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";

const { values } = parseArgs({
  options: {
    "allow-live": { type: "boolean" },
    model: { type: "string" },
    thinking: { type: "string" },
    output: { type: "string" },
  },
});
assert.ok(
  values.output && (!values["allow-live"] || values.model),
  "Use --output <new evidence.json> for a no-model probe. Provider-cost smoke additionally requires --allow-live --model <discovered model> [--thinking <discovered effort>]. No existing repository, database, user session or credential file is accepted.",
);
const output = resolve(values.output);
try {
  await access(output);
  throw new Error(
    "Choose a new evidence output; existing files are never overwritten",
  );
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
const directory = await mkdtemp("/tmp/lao-claude-smoke-");
const fixture = await createGitFixture();
const personal = [
  ".claude/settings.json",
  ".claude.json",
  ".codex/config.toml",
  ".pi/agent/settings.json",
];
async function metadata() {
  return Promise.all(
    personal.map(async (path) => {
      try {
        const info = await stat(join(homedir(), path));
        return {
          path,
          size: info.size,
          mtime: info.mtimeMs,
          ctime: info.ctimeMs,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return { path, absent: true };
        throw error;
      }
    }),
  );
}
const before = await metadata();
const head = await fixture.git("rev-parse", "HEAD");
let workerLaunch: { executable: string; env: NodeJS.ProcessEnv } | undefined;
const nativeEvidence: {
  sessionId: string;
  type: string;
  model?: string;
  effort?: string | null;
  subtype?: string;
  tools?: string[];
  permissionMode?: string;
  skillCount?: number;
  pluginCount?: number;
  mcpCount?: number;
  plugins?: string[];
}[] = [];
const adapter = new ClaudeAdapter(directory, {
  spawn: (options) => {
    workerLaunch ??= { executable: options.command, env: { ...options.env } };
    return spawnClaude(options);
  },
  query: (input) => {
    // Record native effort only; never retain hook inputs or transcript paths.
    for (const matchers of Object.values(input.options.hooks ?? {}))
      for (const matcher of matchers ?? [])
        matcher.hooks = matcher.hooks.map(
          (hook) => async (event, id, control) => {
            nativeEvidence.push({
              sessionId: event.session_id,
              type: `hook-${event.hook_event_name}`,
              effort: event.effort?.level ?? null,
            });
            return hook(event, id, control);
          },
        );
    const native = query(input);
    return {
      supportedModels: () => native.supportedModels(),
      accountInfo: () => native.accountInfo(),
      close: () => native.close(),
      async *[Symbol.asyncIterator]() {
        for await (const message of native) {
          if (message.type === "system" && message.subtype === "init")
            nativeEvidence.push({
              sessionId: message.session_id,
              type: "init",
              model: message.model,
              effort: message.effort ?? null,
              tools: message.tools,
              permissionMode: message.permissionMode,
              skillCount: message.skills.length,
              pluginCount: message.plugins.length,
              mcpCount: message.mcp_servers.length,
              plugins: message.plugins.map((plugin) => plugin.name),
            });
          if (
            message.type === "stream_event" &&
            message.event.type === "message_start"
          )
            nativeEvidence.push({
              sessionId: message.session_id,
              type: "stream-model",
              model: message.event.message.model,
            });
          if (message.type === "result")
            nativeEvidence.push({
              sessionId: message.session_id,
              type: "result",
              subtype: message.subtype,
            });
          yield message;
        }
      },
    };
  },
});
const sessions: ManagedSession[] = [];
const liveResults: {
  operation: string;
  nativeSessionId: string;
  events: SessionEvent[];
  exit: { code: number | null; signal: string | null };
}[] = [];
let failedTurn:
  | { nativeSessionId: string; mode: string; events: SessionEvent[] }
  | undefined;
let success = false;
try {
  const exec = promisify(execFile);
  const capabilities = await adapter.discover();
  assert.ok(
    workerLaunch,
    "Discovery did not launch an owned Claude executable",
  );
  const executable = workerLaunch.executable;
  const version = (
    await exec(executable, ["--version"], {
      timeout: 10_000,
      env: workerLaunch.env,
    })
  ).stdout.trim();
  const sdkVersion = z
    .object({ version: z.string() })
    .parse(
      JSON.parse(
        await readFile(
          new URL(
            "../node_modules/@anthropic-ai/claude-agent-sdk/package.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    ).version;
  assert.equal(
    workerLaunch.env.CLAUDE_CONFIG_DIR,
    join(directory, "claude-config"),
  );
  console.log(JSON.stringify({ version, sdkVersion, capabilities }, null, 2));
  const blocked = values["allow-live"] && capabilities.authenticated === false;
  if (values["allow-live"] && !blocked) {
    const model = capabilities.models.find(
      (model) => model.id === values.model,
    );
    assert.ok(
      capabilities.installed &&
        model &&
        (!values.thinking ||
          model.thinking.some((level) => level.id === values.thinking)),
      "Requested Claude model/effort is not in native discovery; nothing was substituted",
    );
    const base: StartSessionInput = {
      runId: crypto.randomUUID(),
      taskId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      cwd: fixture.directory,
      roleInstructions:
        "Use only this disposable checkout. Do not read credentials, shell, delegate, change configuration, or claim tests ran. Read README.md and quote its heading concisely.",
      model: values.model ?? "",
      thinking: values.thinking ?? null,
      permission: "read_only",
      contextPolicy: "fresh",
      contextPacket: "Read README.md and quote its heading.",
      toolEndpoint: null,
      environment: {},
    };
    const collect = async (
      managed: ManagedSession,
      text: string,
      mode: "read" | "deny" | "approve" | "cancel" = "read",
    ) => {
      const events: SessionEvent[] = [];
      const requests: string[] = [];
      let cancelledActive = false;
      failedTurn = { nativeSessionId: managed.nativeSessionId, mode, events };
      for await (const event of adapter.prompt(managed, text)) {
        events.push(event);
        if (event.type === "approval_requested") {
          assert.ok(
            mode === "deny" || mode === "approve",
            "Unexpected permission surface",
          );
          requests.push(event.nativeRequestId);
          assert.equal(
            await readFile(join(fixture.directory, "README.md"), "utf8"),
            "# Disposable fixture\n",
          );
          if (mode === "approve" && requests.length === 1) {
            await assert.rejects(
              access(join(fixture.directory, "approved.txt")),
            );
            await adapter.respondToApproval(
              managed,
              event.nativeRequestId,
              "approve",
            );
          } else {
            assert.ok(
              requests.length <= 2,
              "Model attempted an unauthorized retry",
            );
            if (mode === "approve") {
              assert.equal(
                await readFile(join(fixture.directory, "approved.txt"), "utf8"),
                "Approved once\n",
              );
              await assert.rejects(
                adapter.respondToApproval(
                  managed,
                  requests[0] ?? "",
                  "approve",
                ),
              );
            }
            await adapter.respondToApproval(
              managed,
              event.nativeRequestId,
              "deny",
            );
            if (mode === "deny") await adapter.cancel(managed);
          }
          await assert.rejects(
            adapter.respondToApproval(
              managed,
              event.nativeRequestId,
              "approve",
            ),
          );
        }
        if (
          mode === "cancel" &&
          event.type === "text_delta" &&
          !cancelledActive
        ) {
          assert.ok(
            !nativeEvidence.some(
              (entry) =>
                entry.sessionId === managed.nativeSessionId &&
                entry.type === "result",
            ),
            "Generation already completed before cancellation",
          );
          assert.ok(managed.processId);
          process.kill(managed.processId, 0);
          cancelledActive = true;
          await adapter.cancel(managed);
        }
      }
      if (mode === "deny" || mode === "cancel") {
        assert.equal(
          mode === "deny" ? requests.length === 1 : cancelledActive,
          true,
        );
        assert.deepEqual(events.at(-1), {
          type: "turn_completed",
          nativeStatus: "interrupted",
        });
        await assert.rejects(
          adapter.resume(managed.nativeSessionId, {
            ...managed.input,
            contextPolicy: "resume",
          }),
          { code: "POLICY_DENIED" },
        );
      } else {
        if (mode === "read") {
          const text = events
            .flatMap((event) =>
              event.type === "text_delta" ? [event.text] : [],
            )
            .join("");
          assert.ok(text.includes("Disposable fixture"));
        } else {
          assert.equal(
            requests.length,
            2,
            "Both independent native Write callbacks must be observed",
          );
          assert.equal(
            await readFile(join(fixture.directory, "approved.txt"), "utf8"),
            "Approved once\n",
          );
          await assert.rejects(access(join(fixture.directory, "denied.txt")));
        }
        assert.ok(
          events.some(
            (event) =>
              event.type === "turn_completed" &&
              event.nativeStatus === "completed",
          ),
        );
        assert.ok(!events.some((event) => event.type === "session_error"));
        assert.deepEqual(await adapter.exit(managed), {
          code: 0,
          signal: null,
        });
      }
      const init = nativeEvidence.findLast(
        (entry) =>
          entry.sessionId === managed.nativeSessionId && entry.type === "init",
      );
      assert.ok(init?.model);
      if (init.effort !== null) assert.equal(init.effort, base.thinking);
      else if (mode !== "cancel")
        assert.ok(
          nativeEvidence.some(
            (entry) =>
              entry.sessionId === managed.nativeSessionId &&
              entry.type.startsWith("hook-") &&
              entry.effort === base.thinking,
          ),
          "Requested effort was not proven by native initialization or a native hook",
        );
      assert.ok(
        nativeEvidence.some(
          (entry) =>
            entry.sessionId === managed.nativeSessionId &&
            entry.type === "stream-model" &&
            entry.model === init.model,
        ),
      );
      failedTurn = undefined;
      return events;
    };
    const first = await adapter.startSession(base);
    sessions.push(first);
    const firstEvents = await collect(first, base.contextPacket);
    liveResults.push({
      operation: "read",
      nativeSessionId: first.nativeSessionId,
      events: firstEvents,
      exit: await adapter.exit(first),
    });
    await adapter.dispose(first);
    sessions.pop();
    const resumed = await adapter.resume(first.nativeSessionId, {
      ...base,
      attemptId: crypto.randomUUID(),
      contextPolicy: "resume",
      contextPacket:
        "Read README.md again and quote the heading; do not modify anything.",
    });
    sessions.push(resumed);
    assert.equal(resumed.nativeSessionId, first.nativeSessionId);
    const resumedEvents = await collect(resumed, resumed.input.contextPacket);
    liveResults.push({
      operation: "same-checkout-resume",
      nativeSessionId: resumed.nativeSessionId,
      events: resumedEvents,
      exit: await adapter.exit(resumed),
    });
    await adapter.dispose(resumed);
    sessions.pop();
    const writer = await adapter.startSession({
      ...base,
      taskId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      permission: "workspace_write",
      roleInstructions:
        "Use only this disposable checkout. Attempt one Write to README.md containing '# Permission probe\\n'. Do not use another tool or retry if permission is denied; report the denial. Never execute shell or delegate.",
      contextPacket:
        "Try the one harmless Write to README.md; the owner will deny it, then stop this session.",
    });
    sessions.push(writer);
    const writerEvents = await collect(
      writer,
      writer.input.contextPacket,
      "deny",
    );
    liveResults.push({
      operation: "native-permission-denial-and-cancel",
      nativeSessionId: writer.nativeSessionId,
      events: writerEvents,
      exit: await adapter.exit(writer),
    });
    await adapter.dispose(writer);
    sessions.pop();
    const approvedWriter = await adapter.startSession({
      ...base,
      taskId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      permission: "workspace_write",
      roleInstructions:
        "Use only Write. First Write approved.txt with exactly 'Approved once\\n'. After it succeeds, Write denied.txt with 'Must not exist\\n'. No other tools, edits, retries, shell or delegation. Report completion/denial concisely.",
      contextPacket:
        "Perform the two sequential Writes. The owner approves only the first, and denies the second.",
    });
    sessions.push(approvedWriter);
    const approvedEvents = await collect(
      approvedWriter,
      approvedWriter.input.contextPacket,
      "approve",
    );
    liveResults.push({
      operation: "native-approved-write-and-independent-denial",
      nativeSessionId: approvedWriter.nativeSessionId,
      events: approvedEvents,
      exit: await adapter.exit(approvedWriter),
    });
    await adapter.dispose(approvedWriter);
    sessions.pop();
    const active = await adapter.startSession({
      ...base,
      taskId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      roleInstructions:
        "Do not use tools. Produce a long numbered list of 1000 distinct sentences about sorting algorithms, one sentence per line. Begin immediately; do not summarize.",
      contextPacket:
        "Generate the numbered list now. The owner will interrupt generation.",
    });
    sessions.push(active);
    const activeEvents = await collect(
      active,
      active.input.contextPacket,
      "cancel",
    );
    liveResults.push({
      operation: "active-generation-cancellation",
      nativeSessionId: active.nativeSessionId,
      events: activeEvents,
      exit: await adapter.exit(active),
    });
    await adapter.dispose(active);
    sessions.pop();
  }
  const expectedStatus = liveResults.length ? "?? approved.txt" : "";
  assert.equal(await fixture.git("status", "--porcelain"), expectedStatus);
  assert.equal(await fixture.git("rev-parse", "HEAD"), head);
  assert.equal(
    await readFile(join(fixture.directory, "README.md"), "utf8"),
    "# Disposable fixture\n",
  );
  assert.deepEqual(
    await metadata(),
    before,
    "Personal harness configuration metadata changed",
  );
  await fixture.verify(async () =>
    assert.equal(await fixture.git("status", "--porcelain"), expectedStatus),
  );
  await rm(directory, { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(
      {
        status: blocked
          ? "BLOCKED"
          : values["allow-live"]
            ? "LIVE_PASS"
            : "PROBE_ONLY",
        executable,
        version,
        sdkVersion,
        capabilities,
        nativeEvidence,
        liveReadiness:
          capabilities.authenticated === false
            ? "BLOCKED: privately supply the selected setup-token to the app process, or explicitly select an approved API/cloud route. No personal credential extraction."
            : "Configured route is unverified until an authorized model turn succeeds",
        ownerCommand: blocked
          ? "mise x -- pnpm test:live:claude --allow-live --model sonnet --thinking low --output /tmp/m8-claude-live-evidence-new.json"
          : undefined,
        modelPromptsSubmitted: liveResults.length,
        liveResults,
        checks: {
          nativeSdkControlHandshake:
            capabilities.installed && capabilities.models.length > 0,
          fixtureHeadAndReadmeUnchanged: true,
          personalConfigMetadataUnchanged: true,
          fixtureRemovedAfterChecks: true,
          approvedDisposableWrite: liveResults.length
            ? "approved.txt: Approved once\\n"
            : undefined,
        },
        limits: {
          probeDoesNotEstablishModelEntitlement: true,
          noPersonalCredentialExtraction: true,
          subscriptionProductPolicyNotResolvedByProbe: true,
          sameCheckoutResumeOnly: true,
          noClaudeLeadClaim: true,
          noOsSandboxClaim: true,
        },
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    `${blocked ? "BLOCKED: supported SDK authentication required; no model turn" : values["allow-live"] ? "LIVE PASS" : "PROBE ONLY (no model turn)"}: ${output}`,
  );
  if (blocked) process.exitCode = 2;
  success = true;
} catch (error) {
  await writeFile(
    output,
    `${JSON.stringify(
      {
        status: "FAILED",
        nativeEvidence,
        liveResults,
        failedTurn,
        retainedAppState: directory,
        retainedFixture: fixture.directory,
        noAutomaticReplay: true,
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
  throw error;
} finally {
  for (const session of sessions) await adapter.dispose(session);
  if (!success)
    console.error(
      `Evidence/worktree retained for inspection: ${directory}; ${fixture.directory}. No automatic retry.`,
    );
}
