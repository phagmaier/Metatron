import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  type Attempt,
  type AttemptRecovery,
  type RecoveryCheck,
  recoveryCheckSchema,
  type Session,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { dispatchSchema } from "../../shared/orchestration.ts";
import {
  recheckRecoverySchema,
  recoveryDecisionSchema,
  unverifiedFacts,
} from "../../shared/recovery.ts";
import { GitError } from "../git/command.ts";
import { inspectRepository } from "../git/inspect.ts";
import { mutate } from "../storage/mutations.ts";
import { saveAttemptRecovery } from "../storage/recovery.ts";
import type { Store } from "../storage/store.ts";
import type { Engine } from "./engine.ts";

async function observeRepository(
  store: Store,
  attempt: Attempt,
): Promise<RecoveryCheck["repository"]> {
  const run = store.getRun(store.getTask(attempt.taskId).runId);
  const recorded = run.repository;
  if (!recorded)
    return {
      state: "unavailable",
      reason: "This run recorded no repository identity",
    };
  try {
    const current = await inspectRepository(
      store.getProject(run.projectId).repositoryPath,
    );
    if (
      current.root !== recorded.root ||
      current.commonDirectory !== recorded.commonDirectory
    )
      return {
        state: "changed",
        reason:
          "The repository root or Git directory differs from this run's recorded identity",
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

function observeProcess(
  session: Session | undefined,
): RecoveryCheck["process"] {
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
  try {
    // Signal 0 only tests whether the PID exists; nothing is delivered.
    process.kill(processId, 0);
    return {
      processId,
      state: "pid_present",
      reason:
        "A process with this PID exists. It may be the surviving worker or an unrelated process that reused the PID.",
    };
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
    if (code === "EPERM")
      return {
        processId,
        state: "pid_present",
        reason:
          "A process with this PID exists but belongs to another user; it is not this app's child",
      };
    return {
      processId,
      state: "unknown",
      reason: `Process lookup failed (${code ?? "unknown error"})`,
    };
  }
}

// Reads the filesystem, Git and the process table; writes nothing anywhere.
export async function observeRecovery(
  engine: Engine,
  attemptId: string,
): Promise<RecoveryCheck> {
  const { store } = engine;
  const attempt = store.getAttempt(attemptId);
  return recoveryCheckSchema.parse({
    id: randomUUID(),
    observedAt: new Date().toISOString(),
    repository: await observeRepository(store, attempt),
    worktree: await engine.worktrees.observe(attempt),
    process: observeProcess(
      store.listSessions().find((s) => s.attemptId === attempt.id),
    ),
  });
}

function recoverable(store: Store, taskId: string) {
  const task = store.getTask(taskId);
  if (task.kind !== "work" || task.status !== "RETRY_DECISION")
    throw new DomainError(
      "CONFLICT",
      "Only a work task awaiting a retry decision can be rechecked or retried",
    );
  const attempt = store
    .listAttempts()
    .findLast((item) => item.taskId === task.id);
  if (!attempt || ["created", "running"].includes(attempt.status))
    throw new DomainError(
      "CONFLICT",
      "No finished attempt evidence exists for this task",
    );
  const recovery: AttemptRecovery = attempt.recovery ?? {
    cause:
      attempt.status === "RECOVERY_REQUIRED"
        ? "recovery_required"
        : attempt.status === "failed"
          ? "failed"
          : "interrupted",
    reason:
      "Recorded before explicit recovery causes; see this attempt's journal diagnostic",
    recordedAt: attempt.updatedAt,
    checks: [],
    decision: null,
  };
  return { task, attempt, recovery };
}

function withCheck(recovery: AttemptRecovery, check: RecoveryCheck) {
  return { ...recovery, checks: [...recovery.checks, check].slice(-20) };
}

// A replayed key returns its stored result before any observation, so a lost
// response is never observed or decided twice.
function stored<T>(
  store: Store,
  key: string,
  operation: string,
  input: unknown,
  schema: z.ZodType<T>,
) {
  if (!store.db.prepare("SELECT 1 FROM mutations WHERE key=?").get(key))
    return null;
  return mutate(store.db, key, operation, input, schema, () => {
    throw new DomainError("STORAGE", "Recorded mutation disappeared");
  });
}

export async function recheckRecovery(
  engine: Engine,
  input: unknown,
  key: string,
) {
  const { store } = engine;
  const data = recheckRecoverySchema.parse(input);
  const replayed = stored(
    store,
    key,
    "recheckRecovery",
    data,
    recoveryCheckSchema,
  );
  if (replayed) return replayed;
  const { attempt } = recoverable(store, data.taskId);
  const check = await observeRecovery(engine, attempt.id);
  return mutate(
    store.db,
    key,
    "recheckRecovery",
    data,
    recoveryCheckSchema,
    () => {
      const current = recoverable(store, data.taskId);
      if (current.attempt.id !== attempt.id)
        throw new DomainError("CONFLICT", "Recovery state changed; recheck");
      saveAttemptRecovery(
        store.db,
        current.attempt,
        withCheck(current.recovery, check),
      );
      store.recordEvent(
        {
          runId: current.task.runId,
          taskId: current.task.id,
          attemptId: attempt.id,
          type: "recovery.rechecked",
          correlationId: key,
          payload: check,
        },
        `${key}:event`,
      );
      return check;
    },
  );
}

const facts = (check: RecoveryCheck) =>
  JSON.stringify([
    check.repository.state,
    check.worktree.path,
    check.worktree.state,
    check.process.processId,
    check.process.state,
  ]);

// The only path from RETRY_DECISION back to scheduling. A retry is always a
// fresh attempt in a new worktree: the prior checkout is retained, never
// relinked, adopted or deleted, even when a same-path replacement exists.
export async function decideRecovery(
  engine: Engine,
  input: unknown,
  key: string,
) {
  const { store } = engine;
  const data = recoveryDecisionSchema.parse(input);
  const replayed = stored(store, key, "decideRecovery", data, dispatchSchema);
  if (replayed) return replayed;
  const { attempt, recovery } = recoverable(store, data.taskId);
  const seen = recovery.checks.at(-1);
  if (seen?.id !== data.checkId)
    throw new DomainError(
      "CONFLICT",
      "Decide on the newest recheck; observe current facts first",
    );
  const check = await observeRecovery(engine, attempt.id);
  if (facts(check) !== facts(seen))
    throw new DomainError(
      "CONFLICT",
      "Recovery facts changed since the last recheck; recheck before deciding",
    );
  if (check.repository.state !== "verified")
    throw new DomainError(
      "CONFLICT",
      `Repository identity is not verified (${check.repository.reason}). A retry cannot start; cancel the task or restore the repository manually.`,
    );
  const unverified = unverifiedFacts(check);
  if (unverified.length && !data.acceptUnverified)
    throw new DomainError(
      "CONFLICT",
      `Explicitly accept the unverified prior ${unverified.join(" and ")} before retrying`,
    );
  return mutate(store.db, key, "decideRecovery", data, dispatchSchema, () => {
    const current = recoverable(store, data.taskId);
    if (
      current.attempt.id !== attempt.id ||
      current.recovery.checks.at(-1)?.id !== data.checkId
    )
      throw new DomainError("CONFLICT", "Recovery state changed; recheck");
    const decision = {
      decidedAt: new Date().toISOString(),
      checkId: check.id,
      profileId: data.profileId,
      acceptedUnverified: data.acceptUnverified,
    };
    saveAttemptRecovery(store.db, current.attempt, {
      ...withCheck(current.recovery, check),
      decision,
    });
    store.transitionTask(
      {
        id: current.task.id,
        expectedStatus: "RETRY_DECISION",
        status: "READY",
        reason:
          "Owner recovery decision: fresh attempt in a new worktree; the prior attempt's checkout is retained and not relinked",
      },
      `${key}:ready`,
    );
    store.recordEvent(
      {
        runId: current.task.runId,
        taskId: current.task.id,
        attemptId: attempt.id,
        type: "recovery.decided",
        correlationId: key,
        payload: {
          ...decision,
          choice: "retry_fresh",
          unverified,
          repository: check.repository.state,
          worktree: check.worktree.state,
          process: check.process.state,
        },
      },
      `${key}:event`,
    );
    // Enqueue applies roster, blocker, dependency and hard launch-budget
    // rules; any refusal rolls back the whole decision.
    return engine.scheduling.enqueue(
      { role: "owner" },
      {
        taskId: current.task.id,
        profileId: data.profileId,
        scenario: data.scenario,
      },
      `${key}:enqueue`,
    );
  });
}
