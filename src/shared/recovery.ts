import { z } from "zod";
import { idSchema, type RecoveryCheck } from "./domain/entities.ts";
import { scenarioSchema } from "./orchestration.ts";

export const recheckRecoverySchema = z.strictObject({ taskId: idSchema });
export const recoveryDecisionSchema = z.strictObject({
  taskId: idSchema,
  // The newest observation the owner reviewed; the server observes again.
  checkId: idSchema,
  profileId: idSchema,
  scenario: scenarioSchema.default("success"),
  acceptUnverified: z.boolean().default(false),
});

// Facts a fresh retry must explicitly accept: the prior checkout's identity or
// the end of the prior process could not be established.
export function unverifiedFacts(check: RecoveryCheck) {
  return [
    ...(["verified", "not_isolated"].includes(check.worktree.state)
      ? []
      : [`worktree ${check.worktree.state}`]),
    ...(["pid_present", "unknown"].includes(check.process.state)
      ? [`process ${check.process.state.replace("_", " ")}`]
      : []),
  ];
}
