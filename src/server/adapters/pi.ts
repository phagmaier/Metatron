import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { idSchema, textSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  resumeUnsupported,
  steeringUnsupported,
} from "../../shared/native-controls.ts";
import { findExecutable, notInstalled, unreadyStep } from "./availability.ts";
import {
  type AdapterCapabilities,
  type HarnessAdapter,
  type ManagedSession,
  type ResumeInput,
  type SessionEvent,
  type StartSessionInput,
  type SteeringOptions,
  startSessionSchema,
} from "./contract.ts";
import { PiEvents } from "./pi-events.ts";
import { PiRpc, type RpcRecord } from "./pi-rpc.ts";

const modelsSchema = z.object({
  models: z.array(
    z.object({ id: z.string(), name: z.string(), provider: z.string() }),
  ),
});
const levelsSchema = z.object({ levels: z.array(z.string()) });
const execute = promisify(execFile);
export type PiSpawn = (
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => PiRpc | Promise<PiRpc>;
// Pi RPC has no version command; the CLI flag is read with the app-owned
// agent directory so it cannot touch personal Pi settings.
async function piVersion(config: string) {
  try {
    const { stdout } = await execute(
      await findExecutable("pi", "Pi"),
      ["--version"],
      {
        cwd: config,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: config,
          PI_OFFLINE: "1",
          PI_TELEMETRY: "0",
        },
        timeout: 10_000,
        maxBuffer: 4096,
      },
    );
    const line = stdout.trim().split("\n")[0]?.trim() ?? "";
    return line && line.length <= 80 ? line : null;
  } catch {
    return null;
  }
}
const stateSchema = z.object({
  sessionId: z.string().min(1),
  model: z.object({ id: z.string(), provider: z.string() }).optional(),
  thinkingLevel: z.string().optional(),
});
type Active = {
  rpc: PiRpc;
  managed: ManagedSession;
  busy: boolean;
  accepting: boolean;
  messages: Map<string, string>;
  settings: Extract<SessionEvent, { type: "settings_verified" }>;
};
export class PiAdapter implements HarnessAdapter {
  private readonly directory: string;
  private readonly spawnRpc: PiSpawn;
  // An injected launcher owns its executable, whose version is not Pi's.
  private readonly reportsVersion: boolean;
  private readonly sessions = new Map<string, Active>();
  constructor(directory: string, spawnRpc?: PiSpawn) {
    this.directory = resolve(directory);
    this.spawnRpc =
      spawnRpc ??
      (async (args, cwd, env) =>
        new PiRpc(await findExecutable("pi", "Pi"), args, cwd, env));
    this.reportsVersion = !spawnRpc;
  }
  private async launch(
    cwd: string,
    tools: string,
    sessionDirectory: string | null,
    permission = "read_only",
    instructions = "",
    gateway: { url: string; token: string } | null = null,
  ) {
    const config = join(this.directory, "pi");
    await mkdir(config, { recursive: true, mode: 0o700 });
    try {
      await writeFile(
        join(config, "settings.json"),
        JSON.stringify({
          retry: { enabled: false, provider: { maxRetries: 0 } },
          compaction: { enabled: false },
        }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
    }
    // --no-extensions also drops built-ins; only the MCP connector is re-added,
    // and the app extension registers the sole (session-scoped) server.
    const args = [
      "--mode",
      "rpc",
      "--offline",
      "--no-extensions",
      ...(gateway ? ["--extension", "builtin:mcp"] : ["--no-mcp"]),
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-approve",
      "--tools",
      gateway ? `${tools},mcp__lao__*` : tools,
      "--system-prompt",
      instructions ||
        "Report concise evidence. Use only the assigned repository. Never read credentials.",
    ];
    if (sessionDirectory) {
      await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
      args.push(
        "--session-dir",
        sessionDirectory,
        "--extension",
        fileURLToPath(new URL("./pi-guard.ts", import.meta.url)),
      );
    } else args.push("--no-session");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PI_CODING_AGENT_DIR: config,
      PI_CODING_AGENT_SESSION_DIR:
        sessionDirectory ?? join(config, "discovery-sessions"),
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
      LAO_PI_PERMISSION: permission,
    };
    delete env.LAO_GATEWAY_URL;
    delete env.LAO_GATEWAY_TOKEN;
    if (gateway) {
      env.LAO_GATEWAY_URL = gateway.url;
      env.LAO_GATEWAY_TOKEN = gateway.token;
    }
    // Repository selectors and caller overlays must not redirect native tools.
    for (const key of Object.keys(env))
      if (key.startsWith("GIT_")) delete env[key];
    return this.spawnRpc(args, cwd, env);
  }
  async discover(): Promise<AdapterCapabilities> {
    const result: AdapterCapabilities = {
      adapter: "pi",
      installed: false,
      authenticated: "unknown",
      models: [],
      supportsResume: false,
      supportsLiveSteer: steeringUnsupported.pi === null,
      supportsCancel: true,
      supportsPermissionPrompts: false,
      supportsToolGateway: true,
      version: null,
      nextStep: null,
      diagnostics: [
        "App-owned Pi configuration; provider environment credentials or app-owned Pi login required. Catalog presence does not prove entitlement.",
        "File tools plus the session-scoped app gateway (report tools) only; shell, personal MCP servers and discovered extensions are disabled. No OS sandbox. Steer/follow-up queue at native input boundaries; queue acceptance is not delivery.",
        `Unsupported: owner approval prompts (allowed tools run without a native per-call callback; the tool allowlist and app guard extension enforce policy); resume (${resumeUnsupported.pi}; each attempt uses a new worktree); Lead/coordinator sessions.`,
      ],
    };
    let rpc: PiRpc | undefined;
    let version: Promise<string | null> = Promise.resolve(null);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      rpc = await this.launch(this.directory, "", null);
      result.installed = true;
      if (this.reportsVersion) version = piVersion(join(this.directory, "pi"));
      const models = modelsSchema.parse(
        await rpc.request("get_available_models"),
      );
      for (const model of models.models) {
        await rpc.request("set_model", {
          provider: model.provider,
          modelId: model.id,
        });
        const levels = levelsSchema.parse(
          await rpc.request("get_available_thinking_levels"),
        );
        result.models.push({
          id: `${model.provider}/${model.id}`,
          label: `${model.name} (${model.provider})`,
          thinking: levels.levels.map((id) => ({ id, label: id })),
        });
      }
      // Pi lists only models whose provider has usable credentials.
      if (!result.models.length) {
        result.authenticated = false;
        result.nextStep =
          "Pi lists no model with usable provider credentials. Export a provider API key Pi supports (for example DEEPSEEK_API_KEY; see Pi's providers documentation) in the shell that starts this app, restart the app and check again.";
      }
    } catch (error) {
      // A partial catalog was never validated as a whole.
      result.models = [];
      result.installed = !notInstalled(error);
      if (notInstalled(error)) result.nextStep = error.message;
      else {
        result.nextStep = unreadyStep("Pi");
        result.diagnostics.push(
          error instanceof DomainError
            ? error.message
            : "Pi discovery failed; verify Pi installation and configuration",
        );
      }
    } finally {
      if (rpc) await rpc.close();
      result.version = await version;
    }
    return result;
  }
  async startSession(input: StartSessionInput): Promise<ManagedSession> {
    const data = startSessionSchema.parse(input);
    const token = data.environment.LAO_GATEWAY_TOKEN;
    const keys = Object.keys(data.environment);
    if (
      data.permission === "coordinator" ||
      data.contextPolicy === "resume" ||
      (data.toolEndpoint
        ? !data.toolEndpoint.startsWith("http://127.0.0.1:") ||
          !token ||
          keys.length !== 1
        : keys.length !== 0)
    )
      throw new DomainError(
        "UNSUPPORTED",
        "Pi supports fresh file-tool workers with only the app's loopback gateway overlay",
      );
    const gateway =
      data.toolEndpoint && token ? { url: data.toolEndpoint, token } : null;
    const transcriptPath = join(this.directory, "pi-sessions", data.attemptId);
    const rpc = await this.launch(
      data.cwd,
      data.permission === "read_only"
        ? "read,grep,find,ls"
        : "read,grep,find,ls,edit,write",
      transcriptPath,
      data.permission,
      data.roleInstructions,
      gateway,
    );
    try {
      const models = modelsSchema.parse(
        await rpc.request("get_available_models"),
      );
      const model = models.models.find(
        (m) => `${m.provider}/${m.id}` === data.model,
      );
      if (!model)
        throw new DomainError(
          "UNSUPPORTED",
          "Requested Pi model is absent from the native catalog",
        );
      await rpc.request("set_model", {
        provider: model.provider,
        modelId: model.id,
      });
      const levels = levelsSchema.parse(
        await rpc.request("get_available_thinking_levels"),
      );
      if (data.thinking !== null) {
        if (!levels.levels.includes(data.thinking))
          throw new DomainError(
            "UNSUPPORTED",
            "Requested thinking level is unsupported by this Pi model",
          );
        await rpc.request("set_thinking_level", { level: data.thinking });
      }
      const state = stateSchema.parse(await rpc.request("get_state"));
      const commands = z
        .object({ commands: z.array(z.object({ name: z.string() })) })
        .parse(await rpc.request("get_commands"));
      const names = commands.commands.map((command) => command.name);
      if (
        !names.includes("lao_guard") ||
        (gateway !== null && !names.includes("lao_gateway"))
      )
        throw new DomainError(
          "POLICY_DENIED",
          "Pi policy extension or gateway registration did not load; refusing all model prompts",
        );
      if (
        `${state.model?.provider}/${state.model?.id}` !== data.model ||
        (data.thinking !== null && state.thinkingLevel !== data.thinking)
      )
        throw new DomainError(
          "UNSUPPORTED",
          "Pi did not apply the requested model/thinking configuration",
        );
      const managed: ManagedSession = {
        nativeSessionId: state.sessionId,
        adapter: "pi",
        transcriptPath,
        input: data,
        ...(rpc.child.pid ? { processId: rpc.child.pid } : {}),
      };
      this.sessions.set(managed.nativeSessionId, {
        rpc,
        managed,
        busy: false,
        accepting: false,
        messages: new Map(),
        settings: {
          type: "settings_verified",
          model: data.model,
          thinking: state.thinkingLevel ?? null,
          source: "Pi get_state after set_model/set_thinking_level",
        },
      });
      return managed;
    } catch (error) {
      await rpc.close();
      throw error;
    }
  }
  private active(session: ManagedSession) {
    const current = this.sessions.get(session.nativeSessionId);
    if (!current || current.managed !== session)
      throw new DomainError(
        "CONFLICT",
        "Pi session identity is not owned by this adapter",
      );
    return current;
  }
  async *prompt(
    session: ManagedSession,
    text: string,
  ): AsyncIterable<SessionEvent> {
    const current = this.active(session);
    if (current.busy)
      throw new DomainError("CONFLICT", "Pi already has an active prompt");
    current.busy = true;
    current.accepting = true;
    const queue: RpcRecord[] = [];
    let wake: (() => void) | undefined;
    let overflow = false;
    const unsubscribe = current.rpc.subscribe((event) => {
      if (
        ["agent_settled", "transport_exit", "transport_error"].includes(
          event.type,
        )
      )
        current.accepting = false;
      if (queue.length >= 4096) {
        overflow = true;
        current.rpc.child.kill("SIGTERM");
      } else queue.push(event);
      wake?.();
    });
    const mapper = new PiEvents();
    const deadline = setTimeout(() => {
      queue.push({ type: "transport_error", reason: "deadline" });
      current.rpc.child.kill("SIGTERM");
      wake?.();
    }, 180_000);
    try {
      const response = z.object({ disposition: z.string() }).parse(
        await current.rpc.request("prompt", {
          message: `${session.input.contextPacket}\n\n${text}`,
        }),
      );
      if (response.disposition !== "started")
        throw new DomainError(
          "CONFLICT",
          "Pi did not start this prompt; no automatic replay",
        );
      for (;;) {
        if (overflow)
          throw new DomainError(
            "CONFLICT",
            "Pi event queue exceeded its bound; attempt requires recovery",
          );
        const record = queue.shift();
        if (!record) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
          continue;
        }
        if (record.type === "message_start") {
          const user = z
            .object({
              role: z.literal("user"),
              content: z.union([
                z.string(),
                z.array(
                  z.object({ type: z.literal("text"), text: z.string() }),
                ),
              ]),
            })
            .safeParse(record.message);
          if (user.success) {
            const content =
              typeof user.data.content === "string"
                ? user.data.content
                : user.data.content.map((part) => part.text).join("");
            const messageId = current.messages.get(content);
            if (messageId) {
              current.messages.delete(content);
              yield { type: "owner_message_delivered", messageId };
            }
          }
        }
        for (const event of mapper.consume(record)) {
          if (
            event.type === "turn_completed" &&
            event.nativeStatus === "completed"
          )
            yield current.settings;
          yield event;
        }
        if (
          ["agent_settled", "transport_exit", "transport_error"].includes(
            record.type,
          )
        )
          return;
      }
    } finally {
      clearTimeout(deadline);
      unsubscribe();
      current.busy = false;
      current.accepting = false;
    }
  }
  async cancel(session: ManagedSession) {
    const current = this.active(session);
    current.accepting = false;
    // Pi's abort may continue queued inputs. Clear them first so owner
    // cancellation cannot start a queued follow-up; failure closes only this
    // app-owned process instead of issuing an abort with unknown queue state.
    try {
      await current.rpc.request("clear_queue", {}, 10_000);
      current.messages.clear();
      await current.rpc.request("abort", {}, 10_000);
    } catch (error) {
      await current.rpc.close();
      throw error;
    }
  }
  async steer(
    session: ManagedSession,
    text: string,
    options?: SteeringOptions,
  ) {
    const current = this.active(session);
    const parsed = textSchema.max(4000).parse(text);
    if (!current.busy || !current.accepting) return "unsupported" as const;
    const kind = z.enum(["steer", "follow_up"]).parse(options?.kind ?? "steer");
    const id = options ? idSchema.parse(options.messageId) : null;
    // A literal prefix prevents slash-command expansion and gives native
    // user-message events an exact, per-operation correlation token.
    const message = id ? `Owner ${kind} ${id}:\n${parsed}` : parsed;
    if (id) current.messages.set(message, id);
    const result = z
      .object({ disposition: z.enum(["queued", "handled"]) })
      .parse(await current.rpc.request(kind, { message }));
    return result.disposition === "handled"
      ? ("sent" as const)
      : ("queued" as const);
  }
  async resume(_id: string, _input: ResumeInput): Promise<ManagedSession> {
    throw new DomainError(
      "UNSUPPORTED",
      `${resumeUnsupported.pi}; retained sessions require an owner recovery decision`,
    );
  }
  async respondToApproval(): Promise<void> {
    throw new DomainError(
      "UNSUPPORTED",
      "Pi file tools have no native per-call approval callback",
    );
  }
  async dispose(session: ManagedSession) {
    const active = this.active(session);
    try {
      await active.rpc.close();
      // Keep bounded wire headers, never arbitrary provider error bodies or
      // tool payloads. The native session transcript remains app-owned.
      await writeFile(
        join(
          this.directory,
          "pi-sessions",
          session.input.attemptId,
          "rpc-diagnostics.json",
        ),
        JSON.stringify(active.rpc.diagnostics),
        { mode: 0o600 },
      );
    } finally {
      // A failed diagnostic write is still reported, but the closed process
      // must not stay registered as a live session.
      this.sessions.delete(session.nativeSessionId);
    }
  }
  async exit(session: ManagedSession) {
    return this.active(session).rpc.close();
  }
}
