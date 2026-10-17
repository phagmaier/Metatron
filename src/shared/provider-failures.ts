import { z } from "zod";

export const providerFailureKindSchema = z.enum([
  "auth",
  "rate_limit",
  "credits_exhausted",
  "usage_limit",
]);
export type ProviderFailureKind = z.infer<typeof providerFailureKindSchema>;

export const providerFailureSchema = z.strictObject({
  kind: providerFailureKindSchema,
  evidenceEventId: z.uuid(),
  // A last native sample, never an account balance or a complete usage total.
  inputTokens: z.int().nonnegative().nullable(),
  outputTokens: z.int().nonnegative().nullable(),
});

export const providerFailureLabels: Record<ProviderFailureKind, string> = {
  auth: "Authentication failed",
  rate_limit: "Rate limit reached",
  credits_exhausted: "Credits exhausted",
  usage_limit: "Provider usage limit reached",
};
