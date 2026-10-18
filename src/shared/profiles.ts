import { z } from "zod";
import {
  agentProfileSchema,
  harnessSchema,
  idSchema,
  permissionSchema,
  textSchema,
} from "./domain/entities.ts";

export const profileContentSchema = z.strictObject({
  name: textSchema.max(160),
  roleId: idSchema,
  harness: harnessSchema,
  model: textSchema.max(512),
  thinking: textSchema.max(160).nullable(),
  permission: permissionSchema,
  instructionOverride: textSchema.max(4000).nullable(),
});
export type ProfileContent = z.infer<typeof profileContentSchema>;
export const profileReferenceSchema = z.strictObject({ id: idSchema });
export const updateProfileSchema = profileContentSchema.extend({
  id: idSchema,
  version: z.int().positive(),
});
export const deleteProfileSchema = z.strictObject({
  id: idSchema,
  version: z.int().positive(),
});
export const profilesResponseSchema = z.strictObject({
  profiles: z.array(agentProfileSchema),
  demoProfileIds: z.array(idSchema),
});
export const profileDiscoverySchema = z.strictObject({
  harness: harnessSchema,
});
// Setup state from fresh no-model discovery: "installed" means the executable
// was found but cannot be used yet; "unknown" means discovery itself failed.
export const harnessStateSchema = z.enum([
  "missing",
  "installed",
  "auth_required",
  "available",
  "unknown",
]);
export type HarnessState = z.infer<typeof harnessStateSchema>;
export const profileCapabilitiesSchema = z.strictObject({
  harness: harnessSchema,
  state: harnessStateSchema,
  version: textSchema.nullable(),
  nextStep: textSchema.nullable(),
  implemented: z.boolean(),
  installed: z.union([z.boolean(), z.literal("unknown")]),
  authenticated: z.union([z.boolean(), z.literal("unknown")]),
  models: z.array(
    z.strictObject({
      id: textSchema,
      label: textSchema,
      thinking: z.array(z.strictObject({ id: textSchema, label: textSchema })),
    }),
  ),
  permissions: z.array(permissionSchema),
  diagnostics: z.array(textSchema),
});
export type ProfileCapabilities = z.infer<typeof profileCapabilitiesSchema>;
