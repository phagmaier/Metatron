import { realpath } from "node:fs/promises";
import {
  absolutePathSchema,
  repositorySchema,
} from "../../shared/domain/entities.ts";
import { git as command, GitError } from "./command.ts";

export { GitError } from "./command.ts";
export async function inspectRepository(path: string) {
  absolutePathSchema.parse(path);
  let directory: string;
  try {
    directory = await realpath(path);
  } catch (error) {
    throw new GitError("Repository directory does not exist", error);
  }
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
  const baseSha = await git(
    "rev-parse",
    "--verify",
    "--end-of-options",
    "HEAD^{commit}",
  );
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  const status = await git(
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  );
  return repositorySchema.parse({
    root,
    commonDirectory,
    baseSha,
    branch,
    clean: status.length === 0,
  });
}
export function requireClean(
  repository: ReturnType<typeof repositorySchema.parse>,
) {
  if (!repository.clean)
    throw new GitError(
      "Checkout is dirty. Commit or clean your changes manually before starting; the app never resets or stashes them.",
    );
}
