import { z } from "zod";
import {
  absolutePathSchema,
  adapterKindSchema,
  contextPolicySchema,
  idSchema,
  permissionSchema,
  textSchema,
} from "../../shared/domain/entities.ts";
import { processStateSchema } from "../../shared/domain/states.ts";
import { nativePermissionDenialSchema } from "../../shared/native-permissions.ts";

export const capabilitiesSchema = z.strictObject({
  adapter: adapterKindSchema,
  installed: z.boolean(),
  authenticated: z.union([z.boolean(), z.literal("unknown")]),
  models: z.array(
    z.strictObject({
      id: textSchema,
      label: textSchema,
      thinking: z.array(z.strictObject({ id: textSchema, label: textSchema })),
    }),
  ),
  supportsResume: z.boolean(),
  supportsLiveSteer: z.boolean(),
  supportsCancel: z.boolean(),
  supportsPermissionPrompts: z.boolean(),
  supportsToolGateway: z.boolean(),
  diagnostics: z.array(textSchema),
});
export type AdapterCapabilities = z.infer<typeof capabilitiesSchema>;
export const sessionEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("owner_message_delivered"),
    messageId: idSchema,
  }),
  z.strictObject({
    type: z.literal("approval_denied"),
    permission: nativePermissionDenialSchema,
  }),
  z.strictObject({
    type: z.literal("text_delta"),
    text: z.string().min(1).max(32_768),
  }),
  z.strictObject({
    type: z.literal("tool_started"),
    toolId: textSchema,
    summary: textSchema,
  }),
  z.strictObject({
    type: z.literal("tool_finished"),
    toolId: textSchema,
    summary: textSchema,
  }),
  z.strictObject({
    type: z.literal("approval_requested"),
    nativeRequestId: textSchema,
    details: textSchema,
  }),
  z.strictObject({
    type: z.literal("turn_completed"),
    nativeStatus: z.enum(["completed", "failed", "interrupted"]),
  }),
  z.strictObject({
    type: z.literal("session_error"),
    code: textSchema,
    recoverable: z.boolean(),
    message: textSchema,
  }),
  z.strictObject({
    type: z.literal("usage"),
    inputTokens: z.int().min(0).optional(),
    outputTokens: z.int().min(0).optional(),
    source: textSchema,
  }),
  z.strictObject({
    type: z.literal("process_state"),
    state: processStateSchema,
    exitCode: z.int().nullable(),
  }),
]);
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export const startSessionSchema = z.strictObject({
  runId: idSchema,
  taskId: idSchema,
  attemptId: idSchema,
  cwd: absolutePathSchema,
  roleInstructions: textSchema,
  model: textSchema,
  thinking: textSchema.nullable(),
  permission: permissionSchema,
  contextPolicy: contextPolicySchema,
  contextPacket: textSchema,
  toolEndpoint: z.url().nullable(),
  environment: z.record(z.string(), z.string()),
});
export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type ResumeInput = StartSessionInput;
export type ManagedSession = {
  processId?: number;
  nativeSessionId: string;
  // Where the harness keeps this session's transcript, when the app owns it.
  transcriptPath?: string;
  adapter: AdapterCapabilities["adapter"];
  input: StartSessionInput;
};
export type ApprovalDecision = "approve" | "deny";
export type SteeringOptions = {
  kind: "steer" | "follow_up";
  messageId: string;
};
export interface HarnessAdapter {
  discover(): Promise<AdapterCapabilities>;
  startSession(input: StartSessionInput): Promise<ManagedSession>;
  prompt(session: ManagedSession, text: string): AsyncIterable<SessionEvent>;
  resume(nativeSessionId: string, input: ResumeInput): Promise<ManagedSession>;
  steer(
    session: ManagedSession,
    text: string,
    options?: SteeringOptions,
  ): Promise<"sent" | "queued" | "unsupported">;
  cancel(session: ManagedSession): Promise<void>;
  respondToApproval(
    session: ManagedSession,
    id: string,
    decision: ApprovalDecision,
  ): Promise<void>;
  dispose(session: ManagedSession): Promise<void>;
}
