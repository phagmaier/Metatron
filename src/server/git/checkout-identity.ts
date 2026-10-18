import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";

const execute = promisify(execFile);
export const checkoutIdentitySchema = z.strictObject({
  cwd: z.string(),
  cwdDevice: z.number(),
  cwdInode: z.number(),
  git: z.string(),
  gitDevice: z.number(),
  gitInode: z.number(),
  common: z.string(),
  checkout: z.string(),
});
export async function checkoutIdentity(
  cwd: string,
): Promise<z.infer<typeof checkoutIdentitySchema>> {
  try {
    const physical = await realpath(cwd);
    if (physical !== resolve(cwd)) throw new Error("Noncanonical checkout");
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
      throw new Error("Wrong Git root");
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
      "Native worker requires the original canonical Git checkout identity",
    );
  }
}
