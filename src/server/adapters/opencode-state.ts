import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { checkoutIdentitySchema } from "../git/checkout-identity.ts";

export const openCodeId = z.string().regex(/^ses_[A-Za-z0-9_-]+$/);
export const openCodeModel = z.object({
  id: z.string().min(1),
  providerID: z.string().min(1),
  variant: z.string().optional(),
});
export const openCodeSession = z.object({
  id: openCodeId,
  parentID: z.string().optional(),
  agent: z.string(),
  model: openCodeModel,
  outcome: z.enum(["succeeded", "failed", "interrupted"]).optional(),
  location: z.object({ directory: z.string() }),
  permissions: z.array(
    z.object({
      action: z.string(),
      resource: z.string(),
      effect: z.enum(["allow", "deny", "ask"]),
    }),
  ),
});
export const openCodeManifest = z.strictObject({
  version: z.literal(1),
  nativeSessionId: openCodeId,
  serverDirectory: z.string(),
  clean: z.boolean(),
  runId: z.uuid(),
  taskId: z.uuid(),
  cwd: z.string(),
  model: z.string(),
  thinking: z.string().nullable(),
  permission: z.enum(["read_only", "workspace_write"]),
  identity: checkoutIdentitySchema,
});
export type OpenCodeManifest = z.infer<typeof openCodeManifest>;
export async function saveOpenCodeManifest(
  directory: string,
  manifest: OpenCodeManifest,
) {
  const path = join(
    directory,
    "opencode-sessions",
    `${manifest.nativeSessionId}.json`,
  );
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
}
