import { z } from "zod";
import {
  idSchema,
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
