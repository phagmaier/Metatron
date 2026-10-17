import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  artifactSchema,
  idSchema,
  workflowTemplateSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { workflowContentSchema } from "../../shared/domain/workflow.ts";
import {
  exploreSubsystemConfigSchema,
  exploreSubsystemContent,
} from "../../shared/workflow-presets.ts";
import { type WorkflowRun, workflowRunSchema } from "../../shared/workflows.ts";
import { mutate } from "./mutations.ts";
import { getProfile } from "./profiles.ts";
import type { Store } from "./store.ts";

export function createWorkflowTemplate(
  store: Store,
  input: unknown,
  key: string,
) {
  const data = workflowContentSchema.parse(input);
  return mutate(
    store.db,
    key,
    "createWorkflowTemplate",
    data,
    workflowTemplateSchema,
    () => {
      for (const stage of data.stages) {
        const profile = getProfile(store, { id: stage.profileId });
        if (profile.permission === "coordinator")
          throw new DomainError(
            "POLICY_DENIED",
            "Workflow stages need worker profiles, not a coordinator",
          );
      }
      const now = new Date().toISOString();
      const template = workflowTemplateSchema.parse({
        ...data,
        id: randomUUID(),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      store.db
        .prepare("INSERT INTO workflow_templates VALUES (?,?)")
        .run(template.id, JSON.stringify(template));
      store.recordEvent(
        {
          type: "workflow_template.created",
          correlationId: key,
          payload: { templateId: template.id, version: template.version },
        },
        `${key}:event`,
      );
      return template;
    },
  );
}

export function createExploreSubsystemTemplate(
  store: Store,
  input: unknown,
  key: string,
) {
  const config = exploreSubsystemConfigSchema.parse(input);
  return mutate(
    store.db,
    key,
    "createExploreSubsystemTemplate",
    config,
    workflowTemplateSchema,
    () => {
      for (const id of [config.readerProfileId, config.synthesizerProfileId]) {
        if (getProfile(store, { id }).permission !== "read_only")
          throw new DomainError(
            "POLICY_DENIED",
            "Explore Subsystem requires read-only reader and synthesizer profiles",
          );
      }
      return createWorkflowTemplate(
        store,
        exploreSubsystemContent(config),
        `${key}:template`,
      );
    },
  );
}

export function listWorkflowRuns(store: Store, runId?: string) {
  if (runId) idSchema.parse(runId);
  return store.db
    .prepare("SELECT data FROM workflow_runs ORDER BY rowid")
    .all()
    .map((row) => workflowRunSchema.parse(JSON.parse(String(row.data))))
    .filter((workflow) => !runId || workflow.runId === runId);
}
export function getWorkflowRun(store: Store, id: string) {
  idSchema.parse(id);
  const row = store.db
    .prepare("SELECT data FROM workflow_runs WHERE id=?")
    .get(id);
  if (!row) throw new DomainError("NOT_FOUND", "Workflow execution not found");
  return workflowRunSchema.parse(JSON.parse(String(row.data)));
}
export function saveWorkflowRun(
  store: Store,
  workflow: WorkflowRun,
  key: string,
) {
  const data = workflowRunSchema.parse(workflow);
  return mutate(
    store.db,
    key,
    "saveWorkflowRun",
    data,
    workflowRunSchema,
    () => {
      store.db
        .prepare("UPDATE workflow_runs SET data=? WHERE id=?")
        .run(JSON.stringify(data), data.id);
      store.recordEvent(
        {
          type: "workflow.updated",
          runId: data.runId,
          correlationId: key,
          payload: {
            workflowId: data.id,
            status: data.status,
            stages: data.stages,
          },
        },
        `${key}:event`,
      );
      return data;
    },
  );
}

export function workflowChild(store: Store, taskId: string) {
  const task = store.getTask(taskId);
  if (!task.workflowId) return null;
  const workflow = getWorkflowRun(store, task.workflowId);
  const state = workflow.stages.find((stage) => stage.taskIds.includes(taskId));
  const stage = workflow.template.stages.find(
    (stage) => stage.id === state?.stageId,
  );
  if (!state || !stage || workflow.runId !== task.runId)
    throw new DomainError(
      "INVALID_REFERENCE",
      "Task is not a child of this workflow",
    );
  return { workflow, state, stage };
}
export function assertWorkflowAssignment(store: Store, taskId: string) {
  const child = workflowChild(store, taskId);
  // Preparation is immutable; the owner can still override a queued worker
  // through normal roster, permission, pin and budget validation.
  if (child && child.state.status !== "queued")
    throw new DomainError(
      "POLICY_DENIED",
      "Workflow stage inputs and prerequisites must be prepared before dispatch",
    );
}

export function workflowOutcome(store: Store, taskId: string) {
  const task = store.getTask(taskId);
  const attempt = store
    .listAttempts()
    .findLast((attempt) => attempt.taskId === taskId);
  const reserved =
    attempt &&
    store.db
      .prepare("SELECT 1 FROM reservations WHERE attempt_id=?")
      .get(attempt.id);
  const artifact =
    attempt?.status === "completed" && task.status !== "CANCELLED"
      ? store.db
          .prepare(
            "SELECT data FROM artifacts WHERE attempt_id=? AND json_extract(data,'$.kind')='report' ORDER BY rowid DESC LIMIT 1",
          )
          .get(attempt.id)
      : undefined;
  const report = artifact
    ? artifactSchema.parse(JSON.parse(String(artifact.data)))
    : null;
  const blocked = store.db
    .prepare(
      "SELECT diagnostic FROM dispatches WHERE task_id=? AND state='blocked'",
    )
    .get(taskId);
  const status = reserved
    ? "waiting"
    : report
      ? "completed"
      : blocked ||
          attempt?.status === "RECOVERY_REQUIRED" ||
          attempt?.status === "interrupted" ||
          attempt?.status === "completed"
        ? "blocked"
        : task.status === "CANCELLED" || attempt?.status === "failed"
          ? "failed"
          : "waiting";
  return {
    taskId,
    status,
    report,
    attemptId: attempt?.id ?? null,
    diagnostic: blocked?.diagnostic == null ? null : String(blocked.diagnostic),
  };
}

export const workflowResultSchema = z.array(
  z.strictObject({
    name: z.string(),
    stageId: z.string(),
    status: z.string(),
    taskIds: z.array(idSchema),
  }),
);
