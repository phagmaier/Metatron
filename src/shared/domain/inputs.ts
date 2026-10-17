import { z } from "zod";
import {
  absolutePathSchema,
  adapterKindSchema,
  contextPolicySchema,
  defaultLimits,
  idSchema,
  limitsSchema,
  modeSchema,
  repositorySchema,
  shaSchema,
  teamSnapshotSchema,
  textSchema,
} from "./entities.ts";
import {
  humanRequestStatusSchema,
  processStateSchema,
  taskStatusSchema,
} from "./states.ts";

export const mutationKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
export const createProjectSchema = z.strictObject({
  name: textSchema,
  repositoryPath: absolutePathSchema,
  repository: repositorySchema.nullable().default(null),
});
export const createRunSchema = z.strictObject({
  projectId: idSchema,
  title: textSchema,
  initialPrompt: textSchema,
  mode: modeSchema.default("autonomous_bounded"),
  limits: limitsSchema.default(defaultLimits),
  teamSnapshot: teamSnapshotSchema.nullable().default(null),
  execution: z.enum(["fake", "native"]).default("fake"),
  repository: repositorySchema.nullable().default(null),
});
export const updateRunSchema = z
  .strictObject({
    id: idSchema,
    mode: modeSchema.optional(),
    status: z.enum(["active", "paused", "stopped", "completed"]).optional(),
  })
  .refine(
    (v) => v.mode !== undefined || v.status !== undefined,
    "Empty update",
  );
export const createTaskSchema = z.strictObject({
  runId: idSchema,
  title: textSchema,
  objective: textSchema,
  scope: z.array(textSchema).max(256).default([]),
  acceptanceCriteria: z.array(textSchema).max(256).default([]),
  priority: z.int().min(-100).max(100).default(0),
  origin: z.enum(["owner", "lead", "workflow", "worker"]).default("owner"),
  parentTaskId: idSchema.nullable().default(null),
  workflowId: idSchema.nullable().default(null),
  dependencyIds: z.array(idSchema).max(256).default([]),
  kind: z.enum(["lead", "work"]).default("work"),
});
export const transitionTaskSchema = z.strictObject({
  id: idSchema,
  expectedStatus: taskStatusSchema,
  status: taskStatusSchema,
  reason: textSchema,
});
export const updateTaskSchema = z
  .strictObject({
    id: idSchema,
    title: textSchema.optional(),
    objective: textSchema.optional(),
    scope: z.array(textSchema).max(256).optional(),
    acceptanceCriteria: z.array(textSchema).max(256).optional(),
    priority: z.int().min(-100).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 1, "Empty update");
export const createAttemptSchema = z.strictObject({
  taskId: idSchema,
  profileId: idSchema.nullable().default(null),
  adapter: adapterKindSchema,
  intendedOperation: textSchema,
  cwd: absolutePathSchema,
  worktreePath: absolutePathSchema.nullable().default(null),
  baseSha: textSchema.nullable().default(null),
});
export const updateAttemptSchema = z.strictObject({
  id: idSchema,
  status: z.enum([
    "running",
    "completed",
    "failed",
    "interrupted",
    "cancelled",
    "RECOVERY_REQUIRED",
  ]),
});
export const createSessionSchema = z.strictObject({
  attemptId: idSchema,
  contextPolicy: contextPolicySchema.default("fresh"),
  nativeSessionId: textSchema.nullable().default(null),
});
export const updateSessionSchema = z.strictObject({
  id: idSchema,
  expectedState: processStateSchema,
  state: processStateSchema,
  nativeSessionId: textSchema.optional(),
  processId: z.int().positive().nullable().optional(),
  processIdentity: textSchema.nullable().optional(),
  exitCode: z.int().nullable().optional(),
});
export const createHumanRequestSchema = z
  .strictObject({
    runId: idSchema,
    sessionId: idSchema.nullable().default(null),
    affectedTaskIds: z
      .array(idSchema)
      .max(256)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Task links must be unique",
      ),
    type: z.enum([
      "permission",
      "environment",
      "clarification",
      "credential_setup",
      "risky_operation",
      "manual_check",
    ]),
    urgency: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    reason: textSchema,
    suggestedAction: textSchema,
    blocking: z.boolean(),
  })
  .refine(
    (request) => !request.blocking || request.affectedTaskIds.length > 0,
    "A blocking request needs an affected task",
  );
export const updateHumanRequestSchema = z
  .strictObject({
    id: idSchema,
    expectedStatus: humanRequestStatusSchema,
    status: humanRequestStatusSchema,
    ownerResponse: textSchema.nullable().optional(),
  })
  .refine(
    (reply) => reply.status !== "answered" || !!reply.ownerResponse,
    "An answer needs response text",
  );
export const createIntegrationCandidateSchema = z.strictObject({
  attemptId: idSchema,
  baseSha: shaSchema,
  candidateSha: shaSchema,
  reportSubmitted: z.boolean(),
});
export const appendEventSchema = z.strictObject({
  runId: idSchema.nullable().default(null),
  taskId: idSchema.nullable().default(null),
  attemptId: idSchema.nullable().default(null),
  sessionId: idSchema.nullable().default(null),
  type: textSchema,
  correlationId: textSchema,
  causationId: idSchema.nullable().default(null),
  payload: z.record(z.string(), z.json()),
});
export const eventQuerySchema = z.strictObject({
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  runId: idSchema.optional(),
});
