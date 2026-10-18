import { z } from "zod";
import {
  defaultLimits,
  idSchema,
  limitsSchema,
  modeSchema,
  type Run,
  textSchema,
} from "./domain/entities.ts";
import { fakeTeamSnapshot } from "./presets.ts";

export const nativeRunSchema = z.strictObject({
  projectId: idSchema,
  harness: z.enum(["pi", "claude-code", "opencode"]).default("pi"),
  title: textSchema,
  initialPrompt: textSchema,
  model: textSchema,
  thinking: textSchema.nullable(),
  permission: z.enum(["read_only", "workspace_write"]),
  limits: limitsSchema.default(defaultLimits),
});
export function nativeTeam(
  model: string,
  thinking: string | null,
  harness: "pi" | "claude-code" | "opencode" = "pi",
) {
  const label =
    harness === "pi"
      ? "Pi"
      : harness === "claude-code"
        ? "Claude Code"
        : "OpenCode";
  return {
    ...fakeTeamSnapshot,
    preset: {
      ...fakeTeamSnapshot.preset,
      name: `Owner-directed ${label} workers`,
      mode: "supervised" as const,
    },
    profiles: fakeTeamSnapshot.profiles.map((p) => ({
      ...p,
      name:
        p.permission === "coordinator"
          ? "Owner-directed (no live Lead)"
          : p.name.replace("Fake ", `${label} `),
      harness: p.permission === "coordinator" ? p.harness : harness,
      model,
      thinking,
    })),
  };
}
const selectionSchema = z.strictObject({
  model: textSchema,
  thinking: textSchema.nullable(),
});
export const leadRunSchema = z.strictObject({
  projectId: idSchema,
  title: textSchema,
  initialPrompt: textSchema,
  mode: modeSchema.default("autonomous_bounded"),
  limits: limitsSchema.default(defaultLimits),
  lead: selectionSchema,
  worker: selectionSchema,
});
export type LeadRunInput = z.infer<typeof leadRunSchema>;
export function leadTeam(
  input: Pick<LeadRunInput, "lead" | "worker" | "mode">,
) {
  return {
    ...fakeTeamSnapshot,
    preset: {
      ...fakeTeamSnapshot.preset,
      name: "Codex Lead with Pi workers",
      mode: input.mode,
    },
    profiles: fakeTeamSnapshot.profiles.map((p) =>
      p.permission === "coordinator"
        ? { ...p, name: "Codex Lead", harness: "codex" as const, ...input.lead }
        : { ...p, name: p.name.replace("Fake ", "Pi "), ...input.worker },
    ),
  };
}
export function hasNativeLead(run: Run) {
  const lead = run.teamSnapshot?.profiles.find(
    (p) => p.id === run.teamSnapshot?.preset.leadProfileId,
  );
  return run.execution === "native" && lead?.harness === "codex";
}
