import { createHash } from "node:crypto";
import { nativePermissionMethodSchema } from "../../shared/native-permissions.ts";
import type { ServerRequestHandler } from "./codex-rpc.ts";
import type { SessionEvent } from "./contract.ts";

export function denyCodexPermission(method: string, id: string | number) {
  const known = nativePermissionMethodSchema.safeParse(method);
  const event: Extract<SessionEvent, { type: "approval_denied" }> = {
    type: "approval_denied",
    permission: {
      adapter: "codex",
      requestFingerprint: createHash("sha256")
        .update(JSON.stringify([typeof id, id]))
        .digest("hex"),
      method: known.success ? known.data : "unsupported",
      outcome: "denied_by_policy",
    },
  };
  let response: ReturnType<ServerRequestHandler>;
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  )
    response = { result: { decision: "decline" } };
  else if (method === "item/permissions/requestApproval")
    // Installed Codex denies this request with an empty granted subset, not a
    // command-approval decision. Never echo its requested permissions back.
    response = { result: { permissions: {}, scope: "turn" } };
  else if (method === "execCommandApproval" || method === "applyPatchApproval")
    response = {
      result: { decision: { denied: { rejection: "Denied by app policy" } } },
    };
  else if (method === "mcpServer/elicitation/request")
    response = { result: { action: "decline", content: null } };
  else response = { error: { code: -32000, message: "Denied by app policy" } };
  return { event, response };
}
