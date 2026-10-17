import { lstat, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { inside, physicalPath, sensitivePath } from "../git/paths.ts";

type ToolCall = { toolName: string; input: Record<string, unknown> };
type Block = { block: true; reason: string };
type GuardAPI = {
  on: (
    name: "tool_call",
    callback: (event: ToolCall) => Promise<Block | undefined>,
  ) => void;
  registerCommand: (
    name: string,
    definition: { description: string; handler: () => Promise<void> },
  ) => void;
  registerMcpServer: (
    name: string,
    config: {
      url: string;
      headers: Record<string, string>;
      exposure: "direct";
      description: string;
      timeout: number;
    },
  ) => void;
};
const gatewayTools = [
  "read_assignment",
  "report_progress",
  "submit_result",
  "report_issue",
  "request_human_action",
].map((name) => `mcp__lao__${name}`);

export async function checkPiTool(
  root: string,
  permission: string,
  event: ToolCall,
  gateway = false,
): Promise<Block | undefined> {
  const deny = (reason: string): Block => ({ block: true, reason });
  // Gateway tools carry no paths; the server authorizes every call itself.
  if (gateway && gatewayTools.includes(event.toolName)) return undefined;
  const allowed =
    permission === "workspace_write"
      ? ["read", "grep", "find", "ls", "edit", "write"]
      : ["read", "grep", "find", "ls"];
  if (!allowed.includes(event.toolName))
    return deny("Tool is outside this worker's allowlist");
  const path = event.input.path ?? ".";
  if (typeof path !== "string" || path.includes("\0"))
    return deny("Invalid tool path");
  const target = resolve(root, path);
  try {
    const physical = await physicalPath(target);
    if (
      !inside(root, target) ||
      sensitivePath(target.slice(root.length + 1)) ||
      !inside(root, physical) ||
      sensitivePath(physical.slice(root.length + 1))
    )
      return deny("Path is outside the assigned worktree or is sensitive");
    // Recursive search tools could follow links or read secrets below a clean
    // directory path. Refuse such trees, rather than trusting prompt guidance.
    if (["grep", "find", "ls"].includes(event.toolName)) {
      const inspect = async (directory: string): Promise<boolean> => {
        const stat = await lstat(directory);
        if (stat.isSymbolicLink()) return false;
        if (!stat.isDirectory()) return true;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.name === ".git") continue;
          if (sensitivePath(entry.name) || entry.isSymbolicLink()) return false;
          if (
            entry.isDirectory() &&
            !(await inspect(resolve(directory, entry.name)))
          )
            return false;
        }
        return true;
      };
      if (!(await inspect(target)))
        return deny(
          "Recursive inspection includes a symlink or sensitive path; use explicit safe file reads",
        );
    }
  } catch {
    return deny("Cannot validate tool path safely");
  }
  return undefined;
}

// This deliberately small structural API avoids importing the entire Pi SDK.
// Pi loads this explicit extension even with extension discovery disabled.
export default function installGuard(pi: GuardAPI) {
  const url = process.env.LAO_GATEWAY_URL;
  const token = process.env.LAO_GATEWAY_TOKEN;
  const gateway = Boolean(url && token);
  if (url && token) {
    pi.registerMcpServer("lao", {
      url,
      headers: { Authorization: `Bearer ${token}` },
      exposure: "direct",
      description:
        "Local Agent Orchestrator worker tools: assignment, progress, structured result, issues and owner help",
      timeout: 60,
    });
    pi.registerCommand("lao_gateway", {
      description: "Session-scoped app gateway is registered",
      handler: async () => {},
    });
  }
  pi.on("tool_call", async (event) => {
    try {
      return await checkPiTool(
        await realpath(process.cwd()),
        process.env.LAO_PI_PERMISSION ?? "read_only",
        event,
        gateway,
      );
    } catch {
      return { block: true, reason: "Cannot validate the assigned worktree" };
    }
  });
  pi.registerCommand("lao_guard", {
    description: "App file-tool policy is installed",
    handler: async () => {},
  });
}
