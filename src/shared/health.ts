import { z } from "zod";

export const healthSchema = z.strictObject({
  status: z.literal("ok"),
  app: z.literal("Local Agent Orchestrator"),
  milestone: z.literal("M2"),
});
