import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { repositorySchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type IntegrationDrift,
  integrationDriftSchema,
} from "../../shared/integration.ts";
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

// A moved destination gets a real three-way merge commit in the integration
// worktree. rerere could replay a recorded resolution, so it is disabled; a
// conflict leaves the unmerged state for inspection and is never resolved here.
export async function mergeCandidate(
  path: string,
  candidateSha: string,
  commit: { message: string; date: string },
) {
  const date = `${Math.floor(Date.parse(commit.date) / 1000)} +0000`;
  try {
    await git(
      path,
      [
        "-c",
        "rerere.enabled=false",
        "merge",
        "--no-ff",
        "--no-edit",
        "--no-stat",
        "--no-autostash",
        "--no-verify-signatures",
        "--no-rerere-autoupdate",
        "-m",
        commit.message,
        candidateSha,
      ],
      {
        GIT_AUTHOR_NAME: "Local Agent Orchestrator",
        GIT_AUTHOR_EMAIL: "lao@localhost",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: "Local Agent Orchestrator",
        GIT_COMMITTER_EMAIL: "lao@localhost",
        GIT_COMMITTER_DATE: date,
      },
    );
  } catch (error) {
    if (!(error instanceof GitError) || error.exitCode !== 1) throw error;
    const conflicts = (
      await git(path, ["diff", "--name-only", "--diff-filter=U", "-z"])
    )
      .split("\0")
      .filter(Boolean);
    if (!conflicts.length) throw error;
    return { resultSha: null, conflicts };
  }
  return {
    resultSha: (
      await git(path, ["rev-parse", "--verify", "--end-of-options", "HEAD"])
    ).trim(),
    conflicts: [],
  };
}

export async function changedFiles(path: string, from: string, to: string) {
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

// How the destination moved since the candidate base. Null when the histories
// share no commit, so there is no merge base to apply the candidate against.
export async function destinationDrift(
  root: string,
  refs: { baseSha: string; candidateSha: string; destinationSha: string },
): Promise<IntegrationDrift | null> {
  let mergeBase: string;
  try {
    mergeBase = (
      await git(root, ["merge-base", refs.baseSha, refs.destinationSha])
    ).trim();
  } catch (error) {
    if (!(error instanceof GitError) || error.exitCode !== 1) throw error;
    return null;
  }
  const files = await changedFiles(root, mergeBase, refs.destinationSha);
  const destination = new Set(files.map((file) => file.path));
  const overlapping = (
    await changedFiles(root, refs.baseSha, refs.candidateSha)
  )
    .map((file) => file.path)
    .filter((file) => destination.has(file));
  return integrationDriftSchema.parse({
    mergeBase,
    baseIsAncestor: mergeBase === refs.baseSha,
    commits: Number(
      await git(root, [
        "rev-list",
        "--count",
        `${mergeBase}..${refs.destinationSha}`,
      ]),
    ),
    files: files.slice(0, 200),
    filesTruncated: files.length > 200,
    overlapping: overlapping.slice(0, 500),
  });
}

// Built-in `union` or a configured custom driver can merge both sides of an
// overlapping file without reporting a conflict, i.e. silently choose content.
export async function silentMergeDrivers(
  path: string,
  revisions: readonly string[],
  files: readonly string[],
) {
  if (!files.length) return [];
  const flagged = new Set<string>();
  for (const revision of revisions) {
    const fields = (
      await git(path, [
        "check-attr",
        "-z",
        `--source=${revision}`,
        "merge",
        "--",
        ...files,
      ])
    ).split("\0");
    for (let i = 0; i + 2 < fields.length; i += 3)
      if (
        !["unspecified", "set", "unset", "text", "binary"].includes(
          fields[i + 2] ?? "",
        )
      )
        flagged.add(fields[i] ?? "");
  }
  return [...flagged];
}

// The integration may introduce only reviewed candidate paths, and keeps the
// candidate's exact content except in files the destination also changed.
// It must also avoid secret-sensitive paths and pass `git diff --check`.
export async function verifyIntegrationDiff(
  path: string,
  refs: {
    baseSha: string;
    candidateSha: string;
    destinationSha: string;
    resultSha: string;
    mergeBase: string;
  },
) {
  const files = await changedFiles(path, refs.destinationSha, refs.resultSha);
  const reviewed = new Set(
    (await changedFiles(path, refs.baseSha, refs.candidateSha)).map(
      (file) => file.path,
    ),
  );
  const destination = new Set(
    (await changedFiles(path, refs.mergeBase, refs.destinationSha)).map(
      (file) => file.path,
    ),
  );
  const altered = (
    await changedFiles(path, refs.candidateSha, refs.resultSha)
  ).filter((file) => !destination.has(file.path));
  return {
    files,
    unreviewed: files
      .filter((file) => !reviewed.has(file.path))
      .map((f) => f.path),
    altered: altered.map((file) => file.path),
    sensitive: files
      .filter((file) => sensitivePath(file.path))
      .map((f) => f.path),
    diffCheck: await diffCheckPasses(path, [
      refs.destinationSha,
      refs.resultSha,
      "--",
    ]),
    patch: await diffPatch(path, refs.destinationSha, refs.resultSha),
  };
}

export function diffPatch(path: string, from: string, to: string) {
  return git(path, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    from,
    to,
    "--",
  ]);
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
