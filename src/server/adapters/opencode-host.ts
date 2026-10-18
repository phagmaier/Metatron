import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";
import { findExecutable } from "./availability.ts";
import type { StartSessionInput } from "./contract.ts";

export type OpenCodeExit = {
  code: number | null;
  signal: string | null;
  expected: boolean;
};
export type OpenCodeHostOptions = {
  executable?: string;
  spawn?: (
    executable: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => ChildProcessWithoutNullStreams;
};
// The only provider credentials forwarded to the app-owned server.
export const openCodeProviderKeys = [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
];
export const openCodeGatewayTools = [
  "read_assignment",
  "report_progress",
  "submit_result",
  "report_issue",
  "request_human_action",
];
export function openCodeRules(permission: string, gateway: boolean) {
  return [
    { action: "*", resource: "*", effect: "deny" as const },
    ...[
      "read",
      "glob",
      "grep",
      ...(permission === "workspace_write" ? ["edit"] : []),
      ...(gateway ? openCodeGatewayTools.map((name) => `lao_${name}`) : []),
    ].map((action) => ({ action, resource: "*", effect: "ask" as const })),
  ];
}
const serverInfo = z.object({
  version: z.string(),
  pid: z.int().positive(),
  urls: z.array(z.string()),
});

export class OpenCodeHost {
  readonly directory: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<OpenCodeExit>;
  private stopping = false;
  private stopPromise: Promise<OpenCodeExit> | undefined;
  private exitEvidence: OpenCodeExit | undefined;
  private constructor(
    directory: string,
    child: ChildProcessWithoutNullStreams,
  ) {
    this.directory = directory;
    this.child = child;
    const exit = Promise.withResolvers<OpenCodeExit>();
    this.exited = exit.promise;
    child.once("exit", (code, signal) => {
      this.exitEvidence = {
        code,
        signal,
        expected:
          this.stopping && (code === 0 || code === 130) && signal === null,
      };
      exit.resolve(this.exitEvidence);
    });
    child.once("error", () => {
      if (!child.pid) {
        this.exitEvidence = { code: null, signal: null, expected: false };
        exit.resolve(this.exitEvidence);
      }
    });
  }
  static async launch(
    directory: string,
    options: OpenCodeHostOptions = {},
    input?: StartSessionInput,
  ): Promise<{
    host: OpenCodeHost;
    client: OpenCodeClient;
    version: string;
    url: string;
  }> {
    const root = resolve(directory);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const executable = await realpath(
      await findExecutable("opencode", "OpenCode", options.executable),
    );
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "PATH",
      "LANG",
      "LC_ALL",
      "TMPDIR",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY",
      ...openCodeProviderKeys,
    ])
      if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_STATE_HOME: join(root, "state"),
      XDG_CACHE_HOME: join(root, "cache"),
      OPENCODE_CONFIG_DIR: join(root, "config", "opencode"),
      OPENCODE_CONFIG_PROJECT_DISABLE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_FILEWATCHER_DISABLE: "1",
    });
    if (input?.toolEndpoint)
      env.LAO_GATEWAY_TOKEN = input.environment.LAO_GATEWAY_TOKEN;
    await mkdir(env.OPENCODE_CONFIG_DIR ?? "", {
      recursive: true,
      mode: 0o700,
    });
    const rules = openCodeRules(
      input?.permission ?? "read_only",
      !!input?.toolEndpoint,
    );
    const allowActions = rules
      .filter((rule) => rule.effect === "ask")
      .map((rule) => rule.action);
    await writeFile(
      join(env.OPENCODE_CONFIG_DIR ?? "", "opencode.json"),
      JSON.stringify({
        update: "disable",
        share: "disabled",
        snapshots: false,
        formatter: false,
        warming: false,
        compaction: { auto: false },
        default_agent: "metatron",
        // Project discovery is disabled independently; these disable automatic native context/code execution.
        plugins: [
          "*",
          "-opencode.config.instruction",
          "-opencode.config.location-watcher",
          "-opencode.warming",
          "-opencode.tools",
          "-opencode.tools.mcp-resources",
          "-opencode.browser",
        ],
        policies: [
          { action: "tool.use", resource: "*", effect: "deny" },
          ...allowActions.map((action) => ({
            action: "tool.use",
            resource: `${action}:*`,
            effect: "allow",
          })),
          { action: "integration.use", resource: "skill:*", effect: "deny" },
          { action: "integration.use", resource: "mcp:*", effect: "deny" },
          ...(input?.toolEndpoint
            ? [
                {
                  action: "integration.use",
                  resource: "mcp:lao",
                  effect: "allow",
                },
              ]
            : []),
        ],
        permissions: rules,
        agents: {
          metatron: {
            mode: "primary",
            steps: 12,
            system:
              input?.roleInstructions ??
              "Discover native metadata only; no model request.",
            permissions: rules,
          },
          title: { disabled: true },
          summary: { disabled: true },
          compaction: { disabled: true },
        },
        ...(input?.toolEndpoint
          ? {
              mcp: {
                servers: {
                  lao: {
                    type: "remote",
                    url: input.toolEndpoint,
                    oauth: false,
                    codemode: false,
                    headers: {
                      Authorization: "Bearer {env:LAO_GATEWAY_TOKEN}",
                    },
                  },
                },
              },
            }
          : {}),
      }),
      { mode: 0o600 },
    );
    const factory =
      options.spawn ??
      ((command, args, settings) =>
        spawn(command, args, { ...settings, stdio: "pipe", detached: false }));
    const child = factory(
      executable,
      ["serve", "--hostname", "127.0.0.1", "--port", "0"],
      { cwd: root, env },
    );
    const host = new OpenCodeHost(root, child);
    child.stderr.resume();
    try {
      const ready = Promise.withResolvers<{ url: string; password: string }>();
      let text = "";
      const timer = setTimeout(
        () =>
          finish(
            new DomainError(
              "UNSUPPORTED",
              "OpenCode private server startup timed out",
            ),
          ),
        15000,
      );
      const finish = (
        error?: Error,
        endpoint?: { url: string; password: string },
      ) => {
        clearTimeout(timer);
        child.stdout.off("data", data);
        child.off("error", failed);
        child.off("exit", ended);
        if (error) ready.reject(error);
        else if (endpoint) ready.resolve(endpoint);
      };
      const failed = () =>
        finish(
          new DomainError(
            "UNSUPPORTED",
            "OpenCode private process could not start; native details redacted",
          ),
        );
      const ended = () =>
        finish(
          new DomainError(
            "UNSUPPORTED",
            "OpenCode exited before authenticating its private server",
          ),
        );
      const data = (chunk: Buffer) => {
        text += chunk.toString("utf8");
        if (text.length > 8192)
          return finish(
            new DomainError(
              "UNSUPPORTED",
              "OpenCode startup exceeded its bounded control output",
            ),
          );
        const url =
          /^server listening on (http:\/\/127\.0\.0\.1:\d+)\r?\n/m.exec(
            text,
          )?.[1];
        const password = /^server password (\S+)\r?\n/m.exec(text)?.[1];
        if (url && password) {
          text = "";
          finish(undefined, { url, password });
        }
      };
      child.stdout.on("data", data);
      child.once("error", failed);
      child.once("exit", ended);
      const endpoint = await ready.promise;
      // No browser receives this password or native URL; native CORS is not authentication.
      child.stdout.resume();
      const client = OpenCode.make({
        baseUrl: endpoint.url,
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString("base64")}`,
        },
        fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
      });
      const info = serverInfo.parse(
        await client.server.info({ signal: AbortSignal.timeout(5000) }),
      );
      if (
        info.pid !== child.pid ||
        info.urls.some((url) => new URL(url).hostname !== "127.0.0.1")
      )
        throw new DomainError(
          "POLICY_DENIED",
          "OpenCode server identity or loopback scope was not confirmed",
        );
      // v2.0.29 serves HTTP before its per-location plugins/configuration finish activating.
      // A listening socket/catalog is not permission-policy readiness; never prompt before this barrier.
      const location = { directory: input?.cwd ?? root };
      const required = [
        "opencode.config.agent",
        "opencode.config.policy",
        "opencode.config.provider",
        "opencode.tool.read",
        "opencode.tool.glob",
        "opencode.tool.grep",
        ...(input?.permission === "workspace_write"
          ? ["opencode.tool.edit", "opencode.tool.write"]
          : []),
        ...(input?.toolEndpoint ? ["opencode.config.mcp"] : []),
      ];
      const disabled = [
        "opencode.config.instruction",
        "opencode.config.location-watcher",
        "opencode.warming",
        "opencode.tools",
        "opencode.tools.mcp-resources",
        "opencode.browser",
      ];
      const deadline = Date.now() + 10000;
      let configured = false;
      while (Date.now() < deadline) {
        const report = await client.plugin.list(
          { location },
          { signal: AbortSignal.timeout(5000) },
        );
        if (
          report.data.some(
            (plugin) =>
              plugin.source.type !== "builtin" ||
              (plugin.state.status === "active" &&
                disabled.includes(plugin.id ?? "")),
          )
        )
          throw new DomainError(
            "POLICY_DENIED",
            "OpenCode loaded an unexpected customization or unsafe builtin",
          );
        if (
          report.data.some(
            (plugin) =>
              required.includes(plugin.id ?? "") &&
              plugin.state.status !== "active",
          )
        )
          throw new DomainError(
            "UNSUPPORTED",
            "A required native OpenCode policy/file plugin did not activate",
          );
        if (
          required.every((id) =>
            report.data.some(
              (plugin) => plugin.id === id && plugin.state.status === "active",
            ),
          )
        ) {
          const agent = (
            await client.agent.get(
              { agentID: "metatron", location },
              { signal: AbortSignal.timeout(5000) },
            )
          ).data;
          if (
            agent.system !==
              (input?.roleInstructions ??
                "Discover native metadata only; no model request.") ||
            JSON.stringify(agent.permissions.slice(-rules.length)) !==
              JSON.stringify(rules)
          )
            throw new DomainError(
              "POLICY_DENIED",
              "OpenCode did not apply the app-owned worker instructions/permissions",
            );
          configured = true;
          break;
        }
        await delay(100);
      }
      if (!configured)
        throw new DomainError(
          "UNSUPPORTED",
          "OpenCode app-owned plugin/configuration activation timed out; no prompt submitted",
        );
      return { host, client, version: info.version, url: endpoint.url };
    } catch (error) {
      await host.stop();
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "UNSUPPORTED",
        "OpenCode private initialization failed; native details redacted",
      );
    }
  }
  stop(): Promise<OpenCodeExit> {
    this.stopPromise ??= this.shutdown();
    return this.stopPromise;
  }
  private async shutdown(): Promise<OpenCodeExit> {
    this.stopping = true;
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      if (this.exitEvidence) break;
      this.child.kill(signal);
      const delay = Promise.withResolvers<void>();
      const timer = setTimeout(delay.resolve, 3000);
      await Promise.race([this.exited, delay.promise]);
      clearTimeout(timer);
    }
    if (!this.exitEvidence)
      throw new DomainError(
        "CONFLICT",
        "Owned OpenCode server did not confirm exit; inspection required",
      );
    return this.exitEvidence;
  }
}
