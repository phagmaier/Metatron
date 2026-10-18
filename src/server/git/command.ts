import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { absolutePathSchema } from "../../shared/domain/entities.ts";
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

export async function git(
  cwd: string,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
) {
  absolutePathSchema.parse(cwd);
  if (args.some((arg) => arg.includes("\0")))
    throw new GitError("Git argument contains NUL");
  // Do not inherit repository selectors, aliases, hooks, external diff drivers,
  // fsmonitor or global config. No shell, automatic cleanup, reset or stash.
  // extraEnv carries engine-chosen values only (private index, fixed identity).
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  Object.assign(env, {
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    ...extraEnv,
  });
  const defaults = [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "commit.gpgSign=false",
    "-c",
    "merge.default=text",
    "-c",
    "merge.verifySignatures=false",
    "-c",
    "submodule.recurse=false",
  ];
  const options = { cwd, env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 };
  try {
    // Even status can run a clean filter. Refuse executable repository drivers
    // before every operation, including after owner/config changes; never print
    // their values or silently produce candidates with conversion disabled.
    let drivers = "";
    try {
      drivers = (
        await exec(
          "git",
          [
            ...defaults,
            "config",
            "--null",
            "--get-regexp",
            "^(filter\\..*\\.(clean|smudge|process)|merge\\..*\\.driver)$",
          ],
          options,
        )
      ).stdout;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === 1))
        throw error;
    }
    if (
      drivers.split("\0").some((record) => {
        const separator = record.indexOf("\n");
        return separator >= 0 && record.slice(separator + 1).trim().length > 0;
      })
    )
      throw new GitError(
        "Executable Git filters or merge drivers are unsupported. The app refuses to run them or change repository configuration; inspect the repository's driver setup manually.",
      );
    return (await exec("git", [...defaults, ...args], options)).stdout;
  } catch (error) {
    if (error instanceof GitError) throw error;
    throw new GitError(
      `Git ${args[0] ?? "command"} failed; retained working copies require inspection`,
      error,
    );
  }
}
// `git diff --check` exits 2 for whitespace errors or conflict markers.
export async function diffCheckPasses(
  cwd: string,
  args: readonly string[],
  extraEnv: Readonly<Record<string, string>> = {},
) {
  try {
    await git(
      cwd,
      ["diff", "--no-ext-diff", "--no-textconv", "--check", ...args],
      extraEnv,
    );
    return true;
  } catch (error) {
    if (!(error instanceof GitError) || error.exitCode !== 2) throw error;
    return false;
  }
}
