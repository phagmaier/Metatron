import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import {
  absolutePathSchema,
  type Repository,
  repositorySchema,
} from "../../shared/domain/entities.ts";
import { git as command, GitError } from "./command.ts";

export { GitError } from "./command.ts";

// Birth time distinguishes a replacement even when a filesystem reuses an inode.
export async function directoryIdentity(path: string) {
  let entry: BigIntStats;
  try {
    entry = await lstat(path, { bigint: true });
  } catch (error) {
    throw new GitError(
      "Repository directory identity could not be read",
      error,
    );
  }
  if (!entry.isDirectory())
    throw new GitError("Repository directory identity requires a directory");
  return `${entry.dev}:${entry.ino}:${entry.birthtimeNs}`;
}

export function sameRepository(recorded: Repository, current: Repository) {
  return (
    recorded.identity !== null &&
    current.identity !== null &&
    recorded.root === current.root &&
    recorded.commonDirectory === current.commonDirectory &&
    recorded.identity.root === current.identity.root &&
    recorded.identity.commonDirectory === current.identity.commonDirectory
  );
}
export async function requireVisibleIndex(root: string) {
  // Status intentionally ignores these flags, so it cannot prove owner edits
  // are absent. Never clear flags or expand a sparse checkout on the owner's behalf.
  const entries = (await command(root, ["ls-files", "-v", "-z"])).split("\0");
  if (entries.some((entry) => /^[a-zS] /.test(entry)))
    throw new GitError(
      "Checkout index hides tracked paths (assume-unchanged or skip-worktree/sparse checkout). Restore a fully visible index manually; the app never changes these flags.",
    );
}
export async function inspectRepository(path: string): Promise<Repository> {
  absolutePathSchema.parse(path);
  let directory: string;
  try {
    directory = await realpath(path);
  } catch (error) {
    throw new GitError("Repository directory does not exist", error);
  }
  const rootIdentity = await directoryIdentity(directory);
  const git = async (...args: string[]) =>
    (await command(directory, args)).trimEnd();
  const root = await realpath(
    await git("rev-parse", "--path-format=absolute", "--show-toplevel"),
  );
  if (directory !== root)
    throw new GitError(
      "Select the repository root, rather than a subdirectory",
    );
  const commonDirectory = await realpath(
    await git("rev-parse", "--path-format=absolute", "--git-common-dir"),
  );
  const commonIdentity = await directoryIdentity(commonDirectory);
  const baseSha = await git(
    "rev-parse",
    "--verify",
    "--end-of-options",
    "HEAD^{commit}",
  );
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  await requireVisibleIndex(root);
  const status = await git(
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  );
  if (
    (await directoryIdentity(root)) !== rootIdentity ||
    (await directoryIdentity(commonDirectory)) !== commonIdentity
  )
    throw new GitError(
      "Repository directories changed during inspection; reopen the project",
    );
  return repositorySchema.parse({
    root,
    commonDirectory,
    baseSha,
    branch,
    clean: status.length === 0,
    identity: { root: rootIdentity, commonDirectory: commonIdentity },
  });
}
export function requireClean(repository: Repository) {
  if (!repository.clean)
    throw new GitError(
      "Checkout is dirty. Commit or clean your changes manually before starting; the app never resets or stashes them.",
    );
}
