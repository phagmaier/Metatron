import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type {
  ModelInfo,
  Options,
  PermissionResult,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ClaudeSpawn } from "../../src/server/adapters/claude-process.ts";
import type { ClaudeQueryFactory } from "../../src/server/adapters/claude-turn.ts";

export type ClaudeFixtureContext = {
  sessionId: string;
  cwd: string;
  model: string;
  options: Options;
  header: (
    type: string,
    fields?: Record<string, unknown>,
  ) => Record<string, unknown>;
  result: (fields?: Record<string, unknown>) => Record<string, unknown>;
  tool: (
    name: string,
    input: Record<string, unknown>,
    autoAllowed?: boolean,
  ) => Promise<PermissionResult>;
  exited: Promise<void>;
};
export type ClaudeFixtureScript = (
  context: ClaudeFixtureContext,
) => AsyncIterable<unknown>;
export type ClaudeSdkFixtureOptions = {
  exitCode?: number;
  script?: ClaudeFixtureScript;
  models?: ModelInfo[];
  stubborn?: boolean;
  earlyTool?: (context: ClaudeFixtureContext) => Promise<PermissionResult>;
};
export function claudeSdkFixture(config: ClaudeSdkFixtureOptions = {}) {
  const decisions: PermissionResult[] = [];
  const prompts: string[] = [];
  const submitted: SDKUserMessage[] = [];
  const pids: number[] = [];
  const controllers: AbortController[] = [];
  const spawnChild: ClaudeSpawn = (options) => {
    // A real, inert owned child supplies authoritative exit evidence, without
    // launching Claude or making network/model requests.
    const source = options.args.includes("--fixture-stubborn")
      ? "process.on('SIGTERM', () => {}); process.stdin.resume(); setInterval(() => {}, 1000);"
      : `process.stdin.resume(); process.stdin.on('end', () => process.exit(${config.exitCode ?? 0}));`;
    const child = spawn(process.execPath, ["-e", source], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });
    child.stderr.resume();
    if (child.pid) pids.push(child.pid);
    return child;
  };
  const factory: ClaudeQueryFactory = ({ prompt, options }) => {
    if (options.abortController) controllers.push(options.abortController);
    if (!options.spawnClaudeCodeProcess)
      throw new Error("Fixture needs the owned-process seam");
    if (!options.cwd)
      throw new Error(
        "SDK fixture requires an explicit disposable working directory",
      );
    const child = options.spawnClaudeCodeProcess({
      command: process.execPath,
      args:
        config.stubborn && options.persistSession ? ["--fixture-stubborn"] : [],
      cwd: options.cwd,
      env: options.env ?? {},
      signal: options.abortController?.signal ?? new AbortController().signal,
    });
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    const models: ModelInfo[] = config.models ?? [
      {
        value: "fixture-sonnet",
        resolvedModel: "fixture-sonnet-20261017",
        displayName: "Fixture Sonnet",
        description: "Deterministic protocol fixture",
        supportsEffort: true,
        supportedEffortLevels: ["high", "max"],
      },
    ];
    return {
      supportedModels: async () => models,
      accountInfo: async () => ({
        apiProvider: "firstParty",
        apiKeySource: "ANTHROPIC_API_KEY",
      }),
      close: () => {},
      async *[Symbol.asyncIterator]() {
        for await (const message of prompt) {
          const sessionId = options.resume ?? options.sessionId ?? randomUUID();
          const cwd = options.cwd ?? "";
          const model = options.model ?? models[0]?.value ?? "";
          const header = (
            type: string,
            fields: Record<string, unknown> = {},
          ) => ({
            type,
            session_id: sessionId,
            parent_tool_use_id: null,
            uuid: randomUUID(),
            ...fields,
          });
          const result = (fields: Record<string, unknown> = {}) =>
            header("result", {
              subtype: "success",
              is_error: false,
              usage: { input_tokens: 11, output_tokens: 7 },
              ...fields,
            });
          prompts.push(
            typeof message.message.content === "string"
              ? message.message.content
              : "structured fixture input",
          );
          submitted.push(message);
          const tool = async (
            name: string,
            input: Record<string, unknown>,
            autoAllowed = false,
          ): Promise<PermissionResult> => {
            const toolUseID = randomUUID();
            let ask = !autoAllowed;
            for (const matcher of options.hooks?.PreToolUse ?? []) {
              for (const hook of matcher.hooks) {
                const output = await hook(
                  {
                    hook_event_name: "PreToolUse",
                    session_id: sessionId,
                    cwd,
                    transcript_path: "fixture-owned",
                    tool_name: name,
                    tool_input: input,
                    tool_use_id: toolUseID,
                  },
                  toolUseID,
                  {
                    signal:
                      options.abortController?.signal ??
                      new AbortController().signal,
                  },
                );
                const parsed = z
                  .object({
                    hookSpecificOutput: z
                      .object({
                        permissionDecision: z
                          .enum(["allow", "deny", "ask"])
                          .optional(),
                      })
                      .optional(),
                  })
                  .parse(output);
                if (parsed.hookSpecificOutput?.permissionDecision === "deny") {
                  const denied: PermissionResult = {
                    behavior: "deny",
                    message: "Fixture native hook denied request",
                  };
                  decisions.push(denied);
                  return denied;
                }
                if (parsed.hookSpecificOutput?.permissionDecision === "ask")
                  ask = true;
              }
            }
            const decision =
              ask && options.canUseTool
                ? await options.canUseTool(name, input, {
                    signal:
                      options.abortController?.signal ??
                      new AbortController().signal,
                    toolUseID,
                    requestId: randomUUID(),
                  })
                : { behavior: "allow" as const };
            const resolved: PermissionResult = decision ?? {
              behavior: "deny",
              message: "Fixture missing permission response",
            };
            decisions.push(resolved);
            if (
              resolved.behavior === "allow" &&
              name === "Write" &&
              typeof input.file_path === "string" &&
              typeof input.content === "string"
            )
              await writeFile(input.file_path, input.content);
            return resolved;
          };
          const context: ClaudeFixtureContext = {
            sessionId,
            cwd,
            model,
            options,
            header,
            result,
            tool,
            exited,
          };
          const early = config.earlyTool?.(context);
          yield header("system", {
            subtype: "init",
            cwd,
            model,
            permissionMode: "default",
            effort: options.effort ?? null,
            tools: Array.isArray(options.tools) ? options.tools : [],
            skills: [],
            plugins: [],
            mcp_servers: options.mcpServers?.lao
              ? [{ name: "lao", status: "connected", source: "dynamic" }]
              : [],
          });
          if (early) await early;
          if (config.script) yield* config.script(context);
          else {
            yield header("stream_event", {
              event: {
                type: "message_start",
                message: { id: "assistant-1", model },
              },
            });
            yield header("stream_event", {
              event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: " \nHello " },
              },
            });
            yield header("assistant", {
              message: {
                id: "assistant-1",
                model,
                content: [{ type: "text", text: " \nHello " }],
              },
            });
            yield result();
          }
          return;
        }
      },
    };
  };
  return {
    factory,
    spawn: spawnChild,
    prompts,
    submitted,
    decisions,
    pids,
    abort: () => {
      for (const controller of controllers) controller.abort();
    },
  };
}
