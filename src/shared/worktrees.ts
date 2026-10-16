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
