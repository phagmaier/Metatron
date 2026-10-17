import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type EffortLevel,
  type Options,
  type PermissionResult,
  query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";
import { checkClaudeTool } from "./claude-policy.ts";
import {
  ClaudeInput,
  ClaudeProcess,
  type ClaudeSpawn,
  claudeExecutable,
  spawnClaude,
} from "./claude-process.ts";
import {
  type Active,
  type ClaudeQuery,
  type ClaudeQueryFactory,
  claudeInitialized,
  sameClaudeCheckout,
} from "./claude-turn.ts";
import type { StartSessionInput } from "./contract.ts";

export type ClaudeAdapterOptions = {
  query?: ClaudeQueryFactory;
  spawn?: ClaudeSpawn;
  executable?: string;
};
export type Launched = {
  query: ClaudeQuery;
  process: ClaudeProcess;
  input: ClaudeInput<SDKUserMessage>;
  abort: AbortController;
  allTools: string[];
  bind: (current: Active) => void;
};
const gatewayTools = [
  "read_assignment",
  "report_progress",
  "submit_result",
  "report_issue",
  "request_human_action",
].map((name) => `mcp__lao__${name}`);

function claudeEnvironment(directory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Do not inherit Claude personal-session selectors, OAuth tokens, git
  // selectors, arbitrary Node preload hooks, or caller-supplied overlays.
  for (const [key, value] of Object.entries(process.env))
    if (
      [
        "PATH",
        "HOME",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
      ].includes(key) ||
      /^(?:AWS_|GOOGLE_|CLOUD_ML_|ANTHROPIC_VERTEX_|AZURE_|ANTHROPIC_FOUNDRY_)/.test(
        key,
      )
    )
      env[key] = value;
  env.CLAUDE_CONFIG_DIR = join(directory, "claude-config");
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "metatron";
  env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = "false";
  return env;
}
export async function launchClaude(
  directory: string,
  options: ClaudeAdapterOptions,
  cwd: string,
  data?: StartSessionInput,
  sessionId?: string,
  resume = false,
  effort?: EffortLevel,
): Promise<Launched> {
  await mkdir(join(directory, "claude-config"), {
    recursive: true,
    mode: 0o700,
  });
  const executable = await claudeExecutable(options.executable);
  const process = new ClaudeProcess(options.spawn ?? spawnClaude);
  const input = new ClaudeInput<SDKUserMessage>();
  const abort = new AbortController();
  const tools = data
    ? [
        "Read",
        "Grep",
        "Glob",
        ...(data.permission === "workspace_write" ? ["Edit", "Write"] : []),
      ]
    : [];
  const allTools = [...tools, ...(data?.toolEndpoint ? gatewayTools : [])];
  let active: Active | undefined;
  const nativeOptions: Options = {
    cwd,
    pathToClaudeCodeExecutable: executable,
    env: claudeEnvironment(directory),
    spawnClaudeCodeProcess: process.spawn,
    abortController: abort,
    settingSources: [],
    plugins: [],
    skills: [],
    agents: {},
    strictMcpConfig: true,
    tools,
    allowedTools: [],
    disallowedTools: [
      "Bash",
      "Agent",
      "Task",
      "Skill",
      "WebFetch",
      "WebSearch",
      "NotebookEdit",
    ],
    permissionMode: "default",
    permissionPrompts: "host",
    includePartialMessages: true,
    verbatimPrompts: true,
    persistSession: !!data,
    promptSuggestions: false,
    agentProgressSummaries: false,
    systemPrompt:
      data?.roleInstructions ??
      "Discover native capabilities only. Do not make a model request.",
    settings: { autoMemoryEnabled: false },
    mcpServers: data?.toolEndpoint
      ? {
          lao: {
            type: "http",
            url: data.toolEndpoint,
            headers: {
              Authorization: `Bearer ${data.environment.LAO_GATEWAY_TOKEN}`,
            },
          },
        }
      : {},
    stderr: () => {},
    ...(data ? { model: data.model } : {}),
    ...(sessionId ? (resume ? { resume: sessionId } : { sessionId }) : {}),
    ...(effort ? { effort } : {}),
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (hook, _toolUseId, control) => {
              if (
                hook.hook_event_name !== "PreToolUse" ||
                hook.agent_id ||
                !data ||
                !active ||
                active.fault ||
                active.cancelled ||
                active.abort.signal.aborted ||
                control.signal.aborted ||
                !active.busy ||
                active.mapper.result ||
                hook.session_id !== sessionId ||
                resolve(hook.cwd) !== cwd
              )
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason:
                      "App-owned worker session is not accepting tools",
                  },
                };
              if (
                !(await claudeInitialized(active, control.signal)) ||
                !(await sameClaudeCheckout(active))
              )
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason:
                      "App-owned native initialization or original checkout identity was not confirmed",
                  },
                };
              const input = z
                .record(z.string(), z.unknown())
                .safeParse(hook.tool_input);
              const denied = input.success
                ? await checkClaudeTool(
                    cwd,
                    data.permission,
                    { toolName: hook.tool_name, input: input.data },
                    !!data.toolEndpoint,
                  )
                : { block: true };
              if (
                denied ||
                active.fault ||
                active.cancelled ||
                active.abort.signal.aborted ||
                control.signal.aborted ||
                !active.busy ||
                active.mapper.result
              )
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason:
                      "App worker safety policy denied this tool request",
                  },
                };
              // An auto-allow native rule must never bypass owner consent to mutation.
              return ["Edit", "Write"].includes(hook.tool_name)
                ? {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "ask",
                      permissionDecisionReason:
                        "Safe file mutation requires one-shot owner consent",
                    },
                  }
                : {};
            },
          ],
        },
      ],
    },
    canUseTool: async (toolName, input, native) => {
      const denied: PermissionResult = {
        behavior: "deny",
        message: "App worker safety policy denied this tool request",
      };
      if (
        !data ||
        !active ||
        active.fault ||
        !active.busy ||
        active.mapper.result ||
        native.agentID ||
        active.cancelled ||
        active.abort.signal.aborted ||
        native.signal.aborted ||
        (toolName.startsWith("mcp__") &&
          (!data.toolEndpoint ||
            !gatewayTools.includes(toolName) ||
            (native.mcpServer && native.mcpServer.name !== "lao")))
      )
        return denied;
      if (
        !(await claudeInitialized(active, native.signal)) ||
        !(await sameClaudeCheckout(active))
      )
        return denied;
      const blocked = await checkClaudeTool(
        cwd,
        data.permission,
        { toolName, input },
        !!data.toolEndpoint,
      );
      if (
        blocked ||
        active.fault ||
        active.cancelled ||
        active.abort.signal.aborted ||
        native.signal.aborted ||
        !active.busy ||
        active.mapper.result
      )
        return denied;
      if (!["Edit", "Write"].includes(toolName))
        return { behavior: "allow", updatedInput: input };
      if (
        !native.requestId ||
        active.seenRequests.has(native.requestId) ||
        active.seenRequests.size >= 4096
      )
        return denied;
      active.seenRequests.add(native.requestId);
      const id = randomUUID();
      const current = active;
      const approved = await new Promise<boolean>((resolve) => {
        const finish = (allowed: boolean) => {
          native.signal.removeEventListener("abort", onAbort);
          current.pending.delete(id);
          resolve(allowed);
        };
        const onAbort = () => finish(false);
        current.pending.set(id, { finish });
        native.signal.addEventListener("abort", onAbort, { once: true });
        if (native.signal.aborted || current.cancelled) finish(false);
        else
          current.events.push({
            type: "approval_requested",
            nativeRequestId: id,
            details: `Claude requests one-shot approval for safe ${toolName} in the assigned worktree; tool input is redacted`,
          });
      });
      if (!approved || !(await sameClaudeCheckout(current))) return denied;
      const changed = await checkClaudeTool(
        cwd,
        data.permission,
        { toolName, input },
        !!data.toolEndpoint,
      );
      if (
        changed ||
        current.fault ||
        current.cancelled ||
        current.abort.signal.aborted ||
        !current.busy ||
        current.mapper.result ||
        native.signal.aborted
      )
        return denied;
      return { behavior: "allow", updatedInput: input };
    },
  };
  let native: ClaudeQuery;
  try {
    native = (options.query ?? query)({
      prompt: input,
      options: nativeOptions,
    });
  } catch {
    input.close();
    if (process.pid) await process.stop();
    throw new DomainError(
      "UNSUPPORTED",
      "Claude SDK initialization failed; native details are redacted",
    );
  }
  return {
    query: native,
    process,
    input,
    abort,
    allTools,
    bind: (current: Active) => {
      active = current;
    },
  };
}
