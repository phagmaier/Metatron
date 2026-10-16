import { randomUUID } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative } from "node:path";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type Candidate,
  candidateSchema,
  type Worktree,
} from "../../shared/worktrees.ts";
import { diffCheckPasses, git } from "./command.ts";
import { inside, sensitivePath } from "./paths.ts";

type CandidateFile = Candidate["files"][number];
const changes: Record<string, CandidateFile["change"]> = {
  " M": "modified",
  " D": "deleted",
  " T": "type_changed",
  "??": "added",
  "!!": "ignored",
};

function normalizeDeclared(root: string, path: string) {
  const value = path.trim();
  if (isAbsolute(value))
    return inside(root, value) ? relative(root, value) : value;
  return posix.normalize(value);
}

async function classify(
  root: string,
  code: string,
  path: string,
  declared: ReadonlySet<string>,
): Promise<CandidateFile> {
  const change = changes[code];
  if (!change)
    throw new DomainError("GIT", `Unexpected candidate status ${code}`);
  const file = (
    disposition: CandidateFile["disposition"],
    reason: string | null = null,
  ) => ({ path, change, disposition, reason });
  if (sensitivePath(path)) return file("blocked", "secret-sensitive path");
  if (change === "ignored")
    return declared.has(path)
      ? file("blocked", "declared file is ignored by Git")
      : file("excluded", "ignored by Git; not part of the candidate");
  if (path.endsWith("/"))
    return file("blocked", "embedded repository requires owner review");
  if (change === "added" && !declared.has(path))
    return file("blocked", "undeclared new file");
  if (change !== "deleted") {
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink())
      return file("blocked", "symbolic link requires owner review");
    if (!stat.isFile())
      return file("blocked", "submodule or special file requires owner review");
  }
  return file("included");
}

// Builds the candidate in a private index seeded from the recorded base, so the
// worktree's own index, files and branch are never modified. Tracked changes
// are included; new files only when the worker declared them. Anything unsafe
// blocks without a commit. The commit uses a fixed identity and the attempt's
// date, so the same content always yields the same SHA, and the candidate
// branch is create-only: an existing different commit is never overwritten.
export async function captureCandidate(
  worktree: Worktree,
  declaredFiles: readonly string[],
  commit: { message: string; date: string },
  startSha = worktree.repository.baseSha,
): Promise<Candidate> {
  const root = worktree.path;
  const baseSha = worktree.repository.baseSha;
  const headSha = (
    await git(root, ["rev-parse", "--verify", "--end-of-options", "HEAD"])
  ).trim();
  const result = (
    status: Candidate["status"],
    files: CandidateFile[],
    blockers: string[],
    declaredUnchanged: string[] = [],
    candidateSha: string | null = null,
  ) =>
    candidateSchema.parse({
      attemptId: worktree.attemptId,
      status,
      baseSha,
      headSha,
      candidateSha,
      branch: candidateSha ? `lao/candidate-${worktree.attemptId}` : null,
      files,
      declaredUnchanged,
      blockers,
    });
  if (headSha !== startSha)
    return result(
      "blocked",
      [],
      [
        "Worktree HEAD moved from its recorded starting commit; owner review required",
      ],
    );
  const index = join(dirname(root), `candidate-${randomUUID()}.index`);
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(root, ["read-tree", baseSha], env);
    const records = (
      await git(
        root,
        [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
          "--ignored=traditional",
          "--ignore-submodules=none",
          "--no-renames",
        ],
        env,
      )
    )
      .split("\0")
      .filter(Boolean);
    // Previously captured additions are tracked in the revision's starting
    // tree. Keep them in the cumulative candidate without asking the worker
    // to redeclare old files; new additions still require explicit declaration.
    const inherited =
      startSha === baseSha
        ? []
        : (
            await git(root, [
              "diff",
              "--name-only",
              "--diff-filter=A",
              "--no-renames",
              "-z",
              baseSha,
              startSha,
              "--",
            ])
          )
            .split("\0")
            .filter(Boolean);
    const declared = new Set(
      declaredFiles.map((path) => normalizeDeclared(root, path)),
    );
    const allowedAdditions = new Set([...declared, ...inherited]);
    const files: CandidateFile[] = [];
    for (const record of records) {
      const status = record.slice(0, 2);
      // The private index is seeded from the run base. For revisions its
      // difference from HEAD is expected; only files versus that index matter.
      const code =
        status === "??" || status === "!!" ? status : ` ${status[1]}`;
      if (code === "  ") continue;
      files.push(await classify(root, code, record.slice(3), allowedAdditions));
    }
    const declaredUnchanged = [...declared].filter(
      (path) => !files.some((file) => file.path === path),
    );
    const blockers = files
      .filter((file) => file.disposition === "blocked")
      .map((file) => `${file.path}: ${file.reason}`);
    const included = files
      .filter((file) => file.disposition === "included")
      .map((file) => file.path);
    if (blockers.length)
      return result("blocked", files, blockers, declaredUnchanged);
    if (!included.length && startSha === baseSha)
      return result("empty", files, [], declaredUnchanged);
    for (let i = 0; i < included.length; i += 200)
      await git(
        root,
        [
          "update-index",
          "--add",
          "--remove",
          "--",
          ...included.slice(i, i + 200),
        ],
        env,
      );
    if (!(await diffCheckPasses(root, ["--cached", baseSha, "--"], env)))
      return result(
        "blocked",
        files,
        ["git diff --check found whitespace errors or conflict markers"],
        declaredUnchanged,
      );
    const tree = (await git(root, ["write-tree"], env)).trim();
    const date = `${Math.floor(Date.parse(commit.date) / 1000)} +0000`;
    const sha = (
      await git(
        root,
        ["commit-tree", tree, "-p", baseSha, "-m", commit.message],
        {
          GIT_AUTHOR_NAME: "Local Agent Orchestrator",
          GIT_AUTHOR_EMAIL: "lao@localhost",
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_NAME: "Local Agent Orchestrator",
          GIT_COMMITTER_EMAIL: "lao@localhost",
          GIT_COMMITTER_DATE: date,
        },
      )
    ).trim();
    const ref = `refs/heads/lao/candidate-${worktree.attemptId}`;
    const existing = (
      await git(root, ["for-each-ref", "--format=%(objectname)", ref])
    ).trim();
    if (existing && existing !== sha)
      return result(
        "blocked",
        files,
        [`${ref} already records a different commit; never overwritten`],
        declaredUnchanged,
      );
    if (!existing)
      await git(root, [
        "update-ref",
        "-m",
        "lao candidate",
        ref,
        sha,
        "0".repeat(sha.length),
      ]);
    return result("captured", files, [], declaredUnchanged, sha);
  } finally {
    await rm(index, { force: true });
  }
}
