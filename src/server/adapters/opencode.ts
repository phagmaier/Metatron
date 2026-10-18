import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";
import { checkoutIdentity } from "../git/checkout-identity.ts";
import type {
  AdapterCapabilities,
  ApprovalDecision,
  HarnessAdapter,
  ManagedSession,
  ResumeInput,
  SessionEvent,
  StartSessionInput,
} from "./contract.ts";
import { startSessionSchema } from "./contract.ts";
import { OpenCodeEvents } from "./opencode-events.ts";
import {
  OpenCodeHost,
  type OpenCodeHostOptions,
  openCodeRules,
} from "./opencode-host.ts";
import { inspectOpenCodePermission } from "./opencode-permissions.ts";
import {
  openCodeId,
  openCodeManifest,
  openCodeSession,
  saveOpenCodeManifest,
} from "./opencode-state.ts";
import {
  cancelOpenCodeTurn,
  type OpenCodeActive,
  promptOpenCodeTurn,
  releaseOpenCodeLease,
  requireOpenCodeIdle,
  validateOpenCodeIdentity,
} from "./opencode-turn.ts";
import { AdapterQueue } from "./queue.ts";

const catalog = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      providerID: z.string().min(1),
      name: z.string(),
      enabled: z.boolean(),
      variants: z.array(z.object({ id: z.string().min(1) })),
    }),
  ),
});
export class OpenCodeAdapter implements HarnessAdapter {
  private readonly directory: string;
  private readonly options: OpenCodeHostOptions;
  private readonly sessions = new Map<string, OpenCodeActive>();
  constructor(directory: string, options: OpenCodeHostOptions = {}) {
    this.directory = resolve(directory);
    this.options = options;
  }
  async discover(): Promise<AdapterCapabilities> {
    const result: AdapterCapabilities = {
      adapter: "opencode",
      installed: false,
      authenticated: false,
      models: [],
      supportsResume: true,
      supportsCancel: true,
      supportsPermissionPrompts: true,
      supportsLiveSteer: false,
      supportsToolGateway: true,
      diagnostics: [
        "Official OpenCode v2 HTTP client and an app-owned password-protected loopback server; personal service/config/sessions are not reused. Provider access remains unknown until a native turn succeeds.",
        "File-tool workers only, every allowed operation asks the app for path/checkout validation; no shell, delegation, Code Mode, browser or discovered project customization. These are application guards, not an OS sandbox.",
        "Approve grants one native request. OpenCode reject affects every pending request in that session, so denial also stops the owned turn. No persistent native approvals or automatic replay; live-only stream loss requires recovery. Resume is clean same-checkout only.",
      ],
    };
    let host: OpenCodeHost | undefined;
    let probe: string | undefined;
    try {
      await mkdir(join(this.directory, "opencode-hosts"), {
        recursive: true,
        mode: 0o700,
      });
      probe = await mkdtemp(join(this.directory, "opencode-hosts", "probe-"));
      const launched = await OpenCodeHost.launch(probe, this.options);
      host = launched.host;
      result.installed = true;
      const models = catalog
        .parse(
          await launched.client.model.list(
            { location: { directory: probe } },
            { signal: AbortSignal.timeout(10000) },
          ),
        )
        .data.filter((model) => model.enabled);
      result.models = models.map((model) => ({
        id: `${model.providerID}/${model.id}`,
        label: `${model.name} (${model.providerID})`,
        thinking: model.variants.map((variant) => ({
          id: variant.id,
          label: variant.id,
        })),
      }));
      result.authenticated = models.length ? "unknown" : false;
      result.diagnostics.push(
        `Installed OpenCode ${launched.version}; native model/variant catalog is not entitlement or price authorization.`,
      );
      if (!models.length)
        result.diagnostics.push(
          "AUTH_REQUIRED: configure an app-owned supported OpenCode provider route; no model prompt was submitted",
        );
    } catch (error) {
      result.diagnostics.push(
        `OpenCode no-model discovery failed (${error instanceof DomainError ? error.code : "NATIVE_CONTROL"}); native details redacted. Check installed v2 CLI and app-owned provider configuration.`,
      );
    } finally {
      if (host) {
        try {
          await host.stop();
        } catch {
          result.diagnostics.push(
            "Owned OpenCode server exit is uncertain; inspect app-owned process state",
          );
          probe = undefined;
        }
      }
      if (probe) await rm(probe, { recursive: true });
    }
    return result;
  }
  private active(session: ManagedSession) {
    const current = this.sessions.get(session.nativeSessionId);
    if (!current || current.managed !== session)
      throw new DomainError(
        "CONFLICT",
        "OpenCode session is not owned by this adapter instance",
      );
    return current;
  }
  private async create(
    input: StartSessionInput,
    resumeId?: string,
  ): Promise<ManagedSession> {
    const data = startSessionSchema.parse(input);
    const keys = Object.keys(data.environment);
    let gateway = false;
    if (data.toolEndpoint) {
      const url = new URL(data.toolEndpoint);
      gateway =
        url.protocol === "http:" &&
        url.hostname === "127.0.0.1" &&
        !!url.port &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        keys.length === 1 &&
        !!data.environment.LAO_GATEWAY_TOKEN;
    }
    if (
      !["read_only", "workspace_write"].includes(data.permission) ||
      (data.toolEndpoint ? !gateway : keys.length !== 0) ||
      (!resumeId && data.contextPolicy === "resume")
    )
      throw new DomainError(
        "UNSUPPORTED",
        "OpenCode accepts only file-worker profiles and an app loopback gateway overlay",
      );
    const identity = await checkoutIdentity(data.cwd);
    const hosts = join(this.directory, "opencode-hosts");
    const manifests = join(this.directory, "opencode-sessions");
    await mkdir(hosts, { recursive: true, mode: 0o700 });
    await mkdir(manifests, { recursive: true, mode: 0o700 });
    let previous: z.infer<typeof openCodeManifest> | undefined;
    let serverDirectory: string;
    let lock: string | undefined;
    let host: OpenCodeHost | undefined;
    try {
      if (resumeId) {
        openCodeId.parse(resumeId);
        previous = openCodeManifest.parse(
          JSON.parse(
            await readFile(join(manifests, `${resumeId}.json`), "utf8"),
          ),
        );
        if (
          !previous.clean ||
          previous.nativeSessionId !== resumeId ||
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
            "OpenCode resume requires a clean same-run/task/model/permission checkout; interrupted work never replays",
          );
        serverDirectory = previous.serverDirectory;
        if (
          dirname(serverDirectory) !== hosts ||
          !basename(serverDirectory).startsWith("owned-") ||
          (await realpath(serverDirectory)) !== serverDirectory
        )
          throw new DomainError(
            "POLICY_DENIED",
            "OpenCode resume does not own the retained private server state",
          );
        const candidate = join(manifests, `${resumeId}.lock`);
        const handle = await open(candidate, "wx", 0o600);
        await handle.close();
        lock = candidate;
      } else serverDirectory = await mkdtemp(join(hosts, "owned-"));
      const launched = await OpenCodeHost.launch(
        serverDirectory,
        this.options,
        data,
      );
      host = launched.host;
      const models = catalog.parse(
        await launched.client.model.list(
          { location: { directory: data.cwd } },
          { signal: AbortSignal.timeout(10000) },
        ),
      ).data;
      const selected = models.find(
        (model) =>
          model.enabled && `${model.providerID}/${model.id}` === data.model,
      );
      if (
        !selected ||
        (data.thinking !== null &&
          !selected.variants.some((variant) => variant.id === data.thinking))
      )
        throw new DomainError(
          "UNSUPPORTED",
          "Requested OpenCode model/variant is not enabled in native discovery; no prompt submitted",
        );
      const model = {
        id: selected.id,
        providerID: selected.providerID,
        ...(data.thinking !== null ? { variant: data.thinking } : {}),
      };
      const session = openCodeSession.parse(
        resumeId
          ? await launched.client.session.get(
              { sessionID: resumeId },
              { signal: AbortSignal.timeout(5000) },
            )
          : await launched.client.session.create(
              {
                location: { directory: data.cwd },
                agent: "metatron",
                model,
                permissions: openCodeRules(data.permission, gateway),
              },
              { signal: AbortSignal.timeout(10000) },
            ),
      );
      if (resumeId && session.id !== resumeId)
        throw new DomainError(
          "POLICY_DENIED",
          "OpenCode resumed a foreign native session",
        );
      if (gateway) {
        await launched.client.mcp.connect(
          { server: "lao", location: { directory: data.cwd } },
          { signal: AbortSignal.timeout(10000) },
        );
        const servers = z
          .object({
            data: z.array(
              z.object({
                name: z.string(),
                status: z.object({ status: z.string() }),
              }),
            ),
          })
          .parse(
            await launched.client.mcp.list(
              { location: { directory: data.cwd } },
              { signal: AbortSignal.timeout(5000) },
            ),
          );
        if (
          servers.data
            .filter((server) => server.status.status === "connected")
            .some((server) => server.name !== "lao") ||
          !servers.data.some(
            (server) =>
              server.name === "lao" && server.status.status === "connected",
          )
        )
          throw new DomainError(
            "POLICY_DENIED",
            "OpenCode worker gateway did not connect with the expected isolated identity",
          );
      }
      if (!lock) {
        const candidate = join(manifests, `${session.id}.lock`);
        const handle = await open(candidate, "wx", 0o600);
        await handle.close();
        lock = candidate;
      }
      const managed: ManagedSession = {
        adapter: "opencode",
        nativeSessionId: session.id,
        input: data,
        ...(host.child.pid ? { processId: host.child.pid } : {}),
        transcriptPath: serverDirectory,
      };
      const manifest = openCodeManifest.parse({
        version: 1,
        nativeSessionId: session.id,
        serverDirectory,
        clean: false,
        runId: data.runId,
        taskId: data.taskId,
        cwd: data.cwd,
        model: data.model,
        thinking: data.thinking,
        permission: data.permission,
        identity,
      });
      const current: OpenCodeActive = {
        managed,
        host,
        client: launched.client,
        manifest,
        mapper: new OpenCodeEvents(session.id, data.cwd, model),
        events: new AdapterQueue(),
        streamAbort: new AbortController(),
        pending: new Map(),
        seenPermissions: new Set(),
        replies: new Set(),
        used: false,
        busy: false,
        cancelled: false,
        closed: false,
        fault: false,
        lock,
        directory: this.directory,
        interruptConfirmed: false,
      };
      await validateOpenCodeIdentity(current);
      if (resumeId && session.outcome !== "succeeded")
        throw new DomainError(
          "POLICY_DENIED",
          "OpenCode native session was not authoritatively successful before resume",
        );
      await requireOpenCodeIdle(current);
      await saveOpenCodeManifest(this.directory, manifest);
      this.sessions.set(session.id, current);
      return managed;
    } catch (error) {
      if (host) await host.stop();
      if (lock) await unlink(lock).catch(() => {});
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "UNSUPPORTED",
        "OpenCode native session initialization failed; details redacted; no automatic replay",
      );
    }
  }
  async startSession(input: StartSessionInput) {
    return this.create(input);
  }
  async resume(nativeSessionId: string, input: ResumeInput) {
    return this.create(input, nativeSessionId);
  }
  prompt(session: ManagedSession, text: string): AsyncIterable<SessionEvent> {
    return promptOpenCodeTurn(this.active(session), text);
  }
  async steer(): Promise<"unsupported"> {
    return "unsupported";
  }
  async cancel(session: ManagedSession) {
    await cancelOpenCodeTurn(this.active(session));
  }
  async respondToApproval(
    session: ManagedSession,
    id: string,
    decision: ApprovalDecision,
  ) {
    const current = this.active(session);
    const previous = current.pending.get(id);
    if (
      !previous ||
      current.cancelled ||
      current.closed ||
      !current.busy ||
      current.fault
    )
      throw new DomainError(
        "CONFLICT",
        "OpenCode permission is stale or no longer pending",
      );
    await validateOpenCodeIdentity(current);
    const request = await current.client.permission.get(
      { sessionID: session.nativeSessionId, requestID: id },
      { signal: AbortSignal.timeout(5000) },
    );
    const bound = await inspectOpenCodePermission(
      current.client,
      session,
      request,
    );
    current.mapper.checkModel(bound.model);
    if (
      JSON.stringify(bound.request) !== JSON.stringify(previous.request) ||
      JSON.stringify(bound.input) !== JSON.stringify(previous.input) ||
      current.cancelled ||
      current.closed ||
      current.fault
    )
      throw new DomainError(
        "POLICY_DENIED",
        "OpenCode pending operation changed while owner consent was awaited",
      );
    current.pending.delete(id);
    if (decision === "deny") {
      current.cancelled = true;
      current.pending.clear();
    }
    const delivery = current.client.permission.reply(
      {
        sessionID: session.nativeSessionId,
        requestID: id,
        decision: decision === "deny" ? "reject" : "once",
      },
      { signal: AbortSignal.timeout(5000) },
    );
    current.replies.add(delivery);
    try {
      await delivery;
    } finally {
      current.replies.delete(delivery);
      if (decision === "deny") await cancelOpenCodeTurn(current);
    }
  }
  async exit(session: ManagedSession) {
    return this.active(session).host.stop();
  }
  evidence(session: ManagedSession) {
    const current = this.active(session);
    return {
      modelRefs: current.mapper.modelEvidence,
      interruptConfirmed: current.interruptConfirmed,
    };
  }
  diagnostics(session: ManagedSession) {
    const current = this.active(session);
    return [
      current.mapper.modelVerified
        ? "Native OpenCode model/variant verified"
        : "Native OpenCode model/variant not yet verified",
      "Private loopback server; no OS sandbox or automatic replay",
    ];
  }
  async dispose(session: ManagedSession) {
    if (!this.sessions.has(session.nativeSessionId)) return;
    const current = this.active(session);
    if (current.busy) await cancelOpenCodeTurn(current);
    current.closed = true;
    current.pending.clear();
    current.streamAbort.abort();
    await current.host.stop();
    await current.done;
    await releaseOpenCodeLease(current);
    this.sessions.delete(session.nativeSessionId);
  }
}
