import { z } from "zod";

export const nativePermissionMethodSchema = z.enum([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "execCommandApproval",
  "applyPatchApproval",
  "mcpServer/elicitation/request",
  "unsupported",
]);

// Persist only bounded protocol metadata: commands, URLs, paths and native
// reasons may contain credentials and stay in the app-owned native transcript.
export const nativePermissionDenialSchema = z.strictObject({
  adapter: z.literal("codex"),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  method: nativePermissionMethodSchema,
  outcome: z.literal("denied_by_policy"),
});
