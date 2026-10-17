import { z } from "zod";
import { nativePermissionDenialSchema } from "../native-permissions.ts";
import {
  humanRequestStatusSchema,
  processStateSchema,
  taskStatusSchema,
} from "./states.ts";

export const idSchema = z.uuid();
export const textSchema = z.string().trim().min(1).max(32_768);
export const absolutePathSchema = z
  .string()
  .startsWith("/")
  .max(4096)
  .refine((s) => !s.includes("\0"), "Path contains NUL");
export const timestampSchema = z.iso.datetime();
export const shaSchema = z.string().regex(/^[0-9a-f]{40,64}$/);
export const harnessSchema = z.enum(["codex", "claude-code", "opencode", "pi"]);
export const adapterKindSchema = z.enum([
  "codex",
  "claude-code",
  "opencode",
  "pi",
  "fake",
]);
export const modeSchema = z.enum([
  "chat_plan",
  "supervised",
  "autonomous_bounded",
]);
export const repositorySchema = z.strictObject({
  root: absolutePathSchema,
  commonDirectory: absolutePathSchema,
  baseSha: shaSchema,
  branch: textSchema,
  clean: z.boolean(),
});
export const permissionSchema = z.enum([
  "read_only",
  "workspace_write",
  "coordinator",
]);
export const contextPolicySchema = z.enum(["auto", "fresh", "resume"]);
const metadata = {
  id: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};
const idsSchema = z
  .array(idSchema)
  .max(256)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate references");

export const projectSchema = z.strictObject({
  ...metadata,
  name: textSchema,
  repositoryPath: absolutePathSchema,
  repository: repositorySchema.nullable().default(null),
});
export type Project = z.infer<typeof projectSchema>;

