import { z } from "zod";
import {
  absolutePathSchema,
  defaultLimits,
  humanRequestSchema,
  idSchema,
  limitsSchema,
  modeSchema,
  reviewResultSchema,
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
const shortText = (max: number) => z.string().trim().min(1).max(max);
const urgencySchema = z.enum(["low", "normal", "high", "urgent"]);
// spec §6.2 handoff report. Bounded so a worker cannot flood the journal.
export const handoffReportSchema = z.strictObject({
  outcome: z.enum(["completed", "partial", "failed", "blocked"]),
  summary: shortText(4000),
  changedFiles: z.array(shortText(1024)).max(500).default([]),
  tests: z
    .array(
      z.strictObject({
        command: shortText(1000),
        result: z.enum(["passed", "failed", "not_run"]),
      }),
    )
    .max(100)
    .default([]),
  findings: z
    .array(
      z.strictObject({
        severity: z.enum(["info", "low", "medium", "high", "critical"]),
        location: shortText(1024),
        text: shortText(4000),
      }),
    )
    .max(100)
    .default([]),
  knownRisks: z.array(shortText(2000)).max(50).default([]),
  questions: z.array(shortText(2000)).max(50).default([]),
  artifactRefs: z.array(shortText(1024)).max(50).default([]),
  revisionOrCommit: shortText(200).nullable().default(null),
});
export type HandoffReport = z.infer<typeof handoffReportSchema>;
const taskTool = <N extends string>(name: N) =>
  z.strictObject({ name: z.literal(name), taskId: idSchema });
const humanTool = <N extends string>(name: N) =>
  z.strictObject({
    name: z.literal(name),
    summary: shortText(500),
    details: shortText(8000),
    urgency: urgencySchema.default("normal"),
    taskIds: z.array(idSchema).max(32).default([]),
  });
export const toolSchema = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("get_run_status") }),
  z.strictObject({ name: z.literal("list_tasks") }),
  taskTool("get_task"),
  taskTool("get_worker_status"),
  taskTool("read_report"),
  z.strictObject({
    name: z.literal("propose_task"),
    title: shortText(200),
    objective: shortText(8000),
    acceptanceCriteria: z.array(shortText(1000)).max(32).default([]),
    priority: z.int().min(-100).max(100).default(0),
  }),
  z.strictObject({
    name: z.literal("assign_task"),
    taskId: idSchema,
    profileId: idSchema,
    scenario: scenarioSchema.default("success"),
  }),
  z.strictObject({
    name: z.literal("request_revision"),
    taskId: idSchema,
    feedback: shortText(8000),
  }),
  z.strictObject({
    name: z.literal("request_review"),
    taskId: idSchema,
    profileId: idSchema,
  }),
  humanTool("escalate_issue"),
  humanTool("request_human_input"),
  taskTool("read_assignment"),
  z.strictObject({
    name: z.literal("report_progress"),
    taskId: idSchema,
    summary: shortText(2000),
  }),
  z.strictObject({
    name: z.literal("submit_result"),
    taskId: idSchema,
    report: z.union([textSchema, handoffReportSchema, reviewResultSchema]),
  }),
  z.strictObject({
    name: z.literal("report_issue"),
    taskId: idSchema,
    summary: shortText(500),
    details: shortText(8000),
    urgency: urgencySchema.default("normal"),
    blocking: z.boolean().default(false),
    suggestedAction: shortText(2000).optional(),
  }),
  z.strictObject({
    name: z.literal("request_human_action"),
    taskId: idSchema,
    type: humanRequestSchema.shape.type,
    urgency: urgencySchema.default("normal"),
    reason: shortText(8000),
    suggestedAction: shortText(2000),
    blocking: z.boolean().default(true),
  }),
]);
export type ToolInput = z.infer<typeof toolSchema>;
export type ToolName = ToolInput["name"];
export const leadReadTools = [
  "get_run_status",
  "list_tasks",
  "get_task",
  "get_worker_status",
  "read_report",
] as const satisfies readonly ToolName[];
export const workerTools = [
  "read_assignment",
  "report_progress",
  "submit_result",
  "report_issue",
  "request_human_action",
] as const satisfies readonly ToolName[];
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
