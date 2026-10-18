import { resolve } from "node:path";
import type { OpenCodeClient } from "@opencode/client";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";
import type { ManagedSession } from "./contract.ts";
import { checkFileTool } from "./file-policy.ts";
import { openCodeGatewayTools } from "./opencode-host.ts";
import { openCodeModel } from "./opencode-state.ts";

export const openCodePermission = z.object({
  id: z.string().min(1),
  sessionID: z.string(),
  action: z.string(),
  resources: z.array(z.string()).min(1),
  source: z.object({
    type: z.literal("tool"),
    messageID: z.string(),
    id: z.string(),
  }),
});
export type OpenCodePermission = z.infer<typeof openCodePermission>;
const toolMessage = z.object({
  id: z.string(),
  type: z.literal("assistant"),
  agent: z.literal("metatron"),
  model: openCodeModel,
  content: z.array(
    z.object({
      type: z.string(),
      id: z.string().optional(),
      name: z.string().optional(),
      state: z.unknown().optional(),
    }),
  ),
});
export async function inspectOpenCodePermission(
  client: OpenCodeClient,
  session: ManagedSession,
  value: unknown,
) {
  const request = openCodePermission.parse(value);
  if (request.sessionID !== session.nativeSessionId)
    throw new DomainError(
      "POLICY_DENIED",
      "OpenCode permission belongs to another session",
    );
  const message = toolMessage.parse(
    await client.session.message.get(
      {
        sessionID: session.nativeSessionId,
        messageID: request.source.messageID,
      },
      { signal: AbortSignal.timeout(5000) },
    ),
  );
  if (message.id !== request.source.messageID)
    throw new DomainError(
      "POLICY_DENIED",
      "OpenCode permission source changed",
    );
  const tool = message.content.find(
    (item) => item.type === "tool" && item.id === request.source.id,
  );
  if (!tool?.name)
    throw new DomainError(
      "POLICY_DENIED",
      "OpenCode permission does not name a pending native tool",
    );
  const state = z
    .object({
      status: z.literal("running"),
      input: z.record(z.string(), z.unknown()),
    })
    .parse(tool.state);
  const input = state.input;
  const gateway = openCodeGatewayTools.some(
    (name) => tool.name === `lao_${name}`,
  );
  if (gateway) {
    if (!session.input.toolEndpoint || request.action !== tool.name)
      throw new DomainError(
        "POLICY_DENIED",
        "OpenCode gateway operation is not a worker tool",
      );
  } else {
    const names: Record<string, string> = {
      read: "Read",
      glob: "Glob",
      grep: "Grep",
      edit: "Edit",
      write: "Write",
    };
    const name = names[tool.name];
    const expectedAction = ["edit", "write"].includes(tool.name)
      ? "edit"
      : tool.name;
    if (!name || request.action !== expectedAction)
      throw new DomainError(
        "POLICY_DENIED",
        "OpenCode tool is outside the file-worker policy",
      );
    const translated = {
      ...input,
      ...(tool.name === "read" || expectedAction === "edit"
        ? { file_path: input.path }
        : {}),
      ...(tool.name === "grep" ? { glob: input.include } : {}),
    };
    const blocked = await checkFileTool(
      session.input.cwd,
      session.input.permission,
      { toolName: name, input: translated },
    );
    if (blocked)
      throw new DomainError(
        "POLICY_DENIED",
        "OpenCode native file operation failed worktree/path policy",
      );
    if (expectedAction === "read" || expectedAction === "edit") {
      if (
        typeof input.path !== "string" ||
        request.resources.some(
          (resource) =>
            resolve(session.input.cwd, resource) !==
            resolve(session.input.cwd, String(input.path)),
        )
      )
        throw new DomainError(
          "POLICY_DENIED",
          "OpenCode permission resources do not match its actual tool input",
        );
    }
  }
  return {
    request,
    input,
    model: message.model,
    mutation: request.action === "edit",
  };
}
