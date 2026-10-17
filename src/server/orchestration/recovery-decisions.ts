import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  type AttemptRecovery,
  type RecoveryCheck,
  recoveryCheckSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { dispatchSchema } from "../../shared/orchestration.ts";
import {
  recheckRecoverySchema,
  recoveryDecisionSchema,
  unverifiedFacts,
} from "../../shared/recovery.ts";
import { mutate } from "../storage/mutations.ts";
import { saveAttemptRecovery } from "../storage/recovery.ts";
import type { Store } from "../storage/store.ts";
import type { Engine } from "./engine.ts";
import { observeRecovery } from "./recovery-observe.ts";

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

function saveCheck(
  store: Store,
  key: string,
  operation: string,
  taskId: string,
  attemptId: string,
  check: RecoveryCheck,
) {
  return mutate(
    store.db,
    key,
    operation,
    { taskId },
    recoveryCheckSchema,
    () => {
      const current = recoverable(store, taskId);
      if (current.attempt.id !== attemptId)
        throw new DomainError("CONFLICT", "Recovery state changed; recheck");
      saveAttemptRecovery(
        store.db,
        current.attempt,
        withCheck(current.recovery, check),
      );
      store.recordEvent(
        {
          runId: current.task.runId,
          taskId,
          attemptId,
          type:
            operation === "reconcileRestart"
              ? "recovery.reconciled"
              : "recovery.rechecked",
          correlationId: key,
          payload: check,
        },
        `${key}:event`,
      );
      return check;
    },
  );
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
  return saveCheck(
    store,
    key,
    "recheckRecovery",
    data.taskId,
    attempt.id,
    check,
  );
}

// Restart reconciliation: each pending retry decision not yet observed gets
// one observation of its repository, checkout, process, native session and
// unfinished tools. Every attempt restart found unfinished qualifies; one
// already observed keeps its facts, and any decision observes again anyway.
// The previous app's children are not owned here, so nothing is reattached,
// prompted, resumed, re-signalled, relinked or deleted, and the ambiguous
// attempt stays in RETRY_DECISION until the owner decides.
export async function reconcileRestart(engine: Engine) {
  const { store } = engine;
  for (const task of store.listTasks()) {
    if (task.kind !== "work" || task.status !== "RETRY_DECISION") continue;
    try {
      const { attempt, recovery } = recoverable(store, task.id);
      if (recovery.checks.length) continue;
      const check = await observeRecovery(engine, attempt.id);
      saveCheck(
        store,
        `restart:${check.id}`,
        "reconcileRestart",
        task.id,
        attempt.id,
        check,
      );
    } catch (error) {
      // The decision barrier stands and the owner can recheck from the card;
      // one unobservable attempt must not keep the app from starting.
      store.recordEvent(
        {
          runId: task.runId,
          taskId: task.id,
          type: "recovery.reconcile_failed",
          correlationId: `restart:${task.id}`,
          payload: {
            error:
              error instanceof DomainError
                ? `${error.code}: ${error.message}`
                : error instanceof Error
                  ? error.name
                  : "Unknown error",
          },
        },
        `restart:${randomUUID()}:failed`,
      );
    }
  }
}

const facts = (check: RecoveryCheck) =>
  JSON.stringify([
    check.repository.state,
    check.worktree.path,
    check.worktree.state,
    check.process.processId,
    check.process.state,
  ]);

// The only path from RETRY_DECISION back to scheduling. A retry is a new
// attempt: a native one gets a new worktree, and the prior checkout is
// retained, never relinked, adopted or deleted, even when a same-path
// replacement exists. Assignment decides whether its session resumes.
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
        reason: `Owner recovery decision (context ${data.contextPolicy}): new attempt; the prior attempt's checkout is retained and not relinked`,
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
          choice: "retry",
          contextPolicy: data.contextPolicy,
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
        contextPolicy: data.contextPolicy,
        resumeSessionId: data.resumeSessionId,
      },
      `${key}:enqueue`,
    );
  });
}