export const roleTemplateSchema = z.strictObject({
  ...metadata,
  version: z.int().positive(),
  name: textSchema,
  instructions: textSchema,
  expectedOutput: textSchema,
});
export type RoleTemplate = z.infer<typeof roleTemplateSchema>;
export const agentProfileSchema = z.strictObject({
  ...metadata,
  name: textSchema,
  roleId: idSchema,
  harness: harnessSchema,
  model: textSchema,
  thinking: textSchema.nullable(),
  permission: permissionSchema,
  instructionOverride: textSchema.nullable(),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const limitsSchema = z.strictObject({
  maxConcurrentWriters: z.int().min(1).max(64),
  maxConcurrentReadersReviewers: z.int().min(1).max(64),
  maxConcurrentAgentsIncludingLead: z.int().min(1).max(128),
  maxTotalWorkerLaunchesPerRun: z.int().min(1).max(10_000),
  maxParallelReadersPerWorkflow: z.int().min(1).max(64),
  maxRevisionCyclesPerTask: z.int().min(0).max(100),
  maxAutomaticLeadWakeupsPerRun: z.int().min(0).max(10_000),
});
export const defaultLimits = limitsSchema.parse({
  maxConcurrentWriters: 2,
  maxConcurrentReadersReviewers: 4,
  maxConcurrentAgentsIncludingLead: 7,
  maxTotalWorkerLaunchesPerRun: 24,
  maxParallelReadersPerWorkflow: 4,
  maxRevisionCyclesPerTask: 2,
  maxAutomaticLeadWakeupsPerRun: 40,
});
export const teamPresetSchema = z.strictObject({
  ...metadata,
  version: z.int().positive(),
  name: textSchema,
  leadProfileId: idSchema,
  workerProfileIds: idsSchema,
  workflowTemplateIds: idsSchema,
  mode: modeSchema,
  limits: limitsSchema,
});
export type TeamPreset = z.infer<typeof teamPresetSchema>;

export const workflowTemplateSchema = z.strictObject({
  ...metadata,
  version: z.int().positive(),
  name: textSchema,
  stages: z
    .array(
      z.strictObject({
        id: textSchema,
        type: z.enum([
          "single_agent",
          "parallel_agents",
          "synthesize",
          "review",
        ]),
        profileId: idSchema,
        instructions: textSchema,
        dependsOn: z.array(textSchema),
        count: z.int().min(1).max(64),
        partialFailure: z.enum(["stop", "include_partial"]),
      }),
    )
    .min(1)
    .max(128),
});
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;
export const teamSnapshotSchema = z
  .strictObject({
    preset: teamPresetSchema,
    roles: z.array(roleTemplateSchema),
    profiles: z.array(agentProfileSchema),
    workflows: z.array(workflowTemplateSchema),
  })
  .superRefine((snapshot, context) => {
    const roles = new Set(snapshot.roles.map((role) => role.id));
    const profiles = new Set(snapshot.profiles.map((profile) => profile.id));
    const workflows = new Set(
      snapshot.workflows.map((workflow) => workflow.id),
    );
    if (
      roles.size !== snapshot.roles.length ||
      profiles.size !== snapshot.profiles.length ||
      workflows.size !== snapshot.workflows.length
    )
      context.addIssue({
        code: "custom",
        message: "Snapshot contains duplicate identities",
      });
    if (
      !profiles.has(snapshot.preset.leadProfileId) ||
      snapshot.preset.workerProfileIds.some((id) => !profiles.has(id))
    )
      context.addIssue({
        code: "custom",
        message: "Snapshot is missing a team profile",
      });
    if (snapshot.profiles.some((profile) => !roles.has(profile.roleId)))
      context.addIssue({
        code: "custom",
        message: "Snapshot is missing profile role guidance",
      });
    if (
      snapshot.preset.workflowTemplateIds.some((id) => !workflows.has(id)) ||
      snapshot.workflows.some((workflow) =>
        workflow.stages.some((stage) => !profiles.has(stage.profileId)),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Snapshot is missing a workflow or stage profile",
      });
  });
export const runSchema = z.strictObject({
  ...metadata,
  projectId: idSchema,
  title: textSchema,
  initialPrompt: textSchema,
  mode: modeSchema,
  status: z.enum(["active", "paused", "stopped", "completed"]),
  teamSnapshot: teamSnapshotSchema.nullable(),
  limits: limitsSchema,
  execution: z.enum(["fake", "native"]),
  repository: repositorySchema.nullable().default(null),
});
export type Run = z.infer<typeof runSchema>;
export const taskSchema = z.strictObject({
  ...metadata,
  runId: idSchema,
  parentTaskId: idSchema.nullable(),
  workflowId: idSchema.nullable(),
  title: textSchema,
  objective: textSchema,
  scope: z.array(textSchema).max(256),
  acceptanceCriteria: z.array(textSchema).max(256),
  priority: z.int().min(-100).max(100),
  origin: z.enum(["owner", "lead", "workflow", "worker"]),
  dependencyIds: idsSchema,
  status: taskStatusSchema,
  assignedProfileId: idSchema.nullable(),
  // A Supervised Lead's suggested worker; never dispatched without the owner.
  proposedProfileId: idSchema.nullable().default(null),
  ownerPinned: z.boolean(),
  kind: z.enum(["lead", "work"]).default("work"),
  // Set only by the engine: a read-only review of this immutable candidate.
  reviewCandidateId: idSchema.nullable().default(null),
  // Engine-owned revision lineage and immutable handoff; generic CRUD cannot set these.
  revisionSourceTaskId: idSchema.nullable().default(null),
  revisionCandidateId: idSchema.nullable().default(null),
  latestRevisionTaskId: idSchema.nullable().default(null),
});
export type Task = z.infer<typeof taskSchema>;
// interrupted: stopped, deadline or ended without authoritative completion;
// crashed: unexpected native exit; disconnected: control lost while the process
// may live; recovery_required: restart or unverifiable process/worktree facts.
export const recoveryCauseSchema = z.enum([
  "interrupted",
  "crashed",
  "disconnected",
  "recovery_required",
  "failed",
]);
export type RecoveryCause = z.infer<typeof recoveryCauseSchema>;
// Observed facts only. Path existence never proves checkout identity, and a
// missing folder or absent PID never proves the worker ended.
export const recoveryCheckSchema = z.strictObject({
  id: idSchema,
  observedAt: timestampSchema,
  repository: z.strictObject({
    state: z.enum(["verified", "changed", "unavailable"]),
    reason: textSchema,
  }),
  worktree: z.strictObject({
    path: absolutePathSchema.nullable(),
    state: z.enum([
      "verified",
      "missing",
      "inaccessible",
      "replaced",
      "unverified",
      "not_isolated",
    ]),
    reason: textSchema,
  }),
  process: z.strictObject({
    processId: z.int().positive().nullable(),
    state: z.enum(["not_recorded", "not_running", "pid_present", "unknown"]),
    reason: textSchema,
  }),
});
export type RecoveryCheck = z.infer<typeof recoveryCheckSchema>;
export const attemptRecoverySchema = z.strictObject({
  cause: recoveryCauseSchema,
  reason: textSchema,
  recordedAt: timestampSchema,
  checks: z.array(recoveryCheckSchema).max(20),
  decision: z
    .strictObject({
      decidedAt: timestampSchema,
      checkId: idSchema,
      profileId: idSchema,
      acceptedUnverified: z.boolean(),
    })
    .nullable(),
});
export type AttemptRecovery = z.infer<typeof attemptRecoverySchema>;
export const attemptSchema = z.strictObject({
  ...metadata,
  taskId: idSchema,
  profileId: idSchema.nullable(),
  adapter: adapterKindSchema,
  dispatchId: idSchema,
  intendedOperation: textSchema,
  cwd: absolutePathSchema,
  worktreePath: absolutePathSchema.nullable(),
  baseSha: textSchema.nullable(),
  status: z.enum([
    "created",
    "running",
    "completed",
    "failed",
    "interrupted",
    "cancelled",
    "RECOVERY_REQUIRED",
  ]),
  recovery: attemptRecoverySchema.nullable().default(null),
});
export type Attempt = z.infer<typeof attemptSchema>;
export const workerMessageSchema = z.strictObject({
  ...metadata,
  runId: idSchema,
  taskId: idSchema,
  attemptId: idSchema,
  sessionId: idSchema,
  kind: z.enum(["steer", "follow_up"]),
  text: textSchema.max(4000),
  status: z.enum([
    "sending",
    "delivered",
    "queued",
    "unsupported",
    "unconfirmed",
  ]),
  diagnostic: textSchema,
});
export type WorkerMessage = z.infer<typeof workerMessageSchema>;
// Owner stop intent for one session. Only process/session evidence settles it;
// a closed view, a missing folder or silence never does.
export const stopRecordSchema = z.strictObject({
  id: idSchema,
  scope: z.enum(["task", "run", "emergency"]),
  requestedAt: timestampSchema,
  processId: z.int().positive().nullable(),
  status: z.enum(["pending", "confirmed", "failed", "uncertain"]),
  resolvedAt: timestampSchema.nullable(),
  evidence: textSchema.nullable(),
  diagnostic: textSchema.nullable(),
});
export type StopRecord = z.infer<typeof stopRecordSchema>;
export const sessionSchema = z.strictObject({
  ...metadata,
  attemptId: idSchema,
  adapter: adapterKindSchema,
  nativeSessionId: textSchema.nullable(),
  processId: z.int().positive().nullable(),
  state: processStateSchema,
  contextPolicy: contextPolicySchema,
  exitCode: z.int().nullable(),
  recovery: z.enum(["none", "RECOVERY_REQUIRED"]),
  ownerMessages: z.array(workerMessageSchema).default([]),
  stops: z.array(stopRecordSchema).default([]),
});
export type Session = z.infer<typeof sessionSchema>;

export const eventSchema = z.strictObject({
  id: idSchema,
  sequence: z.int().positive(),
  createdAt: timestampSchema,
  runId: idSchema.nullable(),
  taskId: idSchema.nullable(),
  attemptId: idSchema.nullable(),
  sessionId: idSchema.nullable(),
  type: textSchema,
  correlationId: textSchema,
  causationId: idSchema.nullable(),
  payload: z.record(z.string(), z.json()),
});
export type Event = z.infer<typeof eventSchema>;
export const humanRequestSchema = z.strictObject({
  ...metadata,
  runId: idSchema,
  sessionId: idSchema.nullable(),
  affectedTaskIds: idsSchema,
  type: z.enum([
    "permission",
    "environment",
    "clarification",
    "credential_setup",
    "risky_operation",
    "manual_check",
  ]),
  urgency: z.enum(["low", "normal", "high", "urgent"]),
  reason: textSchema,
  suggestedAction: textSchema,
  blocking: z.boolean(),
  status: humanRequestStatusSchema,
  ownerResponse: textSchema.nullable(),
  resolvedAt: timestampSchema.nullable(),
  nativePermission: nativePermissionDenialSchema.nullable().default(null),
});
export type HumanRequest = z.infer<typeof humanRequestSchema>;

export const reviewResultSchema = z
  .strictObject({
    summary: textSchema.max(4000),
    recommendation: z.enum(["pass", "changes_requested"]),
    findings: z
      .array(
        z.strictObject({
          severity: z.enum(["blocking", "important", "suggestion", "nit"]),
          file: textSchema
            .max(1024)
            .refine(
              (path) =>
                !path.includes("\\") &&
                !Array.from(path).some((char) => char.charCodeAt(0) < 32) &&
                path
                  .split("/")
                  .every((part) => part && part !== "." && part !== ".."),
              "Use a repository-relative file path without traversal",
            ),
          line: z.int().positive(),
          justification: textSchema.max(4000),
          evidence: textSchema.max(4000),
          confidence: z.number().min(0).max(1),
        }),
      )
      .max(100),
    tests: z
      .array(
        z.strictObject({
          command: textSchema.max(1000),
          // Current reviewers have file tools only; test claims cannot be accepted.
          result: z.literal("not_run"),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((review, context) => {
    const serious = review.findings.some((f) =>
      ["blocking", "important"].includes(f.severity),
    );
    if (
      (review.recommendation === "pass" && serious) ||
      (review.recommendation === "changes_requested" && !review.findings.length)
    )
      context.addIssue({
        code: "custom",
        path: ["recommendation"],
        message:
          "A pass cannot have blocking/important findings; changes requested needs an actionable finding",
      });
  });
export const reviewSchema = reviewResultSchema.safeExtend({
  ...metadata,
  // The implementation task; the review child is linked by reviewerAttemptId.
  taskId: idSchema,
  reviewerAttemptId: idSchema,
  candidateId: idSchema,
});
export type Review = z.infer<typeof reviewSchema>;
export const integrationCandidateSchema = z.strictObject({
  ...metadata,
  taskId: idSchema,
  attemptId: idSchema,
  baseSha: shaSchema,
  candidateSha: shaSchema,
  // False when the worker never submitted a structured report: the candidate
  // then rests on Git state alone, with every new file blocked.
  reportSubmitted: z.boolean(),
  reviewIds: idsSchema,
  status: z.enum([
    "proposed",
    "reviewed",
    "approved",
    "rejected",
    "blocked",
    "integrated",
  ]),
  humanDecision: z.enum(["approved", "rejected"]).nullable(),
  decidedAt: timestampSchema.nullable(),
});
export type IntegrationCandidate = z.infer<typeof integrationCandidateSchema>;
export const artifactSchema = z.strictObject({
  ...metadata,
  taskId: idSchema,
  attemptId: idSchema.nullable(),
  kind: z.enum(["report", "log", "reference"]),
  path: absolutePathSchema,
  mediaType: textSchema,
  summary: textSchema,
});
export type Artifact = z.infer<typeof artifactSchema>;
