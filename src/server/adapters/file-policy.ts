import { constants, type Stats } from "node:fs";
import { access, lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { inside, physicalPath, sensitivePath } from "../git/paths.ts";

type ToolCall = { toolName: string; input: Record<string, unknown> };
type Block = { block: true; reason: string };
const gatewayTools = [
  "read_assignment",
  "report_progress",
  "submit_result",
  "report_issue",
  "request_human_action",
].map((name) => `mcp__lao__${name}`);

// Search tools must not discover unsafe descendants from an otherwise safe root.
// Git metadata is skipped, matching the existing Pi guard's search convention.
async function inspect(directory: string): Promise<boolean> {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink()) return false;
  if (stat.isFile()) {
    await access(directory, constants.R_OK);
    return true;
  }
  if (!stat.isDirectory()) return false;
  await access(directory, constants.R_OK | constants.X_OK);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    if (
      sensitivePath(entry.name) ||
      entry.isSymbolicLink() ||
      !(await inspect(resolve(directory, entry.name)))
    )
      return false;
  }
  return true;
}

export async function checkFileTool(
  root: string,
  permission: string,
  event: ToolCall,
  gateway = false,
): Promise<Block | undefined> {
  const deny = (reason: string): Block => ({ block: true, reason });
  if (permission !== "read_only" && permission !== "workspace_write")
    return deny("Permission profile is outside this worker's allowlist");
  // The gateway separately authorizes these session-scoped worker report tools.
  if (gateway && gatewayTools.includes(event.toolName)) return undefined;
  const search = event.toolName === "Grep" || event.toolName === "Glob";
  const mutation = event.toolName === "Edit" || event.toolName === "Write";
  if (
    event.toolName !== "Read" &&
    !search &&
    !(mutation && permission === "workspace_write")
  )
    return deny("Tool is outside this worker's allowlist");

  const path = search
    ? event.input.path === undefined
      ? "."
      : event.input.path
    : event.input.file_path;
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    path.split(/[\\/]/).includes("..")
  )
    return deny("Invalid tool path");
  // Glob patterns can themselves name paths, independently of the search root.
  // Reject expansions/escapes that could turn a relative pattern into new roots.
  // Grep globs must not explicitly opt into sensitive Git/config metadata.
  const selector =
    event.toolName === "Glob" ? event.input.pattern : event.input.glob;
  if (
    search &&
    selector !== undefined &&
    (typeof selector !== "string" ||
      selector.includes("\0") ||
      isAbsolute(selector) ||
      /[{}()[\]\\]/.test(selector) ||
      selector.split(/[\\/]/).includes("..") ||
      sensitivePath(selector))
  )
    return deny("Invalid or sensitive search scope");

  try {
    if (typeof root !== "string" || !isAbsolute(root) || root.includes("\0"))
      return deny("Cannot validate the assigned worktree");
    const canonicalRoot = await realpath(root);
    const rootStat = await lstat(root);
    if (
      canonicalRoot !== resolve(root) ||
      rootStat.isSymbolicLink() ||
      !rootStat.isDirectory()
    )
      return deny("Cannot validate the assigned worktree");
    await access(canonicalRoot, constants.R_OK | constants.X_OK);
    const target = resolve(canonicalRoot, path);
    if (
      !inside(canonicalRoot, target) ||
      sensitivePath(relative(canonicalRoot, target))
    )
      return deny("Path is outside the assigned worktree or is sensitive");

    // Inspect each existing component before physicalPath: its ENOENT fallback
    // alone cannot distinguish a safe new file from a dangling parent symlink.
    let current = canonicalRoot;
    const parts = relative(canonicalRoot, target).split(sep).filter(Boolean);
    for (const [index, part] of parts.entries()) {
      const parent = current;
      current = resolve(current, part);
      let stat: Stats;
      try {
        stat = await lstat(current);
      } catch (error) {
        if (
          event.toolName !== "Write" ||
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
        await access(parent, constants.W_OK | constants.X_OK);
        break;
      }
      if (stat.isSymbolicLink()) return deny("Tool path includes a symlink");
      if (index < parts.length - 1) {
        if (!stat.isDirectory())
          return deny("Cannot validate tool path safely");
        await access(current, constants.X_OK);
      }
    }
    const physical = await physicalPath(target);
    if (
      !inside(canonicalRoot, physical) ||
      sensitivePath(relative(canonicalRoot, physical))
    )
      return deny("Path is outside the assigned worktree or is sensitive");
    if (search) {
      if (!(await inspect(target)))
        return deny(
          "Recursive inspection includes an unsafe path; use explicit safe file reads",
        );
    } else {
      try {
        if (!(await lstat(target)).isFile())
          return deny("Tool path is not a regular file");
        await access(
          target,
          event.toolName === "Write"
            ? constants.W_OK
            : constants.R_OK | (mutation ? constants.W_OK : 0),
        );
      } catch (error) {
        if (
          event.toolName !== "Write" ||
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
    }
  } catch {
    return deny("Cannot validate tool path safely");
  }
  return undefined;
}
