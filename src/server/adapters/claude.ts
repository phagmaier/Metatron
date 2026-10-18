import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AccountInfo, ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";
import { checkoutIdentity } from "../git/checkout-identity.ts";
import { ClaudeEvents } from "./claude-events.ts";
import {
  type Manifest,
  manifestSchema,
  saveClaudeManifest,
} from "./claude-manifest.ts";
import {
  type ClaudeAdapterOptions,
  type Launched,
  launchClaude,
} from "./claude-options.ts";
import type { ClaudeExit } from "./claude-process.ts";
import {
  type Active,
  cancelClaudeTurn,
  disposeClaudeTurn,
  promptClaudeTurn,
} from "./claude-turn.ts";
import {
  type AdapterCapabilities,
  type ApprovalDecision,
  type HarnessAdapter,
  type ManagedSession,
  type ResumeInput,
  type SessionEvent,
  type StartSessionInput,
  type SteeringOptions,
  startSessionSchema,
} from "./contract.ts";
import { AdapterQueue } from "./queue.ts";

export class ClaudeAdapter implements HarnessAdapter {
  private readonly directory: string;
  private readonly sessions = new Map<string, Active>();
  private readonly options: ClaudeAdapterOptions;
  constructor(directory: string, options: ClaudeAdapterOptions = {}) {
    this.directory = resolve(directory);
    this.options = options;
  }
  private async metadata(
    launched: Launched,
  ): Promise<{ models: ModelInfo[]; account: AccountInfo }> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const [models, account] = await Promise.race([
        Promise.all([
          launched.query.supportedModels(),
          launched.query.accountInfo(),
        ]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DomainError(
                  "UNSUPPORTED",
                  "Claude no-prompt initialization exceeded its bounded deadline",
                ),
              ),
            15000,
          );
        }),
      ]);
      return { models, account };
    } finally {
      clearTimeout(timer);
    }
  }
  async discover(): Promise<AdapterCapabilities> {
    const result: AdapterCapabilities = {
      adapter: "claude-code",
      installed: false,
      authenticated: false,
      models: [],
      supportsResume: true,
      supportsLiveSteer: false,
      supportsCancel: true,
      supportsPermissionPrompts: true,
      supportsToolGateway: true,
      diagnostics: [
        "Official Agent SDK with the installed Claude Code CLI and app-owned configuration. Owner-supplied setup-token, API key or supported cloud provider route; no personal credential files copied. Subscription SDK-product policy applicability requires owner/vendor resolution. Catalog presence does not prove entitlement.",
        "Exact file tools and optional app gateway only; no shell, delegation, discovered settings, plugins, skills or MCP servers. This is an application guard, not an OS sandbox. Resume accepts only clean app-owned same-checkout sessions; interrupted work is never replayed.",
      ],
    };
    let launched: Launched | undefined;
    try {
      launched = await launchClaude(
        this.directory,
        this.options,
        this.directory,
      );
      result.installed = true;
      const { models, account } = await this.metadata(launched);
      result.models = models.map((model) => ({
        id: model.value,
        label: model.displayName,
        thinking: (model.supportedEffortLevels ?? []).map((id) => ({
          id,
          label: id,
        })),
      }));
      const auth = this.authentication(launched, account);
      result.authenticated = auth.authenticated;
      result.diagnostics.push(auth.diagnostic);
    } catch {
      const auth = launched ? this.authentication(launched) : undefined;
      result.authenticated = auth?.authenticated ?? false;
      if (auth) result.diagnostics.push(auth.diagnostic);
      result.diagnostics.push(
        "AUTH_METADATA_UNAVAILABLE: Claude no-prompt discovery failed; verify the installed CLI and selected authentication route. Native error contents are redacted; no model prompt was submitted.",
      );
    } finally {
      if (launched) {
        launched.input.close();
        try {
          await launched.process.stop();
        } catch {
          result.diagnostics.push(
            "Owned Claude discovery subprocess did not confirm clean shutdown",
          );
        }
        launched.query.close();
      }
    }
    return result;
  }
  private authentication(
    launched: Launched,
    account?: AccountInfo,
  ): { authenticated: false | "unknown"; diagnostic: string } {
    // Classify the owned child's launch snapshot, never mutable host state.
    const env = launched.process.environment;
    const cloud = [
      ["CLAUDE_CODE_USE_BEDROCK", "bedrock"],
      ["CLAUDE_CODE_USE_VERTEX", "vertex"],
      ["CLAUDE_CODE_USE_FOUNDRY", "foundry"],
    ].find(([key]) => key && env[key] === "1")?.[1];
    const route =
      cloud ??
      (env.ANTHROPIC_API_KEY
        ? "api-key"
        : env.CLAUDE_CODE_OAUTH_TOKEN
          ? "setup-token"
          : undefined);
    if (!route)
      return {
        authenticated: false,
        diagnostic: launched.excludedAuthentication
          ? "AUTH_POLICY_UNSUPPORTED: an ambient bearer/profile route was excluded from the worker environment. Select owner-supplied setup-token or an approved API/cloud route; no model prompt was submitted."
          : "AUTH_ABSENT: privately supply CLAUDE_CODE_OAUTH_TOKEN from setup-token, ANTHROPIC_API_KEY or an approved Bedrock/Vertex/Foundry route to the app process. Ambient personal login and arbitrary bearer/profile routes are not admitted; no model prompt was submitted.",
      };
    const precedence =
      "Provider selection precedes API key; API key precedes setup-token. No credentials were removed to change billing.";
    if (!account)
      return {
        authenticated: "unknown",
        diagnostic: `AUTH_UNVERIFIED: configured ${route}; native account metadata unavailable. ${precedence}`,
      };
    const matches = cloud
      ? account.apiProvider === cloud
      : account.apiProvider === "firstParty" &&
        (route === "api-key"
          ? account.apiKeySource === "ANTHROPIC_API_KEY"
          : account.tokenSource === "CLAUDE_CODE_OAUTH_TOKEN");
    return {
      authenticated: matches ? "unknown" : false,
      diagnostic: matches
        ? `AUTH_UNVERIFIED: native metadata selects ${route}; model entitlement and quota remain untested. ${precedence}`
        : `AUTH_ROUTE_REJECTED: native metadata did not confirm configured ${route}; no model prompt was submitted. ${precedence}`,
    };
  }
  private async create(
    input: StartSessionInput,
    resumeId?: string,
  ): Promise<ManagedSession> {
    const data = startSessionSchema.parse(input);
    const keys = Object.keys(data.environment);
    let gatewayValid = false;
    if (data.toolEndpoint) {
      const url = new URL(data.toolEndpoint);
      gatewayValid =
        url.protocol === "http:" &&
        url.hostname === "127.0.0.1" &&
        !!url.port &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !url.search &&
        keys.length === 1 &&
        !!data.environment.LAO_GATEWAY_TOKEN;
    }
    if (
      !["read_only", "workspace_write"].includes(data.permission) ||
      (data.toolEndpoint ? !gatewayValid : keys.length !== 0) ||
      (!resumeId && data.contextPolicy === "resume")
    )
      throw new DomainError(
        "UNSUPPORTED",
        "Claude supports isolated file-tool workers with only the app loopback gateway overlay",
      );
    const identity = await checkoutIdentity(data.cwd);
    const sessionId = resumeId ? z.uuid().parse(resumeId) : randomUUID();
    await mkdir(join(this.directory, "claude-sessions"), {
      recursive: true,
      mode: 0o700,
    });
    const lock = join(this.directory, "claude-sessions", `${sessionId}.lock`);
    try {
      const handle = await open(lock, "wx", 0o600);
      await handle.close();
    } catch {
      throw new DomainError(
        "CONFLICT",
        "Claude native session is already owned or requires recovery",
      );
    }
    let launched: Launched | undefined;
    try {
      if (resumeId) {
        let previous: Manifest;
        try {
          previous = manifestSchema.parse(
            JSON.parse(
              await readFile(
                join(this.directory, "claude-sessions", `${sessionId}.json`),
                "utf8",
              ),
            ),
          );
        } catch {
          throw new DomainError(
            "POLICY_DENIED",
            "Claude resume requires an app-owned session manifest",
          );
        }
        if (
          !previous.clean ||
          previous.sessionId !== sessionId ||
          previous.runId !== data.runId ||
          previous.taskId !== data.taskId ||
          previous.cwd !== data.cwd ||
          previous.model !== data.model ||
          previous.thinking !== data.thinking ||
          previous.permission !== data.permission ||
          JSON.stringify(previous.identity) !== JSON.stringify(identity)
        )
          throw new DomainError(
            "POLICY_DENIED",
            "Claude resume requires a clean same-run/task/model/permission session in the original checkout; interrupted work is never replayed",
          );
      }
      // Probe without creating/resuming a persistent native conversation. The
      // validated model and effort are then applied to its sole owned launch.
      launched = await launchClaude(this.directory, this.options, data.cwd);
      const { models, account } = await this.metadata(launched);
      const model = models.find((model) => model.value === data.model);
      if (!model)
        throw new DomainError(
          "UNSUPPORTED",
          "Requested Claude model is absent from the native catalog",
        );
      const effort =
        data.thinking === null
          ? undefined
          : model.supportedEffortLevels?.find(
              (level) => level === data.thinking,
            );
      if (data.thinking !== null && !effort)
        throw new DomainError(
          "UNSUPPORTED",
          "Requested Claude effort is unsupported by this exact model",
        );
      const auth = this.authentication(launched, account);
      if (auth.authenticated === false)
        throw new DomainError("UNSUPPORTED", auth.diagnostic);
      launched.input.close();
      await launched.process.stop();
      launched.query.close();
      launched = await launchClaude(
        this.directory,
        this.options,
        data.cwd,
        data,
        sessionId,
        !!resumeId,
        effort,
      );
      const final = await this.metadata(launched);
      const configured = final.models.find(
        (candidate) => candidate.value === data.model,
      );
      if (
        !configured ||
        configured.resolvedModel !== model.resolvedModel ||
        (effort && !configured.supportedEffortLevels?.includes(effort)) ||
        this.authentication(launched, final.account).authenticated === false
      )
        throw new DomainError(
          "UNSUPPORTED",
          "Claude final no-prompt configuration did not match the validated model, effort or configured authentication route",
        );
      const managed: ManagedSession = {
        adapter: "claude-code",
        nativeSessionId: sessionId,
        input: data,
        ...(launched.process.pid ? { processId: launched.process.pid } : {}),
      };
      const manifest: Manifest = {
        version: 1,
        sessionId,
        clean: false,
        runId: data.runId,
        taskId: data.taskId,
        cwd: data.cwd,
        model: data.model,
        thinking: data.thinking,
        permission: data.permission,
        identity,
      };
      await saveClaudeManifest(this.directory, manifest);
      let resolveReady: ((ready: boolean) => void) | undefined;
      const ready = new Promise<boolean>((resolve) => {
        resolveReady = resolve;
      });
      const current: Active = {
        query: launched.query,
        process: launched.process,
        input: launched.input,
        abort: launched.abort,
        events: new AdapterQueue(),
        mapper: new ClaudeEvents(
          sessionId,
          data.cwd,
          new Set([
            model.value,
            ...(model.resolvedModel ? [model.resolvedModel] : []),
          ]),
          data.thinking,
          new Set(launched.allTools),
          !!data.toolEndpoint,
        ),
        managed,
        manifest,
        lock,
        ready,
        resolveReady,
        pending: new Map(),
        seenRequests: new Set(),
        used: false,
        busy: false,
        cancelled: false,
        closed: false,
        fault: false,
        diagnostics: [],
      };
      void current.process.exit.then(() => {
        current.resolveReady?.(false);
      });
      launched.bind(current);
      this.sessions.set(sessionId, current);
      return managed;
    } catch (error) {
      if (launched) {
        launched.input.close();
        try {
          await launched.process.stop();
        } finally {
          launched.query.close();
        }
      }
      await unlink(lock);
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "UNSUPPORTED",
        "Claude session initialization failed; native details are redacted",
      );
    }
  }
  async startSession(input: StartSessionInput): Promise<ManagedSession> {
    return this.create(input);
  }
  async resume(id: string, input: ResumeInput): Promise<ManagedSession> {
    return this.create(input, id);
  }
  private active(session: ManagedSession): Active {
    const current = this.sessions.get(session.nativeSessionId);
    if (!current || current.managed !== session)
      throw new DomainError(
        "CONFLICT",
        "Claude session identity is not owned by this adapter",
      );
    return current;
  }
  prompt(session: ManagedSession, text: string): AsyncIterable<SessionEvent> {
    return promptClaudeTurn(this.directory, this.active(session), text);
  }
  async steer(
    session: ManagedSession,
    _text: string,
    _options?: SteeringOptions,
  ): Promise<"unsupported"> {
    this.active(session);
    return "unsupported";
  }
  async respondToApproval(
    session: ManagedSession,
    id: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const current = this.active(session);
    const pending = current.pending.get(id);
    if (
      !pending ||
      !current.busy ||
      current.cancelled ||
      current.abort.signal.aborted ||
      current.closed ||
      !["approve", "deny"].includes(decision)
    )
      throw new DomainError(
        "CONFLICT",
        "Claude approval is wrong-session, stale, or already consumed",
      );
    pending.finish(decision === "approve");
  }
  async cancel(session: ManagedSession): Promise<void> {
    await cancelClaudeTurn(this.active(session));
  }
  async exit(session: ManagedSession): Promise<ClaudeExit> {
    const current = this.active(session);
    if (current.busy) await cancelClaudeTurn(current);
    return current.process.stop();
  }
  diagnostics(session: ManagedSession): string[] {
    const current = this.active(session);
    return [...current.diagnostics, ...current.mapper.diagnostics()];
  }
  async dispose(session: ManagedSession): Promise<void> {
    await disposeClaudeTurn(this.active(session));
    this.sessions.delete(session.nativeSessionId);
  }
}
