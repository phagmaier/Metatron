import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";
import { CodexEvents } from "./codex-events.ts";
import { type CodexNotification, CodexRpc } from "./codex-rpc.ts";
import {
  type AdapterCapabilities,
  type HarnessAdapter,
  type ManagedSession,
  type ResumeInput,
  type SessionEvent,
  type StartSessionInput,
  startSessionSchema,
} from "./contract.ts";

// Native delegation and side channels the Lead must not use. Startup verifies
// the effective state and fails closed if any remains enabled.
const disabledFeatures = [
  "multi_agent",
  "multi_agent_v2",
  "apps",
  "plugins",
  "remote_plugin",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "tool_suggest",
  "hooks",
  "worktrees",
  "memories",
  "skill_mcp_dependency_install",
];
const featuresSchema = z.object({
  data: z.array(z.object({ name: z.string(), enabled: z.boolean() })),
});
const accountSchema = z.object({
  account: z.object({ type: z.string() }).loose().nullable(),
});
const modelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      hidden: z.boolean(),
      supportedReasoningEfforts: z.array(
        z.object({ reasoningEffort: z.string(), description: z.string() }),
      ),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});
const threadSchema = z.object({
  thread: z.object({ id: z.string().min(1) }).loose(),
  model: z.string(),
  approvalPolicy: z.unknown(),
  sandbox: z.object({ type: z.string(), networkAccess: z.unknown() }).loose(),
});
const statusSchema = z.object({
  data: z.array(
    z
      .object({
        name: z.string(),
        runtimeStatus: z.string().nullable().optional(),
        tools: z.record(z.string(), z.unknown()).optional(),
      })
      .loose(),
  ),
});
// Codex labels efforts that hand work to native sub-agents; those bypass the
// engine's launch budget, so they are not offered for a Lead.
const delegates = (description: string) => /delegat/i.test(description);
type Active = {
  rpc: CodexRpc;
  managed: ManagedSession;
  busy: boolean;
  turnId: string | null;
  cancelRequested: boolean;
};
export type CodexSpawn = (
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => CodexRpc;

export class CodexAdapter implements HarnessAdapter {
  readonly home: string;
  private readonly directory: string;
  private readonly spawnRpc: CodexSpawn;
  private readonly sessions = new Map<string, Active>();
  constructor(
    directory: string,
    spawnRpc: CodexSpawn = (args, cwd, env) =>
      new CodexRpc("codex", args, cwd, env),
  ) {
    this.directory = resolve(directory);
    this.home = join(this.directory, "codex");
    this.spawnRpc = spawnRpc;
  }
  loginCommand() {
    return `CODEX_HOME='${this.home}' codex login`;
  }
  private async launch(cwd: string, token: string | null) {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: this.home };
    delete env.LAO_GATEWAY_TOKEN;
    if (token) env.LAO_GATEWAY_TOKEN = token;
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_")) delete env[key];
    const rpc = this.spawnRpc(
      [
        "app-server",
        "--listen",
        "stdio://",
        ...disabledFeatures.flatMap((feature) => ["--disable", feature]),
        "-c",
        'web_search="disabled"',
      ],
      cwd,
      env,
    );
    try {
      const init = z
        .object({ codexHome: z.string() })
        .loose()
        .parse(
          await rpc.request("initialize", {
            clientInfo: {
              name: "local-agent-orchestrator",
              title: "Local Agent Orchestrator",
              version: "0.0.0",
            },
            capabilities: { experimentalApi: false },
          }),
        );
      // Never operate on the owner's personal Codex home or sessions.
      if ((await realpath(init.codexHome)) !== (await realpath(this.home)))
        throw new DomainError(
          "POLICY_DENIED",
          "Codex did not use the app-owned CODEX_HOME; refusing",
        );
      rpc.notify("initialized");
      const features = featuresSchema.parse(
        await rpc.request("experimentalFeature/list", {}),
      );
      if (
        features.data.some(
          (f) => disabledFeatures.includes(f.name) && f.enabled,
        )
      )
        throw new DomainError(
          "POLICY_DENIED",
          "Codex delegation/side-channel features remained enabled; refusing",
        );
      return rpc;
    } catch (error) {
      await rpc.close();
      throw error;
    }
  }
  private async catalog(rpc: CodexRpc) {
    const account = accountSchema.parse(
      await rpc.request("account/read", { refreshToken: false }),
    );
    const models: AdapterCapabilities["models"] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const list = modelsSchema.parse(
        await rpc.request("model/list", cursor ? { cursor } : {}),
      );
      for (const model of list.data.filter((m) => !m.hidden))
        models.push({
          id: model.id,
          label: model.displayName,
          thinking: model.supportedReasoningEfforts
            .filter((e) => !delegates(e.description))
            .map((e) => ({ id: e.reasoningEffort, label: e.reasoningEffort })),
        });
      cursor = list.nextCursor ?? null;
      if (!cursor) break;
    }
    return { authenticated: account.account !== null, models };
  }
  async discover(): Promise<AdapterCapabilities> {
    const result: AdapterCapabilities = {
      adapter: "codex",
      installed: false,
      authenticated: "unknown",
      models: [],
      supportsResume: true,
      supportsLiveSteer: false,
      supportsCancel: true,
      supportsPermissionPrompts: false,
      supportsToolGateway: true,
      diagnostics: [
        "Codex app-server Lead: app-owned CODEX_HOME, read-only sandbox without network, approvals never granted, session-scoped MCP tools. Not an OS isolation boundary for reads.",
        "Native sub-agents, apps, plugins, hooks, web search and delegating reasoning efforts are disabled. Steering arrives with M6.",
      ],
    };
    let rpc: CodexRpc | undefined;
    try {
      rpc = await this.launch(this.home, null);
      result.installed = true;
      const catalog = await this.catalog(rpc);
      result.authenticated = catalog.authenticated;
      result.models = catalog.models;
      if (!catalog.authenticated)
        result.diagnostics.push(
          `Codex is not logged in for this app. Owner action: ${this.loginCommand()}`,
        );
    } catch (error) {
      result.diagnostics.push(
        error instanceof DomainError
          ? error.message
          : "Codex discovery failed; verify the installed codex executable",
      );
    } finally {
      if (rpc) await rpc.close();
    }
    return result;
  }
  private async open(input: StartSessionInput, threadId: string | null) {
    const data = startSessionSchema.parse(input);
    const token = data.environment.LAO_GATEWAY_TOKEN;
    if (
      data.permission !== "coordinator" ||
      !data.toolEndpoint?.startsWith("http://127.0.0.1:") ||
      !token ||
      Object.keys(data.environment).length !== 1
    )
      throw new DomainError(
        "UNSUPPORTED",
        "Codex runs only as a gateway-connected coordinator Lead",
      );
    const rpc = await this.launch(data.cwd, token);
    try {
      const catalog = await this.catalog(rpc);
      if (!catalog.authenticated)
        throw new DomainError(
          "UNSUPPORTED",
          `Codex is not logged in for this app. Owner action: ${this.loginCommand()}`,
        );
      const model = catalog.models.find((m) => m.id === data.model);
      if (
        !model ||
        (data.thinking !== null &&
          !model.thinking.some((t) => t.id === data.thinking))
      )
        throw new DomainError(
          "UNSUPPORTED",
          "Requested Codex model/effort is unavailable for a Lead",
        );
      const params = {
        cwd: data.cwd,
        model: data.model,
        sandbox: "read-only",
        approvalPolicy: "never",
        developerInstructions: data.roleInstructions,
        config: {
          web_search: "disabled",
          mcp_servers: {
            lao: {
              url: data.toolEndpoint,
              bearer_token_env_var: "LAO_GATEWAY_TOKEN",
              required: true,
              tool_timeout_sec: 60,
              // Codex refuses non-read-only MCP tools under approval "never"
              // unless the server is pre-approved. Only this app gateway is,
              // and it re-authorizes every call server-side.
              default_tools_approval_mode: "approve",
            },
          },
        },
      };
      const thread = threadSchema.parse(
        threadId
          ? await rpc.request("thread/resume", { ...params, threadId })
          : await rpc.request("thread/start", { ...params, ephemeral: false }),
      );
      if (
        (threadId && thread.thread.id !== threadId) ||
        thread.sandbox.type !== "readOnly" ||
        thread.sandbox.networkAccess !== false ||
        thread.approvalPolicy !== "never" ||
        thread.model !== data.model
      )
        throw new DomainError(
          "POLICY_DENIED",
          "Codex did not apply the read-only Lead configuration; refusing prompts",
        );
      let connected = false;
      for (let i = 0; i < 40 && !connected; i++) {
        const status = statusSchema.parse(
          await rpc.request("mcpServerStatus/list", {
            threadId: thread.thread.id,
          }),
        );
        const lao = status.data.find((s) => s.name === "lao");
        connected =
          lao?.runtimeStatus === "connected" &&
          Object.hasOwn(lao.tools ?? {}, "get_run_status");
        if (!connected) await delay(250);
      }
      if (!connected)
        throw new DomainError(
          "POLICY_DENIED",
          "Lead tool gateway did not connect; refusing prompts",
        );
      const managed: ManagedSession = {
        nativeSessionId: thread.thread.id,
        adapter: "codex",
        input: data,
        ...(rpc.child.pid ? { processId: rpc.child.pid } : {}),
      };
      this.sessions.set(managed.nativeSessionId, {
        rpc,
        managed,
        busy: false,
        turnId: null,
        cancelRequested: false,
      });
      return managed;
    } catch (error) {
      await rpc.close();
      throw error;
    }
  }
  startSession(input: StartSessionInput) {
    return this.open(input, null);
  }
  resume(nativeSessionId: string, input: ResumeInput) {
    return this.open(input, nativeSessionId);
  }
  private active(session: ManagedSession) {
    const current = this.sessions.get(session.nativeSessionId);
    if (!current || current.managed !== session)
      throw new DomainError(
        "CONFLICT",
        "Codex session identity is not owned by this adapter",
      );
    return current;
  }
  async *prompt(
    session: ManagedSession,
    text: string,
  ): AsyncIterable<SessionEvent> {
    const current = this.active(session);
    if (current.busy)
      throw new DomainError(
        "CONFLICT",
        "Codex Lead already has an active turn",
      );
    if (current.cancelRequested)
      throw new DomainError(
        "CONFLICT",
        "Lead turn was stopped before it began",
      );
    current.busy = true;
    const queue: CodexNotification[] = [];
    let wake: (() => void) | undefined;
    const push = (event: CodexNotification) => {
      if (queue.length >= 8192) {
        current.rpc.child.kill("SIGTERM");
        return;
      }
      queue.push(event);
      wake?.();
    };
    const unsubscribe = current.rpc.subscribe(push);
    // approvalPolicy=never should prevent requests; any that arrive are denied.
    current.rpc.handleRequests((method) => {
      push({ method: "policy/declined", params: { method } });
      if (
        method === "item/commandExecution/requestApproval" ||
        method === "item/fileChange/requestApproval"
      )
        return { result: { decision: "decline" } };
      if (method === "execCommandApproval" || method === "applyPatchApproval")
        return { result: { decision: "denied" } };
      if (method === "mcpServer/elicitation/request")
        return { result: { action: "decline" } };
      return { error: { code: -32000, message: "Denied by app policy" } };
    });
    const mapper = new CodexEvents(session.nativeSessionId);
    const deadline = setTimeout(() => {
      push({ method: "transport/error", params: { reason: "deadline" } });
      void this.cancel(session).catch(() => current.rpc.child.kill("SIGTERM"));
    }, 15 * 60_000);
    let interrupting = false;
    try {
      const response = z.object({ turn: z.object({ id: z.string() }) }).parse(
        await current.rpc.request("turn/start", {
          threadId: session.nativeSessionId,
          input: [{ type: "text", text, text_elements: [] }],
          ...(session.input.thinking ? { effort: session.input.thinking } : {}),
        }),
      );
      current.turnId = response.turn.id;
      mapper.start(response.turn.id);
      // A stop that arrived while turn/start was in flight still applies.
      if (current.cancelRequested) await this.cancel(session);
      for (;;) {
        const record = queue.shift();
        if (!record) {
          await new Promise<void>((done) => {
            wake = done;
          });
          wake = undefined;
          continue;
        }
        if (record.method === "policy/declined") {
          yield {
            type: "approval_requested",
            nativeRequestId: String(
              z.object({ method: z.string() }).parse(record.params).method,
            ),
            details: "Declined by app policy; the Lead cannot gain permissions",
          };
          continue;
        }
        for (const event of mapper.consume(record)) {
          yield event;
          if (
            event.type === "session_error" &&
            event.code === "delegation_blocked" &&
            !interrupting
          ) {
            interrupting = true;
            await this.cancel(session).catch(() =>
              current.rpc.child.kill("SIGTERM"),
            );
          }
          if (event.type === "turn_completed") return;
        }
        if (["transport/exit", "transport/error"].includes(record.method))
          return;
      }
    } finally {
      clearTimeout(deadline);
      unsubscribe();
      current.busy = false;
      current.turnId = null;
    }
  }
  async cancel(session: ManagedSession) {
    const current = this.active(session);
    current.cancelRequested = true;
    if (!current.turnId) return;
    await current.rpc.request(
      "turn/interrupt",
      { threadId: session.nativeSessionId, turnId: current.turnId },
      10_000,
    );
  }
  async steer(_session: ManagedSession, _text: string): Promise<"unsupported"> {
    return "unsupported";
  }
  async respondToApproval(): Promise<void> {
    throw new DomainError(
      "UNSUPPORTED",
      "Lead approvals are never granted; the read-only policy declines them",
    );
  }
  async exit(session: ManagedSession) {
    return this.active(session).rpc.close();
  }
  async dispose(session: ManagedSession) {
    const active = this.active(session);
    try {
      await active.rpc.close();
      const directory = join(
        this.directory,
        "codex-sessions",
        session.input.attemptId,
      );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // Method names and ids only; never payloads, prompts or account detail.
      await writeFile(
        join(directory, "rpc-diagnostics.json"),
        JSON.stringify(active.rpc.diagnostics),
        { mode: 0o600 },
      );
    } finally {
      // A failed diagnostic write is still reported, but the closed process
      // must not stay registered as a live session.
      this.sessions.delete(session.nativeSessionId);
    }
  }
}
