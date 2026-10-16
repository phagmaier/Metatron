import { spawn } from "node:child_process";

const keptOutput = 256 * 1024;
const killGrace = 2_000;
// Candidate code is agent-written. Pass only what common toolchains need to
// locate binaries/caches, so provider keys in the app's environment stay out.
// This is not a sandbox: the command still runs with the owner's OS permissions.
const allowedEnv =
  /^(?:PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|TZ|TMPDIR|TERM|LC_[A-Z]+|XDG_(?:CONFIG|CACHE|DATA|STATE|RUNTIME)_(?:HOME|DIR))$/;

export type TestCommandResult = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  aborted: boolean;
  spawnError: string | null;
  durationMs: number;
  output: string;
  truncated: boolean;
};

export function runTestCommand(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  abort: AbortSignal,
): Promise<TestCommandResult> {
  const [command, ...args] = argv;
  if (!command) throw new Error("Empty test command");
  const started = performance.now();
  return new Promise((resolve) => {
    let output = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let spawnError: string | null = null;
    let escalation: NodeJS.Timeout | undefined;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => allowedEnv.test(key)),
    );
    // A new process group lets timeout, shutdown and normal exit stop helpers
    // the command started, so nothing keeps writing into the worktree later.
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (!(error instanceof Error && "code" in error)) throw error;
      }
    };
    const stop = () => {
      killGroup("SIGTERM");
      escalation ??= setTimeout(() => killGroup("SIGKILL"), killGrace);
    };
    const append = (chunk: Buffer) => {
      output = Buffer.concat([output, chunk]);
      if (output.length > keptOutput) {
        output = output.subarray(output.length - keptOutput);
        truncated = true;
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      stop();
    };
    if (abort.aborted) onAbort();
    else abort.addEventListener("abort", onAbort, { once: true });
    let settled = false;
    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      abort.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        signal,
        timedOut,
        aborted,
        spawnError,
        durationMs: Math.round(performance.now() - started),
        output: output.toString("utf8"),
        truncated,
      });
    };
    child.once("error", (error) => {
      spawnError =
        "code" in error && typeof error.code === "string"
          ? error.code
          : error.name;
      if (!child.pid) finish(null, null);
    });
    child.once("exit", () => killGroup("SIGKILL"));
    child.once("close", (code, signal) => finish(code, signal));
  });
}
