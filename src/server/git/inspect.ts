import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import {
  absolutePathSchema,
  repositorySchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";

const exec = promisify(execFile);
export class GitError extends DomainError {
  readonly exitCode: number | null;
  readonly signal: string | null;
  constructor(message: string, error?: unknown) {
    super("GIT", message);
    this.exitCode =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "number"
        ? error.code
        : null;
    this.signal =
      error instanceof Error &&
      "signal" in error &&
      typeof error.signal === "string"
        ? error.signal
        : null;
  }
}
export async function inspectRepository(path: string) {
  absolutePathSchema.parse(path);
  let directory: string;
  try {
    directory = await realpath(path);
  } catch (error) {
    throw new GitError("Repository directory does not exist", error);
  }
  // Reads must neither inherit a different GIT_DIR nor refresh/write the index.
  // Disable fsmonitor and recursive submodule inspection to avoid repo hooks.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  Object.assign(env, {
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  });
  const git = async (...args: string[]) => {
    try {
      return (
        await exec(
          "git",
          [
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            ...args,
          ],
          { cwd: directory, env, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
        )
      ).stdout.trimEnd();
    } catch (error) {
      throw new GitError(
        "Git inspection failed; select a non-bare repository with a committed HEAD",
        error,
      );
    }
  };
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
