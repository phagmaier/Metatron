import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";
import {
  checkoutIdentity,
  checkoutIdentitySchema,
} from "../git/checkout-identity.ts";
import type { StartSessionInput } from "./contract.ts";

const manifestSchema = z.strictObject({
  version: z.literal(1),
  nativeSessionId: z.string().min(1),
  runId: z.uuid(),
  model: z.string(),
  thinking: z.string().nullable(),
  permission: z.enum(["coordinator", "read_only"]),
  identity: checkoutIdentitySchema,
});

// A thread id is native input, never a filesystem path. Bind the thread across
// adapter/server reconstruction; a matching path alone is not checkout identity.
function manifestPath(directory: string, id: string) {
  return join(
    directory,
    "codex-bindings",
    `${createHash("sha256").update(id).digest("hex")}.json`,
  );
}

export async function codexBinding(
  directory: string,
  input: StartSessionInput,
  id: string | null,
) {
  const identity = await checkoutIdentity(input.cwd);
  if (id) {
    let previous: z.infer<typeof manifestSchema>;
    try {
      previous = manifestSchema.parse(
        JSON.parse(await readFile(manifestPath(directory, id), "utf8")),
      );
    } catch {
      throw new DomainError(
        "POLICY_DENIED",
        "Codex resume requires an app-owned thread binding; legacy or unknown threads need a new run",
      );
    }
    if (
      previous.nativeSessionId !== id ||
      previous.runId !== input.runId ||
      previous.model !== input.model ||
      previous.thinking !== input.thinking ||
      previous.permission !== input.permission ||
      JSON.stringify(previous.identity) !== JSON.stringify(identity)
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Codex resume requires the same run, model, permission and original Git checkout; nothing was started",
      );
  }
  return identity;
}

export async function saveCodexBinding(
  directory: string,
  input: StartSessionInput,
  nativeSessionId: string,
  identity: z.infer<typeof checkoutIdentitySchema>,
) {
  await mkdir(join(directory, "codex-bindings"), {
    recursive: true,
    mode: 0o700,
  });
  // Exclusive creation never reassigns an existing native id to a new run. A
  // partial write after a crash fails validation and requires explicit recovery.
  await writeFile(
    manifestPath(directory, nativeSessionId),
    JSON.stringify(
      manifestSchema.parse({
        version: 1,
        nativeSessionId,
        runId: input.runId,
        model: input.model,
        thinking: input.thinking,
        permission: input.permission,
        identity,
      }),
    ),
    { flag: "wx", mode: 0o600 },
  );
}
