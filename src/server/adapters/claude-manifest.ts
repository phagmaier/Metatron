import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";

const execute = promisify(execFile);

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
  identity: z.strictObject({
    cwd: z.string(),
    cwdDevice: z.number(),
    cwdInode: z.number(),
    git: z.string(),
    gitDevice: z.number(),
    gitInode: z.number(),
    common: z.string(),
    checkout: z.string(),
  }),
});
export type Manifest = z.infer<typeof manifestSchema>;

export async function claudeCheckoutIdentity(
  cwd: string,
): Promise<Manifest["identity"]> {
  try {
    const physical = await realpath(cwd);
    if (physical !== resolve(cwd))
      throw new DomainError(
        "POLICY_DENIED",
        "Claude checkout path must be canonical and not symlinked",
      );
    const options = {
      cwd: physical,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      timeout: 10000,
      maxBuffer: 16384,
    };
    const [top, git, common, checkout] = await Promise.all([
      execute("git", ["rev-parse", "--show-toplevel"], options),
      execute("git", ["rev-parse", "--absolute-git-dir"], options),
      execute(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        options,
      ),
      execute("git", ["rev-parse", "--symbolic-full-name", "HEAD"], options),
    ]);
    if ((await realpath(top.stdout.trim())) !== physical)
      throw new Error("root");
    const gitPath = await realpath(git.stdout.trim());
    const [cwdStat, gitStat] = await Promise.all([
      stat(physical),
      stat(gitPath),
    ]);
    const checkoutName = checkout.stdout.trim();
    const revision =
      checkoutName === "HEAD"
        ? (await execute("git", ["rev-parse", "HEAD"], options)).stdout.trim()
        : checkoutName;
    return {
      cwd: physical,
      cwdDevice: cwdStat.dev,
      cwdInode: cwdStat.ino,
      git: gitPath,
      gitDevice: gitStat.dev,
      gitInode: gitStat.ino,
      common: await realpath(common.stdout.trim()),
      checkout: revision,
    };
  } catch {
    throw new DomainError(
      "POLICY_DENIED",
      "Claude requires the original app-owned Git checkout identity",
    );
  }
}
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
