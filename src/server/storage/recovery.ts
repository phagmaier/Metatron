import type { DatabaseSync } from "node:sqlite";
import {
  attemptSchema,
  sessionSchema,
  taskSchema,
} from "../../shared/domain/entities.ts";
import {
  assertSessionTransition,
  assertTaskTransition,
  type TaskStatus,
} from "../../shared/domain/states.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
import type { Store } from "./store.ts";

export function recoverInterrupted(
  db: DatabaseSync,
  store: Pick<Store, "listAttempts" | "listSessions" | "getTask">,
) {
  // Reopening never replays prompts or mutating operations. M6 will reconcile
  // native children; until then unfinished attempts require a human decision.
  for (const attempt of store.listAttempts()) {
    if (!["created", "running"].includes(attempt.status)) continue;
    const key = `recovery:${attempt.id}`;
    mutate(
      db,
      key,
      "recoverInterrupted",
      { id: attempt.id },
      attemptSchema,
      () => {
        const now = new Date().toISOString();
        const recovered = attemptSchema.parse({
          ...attempt,
          status: "RECOVERY_REQUIRED",
          updatedAt: now,
        });
        db.prepare("UPDATE attempts SET data = ? WHERE id = ?").run(
          JSON.stringify(recovered),
          attempt.id,
        );
        for (const session of store
          .listSessions()
          .filter((s) => s.attemptId === attempt.id)) {
          let state = session.state;
          if (state === "not_started") {
            assertSessionTransition(state, "starting");
            state = "starting";
          }
          if (!["exited", "crashed", "disconnected"].includes(state)) {
            assertSessionTransition(state, "disconnected");
            state = "disconnected";
          }
          const updated = sessionSchema.parse({
            ...session,
            recovery: "RECOVERY_REQUIRED",
            state,
            updatedAt: now,
          });
          db.prepare("UPDATE sessions SET data = ? WHERE id = ?").run(
            JSON.stringify(updated),
            session.id,
          );
        }
        let task = store.getTask(attempt.taskId);
        const path: TaskStatus[] = [
          "QUEUED",
          "RUNNING",
          "WAITING_HUMAN",
          "INTEGRATING",
        ].includes(task.status)
          ? ["INTERRUPTED", "RETRY_DECISION"]
          : ["FAILED", "INTERRUPTED"].includes(task.status)
            ? ["RETRY_DECISION"]
            : [];
        for (const status of path) {
          assertTaskTransition(task.status, status);
          const previous = task.status;
          task = taskSchema.parse({ ...task, status, updatedAt: now });
          db.prepare("UPDATE tasks SET data = ? WHERE id = ?").run(
            JSON.stringify(task),
            task.id,
          );
          appendEvent(db, {
            type: "task.transitioned",
            runId: task.runId,
            taskId: task.id,
            correlationId: key,
            payload: {
              from: previous,
              to: status,
              reason: "Unfinished attempt at app restart",
            },
          });
        }
        appendEvent(db, {
          type: "recovery.required",
          runId: task.runId,
          taskId: task.id,
          attemptId: attempt.id,
          correlationId: key,
          payload: {
            previousAttemptStatus: attempt.status,
            taskStatus: task.status,
          },
        });
        return recovered;
      },
    );
  }
  // Reservations represent live execution only. Recovered ambiguous attempts
  // retain their dispatch history but must never be considered queued again.
  db.exec(`BEGIN IMMEDIATE;
    UPDATE worktrees SET data=json_set(data,'$.state','retained') WHERE json_extract(data,'$.state')='ready' AND attempt_id IN (SELECT id FROM attempts WHERE json_extract(data,'$.status')='RECOVERY_REQUIRED');
    DELETE FROM reservations WHERE attempt_id IN (SELECT id FROM attempts WHERE json_extract(data,'$.status') NOT IN ('created','running'));
    UPDATE dispatches SET state='released',diagnostic='Recovery decision required after restart' WHERE state='active' AND attempt_id IN (SELECT id FROM attempts WHERE json_extract(data,'$.status')='RECOVERY_REQUIRED');
    COMMIT;`);
}
