import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type Task, taskSchema } from "../../shared/domain/entities.ts";
import {
  assertTaskTransition,
  DomainError,
  type TaskStatus,
} from "../../shared/domain/states.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
import type { Store } from "./store.ts";

export function unmetDependencies(store: Store, task: Task) {
  return task.dependencyIds.filter((id) => store.getTask(id).status !== "DONE");
}

function hasUnsettledAttempt(store: Store, task: Task) {
  const attempts = store.listAttempts().filter((a) => a.taskId === task.id);
  return attempts.some((a) => ["created", "running"].includes(a.status));
}

export function assertDependencyTransition(
  store: Store,
  task: Task,
  status: TaskStatus,
) {
  if (
    (["QUEUED", "RUNNING"].includes(status) ||
      (task.status === "WAITING_DEPENDENCY" && status === "READY")) &&
    unmetDependencies(store, task).length
  )
    throw new DomainError(
      "CONFLICT",
      "Every prerequisite must be DONE before continuing",
    );
  // A dependency hold is scheduling state, never a native suspension handshake
  // or permission to replay a live/ambiguous attempt.
  if (
    ((task.status === "WAITING_DEPENDENCY" && status === "READY") ||
      status === "WAITING_DEPENDENCY") &&
    hasUnsettledAttempt(store, task)
  )
    throw new DomainError(
      "CONFLICT",
      "Active or ambiguous work requires an explicit recovery decision",
    );
}

export function reconcileDependencyWaits(
  store: Store,
  correlationId: string,
  runId?: string,
) {
  // This transaction also composes with the triggering task/request mutation:
  // owner replies cannot expose a half-updated dependency chain to dispatch.
  return mutate(
    store.db,
    `dependencies:${randomUUID()}`,
    "dependencyWaits",
    { runId: runId ?? null },
    z.null(),
    () => {
      const move = (
        task: Task,
        status: TaskStatus,
        prerequisiteIds: string[],
      ) => {
        assertTaskTransition(task.status, status);
        const updated = taskSchema.parse({
          ...task,
          status,
          updatedAt: new Date().toISOString(),
        });
        store.db
          .prepare("UPDATE tasks SET data=? WHERE id=?")
          .run(JSON.stringify(updated), task.id);
        appendEvent(store.db, {
          type: "task.transitioned",
          runId: task.runId,
          taskId: task.id,
          correlationId,
          payload: {
            from: task.status,
            to: status,
            reason: prerequisiteIds.length
              ? "Waiting for unfinished prerequisites"
              : "All prerequisites completed",
            prerequisiteIds,
          },
        });
        return updated;
      };
      for (let task of store.listTasks(runId)) {
        if (!["READY", "QUEUED", "WAITING_DEPENDENCY"].includes(task.status))
          continue;
        const pending = unmetDependencies(store, task);
        if (["READY", "QUEUED"].includes(task.status) && pending.length) {
          if (!hasUnsettledAttempt(store, task))
            move(task, "WAITING_DEPENDENCY", pending);
        } else if (task.status === "WAITING_DEPENDENCY" && !pending.length) {
          if (
            store.listTaskBlockers(task.id).length ||
            hasUnsettledAttempt(store, task)
          )
            continue;
          task = move(task, "READY", []);
          // Keep the owner's saved assignment, FIFO sequence and budget commitment.
          // BACKLOG and human/recovery waits are never promoted by this path.
          const dispatch = store.db
            .prepare("SELECT state FROM dispatches WHERE task_id=?")
            .get(task.id);
          if (dispatch?.state === "queued") move(task, "QUEUED", []);
        }
      }
      return null;
    },
  );
}
