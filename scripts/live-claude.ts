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
import { z } from "zod";
import { ClaudeAdapter } from "../src/server/adapters/claude.ts";
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
const adapter = new ClaudeAdapter(directory);
const sessions: ManagedSession[] = [];
const liveResults: {
  operation: string;
  nativeSessionId: string;
  events: SessionEvent[];
  exit: { code: number | null; signal: string | null };
}[] = [];
let success = false;
try {
  const exec = promisify(execFile);
  const version = (
    await exec("claude", ["--version"], {
      timeout: 10_000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: join(directory, "cli-probe") },
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
  const capabilities = await adapter.discover();
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
      stopOnApproval = false,
    ) => {
      const events: SessionEvent[] = [];
      let requested = false;
      for await (const event of adapter.prompt(managed, text)) {
        events.push(event);
        if (event.type === "approval_requested") {
          assert.equal(
            stopOnApproval,
            true,
            "A reader cannot gain a mutation approval surface",
          );
          requested = true;
          assert.equal(
            await readFile(join(fixture.directory, "README.md"), "utf8"),
            "# Disposable fixture\n",
          );
          await adapter.respondToApproval(
            managed,
            event.nativeRequestId,
            "deny",
          );
          await adapter.cancel(managed);
          await assert.rejects(
            adapter.respondToApproval(
              managed,
              event.nativeRequestId,
              "approve",
            ),
          );
        }
      }
      if (stopOnApproval)
        assert.equal(
          requested,
          true,
          "Native model did not exercise the requested permission callback; do not claim it was verified",
        );
      else {
        const text = events
          .filter((event) => event.type === "text_delta")
          .map((event) => event.text)
          .join("");
        assert.ok(text.includes("Disposable fixture"));
        assert.ok(
          events.some(
            (event) =>
              event.type === "turn_completed" &&
              event.nativeStatus === "completed",
          ),
        );
        assert.ok(!events.some((event) => event.type === "session_error"));
      }
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
      true,
    );
    liveResults.push({
      operation: "native-permission-denial-and-cancel",
      nativeSessionId: writer.nativeSessionId,
      events: writerEvents,
      exit: await adapter.exit(writer),
    });
    await adapter.dispose(writer);
    sessions.pop();
  }
  assert.equal(await fixture.git("status", "--porcelain"), "");
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
    assert.equal(await fixture.git("status", "--porcelain"), ""),
  );
  await rm(directory, { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ status: blocked ? "BLOCKED" : values["allow-live"] ? "LIVE_PASS" : "PROBE_ONLY", version, sdkVersion, capabilities, liveReadiness: capabilities.authenticated === false ? "BLOCKED: privately configure ANTHROPIC_API_KEY or an approved SDK cloud-provider environment; personal subscription/login credentials are not copied or reused" : "Unknown until an authorized provider turn succeeds", ownerCommand: blocked ? "mise x -- pnpm test:live:claude --allow-live --model sonnet --thinking low --output /tmp/m8-claude-live-evidence.json" : undefined, modelPromptsSubmitted: liveResults.length, liveResults, checks: { nativeSdkControlHandshake: capabilities.installed && capabilities.models.length > 0, ownerCheckoutUnchanged: true, personalConfigMetadataUnchanged: true, fixtureRemovedAfterChecks: true }, limits: { probeDoesNotEstablishModelEntitlement: true, noPersonalSubscriptionCredentialReuse: true, sameCheckoutResumeOnly: true, noClaudeLeadClaim: true, noOsSandboxClaim: true } }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    `${blocked ? "BLOCKED: supported SDK authentication required; no model turn" : values["allow-live"] ? "LIVE PASS" : "PROBE ONLY (no model turn)"}: ${output}`,
  );
  if (blocked) process.exitCode = 2;
  success = true;
} finally {
  for (const session of sessions) await adapter.dispose(session);
  if (!success)
    console.error(
      `Evidence/worktree retained for inspection: ${directory}; ${fixture.directory}. No automatic retry.`,
    );
}
