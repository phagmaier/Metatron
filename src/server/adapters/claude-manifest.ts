import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { checkoutIdentitySchema } from "../git/checkout-identity.ts";

export const manifestSchema = z.strictObject({
  version: z.literal(1),
  sessionId: z.uuid(),
  clean: z.boolean(),
  runId: z.string(),
  taskId: z.string(),
  cwd: z.string(),
  model: z.string(),
  thinking: z.string().nullable(),
  permission: z.string(),
  identity: checkoutIdentitySchema,
});
export type Manifest = z.infer<typeof manifestSchema>;

export async function saveClaudeManifest(
  directory: string,
  manifest: Manifest,
): Promise<void> {
  const file = join(directory, "claude-sessions", `${manifest.sessionId}.json`);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, file);
}
