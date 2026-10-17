import { z } from "zod";
import { idSchema, roleTemplateSchema, textSchema } from "./domain/entities.ts";

// Leave room for the engine's mandatory policy and result contracts in prompts.
export const roleContentSchema = z.strictObject({
  name: textSchema.max(160),
  instructions: textSchema.max(12_000),
  expectedOutput: textSchema.max(8_000),
});
export const roleReferenceSchema = z.strictObject({ id: idSchema });
export const updateRoleSchema = roleContentSchema.extend({
  id: idSchema,
  version: z.int().positive(),
});
export const deleteRoleSchema = z.strictObject({
  id: idSchema,
  version: z.int().positive(),
});
export const rolesResponseSchema = z.strictObject({
  roles: z.array(roleTemplateSchema),
});
// Imports create a new local identity. Portable guidance cannot replace a role
// by ID/name or smuggle harness, model, permission or scheduling configuration.
export const roleExportSchema = z.strictObject({
  format: z.literal("local-agent-orchestrator.role-template"),
  formatVersion: z.literal(1),
  role: roleContentSchema,
});
