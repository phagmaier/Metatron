import { z } from "zod";
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
      if (this.failure) {
        const error = parsed.data.errorMessage ?? "";
        const code = /auth|api.?key|401|403|credential/i.test(error)
          ? "auth"
          : /quota|credit|429|rate.?limit|balance/i.test(error)
            ? "quota"
            : "native_error";
        return [
          {
            type: "session_error",
            code,
            recoverable: code !== "auth",
            message: `Pi reported ${code}; inspect app-owned native session diagnostics`,
          },
        ];
      }
      const usage = parsed.data.usage;
      return usage
        ? [
            {
              type: "usage",
              ...(usage.input !== undefined
                ? { inputTokens: usage.input }
                : {}),
              ...(usage.output !== undefined
                ? { outputTokens: usage.output }
                : {}),
              source: "pi native assistant message",
            },
          ]
        : [];
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
