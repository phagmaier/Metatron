import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { repositorySchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { diffCheckPasses, GitError, git } from "./command.ts";
import { inspectRepository } from "./inspect.ts";
import { inside, sensitivePath } from "./paths.ts";

type Repository = ReturnType<typeof repositorySchema.parse>;

// Reads a local branch exactly (`refs/heads/<name>`); no globbing or ref
// shorthand can select a tag, remote or app-owned branch instead.
export async function branchSha(root: string, branch: string) {
  try {
    await git(root, ["check-ref-format", `refs/heads/${branch}`]);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    throw new DomainError("INVALID_REFERENCE", "Invalid destination branch");
  }
  try {
    return (
      await git(root, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `refs/heads/${branch}^{commit}`,
      ])
    ).trim();
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    throw new DomainError("NOT_FOUND", "Destination branch not found");
  }
}

export async function candidateBranchSha(root: string, attemptId: string) {
  return (
    await git(root, [
      "for-each-ref",
      "--format=%(objectname)",
      `refs/heads/lao/candidate-${attemptId}`,
    ])
  ).trim();
}

// Only `git worktree add` touches the source repository: it records a new
// app-owned branch and worktree metadata, never the owner's files or index.
export async function addIntegrationWorktree(
  repository: Repository,
  directory: string,
  manifest: { id: string; path: string; branch: string; startSha: string },
) {
  const root = join(directory, "worktrees");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (
    (await realpath(directory)) !== directory ||
    (await realpath(root)) !== root ||
    inside(repository.root, root) ||
    dirname(dirname(manifest.path)) !== root
  )
    throw new DomainError(
      "POLICY_DENIED",
      "Integration worktrees must be canonical app-owned data outside the source checkout",
    );
  await mkdir(dirname(manifest.path), { mode: 0o700 });
  await writeFile(
    join(dirname(manifest.path), "ownership.json"),
    JSON.stringify({
      ...manifest,
      commonDirectory: repository.commonDirectory,
    }),
    { flag: "wx", mode: 0o600 },
  );
  await git(repository.root, [
    "worktree",
    "add",
    "-b",
    manifest.branch,
    "--",
    manifest.path,
    manifest.startSha,
  ]);
  const actual = await inspectRepository(manifest.path);
  if (
    actual.root !== manifest.path ||
    actual.commonDirectory !== repository.commonDirectory ||
    actual.branch !== manifest.branch ||
    actual.baseSha !== manifest.startSha ||
    !actual.clean
  )
    throw new DomainError(
      "CONFLICT",
      "Integration worktree identity differs from its manifest; retained for inspection",
    );
}

export async function applyCandidate(path: string, candidateSha: string) {
  await git(path, ["merge", "--ff-only", "--no-stat", candidateSha]);
  return (
    await git(path, ["rev-parse", "--verify", "--end-of-options", "HEAD"])
  ).trim();
}

async function changedFiles(path: string, from: string, to: string) {
  const fields = (
    await git(path, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--name-status",
      "-z",
      from,
      to,
      "--",
    ])
  )
    .split("\0")
    .filter(Boolean);
  const files: { status: string; path: string }[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
    files.push({ status: fields[i] ?? "", path: fields[i + 1] ?? "" });
  return files;
}

// The integrated change must be exactly the reviewed candidate change, with no
// secret-sensitive path, and pass whitespace/conflict-marker checks.
export async function verifyIntegrationDiff(
  path: string,
  refs: {
    baseSha: string;
    candidateSha: string;
    destinationSha: string;
    resultSha: string;
  },
) {
  const files = await changedFiles(path, refs.destinationSha, refs.resultSha);
  const reviewed = await changedFiles(path, refs.baseSha, refs.candidateSha);
  const sensitive = files.filter((file) => sensitivePath(file.path));
  return {
    files,
    matchesCandidate: JSON.stringify(files) === JSON.stringify(reviewed),
    sensitive: sensitive.map((file) => file.path),
    diffCheck: await diffCheckPasses(path, [
      refs.destinationSha,
      refs.resultSha,
      "--",
    ]),
    patch: await git(path, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      refs.destinationSha,
      refs.resultSha,
      "--",
    ]),
  };
}

export async function worktreeState(path: string) {
  return {
    head: (
      await git(path, ["rev-parse", "--verify", "--end-of-options", "HEAD"])
    ).trim(),
    branch: (await git(path, ["rev-parse", "--abbrev-ref", "HEAD"])).trim(),
    changed: (
      await git(path, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ])
    )
      .split("\0")
      .filter(Boolean).length,
  };
}
