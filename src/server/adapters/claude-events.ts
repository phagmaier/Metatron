import { resolve } from "node:path";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";
import type { ProviderFailureKind } from "../../shared/provider-failures.ts";
import type { SessionEvent } from "./contract.ts";

const header = z.object({
  type: z.string(),
  session_id: z.string().optional(),
  parent_tool_use_id: z.string().nullable().optional(),
});
const block = z.object({
  type: z.string(),
  text: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  tool_use_id: z.string().optional(),
  is_error: z.boolean().optional(),
});
const assistant = z.object({
  error: z.string().optional(),
  message: z.object({
    id: z.string(),
    model: z.string(),
    content: z.array(block),
  }),
});
const partial = z.object({
  event: z.object({
    type: z.string(),
    message: z.object({ id: z.string(), model: z.string() }).optional(),
    content_block: block.optional(),
    delta: z
      .object({ type: z.string().optional(), text: z.string().optional() })
      .optional(),
  }),
});
const result = z.object({
  subtype: z.string(),
  is_error: z.boolean(),
  usage: z.object({
    input_tokens: z.int().nonnegative(),
    output_tokens: z.int().nonnegative(),
  }),
  queued_turn_count: z.int().nonnegative().optional(),
});

export class ClaudeEvents {
  initialized = false;
  effortVerified = false;
  result: "success" | "failed" | undefined;
  private failed = false;
  private readonly streamed = new Set<string>();
  private currentStreamId: string | undefined;
  private unidentifiedStream = false;
  private readonly tools = new Set<string>();
  private ignored = 0;
  private readonly sessionId: string;
  private readonly cwd: string;
  private readonly models: ReadonlySet<string>;
  private readonly effort: string | null;
  private readonly allowedTools: ReadonlySet<string>;
  private readonly gateway: boolean;
  constructor(
    sessionId: string,
    cwd: string,
    models: ReadonlySet<string>,
    effort: string | null,
    allowedTools: ReadonlySet<string>,
    gateway: boolean,
  ) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.models = models;
    this.effort = effort;
    this.effortVerified = effort === null;
    this.allowedTools = allowedTools;
    this.gateway = gateway;
  }
  diagnostics(): string[] {
    return this.ignored
      ? [
          "Unrecognized native event headers were ignored (bounded, contents redacted)",
        ]
      : [];
  }
  observeEffort(level: string | null | undefined): boolean {
    this.effortVerified = this.effort === null || level === this.effort;
    if (!this.effortVerified) this.failed = true;
    return this.effortVerified;
  }
  private text(text: string): SessionEvent[] {
    const events: SessionEvent[] = [];
    for (let offset = 0; offset < text.length; offset += 32000)
      events.push({
        type: "text_delta",
        text: text.slice(offset, offset + 32000),
      });
    return events;
  }
  private tool(
    id: string | undefined,
    name: string | undefined,
  ): SessionEvent[] {
    if (!id || !name || !this.allowedTools.has(name) || this.tools.has(id))
      return [];
    if (this.tools.size >= 4096)
      throw new DomainError(
        "CONFLICT",
        "Claude exceeded its bounded active-tool limit",
      );
    this.tools.add(id);
    return [{ type: "tool_started", toolId: id.slice(0, 256), summary: name }];
  }
  consume(value: unknown): SessionEvent[] {
    const parsed = header.safeParse(value);
    if (!parsed.success) {
      this.ignored = Math.min(this.ignored + 1, 32);
      return [];
    }
    const h = parsed.data;
    if (h.session_id !== this.sessionId || h.parent_tool_use_id != null)
      return [];
    if (h.type === "system") {
      const init = z
        .object({
          subtype: z.literal("init"),
          cwd: z.string(),
          model: z.string(),
          permissionMode: z.literal("default"),
          effort: z.string().nullable().optional(),
          tools: z.array(z.string()),
          skills: z.array(z.string()),
          plugins: z.array(z.unknown()),
          mcp_servers: z.array(
            z.object({
              name: z.string(),
              status: z.string(),
              source: z.string().optional(),
            }),
          ),
        })
        .safeParse(value);
      if (init.success) {
        const data = init.data;
        if (
          resolve(data.cwd) !== this.cwd ||
          !this.models.has(data.model) ||
          (this.effort !== null &&
            data.effort !== undefined &&
            data.effort !== this.effort) ||
          data.tools.some((name) => !this.allowedTools.has(name)) ||
          data.skills.length ||
          data.plugins.length ||
          data.mcp_servers.length !== (this.gateway ? 1 : 0) ||
          data.mcp_servers.some(
            (server) => server.name !== "lao" || server.status !== "connected",
          )
        )
          throw new DomainError(
            "POLICY_DENIED",
            "Claude native identity or isolated configuration did not match the requested session",
          );
        this.initialized = true;
        // Headless init may omit effort; native tool/Stop hooks must then prove it.
        if (data.effort !== undefined) this.observeEffort(data.effort);
        return [];
      }
      const subtype = z.object({ subtype: z.string() }).safeParse(value);
      if (subtype.success && subtype.data.subtype === "init")
        throw new DomainError(
          "POLICY_DENIED",
          "Claude emitted an invalid native initialization identity",
        );
    }
    if (!this.initialized) {
      if (["assistant", "stream_event", "result", "user"].includes(h.type))
        throw new DomainError(
          "POLICY_DENIED",
          "Claude output arrived before validated native session identity",
        );
      return [];
    }
    if (h.type === "stream_event") {
      const parsed = partial.safeParse(value);
      if (!parsed.success)
        throw new DomainError(
          "CONFLICT",
          "Claude emitted an invalid streaming frame",
        );
      const event = parsed.data.event;
      // message_delta carries stop metadata without a delta.type; content deltas do not.
      if (
        event.type === "content_block_delta" &&
        (!event.delta?.type ||
          (event.delta.type === "text_delta" && event.delta.text === undefined))
      )
        throw new DomainError(
          "CONFLICT",
          "Claude emitted an invalid content delta",
        );
      if (event.type === "message_start" && event.message) {
        if (!this.models.has(event.message.model))
          throw new DomainError(
            "POLICY_DENIED",
            "Claude silently changed the requested model",
          );
        this.currentStreamId = event.message.id;
      }
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      ) {
        if (this.currentStreamId) {
          if (this.streamed.size >= 4096)
            throw new DomainError(
              "CONFLICT",
              "Claude exceeded its bounded streamed-message limit",
            );
          this.streamed.add(this.currentStreamId);
        } else this.unidentifiedStream = true;
        return this.text(event.delta.text ?? "");
      }
      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "tool_use"
      )
        return this.tool(event.content_block.id, event.content_block.name);
      return [];
    }
    if (h.type === "assistant") {
      const parsed = assistant.safeParse(value);
      if (!parsed.success)
        throw new DomainError(
          "CONFLICT",
          "Claude emitted an invalid assistant message",
        );
      const data = parsed.data;
      if (data.error) {
        this.failed = true;
        const kinds: Record<string, ProviderFailureKind> = {
          authentication_failed: "auth",
          cloud_credential_error: "auth",
          oauth_org_not_allowed: "auth",
          rate_limit: "rate_limit",
        };
        const kind = kinds[data.error];
        return [
          {
            type: "session_error",
            code: kind ?? "native_error",
            ...(kind ? { providerFailureKind: kind } : {}),
            recoverable: false,
            message:
              "Claude reported a typed provider failure; native details are redacted",
          },
        ];
      }
      if (!this.models.has(data.message.model))
        throw new DomainError(
          "POLICY_DENIED",
          "Claude silently changed the requested model",
        );
      const alreadyStreamed =
        this.streamed.delete(data.message.id) || this.unidentifiedStream;
      this.unidentifiedStream = false;
      this.currentStreamId = undefined;
      return data.message.content.flatMap((item) =>
        item.type === "text" && !alreadyStreamed
          ? this.text(item.text ?? "")
          : item.type === "tool_use"
            ? this.tool(item.id, item.name)
            : [],
      );
    }
    if (h.type === "user") {
      const parsed = z
        .object({
          isReplay: z.boolean().optional(),
          message: z.object({ content: z.union([z.string(), z.array(block)]) }),
        })
        .safeParse(value);
      if (
        !parsed.success ||
        parsed.data.isReplay ||
        typeof parsed.data.message.content === "string"
      )
        return [];
      return parsed.data.message.content.flatMap((item): SessionEvent[] => {
        if (
          item.type !== "tool_result" ||
          !item.tool_use_id ||
          !this.tools.delete(item.tool_use_id)
        )
          return [];
        return [
          {
            type: "tool_finished",
            toolId: item.tool_use_id.slice(0, 256),
            summary: item.is_error
              ? "Claude tool failed"
              : "Claude tool finished",
          },
        ];
      });
    }
    if (h.type === "result") {
      const parsed = result.safeParse(value);
      if (!parsed.success || this.result)
        throw new DomainError(
          "CONFLICT",
          "Claude emitted an invalid or duplicate authoritative result",
        );
      const data = parsed.data;
      this.result =
        data.subtype === "success" &&
        !data.is_error &&
        !this.failed &&
        this.effortVerified &&
        !data.queued_turn_count
          ? "success"
          : "failed";
      return [
        {
          type: "usage",
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          source: "Claude native root-turn result",
        },
      ];
    }
    this.ignored = Math.min(this.ignored + 1, 32);
    return [];
  }
}
