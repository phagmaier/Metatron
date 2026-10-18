import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";
import type { SessionEvent } from "./contract.ts";
import { openCodeModel } from "./opencode-state.ts";

const header = z.object({
  type: z.string(),
  id: z.string().optional(),
  location: z.object({ directory: z.string() }).optional(),
  data: z.unknown().optional(),
});
const sessionData = z.object({ sessionID: z.string() });
const content = z.object({
  type: z.string(),
  text: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  state: z.unknown().optional(),
});
export class OpenCodeEvents {
  started = false;
  modelVerified = false;
  terminal: "completed" | "failed" | "interrupted" | undefined;
  readonly modelEvidence: z.infer<typeof openCodeModel>[] = [];
  private readonly seen = new Set<string>();
  private readonly text = new Map<string, string>();
  private readonly blocks = new Map<string, string>();
  private readonly tools = new Map<string, string>();
  readonly sessionId: string;
  readonly cwd: string;
  readonly model: z.infer<typeof openCodeModel>;
  constructor(
    sessionId: string,
    cwd: string,
    model: z.infer<typeof openCodeModel>,
  ) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.model = model;
  }
  checkModel(value: unknown) {
    const model = openCodeModel.parse(value);
    if (
      model.id !== this.model.id ||
      model.providerID !== this.model.providerID ||
      model.variant !== this.model.variant
    )
      throw new DomainError(
        "POLICY_DENIED",
        "OpenCode native model/variant drifted from the assigned configuration",
      );
    this.modelVerified = true;
    if (this.modelEvidence.length < 32) this.modelEvidence.push(model);
  }
  private textEvents(text: string): SessionEvent[] {
    const events: SessionEvent[] = [];
    for (let offset = 0; offset < text.length; offset += 32000)
      events.push({
        type: "text_delta",
        text: text.slice(offset, offset + 32000),
      });
    return events;
  }
  consume(value: unknown): { events: SessionEvent[]; permission?: unknown } {
    const h = header.parse(value);
    if (!h.type.startsWith("session.") && !h.type.startsWith("permission."))
      return { events: [] };
    const data = sessionData.safeParse(h.data);
    if (!data.success) {
      if (
        [
          "session.execution.started",
          "session.execution.succeeded",
          "session.execution.failed",
          "session.execution.interrupted",
          "session.step.started",
          "session.text.delta",
          "session.text.ended",
          "session.tool.input.started",
          "session.tool.called",
          "session.tool.success",
          "session.tool.failed",
          "permission.asked",
        ].includes(h.type)
      )
        throw new DomainError(
          "CONFLICT",
          "OpenCode emitted a malformed critical native event",
        );
      return { events: [] };
    }
    if (data.data.sessionID !== this.sessionId) return { events: [] };
    if (h.location && h.location.directory !== this.cwd)
      throw new DomainError(
        "POLICY_DENIED",
        "OpenCode native event changed the assigned location",
      );
    if (h.id) {
      if (this.seen.has(h.id)) return { events: [] };
      if (this.seen.size >= 4096)
        throw new DomainError(
          "CONFLICT",
          "OpenCode native event capacity exceeded",
        );
      this.seen.add(h.id);
    }
    if (h.type === "session.execution.started") this.started = true;
    if (h.type === "session.step.started") {
      const step = z
        .object({ agent: z.literal("metatron"), model: openCodeModel })
        .parse(h.data);
      if (!this.started)
        throw new DomainError(
          "CONFLICT",
          "OpenCode step arrived before native execution started",
        );
      this.checkModel(step.model);
    }
    if (h.type === "permission.asked")
      return { events: [], permission: h.data };
    if (
      (h.type.startsWith("session.text.") ||
        h.type.startsWith("session.tool.")) &&
      (!this.started || !this.modelVerified)
    )
      throw new DomainError(
        "POLICY_DENIED",
        "OpenCode stream arrived before native model/variant validation",
      );
    if (h.type === "session.text.delta" || h.type === "session.text.ended") {
      // The installed v2 server emits transient deltas not included in its generated V2Event union.
      const frame = z
        .object({
          assistantMessageID: z.string(),
          ordinal: z.int().nonnegative(),
          delta: z.string().optional(),
          text: z.string().optional(),
        })
        .parse(h.data);
      const key = `${frame.assistantMessageID}:${frame.ordinal}`;
      const previous = this.blocks.get(key) ?? "";
      let suffix: string;
      if (h.type === "session.text.delta") {
        suffix = z.string().parse(frame.delta);
        this.blocks.set(key, previous + suffix);
      } else {
        const final = z.string().parse(frame.text);
        if (!final.startsWith(previous))
          throw new DomainError(
            "CONFLICT",
            "OpenCode final text rewrote its live deltas",
          );
        suffix = final.slice(previous.length);
        this.blocks.set(key, final);
      }
      this.text.set(
        frame.assistantMessageID,
        (this.text.get(frame.assistantMessageID) ?? "") + suffix,
      );
      return { events: this.textEvents(suffix) };
    }
    if (h.type === "session.tool.input.started") {
      const tool = z.object({ id: z.string(), name: z.string() }).parse(h.data);
      if (this.tools.has(tool.id))
        throw new DomainError(
          "CONFLICT",
          "OpenCode reused a native tool identity",
        );
      this.tools.set(tool.id, "streaming");
      return {
        events: [
          {
            type: "tool_started",
            toolId: tool.id.slice(0, 256),
            summary: tool.name.slice(0, 256),
          },
        ],
      };
    }
    if (
      [
        "session.tool.called",
        "session.tool.success",
        "session.tool.failed",
      ].includes(h.type)
    ) {
      const tool = z.object({ id: z.string() }).parse(h.data);
      if (!this.tools.has(tool.id))
        throw new DomainError(
          "CONFLICT",
          "OpenCode tool outcome lacks its live start identity",
        );
      const previous = this.tools.get(tool.id);
      const state =
        h.type === "session.tool.called"
          ? "running"
          : h.type === "session.tool.success"
            ? "completed"
            : "error";
      this.tools.set(tool.id, state);
      return {
        events:
          state === "running" || ["completed", "error"].includes(previous ?? "")
            ? []
            : [
                {
                  type: "tool_finished",
                  toolId: tool.id.slice(0, 256),
                  summary:
                    state === "completed"
                      ? "OpenCode tool finished"
                      : "OpenCode tool failed",
                },
              ],
      };
    }
    if (h.type === "session.message.content.updated") {
      if (!this.started || !this.modelVerified)
        throw new DomainError(
          "POLICY_DENIED",
          "OpenCode output arrived before model/variant validation",
        );
      const message = z
        .object({ messageID: z.string(), content: z.array(content) })
        .parse(h.data);
      const next = message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("");
      const previous = this.text.get(message.messageID) ?? "";
      if (!next.startsWith(previous))
        throw new DomainError(
          "CONFLICT",
          "OpenCode rewrote previously streamed text",
        );
      this.text.set(message.messageID, next);
      const events = this.textEvents(next.slice(previous.length));
      message.content.forEach((item, ordinal) => {
        if (item.type === "text")
          this.blocks.set(
            `${message.messageID}:${ordinal}`,
            z.string().parse(item.text),
          );
      });
      for (const item of message.content) {
        if (item.type !== "tool" || !item.id || !item.name || !item.state)
          continue;
        const status = z
          .object({ status: z.string() })
          .parse(item.state).status;
        const state = this.tools.get(item.id);
        if (!state)
          events.push({
            type: "tool_started",
            toolId: item.id.slice(0, 256),
            summary: item.name.slice(0, 256),
          });
        if (
          ["completed", "error"].includes(status) &&
          !["completed", "error"].includes(state ?? "")
        )
          events.push({
            type: "tool_finished",
            toolId: item.id.slice(0, 256),
            summary:
              status === "completed"
                ? "OpenCode tool finished"
                : "OpenCode tool failed",
          });
        this.tools.set(item.id, status);
      }
      return { events };
    }
    if (h.type === "session.execution.failed") {
      const failure = z
        .object({
          error: z.object({ type: z.string(), status: z.number().optional() }),
        })
        .parse(h.data).error;
      this.terminal = "failed";
      const kind =
        failure.status === 401 || failure.status === 403
          ? "auth"
          : failure.status === 429
            ? "rate_limit"
            : undefined;
      return {
        events: [
          {
            type: "session_error",
            code: kind ?? "native_error",
            ...(kind ? { providerFailureKind: kind } : {}),
            recoverable: false,
            message:
              "OpenCode native execution failed; provider details redacted; no automatic replay",
          },
        ],
      };
    }
    if (h.type === "session.execution.interrupted")
      this.terminal = "interrupted";
    if (h.type === "session.execution.succeeded") {
      if (!this.started || !this.modelVerified)
        throw new DomainError(
          "POLICY_DENIED",
          "OpenCode completion lacks native model/variant evidence",
        );
      this.terminal = "completed";
    }
    return { events: [] };
  }
}
