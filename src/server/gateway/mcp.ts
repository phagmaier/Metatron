import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { reviewResultSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  handoffReportSchema,
  type ToolName,
  toolSchema,
  workerTools,
} from "../../shared/orchestration.ts";
import type { Engine } from "../orchestration/engine.ts";
import { toolsFor } from "../orchestration/policy.ts";

export const TOOL_SCHEMA_VERSION = "lao-tools/3";
type Binding = {
  role: "lead" | "worker";
  sessionId: string;
  runId: string;
  taskId: string;
  attemptId: string;
  listed: boolean;
};
const descriptions: Record<ToolName, string> = {
  get_run_status:
    "Read this run's objective, mode, worker roster (profile IDs), limits and budget use.",
  list_tasks: "List this run's worker tasks with status and assignment.",
  get_task: "Read one task's objective, criteria, assignment and dispatch.",
  get_worker_status:
    "Read a task's attempts, process state and latest progress.",
  read_report:
    "Read a task's structured worker report, text excerpt and engine-captured Git evidence.",
  propose_task:
    "Create a backlog task for work necessary to the run objective. Unrelated ideas stay proposals.",
  assign_task:
    "Assign a backlog task to a roster worker profile. Supervised mode records a proposal for owner approval; Chat/Plan cannot dispatch.",
  request_revision:
    "Request a bounded revision of a task awaiting review; creates a revision task for the same worker profile.",
  request_review:
    "Request an independent read-only review of a task's captured candidate by a read-only roster profile. The reviewer inspects the candidate commit in its own worktree and never sees the implementer's report. Supervised mode records a proposal for owner approval.",
  escalate_issue:
    "Escalate a risk or blocker to the owner's inbox. Does not pause work.",
  request_human_input:
    "Ask the owner a question. The answer arrives in a later turn.",
  read_assignment:
    "Read your assigned task, scope, worktree and the report shape expected by submit_result.",
  report_progress: "Report a short progress note to the Lead.",
  submit_result:
    "Submit your final structured result once, using this assignment's schema. Reviewer recommendations remain provisional until native completion and clean Git checks; they never approve integration.",
  report_issue:
    "Record a finding. blocking=true or high/urgent urgency requests a stop of only your worker and an owner inbox request; high/urgent and blocking findings wake the Lead. No permission or continuation is granted.",
  request_human_action:
    "Ask the owner for an action or answer. Blocking requests durably request a stop of your worker; waiting is recorded only after shutdown is confirmed. Session identity and worktree are retained. No automatic resume or native permission approval.",
};
const variants = new Map(
  toolSchema.options.map((option) => [option.shape.name.value, option]),
);
function argsSchema(
  name: ToolName,
  role: Binding["role"],
  review: boolean,
): z.ZodType {
  const option = variants.get(name);
  if (!option) throw new Error(`Missing tool schema ${name}`);
  if (role === "worker" && name === "submit_result")
    return review ? reviewResultSchema : handoffReportSchema;
  const shape = Object.fromEntries(
    Object.entries(option.shape).filter(
      ([key]) =>
        key !== "name" &&
        key !== "scenario" &&
        !(role === "worker" && key === "taskId"),
    ),
  );
  return z.strictObject(shape);
}
const jsonRpcSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).optional(),
});
const versions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const hash = (token: string) => createHash("sha256").update(token).digest();

