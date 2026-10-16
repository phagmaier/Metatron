import { z } from "zod";
import {
  attemptSchema,
  eventSchema,
  humanRequestSchema,
  projectSchema,
  runSchema,
  sessionSchema,
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
