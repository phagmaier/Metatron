import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import type {
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import { DomainError } from "../../shared/domain/states.ts";
import { findExecutable } from "./availability.ts";

export type ClaudeExit = { code: number | null; signal: string | null };
export type ClaudeChild = SpawnedProcess & { pid?: number | undefined };
export type ClaudeSpawn = (options: SpawnOptions) => ClaudeChild;
export const spawnClaude: ClaudeSpawn = (options) => {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });
  // Native stderr can contain prompts, tool inputs and credentials. Never retain it.
  child.stderr.resume();
  return child;
};

export async function claudeExecutable(explicit?: string): Promise<string> {
  return realpath(await findExecutable("claude", "Claude Code", explicit));
}

export class ClaudeProcess {
  private child: ClaudeChild | undefined;
  private evidence: ClaudeExit | undefined;
  private settle: ((exit: ClaudeExit) => void) | undefined;
  private childEnvironment: Readonly<NodeJS.ProcessEnv> = {};
  readonly exit = new Promise<ClaudeExit>((resolve) => {
    this.settle = resolve;
  });
  private stopping: Promise<ClaudeExit> | undefined;
  private readonly factory: ClaudeSpawn;
  constructor(factory: ClaudeSpawn) {
    this.factory = factory;
  }
  get pid(): number | undefined {
    return this.child?.pid;
  }
  get environment(): Readonly<NodeJS.ProcessEnv> {
    return this.childEnvironment;
  }
  readonly spawn = (options: SpawnOptions): SpawnedProcess => {
    if (this.child)
      throw new DomainError(
        "CONFLICT",
        "Claude attempted to replace its owned subprocess",
      );
    this.childEnvironment = { ...options.env };
    const child = this.factory(options);
    this.child = child;
    child.on("error", () => {
      /* The SDK reports a redacted transport failure. */
    });
    child.once("exit", (code, signal) => {
      this.evidence = { code, signal };
      this.settle?.(this.evidence);
    });
    if (child.exitCode !== null || child.signalCode) {
      this.evidence = {
        code: child.exitCode,
        signal: child.signalCode ?? null,
      };
      this.settle?.(this.evidence);
    }
    return child;
  };
  private async wait(milliseconds: number): Promise<boolean> {
    if (this.evidence) return true;
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      this.exit.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
    clearTimeout(timer);
    return result;
  }
  stop(): Promise<ClaudeExit> {
    this.stopping ??= this.shutdown();
    return this.stopping;
  }
  private async shutdown(): Promise<ClaudeExit> {
    if (!this.child)
      throw new DomainError(
        "CONFLICT",
        "Claude has no owned subprocess exit evidence",
      );
    if (!this.evidence) this.child.stdin.end();
    if (!(await this.wait(2000))) this.child.kill("SIGTERM");
    if (!(await this.wait(1000))) this.child.kill("SIGKILL");
    if (!(await this.wait(1000)))
      throw new DomainError(
        "CONFLICT",
        "Owned Claude process has not confirmed exit after cancellation",
      );
    return this.exit;
  }
}
