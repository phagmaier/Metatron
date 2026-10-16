import { z } from "zod";
import {
  artifactSchema,
  attemptSchema,
  eventSchema,
  humanRequestSchema,
  idSchema,
  integrationCandidateSchema,
  projectSchema,
  reviewSchema,
  runSchema,
  sessionSchema,
  shaSchema,
  taskSchema,
} from "./domain/entities.ts";

export const projectsResponseSchema = z.strictObject({
  projects: z.array(projectSchema),
});
export const runsResponseSchema = z.strictObject({ runs: z.array(runSchema) });
export const tasksResponseSchema = z.strictObject({
  tasks: z.array(taskSchema),
});
export const sessionsResponseSchema = z.strictObject({
  sessions: z.array(sessionSchema),
});
export const attemptsResponseSchema = z.strictObject({
  attempts: z.array(attemptSchema),
});
export const humanRequestsResponseSchema = z.strictObject({
  humanRequests: z.array(humanRequestSchema),
});
export const eventsResponseSchema = z.strictObject({
  events: z.array(eventSchema),
});
// Every candidate and review across a task's revision lineage, oldest first.
export const reviewHistoryResponseSchema = z.strictObject({
  currentCandidateId: idSchema.nullable(),
  candidates: z.array(integrationCandidateSchema),
  reviews: z.array(
    z.strictObject({
      review: reviewSchema,
      reviewerProfileId: idSchema.nullable(),
    }),
  ),
});
export type ReviewHistory = z.infer<typeof reviewHistoryResponseSchema>;
export const candidateDiffResponseSchema = z.strictObject({
  candidateId: idSchema,
  baseSha: shaSchema,
  candidateSha: shaSchema,
  files: z.array(z.strictObject({ status: z.string(), path: z.string() })),
  patch: z.string(),
  truncated: z.boolean(),
});
export const artifactContentResponseSchema = z.strictObject({
  artifact: artifactSchema,
  content: z.string(),
  truncated: z.boolean(),
});
