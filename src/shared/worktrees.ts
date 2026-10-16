import { z } from "zod";
import {
  absolutePathSchema,
  idSchema,
  repositorySchema,
} from "./domain/entities.ts";

export const worktreeSchema = z.strictObject({
  attemptId: idSchema,
  path: absolutePathSchema,
  branch: z.string().startsWith("lao/attempt-"),
  ownerToken: idSchema,
  repository: repositorySchema,
  state: z.enum(["creating", "ready", "retained", "error"]),
});
export type Worktree = z.infer<typeof worktreeSchema>;
export const worktreeEvidenceSchema = z.strictObject({
  attemptId: idSchema,
  path: absolutePathSchema,
  baseSha: z.string(),
  headSha: z.string(),
  files: z.array(
    z.strictObject({
      path: z.string(),
      status: z.string(),
      sensitive: z.boolean(),
    }),
  ),
  stagedDiffStat: z.string(),
  unstagedDiffStat: z.string(),
  diffCheck: z.enum(["passed", "failed"]),
  tests: z.literal("not_run: shell tools are disabled in M3"),
});
export const candidateSchema = z
  .strictObject({
    attemptId: idSchema,
    status: z.enum(["captured", "empty", "blocked"]),
    baseSha: z.string(),
    headSha: z.string(),
    candidateSha: z.string().nullable(),
    branch: z.string().startsWith("lao/candidate-").nullable(),
    files: z.array(
      z.strictObject({
        path: z.string(),
        change: z.enum([
          "added",
          "modified",
          "deleted",
          "type_changed",
          "ignored",
        ]),
        disposition: z.enum(["included", "excluded", "blocked"]),
        reason: z.string().nullable(),
      }),
    ),
    declaredUnchanged: z.array(z.string()),
    blockers: z.array(z.string()),
  })
  .refine(
    (c) =>
      (c.status === "captured") ===
        (c.candidateSha !== null && c.branch !== null) &&
      (c.status === "blocked") === c.blockers.length > 0,
    "Only a captured candidate has a commit; only a blocked one has blockers",
  );
export type Candidate = z.infer<typeof candidateSchema>;
