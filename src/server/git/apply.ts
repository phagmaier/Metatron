import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ApplyPlan } from "../../shared/integration.ts";
import { GitError, git } from "./command.ts";
import { inside } from "./paths.ts";

const missing = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

async function marker(gitDir: string, name: string) {
  try {
    return (await readFile(join(gitDir, name), "utf8")).trim();
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function worktrees(root: string) {
  const list: { path: string; branch: string | null; prunable: boolean }[] = [];
  for (const field of (
    await git(root, ["worktree", "list", "--porcelain", "-z"])
  ).split("\0")) {
    const current = list.at(-1);
    if (field.startsWith("worktree "))
      list.push({ path: field.slice(9), branch: null, prunable: false });
    else if (current && field.startsWith("branch "))
      current.branch = field.slice(7);
    else if (current && field.startsWith("prunable")) current.prunable = true;
  }
  return list;
}

const operations = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
  "BISECT_LOG",
];

// Read-only. A rebase or bisect shows its worktree as detached, and a bare
// `update-ref` would still move the branch it holds, so these block the apply
// the way `git branch -f` refuses. App-owned worktrees never hold owner branches.
export async function destinationUse(
  root: string,
  branch: string,
  appDirectory: string,
) {
  const ref = `refs/heads/${branch}`;
  const blockers: string[] = [];
  let checkedOut = false;
  for (const tree of await worktrees(root)) {
    if (inside(appDirectory, tree.path)) continue;
    if (tree.branch === ref && tree.path !== root)
      blockers.push(
        `${branch} is checked out in another worktree, ${tree.path}; switch that worktree to another branch first`,
      );
    if (tree.prunable) continue;
    const gitDir = (
      await git(tree.path, ["rev-parse", "--absolute-git-dir"])
    ).trim();
    const rewritten = [
      await marker(gitDir, "rebase-merge/head-name"),
      await marker(gitDir, "rebase-apply/head-name"),
    ].includes(ref);
    if (rewritten || (await marker(gitDir, "BISECT_START")) === branch)
      blockers.push(
        `${branch} is being rebased or bisected in ${tree.path}; finish or abort that first`,
      );
    if (tree.branch === ref && tree.path === root) {
      checkedOut = true;
      const busy: string[] = [];
      for (const name of operations)
        if (await exists(join(gitDir, name))) busy.push(name);
      if (busy.length)
        blockers.push(
          `A Git operation is in progress in your checkout (${busy.join(", ")}); finish or abort it first`,
        );
    }
  }
  return { checkedOut, blockers };
}

export async function commitExists(root: string, sha: string) {
  try {
    await git(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${sha}^{commit}`,
    ]);
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}

export async function isAncestor(
  root: string,
  ancestor: string,
  descendant: string,
) {
  try {
    await git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}

// The exact commands the owner confirms. Both refuse rather than overwrite:
// update-ref compares against the confirmed SHA, and the fast-forward keeps
// local and ignored files, never stashes, and does not touch submodules.
export function applyCommands(
  method: ApplyPlan["method"],
  refs: {
    id: string;
    root: string;
    branch: string;
    expectedSha: string;
    resultSha: string;
  },
): ApplyPlan["commands"] {
  if (method === "update_ref")
    return [
      {
        cwd: refs.root,
        args: [
          "update-ref",
          "-m",
          `lao integration ${refs.id}`,
          `refs/heads/${refs.branch}`,
          refs.resultSha,
          refs.expectedSha,
        ],
      },
    ];
  if (method === "fast_forward_checkout")
    return [
      {
        cwd: refs.root,
        args: [
          "-c",
          "submodule.recurse=false",
          "merge",
          "--ff-only",
          "--no-stat",
          "--no-autostash",
          "--no-overwrite-ignore",
          "--no-verify-signatures",
          refs.resultSha,
        ],
      },
    ];
  return [];
}
