import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type {
  AdapterCapabilities,
  ManagedSession,
  SessionEvent,
  StartSessionInput,
} from "../src/server/adapters/contract.ts";
import { OpenCodeAdapter } from "../src/server/adapters/opencode.ts";
import { OpenCodeHost } from "../src/server/adapters/opencode-host.ts";
import { DomainError } from "../src/shared/domain/states.ts";
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
  "Use --output <new evidence.json>; paid native turns additionally require --allow-live --model <discovered model> [--thinking <discovered variant>]",
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
const directory = await mkdtemp("/tmp/lao-opencode-smoke-");
const fixture = await createGitFixture();
const adapter = new OpenCodeAdapter(directory);
const sessions: ManagedSession[] = [];
const results: {
  operation: string;
  nativeSessionId: string;
  events: SessionEvent[];
  modelRefs?: object[];
  interruptConfirmed?: boolean;
}[] = [];
const personal = [
  ".config/opencode/opencode.json",
  ".config/opencode/opencode.jsonc",
  ".local/share/opencode/auth.json",
  ".local/share/opencode/service.json",
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
const nonce = randomUUID();
let head = "";
let passed = false;
let failure: string | undefined;
let capabilities: AdapterCapabilities | undefined;
let control: object | undefined;
async function collect(
  operation: string,
  session: ManagedSession,
  text: string,
  react?: (event: SessionEvent) => Promise<void>,
) {
  const result = {
    operation,
    nativeSessionId: session.nativeSessionId,
    events: [] as SessionEvent[],
    ...adapter.evidence(session),
  };
  results.push(result);
  const timer = setTimeout(
    () => void adapter.cancel(session).catch(() => {}),
    120000,
  );
  try {
    for await (const event of adapter.prompt(session, text)) {
      result.events.push(event);
      await react?.(event);
    }
    Object.assign(result, adapter.evidence(session));
    return result.events;
  } finally {
    clearTimeout(timer);
  }
}
function terminal(events: SessionEvent[], status: "completed" | "interrupted") {
  assert.ok(
    events.some(
      (event) =>
        event.type === "turn_completed" && event.nativeStatus === status,
    ),
    `Native ${status} evidence required`,
  );
  if (status === "completed")
    assert.ok(
      !events.some((event) => event.type === "session_error"),
      "Native errors cannot establish successful completion",
    );
}
async function absent(path: string) {
  await assert.rejects(access(path), { code: "ENOENT" });
}
try {
  await writeFile(
    join(fixture.directory, "native-proof.txt"),
    `Native disposable nonce: ${nonce}\n`,
  );
  await fixture.git("add", "--", "native-proof.txt");
  await fixture.git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Native proof fixture",
  );
  head = await fixture.git("rev-parse", "HEAD");
  // A project plugin would execute outside tool consent; verify it is never loaded.
  const marker = join(directory, "project-plugin-executed");
  const plugin = join(fixture.directory, "hostile-plugin.mjs");
  await writeFile(
    plugin,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unsafe'); export default {};\n`,
  );
  await writeFile(
    join(fixture.directory, "opencode.json"),
    JSON.stringify({
      plugins: [new URL(`file://${plugin}`).href],
      agents: { metatron: { system: "UNTRUSTED_PROJECT_OVERRIDE" } },
    }),
  );
  const launched = await OpenCodeHost.launch(
    join(directory, "control-probe"),
    {},
    {
      runId: randomUUID(),
      taskId: randomUUID(),
      attemptId: randomUUID(),
      cwd: fixture.directory,
      roleInstructions: "Discover native metadata only; no model request.",
      model: "metadata-only-not-submitted",
      thinking: null,
      permission: "read_only",
      contextPolicy: "fresh",
      contextPacket: "No model probe",
      toolEndpoint: null,
      environment: {},
    },
  );
  try {
    const location = { directory: fixture.directory };
    const missing = await fetch(`${launched.url}/api/info`);
    const wrong = await fetch(`${launched.url}/api/info`, {
      headers: { Authorization: "Basic invalid" },
    });
    const mutation = await fetch(`${launched.url}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
      },
      body: "{}",
    });
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(mutation.status, 401);
    const plugins = await launched.client.plugin.list({ location });
    const external = plugins.data.filter(
      (plugin) => plugin.source.type !== "builtin",
    );
    assert.deepEqual(external, [], "No external or project plugin may load");
    const agents = await launched.client.agent.list({ location });
    assert.ok(agents.data.some((agent) => agent.id === "metatron"));
    await absent(marker);
    assert.ok(
      !agents.data.some((agent) =>
        ["title", "summary", "compaction"].includes(agent.id),
      ),
    );
    control = {
      version: launched.version,
      pidMatches:
        (await launched.client.server.info()).pid === launched.host.child.pid,
      unauthenticatedRead: missing.status,
      wrongPassword: wrong.status,
      unauthenticatedForeignOriginMutation: mutation.status,
      externalPluginCount: external.length,
      activeBuiltinIds: plugins.data
        .filter((plugin) => plugin.state.status === "active")
        .map((plugin) => plugin.id),
      projectPluginExecuted: false,
      originLimit:
        "Native authenticated GET permits arbitrary Origin; private Basic credential stays server-side. Metatron API has separate Origin/token protection.",
    };
  } finally {
    await launched.host.stop();
  }
  capabilities = await adapter.discover();
  assert.equal(
    capabilities.installed,
    true,
    "Installed native worker discovery must succeed",
  );
  if (values["allow-live"]) {
    const model = capabilities.models.find(
      (model) => model.id === values.model,
    );
    assert.ok(model, "Choose a freshly discovered enabled native model");
    assert.ok(
      !values.thinking ||
        model.thinking.some((variant) => variant.id === values.thinking),
      "Choose a freshly discovered native variant",
    );
    const input: StartSessionInput = {
      runId: randomUUID(),
      taskId: randomUUID(),
      attemptId: randomUUID(),
      cwd: fixture.directory,
      roleInstructions:
        "Complete only the stated disposable task. Use native file tools, never shell, delegation, skills, project customization or paths outside this checkout.",
      model: model.id,
      thinking: values.thinking ?? null,
      permission: "read_only",
      contextPolicy: "fresh",
      contextPacket: "Disposable native validation, not a user project.",
      toolEndpoint: null,
      environment: {},
    };
    const reader = await adapter.startSession(input);
    sessions.push(reader);
    const read = await collect(
      "streamed-read",
      reader,
      "Read native-proof.txt with the native read tool. Reply with its nonce exactly. Do not write.",
    );
    terminal(read, "completed");
    assert.ok(
      read.some(
        (event) => event.type === "tool_started" && event.summary === "read",
      ),
    );
    assert.ok(
      read
        .filter((event) => event.type === "text_delta")
        .map((event) => event.text)
        .join("")
        .includes(nonce),
    );
    await adapter.dispose(reader);
    const resumed = await adapter.resume(reader.nativeSessionId, {
      ...input,
      attemptId: randomUUID(),
      contextPolicy: "resume",
    });
    sessions.push(resumed);
    assert.equal(resumed.nativeSessionId, reader.nativeSessionId);
    const resume = await collect(
      "same-id-resume",
      resumed,
      "Read native-proof.txt again using the native read tool. Reply with its nonce exactly. No writes.",
    );
    terminal(resume, "completed");
    assert.ok(
      resume.some(
        (event) => event.type === "tool_started" && event.summary === "read",
      ),
    );
    await adapter.dispose(resumed);
    const writerInput = {
      ...input,
      taskId: randomUUID(),
      attemptId: randomUUID(),
      permission: "workspace_write" as const,
    };
    const denied = await adapter.startSession(writerInput);
    sessions.push(denied);
    let deniedId = "";
    const denial = await collect(
      "deny-and-cancel",
      denied,
      "Use native write to create denied.txt containing DENIED. Do not read other files.",
      async (event) => {
        if (event.type !== "approval_requested") return;
        deniedId = event.nativeRequestId;
        await absent(join(fixture.directory, "denied.txt"));
        await adapter.respondToApproval(denied, deniedId, "deny");
      },
    );
    terminal(denial, "interrupted");
    assert.ok(deniedId);
    await absent(join(fixture.directory, "denied.txt"));
    await assert.rejects(
      adapter.respondToApproval(denied, deniedId, "approve"),
    );
    await assert.rejects(
      adapter.resume(denied.nativeSessionId, {
        ...writerInput,
        contextPolicy: "resume",
      }),
    );
    await adapter.dispose(denied);
    const approved = await adapter.startSession({
      ...writerInput,
      taskId: randomUUID(),
      attemptId: randomUUID(),
    });
    sessions.push(approved);
    const ids: string[] = [];
    const approval = await collect(
      "approve-once-independent-denial",
      approved,
      `In order, use native write to create approved.txt containing exactly ${nonce}, then use native write to create second-denied.txt containing DENIED. Do not use shell or combine operations.`,
      async (event) => {
        if (event.type !== "approval_requested") return;
        ids.push(event.nativeRequestId);
        assert.ok(
          ids.length <= 2,
          "Only the two authorized file requests are expected",
        );
        if (ids.length === 1) {
          await absent(join(fixture.directory, "approved.txt"));
          await adapter.respondToApproval(
            approved,
            event.nativeRequestId,
            "approve",
          );
        } else {
          assert.equal(
            (
              await readFile(join(fixture.directory, "approved.txt"), "utf8")
            ).trim(),
            nonce,
          );
          await adapter.respondToApproval(
            approved,
            event.nativeRequestId,
            "deny",
          );
        }
      },
    );
    terminal(approval, "interrupted");
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(
      (await readFile(join(fixture.directory, "approved.txt"), "utf8")).trim(),
      nonce,
    );
    await absent(join(fixture.directory, "second-denied.txt"));
    for (const id of ids)
      await assert.rejects(adapter.respondToApproval(approved, id, "approve"));
    await adapter.dispose(approved);
    const active = await adapter.startSession({
      ...input,
      taskId: randomUUID(),
      attemptId: randomUUID(),
    });
    sessions.push(active);
    let cancelledAfterText = false;
    const cancellation = await collect(
      "active-generation-cancel",
      active,
      "Without any tools, output consecutive integers from 1 to 20000, one per line. Start now and continue until 20000.",
      async (event) => {
        if (event.type === "text_delta" && !cancelledAfterText) {
          cancelledAfterText = true;
          await adapter.cancel(active);
        }
      },
    );
    terminal(cancellation, "interrupted");
    assert.equal(cancelledAfterText, true);
    assert.equal(adapter.evidence(active).interruptConfirmed, true);
    await assert.rejects(
      adapter.resume(active.nativeSessionId, {
        ...active.input,
        contextPolicy: "resume",
      }),
    );
    await adapter.dispose(active);
    assert.equal(await fixture.git("rev-parse", "HEAD"), head);
    assert.equal(await fixture.git("diff", "--name-only"), "");
  }
  await absent(marker);
  assert.deepEqual(await metadata(), before);
  passed = true;
} catch (error) {
  failure =
    error instanceof assert.AssertionError || error instanceof DomainError
      ? error.message
      : "Native OpenCode validation failed; inspect redacted events and retained app-owned state; never automatically replay";
} finally {
  for (const session of sessions)
    await adapter.dispose(session).catch(() => {});
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ harness: "opencode", passed, liveAuthorized: !!values["allow-live"], selected: { model: values.model, variant: values.thinking }, submittedPromptCount: results.length, control, capabilities, results, failure, retained: passed ? null : { appDirectory: directory, checkout: fixture.directory }, limitations: ["Direct native adapter validation, not the later four-harness/gateway/Lead matrix", "Native deny rejects all pending requests; private server shutdown is independently recorded", "No OS sandbox, personal credential extraction, generic API substitute or automatic replay"] }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  if (passed) {
    await rm(directory, { recursive: true });
    await fixture.verify(async () => {
      assert.equal(await fixture.git("rev-parse", "HEAD"), head);
    });
  }
}
console.log(
  JSON.stringify({
    passed,
    submittedPromptCount: results.length,
    output,
    failure,
  }),
);
if (!passed) process.exitCode = 1;
