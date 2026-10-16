import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import { DomainError } from "../../shared/domain/states.ts";

export const rpcRecordSchema = z
  .object({ type: z.string() })
  .catchall(z.unknown());
export type RpcRecord = z.infer<typeof rpcRecordSchema>;
export class PiRpc {
  readonly diagnostics: Record<string, string | number | boolean>[] = [];
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<{ code: number | null; signal: string | null }>;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Set<(event: RpcRecord) => void>();
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
      if (this.buffer.length > 4 * 1024 * 1024) {
        this.stopProtocol("RPC record exceeded 4 MiB");
        return;
      }
      while (this.buffer.includes("\n")) {
        const end = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, end).replace(/\r$/, "");
        this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        try {
          const event = rpcRecordSchema.parse(JSON.parse(line));
          const header: Record<string, string | number | boolean> = {
            type: event.type,
          };
          for (const key of [
            "id",
            "command",
            "success",
            "aborted",
            "willRetry",
            "toolName",
            "toolCallId",
          ]) {
            const value = event[key];
            if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
            )
              header[key] = value;
          }
          this.diagnostics.push(header);
          if (this.diagnostics.length > 128) this.diagnostics.shift();
          const waiting =
            typeof event.id === "string"
              ? this.pending.get(event.id)
              : undefined;
          if (event.type === "response" && waiting) {
            this.pending.delete(String(event.id));
            clearTimeout(waiting.timer);
            // Native error bodies may contain provider headers or credentials.
            if (event.success === true) waiting.resolve(event.data);
            else
              waiting.reject(
                new DomainError(
                  "NATIVE_REJECTED",
                  `Pi rejected ${String(event.command)}; check native configuration`,
                ),
              );
          } else for (const listener of this.listeners) listener(event);
        } catch {
          this.stopProtocol("Malformed Pi RPC output");
          return;
        }
      }
    });
    // Never put native stderr or environment values into app logs. Persisted
    // Pi session files under app data provide native diagnostics for the owner.
    this.child.stderr.resume();
    this.child.stdin.on("error", () =>
      this.stopProtocol("Pi input pipe closed"),
    );
    this.closed = new Promise((resolve) => {
      this.child.once("error", () =>
        this.stopProtocol("Pi could not start; verify installed executable"),
      );
      this.child.once("close", (code, signal) => {
        this.ended = true;
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(
            new DomainError(
              "NATIVE_TRANSPORT",
              "Pi exited before command response",
            ),
          );
        }
        this.pending.clear();
        for (const listener of this.listeners)
          listener({ type: "transport_exit", code, signal });
        resolve({ code, signal });
      });
    });
  }
  private stopProtocol(message: string) {
    for (const listener of this.listeners)
      listener({ type: "transport_error", message });
    this.child.kill("SIGTERM");
  }
  subscribe(listener: (event: RpcRecord) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  request(
    type: string,
    values: Record<string, unknown> = {},
    timeout = 15_000,
  ): Promise<unknown> {
    if (this.ended)
      return Promise.reject(
        new DomainError("NATIVE_TRANSPORT", "Pi process has exited"),
      );
    const id = String(++this.nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new DomainError(
            "CONFLICT",
            `Pi ${type} response timed out; no command was replayed`,
          ),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ ...values, id, type })}\n`);
    });
  }
  async close() {
    if (!this.ended) this.child.stdin.end();
    const term = setTimeout(() => this.child.kill("SIGTERM"), 2000);
    const kill = setTimeout(() => this.child.kill("SIGKILL"), 4000);
    try {
      return await this.closed;
    } finally {
      clearTimeout(term);
      clearTimeout(kill);
    }
  }
}
