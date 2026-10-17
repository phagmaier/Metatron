import { z } from "zod";
import {
  idSchema,
  idsSchema,
  limitsSchema,
  modeSchema,
  teamPresetSchema,
  textSchema,
  workflowTemplateSchema,
} from "./domain/entities.ts";
import { scenarioSchema } from "./orchestration.ts";

export const teamContentSchema = z.strictObject({
  name: textSchema.max(160),
  leadProfileId: idSchema,
  workerProfileIds: idsSchema.min(1),
  workflowTemplateIds: idsSchema,
  mode: modeSchema,
  limits: limitsSchema,
});
export type TeamContent = z.infer<typeof teamContentSchema>;
export const teamReferenceSchema = z.strictObject({ id: idSchema });
export const updateTeamSchema = teamContentSchema.extend({
  id: idSchema,
  version: z.int().positive(),
});
export const deleteTeamSchema = z.strictObject({
  id: idSchema,
  version: z.int().positive(),
});
export const teamsResponseSchema = z.strictObject({
  teams: z.array(teamPresetSchema),
  demoTeamIds: z.array(idSchema),
  workflows: z.array(workflowTemplateSchema),
});
// The owner confirms the team version they reviewed. Mode, limits, roster and
// workflows come only from that saved team; scenario is FAKE playback only.
export const startTeamRunSchema = z.strictObject({
  projectId: idSchema,
  teamId: idSchema,
  teamVersion: z.int().positive(),
  title: textSchema,
  initialPrompt: textSchema,
  scenario: scenarioSchema.default("success"),
});
