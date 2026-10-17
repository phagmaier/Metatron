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
export const profileCapabilitiesSchema = z.strictObject({
  harness: harnessSchema,
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
