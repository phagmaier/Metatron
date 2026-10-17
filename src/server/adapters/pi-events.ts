import { z } from "zod";
import type { ProviderFailureKind } from "../../shared/provider-failures.ts";
import type { SessionEvent } from "./contract.ts";
import type { RpcRecord } from "./pi-rpc.ts";

const assistantSchema = z.object({
  role: z.literal("assistant"),
  stopReason: z.string(),
  errorMessage: z.string().optional(),
  usage: z
    .object({ input: z.number().optional(), output: z.number().optional() })
    .optional(),
});
// Pi exposes provider errors as text, not structured status codes. Match only
// explicit failure statements in an error message; missing usage is no evidence.
function classify(error: string): ProviderFailureKind | "native_error" {
  if (
    /\b401\b|\bunauthorized\b|\b(?:invalid|incorrect|missing|no) api[ _-]?key\b|\bauthentication (?:failed|required)\b/i.test(
      error,
    )
  )
    return "auth";
  if (
    /\binsufficient[ _-]credits\b|\bcredits? (?:are |is )?(?:exhausted|depleted)\b|\bcredit balance (?:is )?(?:too low|insufficient|exhausted|zero)\b/i.test(
      error,
    )
  )
    return "credits_exhausted";
  if (
    /\binsufficient_quota\b|\b(?:usage limit|quota) (?:has been |is )?(?:exceeded|exhausted|reached)\b/i.test(
      error,
    )
  )
    return "usage_limit";
  if (
    /\b429\b|\btoo many requests\b|\brate[ _-]limit(?:[ _-]exceeded| (?:has been |is )?(?:exceeded|reached))\b/i.test(
      error,
    )
  )
    return "rate_limit";
  return "native_error";
}
export class PiEvents {
  private stopReason: string | null = null;
  private failure = false;
  consume(record: RpcRecord): SessionEvent[] {
    if (record.type === "message_update") {
      const update = z
        .object({ type: z.string(), delta: z.string().optional() })
        .safeParse(record.assistantMessageEvent);
      if (
        update.success &&
        update.data.type === "text_delta" &&
        update.data.delta
      ) {
        const result: SessionEvent[] = [];
        for (let offset = 0; offset < update.data.delta.length; offset += 32000)
          result.push({
            type: "text_delta",
            text: update.data.delta.slice(offset, offset + 32000),
          });
        return result;
      }
    }
    if (record.type === "message_end") {
      const parsed = assistantSchema.safeParse(record.message);
      if (!parsed.success) return [];
      this.stopReason = parsed.data.stopReason;
      // A later successful message can replace a transient failed response;
      // agent_settled, never agent_end, decides the session-level result.
      this.failure = ["error", "aborted"].includes(this.stopReason);
      const usage = parsed.data.usage;
      const usageEvents: SessionEvent[] = usage
        ? [
            {
              type: "usage",
              ...(usage.input !== undefined
                ? { inputTokens: usage.input }
                : {}),
              ...(usage.output !== undefined
                ? { outputTokens: usage.output }
                : {}),
              source: "pi native assistant message (may be partial)",
            },
          ]
        : [];
      if (this.failure) {
        const error = parsed.data.errorMessage ?? "";
        const code =
          this.stopReason === "error" ? classify(error) : "native_error";
        return [
          {
            type: "session_error",
            code,
            ...(code !== "native_error" ? { providerFailureKind: code } : {}),
            recoverable: code !== "auth",
            message: `Pi reported ${code}; inspect app-owned native session diagnostics`,
          },
          ...usageEvents,
        ];
      }
      return usageEvents;
    }
    if (
      record.type === "tool_execution_start" ||
      record.type === "tool_execution_end"
    ) {
      if (
        typeof record.toolCallId !== "string" ||
        typeof record.toolName !== "string"
      )
        return [];
      return [
        {
          type:
            record.type === "tool_execution_start"
              ? "tool_started"
              : "tool_finished",
          toolId: record.toolCallId,
          summary: `${record.toolName}${record.isError === true ? " failed" : ""}`,
        },
      ];
    }
    if (record.type === "agent_settled")
      return [
        {
          type: "turn_completed",
          nativeStatus:
            record.aborted === true || this.stopReason === "aborted"
              ? "interrupted"
              : !this.failure && this.stopReason === "stop"
                ? "completed"
                : "failed",
        },
      ];
    if (record.type === "transport_error")
      return [
        {
          type: "session_error",
          code: record.reason === "deadline" ? "deadline" : "protocol",
          recoverable: false,
          message:
            record.reason === "deadline"
              ? "Pi reached its 180-second execution deadline; interrupted without automatic replay"
              : "Pi RPC protocol failed; no automatic replay",
        },
      ];
    if (record.type === "transport_exit")
      return [
        {
          type: "process_state",
          state: record.code === 0 ? "exited" : "crashed",
          exitCode: typeof record.code === "number" ? record.code : null,
        },
      ];
    return [];
  }
}
