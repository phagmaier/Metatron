import { checkFileTool } from "./file-policy.ts";

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
const fileTools: Record<string, string> = {
  read: "Read",
  grep: "Grep",
  find: "Glob",
  ls: "Glob",
  edit: "Edit",
  write: "Write",
};

export async function checkPiTool(
  root: string,
  permission: string,
  event: ToolCall,
  gateway = false,
): Promise<Block | undefined> {
  // Share component-by-component checks: realpath's ENOENT fallback cannot
  // establish safety when a dangling symlink will be followed by a new write.
  return checkFileTool(
    root,
    permission,
    {
      toolName: event.toolName.startsWith("mcp__lao__")
        ? event.toolName
        : (fileTools[event.toolName] ?? "unsupported"),
      input: { ...event.input, file_path: event.input.path },
    },
    gateway,
  );
}

// This deliberately small structural API avoids importing the entire Pi SDK.
// Pi loads this explicit extension even with extension discovery disabled.
export default function installGuard(pi: GuardAPI) {
  const root = process.cwd();
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
        root,
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