export class Gateway {
  private readonly engine: Engine;
  // Only token digests are held, in memory: restart revokes every endpoint.
  private readonly bindings = new Map<string, Binding>();
  constructor(engine: Engine) {
    this.engine = engine;
  }
  issue(binding: Omit<Binding, "listed">) {
    const token = randomBytes(32).toString("base64url");
    this.bindings.set(hash(token).toString("hex"), {
      ...binding,
      listed: false,
    });
    return token;
  }
  revoke(token: string) {
    this.bindings.delete(hash(token).toString("hex"));
  }
  revokeAll() {
    this.bindings.clear();
  }
  private resolve(request: IncomingMessage) {
    const header = request.headers.authorization;
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? "");
    return match?.[1]
      ? this.bindings.get(hash(match[1]).toString("hex"))
      : undefined;
  }
  private journal(binding: Binding, type: string, payload: object) {
    this.engine.store.recordEvent(
      {
        runId: binding.runId,
        taskId: binding.taskId,
        attemptId: binding.attemptId,
        sessionId: binding.sessionId,
        type,
        correlationId: binding.sessionId,
        payload,
      },
      `gateway:${randomUUID()}`,
    );
  }
  private listTools(binding: Binding) {
    const run = this.engine.store.getRun(binding.runId);
    const review = Boolean(
      this.engine.store.getTask(binding.taskId).reviewCandidateId,
    );
    if (!binding.listed) {
      binding.listed = true;
      this.journal(binding, "gateway.connected", {
        role: binding.role,
        mode: run.mode,
        version: TOOL_SCHEMA_VERSION,
      });
    }
    return toolsFor(binding.role, run.mode).map((name) => {
      const { $schema: _, ...inputSchema } = z.toJSONSchema(
        argsSchema(name, binding.role, review),
        { io: "input" },
      );
      return {
        name,
        description: descriptions[name],
        inputSchema,
        annotations: {
          readOnlyHint: name.startsWith("get_") || name.startsWith("read_"),
        },
      };
    });
  }
  private callTool(binding: Binding, params: Record<string, unknown>) {
    const name = String(params.name ?? "");
    const role = binding.role;
    const known =
      variants.has(name as ToolName) &&
      (role === "lead"
        ? !(workerTools as readonly string[]).includes(name)
        : (workerTools as readonly string[]).includes(name));
    const fail = (code: string, message: string) => {
      this.journal(binding, "gateway.denied", { tool: name, code, message });
      const error = { error: { code, message } };
      return {
        content: [{ type: "text", text: JSON.stringify(error) }],
        structuredContent: error,
        isError: true,
      };
    };
    if (!known) return fail("POLICY_DENIED", `${name} is not a ${role} tool`);
    const review = Boolean(
      this.engine.store.getTask(binding.taskId).reviewCandidateId,
    );
    const args = argsSchema(name as ToolName, role, review).safeParse(
      params.arguments ?? {},
    );
    if (!args.success)
      return fail(
        "INVALID_INPUT",
        args.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join("; "),
      );
    const input =
      role === "worker"
        ? name === "submit_result"
          ? { name, taskId: binding.taskId, report: args.data }
          : { name, ...(args.data as object), taskId: binding.taskId }
        : { name, ...(args.data as object) };
    try {
      const result = this.engine.tool(
        { role, sessionId: binding.sessionId },
        binding.runId,
        input,
        `tool:${binding.sessionId}:${randomUUID()}`,
      );
      this.journal(binding, "gateway.tool_call", { tool: name, outcome: "ok" });
      const structured = { result: JSON.parse(JSON.stringify(result)) };
      return {
        content: [{ type: "text", text: JSON.stringify(structured.result) }],
        structuredContent: structured,
        isError: false,
      };
    } catch (error) {
      if (error instanceof DomainError)
        return fail(
          error.code,
          error.code === "STORAGE" ? "Storage operation failed" : error.message,
        );
      if (error instanceof z.ZodError)
        return fail("INVALID_INPUT", "Tool input failed engine validation");
      throw error;
    }
  }
  async handle(request: IncomingMessage, response: ServerResponse) {
    const reply = (status: number, body?: unknown) => {
      response.writeHead(
        status,
        body === undefined ? {} : { "Content-Type": "application/json" },
      );
      response.end(body === undefined ? undefined : JSON.stringify(body));
    };
    // Stateless Streamable HTTP: no server-initiated SSE stream is offered.
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      reply(405);
      return;
    }
    const binding = this.resolve(request);
    if (!binding) {
      reply(401, { error: "Session gateway token required" });
      return;
    }
    let message: z.infer<typeof jsonRpcSchema>;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 262_144) throw new Error("too large");
        chunks.push(bytes);
      }
      message = jsonRpcSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
    } catch {
      reply(400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid request" },
      });
      return;
    }
    if (message.id === undefined) {
      reply(202);
      return;
    }
    const result = (value: unknown) =>
      reply(200, { jsonrpc: "2.0", id: message.id, result: value });
    try {
      switch (message.method) {
        case "initialize": {
          const requested = message.params?.protocolVersion;
          result({
            protocolVersion:
              typeof requested === "string" && versions.includes(requested)
                ? requested
                : "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "lao", version: TOOL_SCHEMA_VERSION },
            instructions:
              "Local Agent Orchestrator tools. Every call is authorized server-side for this session's role, run, mode, ownership and budget.",
          });
          return;
        }
        case "ping":
          result({});
          return;
        case "tools/list":
          result({ tools: this.listTools(binding) });
          return;
        case "resources/list":
          result({ resources: [] });
          return;
        case "resources/templates/list":
          result({ resourceTemplates: [] });
          return;
        case "tools/call":
          result(this.callTool(binding, message.params ?? {}));
          return;
        default:
          reply(200, {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not found" },
          });
      }
    } catch (error) {
      console.error(
        "Gateway call failed",
        error instanceof Error ? error.name : "Unknown error",
      );
      reply(200, {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "Internal error" },
      });
    }
  }
}
