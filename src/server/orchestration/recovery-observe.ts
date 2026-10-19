import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  type Attempt,
  type RecoveryCheck,
  recoveryCheckSchema,
  type Session,
} from "../../shared/domain/entities.ts";
import { GitError } from "../git/command.ts";
import { inspectRepository, sameRepository } from "../git/inspect.ts";
import type { Store } from "../storage/store.ts";
import type { Engine } from "./engine.ts";

// Linux-only (the target platform). A PID alone may be reused after the
// worker exits or the machine reboots; boot ID plus kernel start time is not.
// null means the identity could not be read, never that the process ended.
export async function processIdentity(processId: number) {
  try {
    const [boot, stat] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`/proc/${processId}/stat`, "utf8"),
    ]);
    // The command name may contain spaces or ")"; starttime (field 22) is the
    // 20th field after its closing parenthesis.
    const start = stat
      .slice(stat.lastIndexOf(")") + 2)
      .split(" ")
      .at(19);
    return start ? `${boot.trim()}:${start}` : null;
  } catch {
    return null;
  }
}

async function observeRepository(
  store: Store,
  attempt: Attempt,
): Promise<RecoveryCheck["repository"]> {
  const run = store.getRun(store.getTask(attempt.taskId).runId);
  const recorded = run.repository;
  if (!recorded?.identity)
    return {
      state: "unavailable",
      reason:
        "This run has no verified repository identity; reopen the project and start a new run. Its history and worktrees are retained.",
    };
  try {
    const current = await inspectRepository(
      store.getProject(run.projectId).repositoryPath,
    );
    if (!sameRepository(recorded, current))
      return {
        state: "changed",
        reason:
          "The repository root or Git directory was replaced or redirected; reopen the project and start a new run. This run and its worktrees are retained.",
      };
    if (current.baseSha !== recorded.baseSha)
      return {
        state: "changed",
        reason: `HEAD moved from ${recorded.baseSha} to ${current.baseSha}; this run's attempts start only from its recorded base`,
      };
    return {
      state: "verified",
      reason: current.clean
        ? "Root, Git directory and HEAD match this run"
        : "Root, Git directory and HEAD match this run; uncommitted changes make dispatch wait until the checkout is clean",
    };
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    return { state: "unavailable", reason: error.message };
  }
}

async function observeProcess(
  session: Session | undefined,
): Promise<RecoveryCheck["process"]> {
  const processId = session?.processId ?? null;
  if (!processId)
    return {
      processId,
      state: "not_recorded",
      reason:
        session?.adapter === "fake"
          ? "FAKE playback has no OS process"
          : "No process ID was recorded for this attempt",
    };
  let foreign = false;
  try {
    // Signal 0 only tests whether the PID exists; nothing is delivered.
    process.kill(processId, 0);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? String(error.code) : null;
    if (code === "ESRCH")
      return {
        processId,
        state: "not_running",
        reason:
          "No process with this PID exists now; descendants it started are not tracked",
      };
    if (code !== "EPERM")
      return {
        processId,
        state: "unknown",
        reason: `Process lookup failed (${code ?? "unknown error"})`,
      };
    foreign = true;
  }
  const recorded = session?.processIdentity ?? null;
  const current = recorded ? await processIdentity(processId) : null;
  if (recorded && current === recorded)
    return {
      processId,
      state: "pid_present",
      reason:
        "The recorded worker process is still running (PID, boot ID and start time match). This app does not control it, and it may still change its checkout.",
    };
  if (recorded && current)
    return {
      processId,
      state: "not_running",
      reason:
        "This PID now belongs to a different process (boot ID or start time differs), so the recorded worker is not running; descendants it started are not tracked",
    };
  return {
    processId,
    state: "pid_present",
    reason: foreign
      ? "A process with this PID exists but belongs to another user; it is not this app's child"
      : recorded
        ? "A process with this PID exists but its identity could not be read. It may be the surviving worker or an unrelated process."
        : "A process with this PID exists. It may be the surviving worker or an unrelated process that reused the PID.",
  };
}

// A native ID is matched to its own attempt and checkout. The Lead resumes its
// thread within one run and checkout; any other reuse is a conflict.
function observeNativeSession(
  store: Store,
  attempt: Attempt,
  session: Session | undefined,
): NonNullable<RecoveryCheck["nativeSession"]> {
  const id = session?.nativeSessionId ?? null;
  if (!session || !id)
    return {
      id: null,
      state: "not_recorded",
      reason:
        "No native session ID was recorded; there is nothing to match or resume",
    };
  const runId = store.getTask(attempt.taskId).runId;
  const other = store.listSessions().find((s) => {
    if (
      s.id === session.id ||
      s.adapter !== session.adapter ||
      s.nativeSessionId !== id
    )
      return false;
    const owner = store.getAttempt(s.attemptId);
    return (
      owner.cwd !== attempt.cwd || store.getTask(owner.taskId).runId !== runId
    );
  });
  if (other)
    return {
      id,
      state: "conflict",
      reason: `The same ${session.adapter} session is also recorded for attempt ${other.attemptId} in another run or checkout; it must not be resumed for this attempt`,
    };
  return {
    id,
    state: "recorded",
    reason: `Matched to this attempt's ${session.adapter} session and checkout only. Observation does not reattach, prompt or resume it.`,
  };
}

const toolEventSchema = z.object({ toolId: z.string(), summary: z.string() });
function unfinishedTools(store: Store, attemptId: string) {
  const open = new Map<string, string>();
  for (const row of store.db
    .prepare(
      "SELECT type, payload FROM events WHERE attempt_id=? AND type IN ('pi.tool_started','pi.tool_finished','codex.tool_started','codex.tool_finished','claude-code.tool_started','claude-code.tool_finished','opencode.tool_started','opencode.tool_finished') ORDER BY sequence",
    )
    .all(attemptId)) {
    const tool = toolEventSchema.parse(JSON.parse(String(row.payload)));
    if (String(row.type).endsWith(".tool_started"))
      open.set(tool.toolId, tool.summary);
    else open.delete(tool.toolId);
  }
  return [...open].slice(-20).map(([toolId, summary]) => ({ toolId, summary }));
}

// Reads the journal, filesystem, Git and the process table; writes nothing.
export async function observeRecovery(
  engine: Engine,
  attemptId: string,
): Promise<RecoveryCheck> {
  const { store } = engine;
  const attempt = store.getAttempt(attemptId);
  const session = store.listSessions().find((s) => s.attemptId === attempt.id);
  return recoveryCheckSchema.parse({
    id: randomUUID(),
    observedAt: new Date().toISOString(),
    repository: await observeRepository(store, attempt),
    worktree: await engine.worktrees.observe(attempt),
    process: await observeProcess(session),
    nativeSession: observeNativeSession(store, attempt, session),
    unfinishedTools: unfinishedTools(store, attempt.id),
  });
}
