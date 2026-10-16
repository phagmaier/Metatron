import { z } from "zod";
import {
  absolutePathSchema,
  defaultLimits,
  idSchema,
  limitsSchema,
  modeSchema,
  textSchema,
} from "./domain/entities.ts";

export const scenarioSchema = z.enum(["success", "failure", "disconnect"]);
export const openProjectSchema = z.strictObject({
  name: textSchema,
  repositoryPath: absolutePathSchema,
});
export const startRunSchema = z.strictObject({
  projectId: idSchema,
  title: textSchema,
  initialPrompt: textSchema,
  leadProfileId: idSchema,
  mode: modeSchema.default("autonomous_bounded"),
  limits: limitsSchema.default(defaultLimits),
  scenario: scenarioSchema.default("success"),
});
export const ownerMessageSchema = z.strictObject({
  runId: idSchema,
  text: textSchema,
  scenario: scenarioSchema.default("success"),
});
export const assignSchema = z.strictObject({
  taskId: idSchema,
  profileId: idSchema,
  scenario: scenarioSchema.default("success"),
});
export const ownerTaskSchema = z.strictObject({
  runId: idSchema,
  title: textSchema,
  objective: textSchema,
  dependencyIds: z.array(idSchema).max(256).default([]),
  priority: z.int().min(-100).max(100).default(0),
});
export const toolSchema = z.discriminatedUnion("name", [
  z.strictObject({
    name: z.literal("propose_task"),
    title: textSchema,
    objective: textSchema,
  }),
  z.strictObject({
    name: z.literal("assign_task"),
    taskId: idSchema,
    profileId: idSchema,
    scenario: scenarioSchema.default("success"),
  }),
  z.strictObject({
    name: z.literal("submit_result"),
    taskId: idSchema,
    report: textSchema,
  }),
]);
export const dispatchSchema = z.strictObject({
  sequence: z.int().positive(),
  taskId: idSchema,
  runId: idSchema,
  profileId: idSchema,
  cwd: absolutePathSchema,
  scenario: scenarioSchema,
  state: z.enum(["queued", "active", "released", "blocked"]),
  attemptId: idSchema.nullable(),
  diagnostic: z.string().nullable(),
});
export type Dispatch = z.infer<typeof dispatchSchema>;
export type Actor =
  | { role: "owner" }
  | { role: "lead" | "worker"; sessionId: string };
