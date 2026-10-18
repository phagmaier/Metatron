import { z } from "zod";
import type { CodexNotification } from "./codex-rpc.ts";
import type { SessionEvent } from "./contract.ts";

const itemSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    server: z.string().optional(),
    tool: z.string().optional(),
    status: z.string().optional(),
    command: z.string().optional(),
  })
  .loose();
const turnSchema = z.object({
  turn: z
    .object({
      id: z.string(),
      status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
      error: z.object({ codexErrorInfo: z.unknown().optional() }).nullish(),
    })
    .loose(),
});
const usageSchema = z.object({
  tokenUsage: z.object({
    last: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  }),
});
// Item types that represent tools; delegation types are blocked outright.
const tools = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageGeneration",
  "imageView",
  "sleep",
]);
const delegation = new Set(["collabAgentToolCall", "subAgentActivity"]);
function classify(info: unknown) {
  if (info === "unauthorized") return "auth";
  if (info === "rateLimitExceeded") return "rate_limit";
  // A plan/account usage limit does not establish an exhausted credit balance.
  if (info === "usageLimitExceeded") return "usage_limit";
  for (const variant of [
    "httpConnectionFailed",
    "responseStreamConnectionFailed",
    "responseStreamDisconnected",
    "responseTooManyFailedAttempts",
  ]) {
    const parsed = z
      .object({
        [variant]: z.object({ httpStatusCode: z.number().nullable() }),
      })
      .safeParse(info);
    if (!parsed.success) continue;
    const status = parsed.data[variant]?.httpStatusCode;
    if (status === 401) return "auth";
    if (status === 429) return "rate_limit";
  }
  return "native_error";
}
function describe(item: z.infer<typeof itemSchema>) {
  if (item.type === "mcpToolCall") return `mcp ${item.server}.${item.tool}`;
  if (item.type === "commandExecution")
    return `read-only shell: ${(item.command ?? "").slice(0, 200)}`;
  if (item.type === "fileChange")
    return "file change requested (read-only sandbox)";
  return item.type;
}

export class CodexEvents {
  private readonly threadId: string;
  private readonly settings: { model: string; thinking: string | null };
  private turnId: string | null = null;
  private messages = 0;
  private usage: SessionEvent | null = null;
  // Set by delegation or a reroute; the turn can still complete before the
  // interrupt lands, and must not then count as success.
  private blocked = false;
  constructor(
    threadId: string,
    settings: { model: string; thinking: string | null },
  ) {
    this.threadId = threadId;
    this.settings = settings;
  }
  start(turnId: string) {
    this.turnId = turnId;
  }
  consume(event: CodexNotification): SessionEvent[] {
    const params = z
      .object({
        threadId: z.string().optional(),
        turnId: z.string().optional(),
      })
      .loose()
      .safeParse(event.params);
    if (
      params.success &&
      params.data.threadId !== undefined &&
      params.data.threadId !== this.threadId
    )
      return [];
    if (
      params.success &&
      params.data.turnId !== undefined &&
      params.data.turnId !== this.turnId
    )
      return [];
    switch (event.method) {
      case "item/agentMessage/delta": {
        const delta = z.object({ delta: z.string() }).safeParse(event.params);
        if (!delta.success || !delta.data.delta) return [];
        const out: SessionEvent[] = [];
        for (let i = 0; i < delta.data.delta.length; i += 32_000)
          out.push({
            type: "text_delta",
            text: delta.data.delta.slice(i, i + 32_000),
          });
        return out;
      }
      case "item/started":
      case "item/completed": {
        const parsed = z.object({ item: itemSchema }).safeParse(event.params);
        if (!parsed.success) return [];
        const item = parsed.data.item;
        if (item.type === "agentMessage" && event.method === "item/started")
          return this.messages++ > 0
            ? [{ type: "text_delta", text: "\n\n" }]
            : [];
        if (delegation.has(item.type)) {
          this.blocked = true;
          return [
            {
              type: "session_error",
              code: "delegation_blocked",
              recoverable: false,
              message:
                "Codex attempted native sub-agent delegation; the app interrupts this turn",
            },
          ];
        }
        if (!tools.has(item.type)) return [];
        return [
          event.method === "item/started"
            ? { type: "tool_started", toolId: item.id, summary: describe(item) }
            : {
                type: "tool_finished",
                toolId: item.id,
                summary: `${describe(item)} · ${item.status ?? "done"}`,
              },
        ];
      }
      // The owner chose this model; a native reroute means the turn would
      // continue on one nobody selected.
      case "model/rerouted":
        this.blocked = true;
        return [
          {
            type: "session_error",
            code: "model_rerouted",
            recoverable: false,
            message:
              "Codex rerouted this turn to a model other than the one selected; the app interrupts it",
          },
        ];
      case "thread/tokenUsage/updated": {
        const usage = usageSchema.safeParse(event.params);
        if (usage.success)
          this.usage = {
            type: "usage",
            inputTokens: usage.data.tokenUsage.last.inputTokens,
            outputTokens: usage.data.tokenUsage.last.outputTokens,
            source: "codex thread token usage (last turn)",
          };
        return [];
      }
      case "error": {
        const error = z
          .object({
            willRetry: z.boolean(),
            error: z.object({ codexErrorInfo: z.unknown().optional() }),
          })
          .safeParse(event.params);
        if (!error.success || error.data.willRetry) return [];
        const code = classify(error.data.error.codexErrorInfo);
        return [
          {
            type: "session_error",
            code,
            ...(code !== "native_error" ? { providerFailureKind: code } : {}),
            recoverable: code !== "auth",
            message: `Codex reported ${code}; inspect app-owned Codex diagnostics`,
          },
        ];
      }
      case "turn/completed": {
        const parsed = turnSchema.safeParse(event.params);
        if (!parsed.success || parsed.data.turn.id !== this.turnId) return [];
        const status =
          this.blocked && parsed.data.turn.status === "completed"
            ? "failed"
            : parsed.data.turn.status;
        const out: SessionEvent[] = this.usage ? [this.usage] : [];
        if (status === "failed" && parsed.data.turn.error) {
          const code = classify(parsed.data.turn.error.codexErrorInfo);
          out.push({
            type: "session_error",
            code,
            ...(code !== "native_error" ? { providerFailureKind: code } : {}),
            recoverable: true,
            message: "Codex turn failed; no automatic retry",
          });
        }
        // Blocked turns map to failed above, so a completed one kept the thread's model.
        if (status === "completed")
          out.push({
            type: "settings_verified",
            ...this.settings,
            source: "Codex thread start/resume response; no model reroute",
          });
        out.push({
          type: "turn_completed",
          nativeStatus:
            status === "completed"
              ? "completed"
              : status === "interrupted"
                ? "interrupted"
                : "failed",
        });
        return out;
      }
      case "transport/error":
        return [
          {
            type: "session_error",
            code: "protocol",
            recoverable: false,
            message: "Codex app-server protocol failed; no automatic replay",
          },
        ];
      case "transport/exit": {
        const exit = z
          .object({ code: z.number().nullable() })
          .safeParse(event.params);
        const code = exit.success ? exit.data.code : null;
        return [
          {
            type: "process_state",
            state: code === 0 ? "exited" : "crashed",
            exitCode: code,
          },
        ];
      }
      default:
        return [];
    }
  }
}
