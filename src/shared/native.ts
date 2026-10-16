import { z } from "zod";
import {
  defaultLimits,
  idSchema,
  limitsSchema,
  textSchema,
} from "./domain/entities.ts";
import { fakeTeamSnapshot } from "./presets.ts";

export const nativeRunSchema = z.strictObject({
  projectId: idSchema,
  title: textSchema,
  initialPrompt: textSchema,
  model: textSchema,
  thinking: textSchema.nullable(),
  permission: z.enum(["read_only", "workspace_write"]),
  limits: limitsSchema.default(defaultLimits),
});
export function nativeTeam(model: string, thinking: string | null) {
  return {
    ...fakeTeamSnapshot,
    preset: {
      ...fakeTeamSnapshot.preset,
      name: "Owner-directed Pi workers",
      mode: "supervised" as const,
    },
    profiles: fakeTeamSnapshot.profiles.map((p) => ({
      ...p,
      name:
        p.permission === "coordinator"
          ? "Owner-directed (live Lead arrives in M4)"
          : p.name.replace("Fake ", "Pi "),
      model,
      thinking,
    })),
  };
}
