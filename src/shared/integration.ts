import { z } from "zod";
import {
  absolutePathSchema,
  idSchema,
  shaSchema,
  timestampSchema,
} from "./domain/entities.ts";

// Owner-declared test commands run as argv arrays, never through a shell.
export const integrationCommandSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(1000)
      .refine((arg) => !arg.includes("\0"), "Argument contains NUL"),
  )
  .min(1)
  .max(64);
export const destinationBranchSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (name) => !name.startsWith("-") && !name.startsWith("lao/"),
    "Choose a local branch outside the app-owned lao/ namespace",
  );
export const integrationRequestSchema = z.strictObject({
  taskId: idSchema,
  destinationBranch: destinationBranchSchema.optional(),
  tests: z.array(integrationCommandSchema).max(8).default([]),
  timeoutSeconds: z.int().min(1).max(3600).default(600),
});
export const integrationCheckSchema = z.strictObject({
  name: z.enum([
    "destination",
    "candidate",
    "apply",
    "overlap",
    "diff",
    "diff_check",
    "tests",
    "final_destination",
  ]),
  // A warning needs the owner's attention but does not fail the preview.
  status: z.enum(["passed", "warning", "failed", "skipped"]),
  detail: z.string().max(2000),
});
export type IntegrationCheck = z.infer<typeof integrationCheckSchema>;
export const integrationTestResultSchema = z.strictObject({
  argv: integrationCommandSchema,
  result: z.enum(["passed", "failed", "timed_out", "error", "interrupted"]),
  exitCode: z.int().nullable(),
  signal: z.string().nullable(),
  durationMs: z.int().min(0),
  artifactId: idSchema,
  outputTruncated: z.boolean(),
});
const fileSchema = z.strictObject({ status: z.string(), path: z.string() });
// How the destination moved away from the candidate base, and which files both
// sides changed. Null when the destination still points at the base.
export const integrationDriftSchema = z.strictObject({
  mergeBase: shaSchema,
  baseIsAncestor: z.boolean(),
  commits: z.int().min(0),
  files: z.array(fileSchema).max(200),
  filesTruncated: z.boolean(),
  overlapping: z.array(z.string()).max(500),
});
export type IntegrationDrift = z.infer<typeof integrationDriftSchema>;
export const integrationPreviewSchema = z.strictObject({
  id: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  runId: idSchema,
  // The original implementation task; revisions resolve to the current one.
  taskId: idSchema,
  implementationTaskId: idSchema,
  candidateId: idSchema,
  reviewId: idSchema,
  baseSha: shaSchema,
  candidateSha: shaSchema,
  destinationBranch: destinationBranchSchema,
  destinationSha: shaSchema.nullable(),
  worktreePath: absolutePathSchema,
  branch: z.string().startsWith("lao/integration-"),
  tests: z.array(integrationCommandSchema).max(8),
  timeoutSeconds: z.int().min(1).max(3600),
  status: z.enum(["preparing", "passed", "failed", "conflict", "interrupted"]),
  resultSha: shaSchema.nullable(),
  files: z.array(fileSchema),
  drift: integrationDriftSchema.nullable().default(null),
  // Unmerged paths left in the retained integration worktree; never resolved by the engine.
  conflicts: z.array(z.string()).max(500).default([]),
  checks: z.array(integrationCheckSchema),
  testResults: z.array(integrationTestResultSchema),
  diffArtifactId: idSchema.nullable(),
  diagnostic: z.string().max(2000).nullable(),
});
export type IntegrationPreview = z.infer<typeof integrationPreviewSchema>;
