import { z } from "zod";

export const nativeApprovalSchema = z.strictObject({
  adapter: z.enum(["claude-code", "opencode"]),
  nativeRequestId: z.string().min(1).max(512),
  decision: z.enum(["approve", "deny"]).nullable(),
  state: z.enum(["pending", "accepted", "failed", "expired"]),
});
export const nativeApprovalDecisionSchema = z.strictObject({
  id: z.uuid(),
  decision: z.enum(["approve", "deny"]),
});
