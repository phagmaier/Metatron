import { z } from "zod";
import {
  artifactSchema,
  attemptSchema,
  idSchema,
  taskSchema,
  timestampSchema,
  workflowTemplateSchema,
} from "./domain/entities.ts";

export const startWorkflowSchema = z
  .strictObject({
    runId: idSchema,
    templateId: idSchema,
    parameters: z.record(z.string(), z.string().trim().min(1).max(4000)),
  })
  .refine(
    (input) => Object.values(input.parameters).join("").length <= 4000,
    "Workflow parameter values exceed 4000 characters",
  );
export const workflowStageStateSchema = z.strictObject({
  stageId: z.string(),
  taskIds: z.array(idSchema),
  status: z.enum([
    "pending",
    "queued",
    "completed",
    "partial",
    "failed",
    "blocked",
  ]),
  diagnostic: z.string().nullable(),
});
export const workflowRunSchema = z.strictObject({
  id: idSchema,
  runId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  template: workflowTemplateSchema,
  parameters: z.record(z.string(), z.string()),
  status: z.enum(["running", "completed", "partial", "failed", "blocked"]),
  stages: z.array(workflowStageStateSchema),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowStageState = z.infer<typeof workflowStageStateSchema>;

export const workflowSourceSchema = z
  .strictObject({
    input: z.string().min(1).max(64),
    stageId: z.string().min(1).max(64),
    taskId: idSchema,
    attemptId: idSchema.nullable(),
    status: z.enum(["completed", "failed"]),
    artifactId: idSchema.nullable(),
    resultEventId: idSchema.nullable(),
    failureEventId: idSchema.nullable(),
    failure: z.enum(["failed", "cancelled"]).nullable(),
    diagnostic: z.string().min(1).max(4000).nullable(),
  })
  .refine(
    (source) =>
      source.status === "completed"
        ? source.attemptId !== null &&
          source.artifactId !== null &&
          source.failure === null &&
          source.failureEventId === null &&
          source.diagnostic === null
        : source.artifactId === null &&
          source.failure !== null &&
          source.diagnostic !== null,
    "Completed sources require a report; failed sources retain a reason, never a fabricated report",
  );
export type WorkflowSource = z.infer<typeof workflowSourceSchema>;

export const workflowHandoffSchema = z.strictObject({
  taskId: idSchema,
  workflowId: idSchema,
  stageId: z.string().min(1).max(64),
  createdAt: timestampSchema,
  parameters: z.record(z.string(), z.string().max(4000)),
  sources: z.array(workflowSourceSchema).max(4096),
});
export type WorkflowHandoff = z.infer<typeof workflowHandoffSchema>;

const evidenceEventSchema = z.strictObject({
  eventId: idSchema,
  type: z.string(),
  payload: z.record(z.string(), z.json()),
});
// One grouped read model per workflow: its saved state plus every child's
// canonical attempts, artifacts and provenance, so the GUI never reconstructs it.
export const workflowsResponseSchema = z.strictObject({
  workflows: z.array(
    z.strictObject({
      workflow: workflowRunSchema,
      children: z.array(
        z.strictObject({
          stageId: z.string(),
          task: taskSchema,
          outcome: z.strictObject({
            status: z.enum(["waiting", "blocked", "completed", "failed"]),
            diagnostic: z.string().nullable(),
          }),
          handoff: workflowHandoffSchema.nullable(),
          taskArtifacts: z.array(artifactSchema),
          attempts: z.array(
            z.strictObject({
              attempt: attemptSchema,
              artifacts: z.array(artifactSchema),
              resultEvent: evidenceEventSchema.nullable(),
              diagnostics: z.array(evidenceEventSchema),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type WorkflowView = z.infer<
  typeof workflowsResponseSchema
>["workflows"][number];
