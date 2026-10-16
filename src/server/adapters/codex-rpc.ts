import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";

const messageSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().optional(),
    params: z.unknown().optional(),
    result: z.unknown().optional(),
    error: z.object({ code: z.number(), message: z.string() }).optional(),
  })
  .loose();
export type CodexNotification = { method: string; params: unknown };
export type ServerRequestHandler = (
  method: string,
  params: unknown,
) => { result: unknown } | { error: { code: number; message: string } };

// Codex app-server stdio: LF-delimited JSON-RPC 2.0 messages without the
// "jsonrpc" field. The server may also send requests (approvals) to us.
export class CodexRpc {
  readonly diagnostics: Record<string, string | number | boolean>[] = [];
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<{ code: number | null; signal: string | null }>;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Set<(event: CodexNotification) => void>();
  private onRequest: ServerRequestHandler = () => ({
    error: { code: -32601, message: "Unsupported by app policy" },
  });
  private nextId = 0;
  private ended = false;
  private buffer = "";
  constructor(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) {
    this.child = spawn(command, args, { cwd, env, stdio: "pipe" });
    const decoder = new StringDecoder("utf8");
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += decoder.write(chunk);
      if (this.buffer.length > 8 * 1024 * 1024) {
        this.stopProtocol("Codex message exceeded 8 MiB");
        return;
      }
      while (this.buffer.includes("\n")) {
        const end = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, end).replace(/\r$/, "");
        this.buffer = this.buffer.slice(end + 1);
        if (line) this.receive(line);
      }
    });
    // Native stderr can include provider diagnostics; never copy it to logs.
    this.child.stderr.resume();
    this.child.stdin.on("error", () =>
      this.stopProtocol("Codex input pipe closed"),
    );
    this.closed = new Promise((resolve) => {
      this.child.once("error", () =>
        this.stopProtocol("Codex could not start; verify installed executable"),
      );
      this.child.once("close", (code, signal) => {
        this.ended = true;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(
            new DomainError(
              "UNSUPPORTED",
              "Codex exited before command response",
            ),
          );
        }
        this.pending.clear();
        for (const listener of this.listeners)
          listener({ method: "transport/exit", params: { code, signal } });
        resolve({ code, signal });
      });
    });
  }
  private receive(line: string) {
    let message: z.infer<typeof messageSchema>;
    try {
      message = messageSchema.parse(JSON.parse(line));
    } catch {
      this.stopProtocol("Malformed Codex app-server output");
      return;
    }
    this.diagnostics.push({
      ...(message.method ? { method: message.method } : {}),
      ...(typeof message.id === "number" ? { id: message.id } : {}),
      ...(message.error ? { errorCode: message.error.code } : {}),
    });
    if (this.diagnostics.length > 128) this.diagnostics.shift();
    if (message.method && message.id !== undefined) {
      const answer = this.onRequest(message.method, message.params);
      this.write({ id: message.id, ...answer });
      return;
    }
    if (message.method) {
      for (const listener of this.listeners)
        listener({ method: message.method, params: message.params });
      return;
    }
    const waiting =
      typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (!waiting) return;
    this.pending.delete(Number(message.id));
    clearTimeout(waiting.timer);
    // Error text may echo provider or account detail; keep only the code.
    if (message.error)
      waiting.reject(
        new DomainError(
          "UNSUPPORTED",
          `Codex rejected the request (code ${message.error.code})`,
        ),
      );
    else waiting.resolve(message.result);
  }
  private write(value: object) {
    if (!this.ended) this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }
  private stopProtocol(message: string) {
    for (const listener of this.listeners)
      listener({ method: "transport/error", params: { message } });
    this.child.kill("SIGTERM");
  }
  handleRequests(handler: ServerRequestHandler) {
    this.onRequest = handler;
  }
  subscribe(listener: (event: CodexNotification) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify(method: string, params?: object) {
    this.write(params ? { method, params } : { method });
  }
  request(method: string, params: object = {}, timeout = 30_000) {
    if (this.ended)
      return Promise.reject(
        new DomainError("CONFLICT", "Codex process has exited"),
      );
    const id = ++this.nextId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new DomainError(
            "CONFLICT",
            `Codex ${method} response timed out; no command was replayed`,
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }
  async close() {
    if (!this.ended) this.child.stdin.end();
    const term = setTimeout(() => this.child.kill("SIGTERM"), 3000);
    const kill = setTimeout(() => this.child.kill("SIGKILL"), 6000);
    try {
      return await this.closed;
    } finally {
      clearTimeout(term);
      clearTimeout(kill);
    }
  }
}
