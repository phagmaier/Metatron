import { dispatchSchema } from "../../shared/orchestration.ts";
import { mutate } from "./mutations.ts";
import type { Scheduling } from "./scheduling.ts";
import type { Store } from "./store.ts";
import { assertWorkflowAssignment } from "./workflows.ts";

export function admitBudgetWaits(store: Store, scheduling: Scheduling) {
  const waiting = scheduling
    .list()
    .filter(
      (dispatch) =>
        dispatch.state === "blocked" &&
        dispatch.blockedReason === "launch_budget",
    )
    .sort(
      (a, b) =>
        store.getTask(b.taskId).priority - store.getTask(a.taskId).priority ||
        a.sequence - b.sequence,
    );
  const exhausted = new Set<string>();
  for (const queued of waiting) {
    if (exhausted.has(queued.runId)) continue;
    const run = store.getRun(queued.runId);
    if (
      scheduling.committedLaunches(run.id) >=
      run.limits.maxTotalWorkerLaunchesPerRun
    ) {
      exhausted.add(run.id);
      continue;
    }
    const key = `budget-admit:${queued.taskId}:${queued.sequence}`;
    mutate(
      store.db,
      key,
      "admitBudgetWait",
      { taskId: queued.taskId, sequence: queued.sequence },
      dispatchSchema.nullable(),
      () => {
        const current = scheduling
          .list()
          .find((dispatch) => dispatch.taskId === queued.taskId);
        const task = store.getTask(queued.taskId);
        const live = store.getRun(task.runId);
        // Only an explicitly budget-held, never-launched generation can re-enter
        // the queue. Git blocks, human waits and ambiguous attempts never do.
        if (
          !current ||
          current.sequence !== queued.sequence ||
          current.state !== "blocked" ||
          current.blockedReason !== "launch_budget" ||
          current.attemptId !== null ||
          !task.workflowId ||
          task.kind !== "work" ||
          task.status !== "QUEUED" ||
          live.status !== "active" ||
          live.mode === "chat_plan" ||
          store.listTaskBlockers(task.id).length ||
          scheduling.committedLaunches(live.id) >=
            live.limits.maxTotalWorkerLaunchesPerRun
        )
          return null;
        assertWorkflowAssignment(store, task.id);
        store.db
          .prepare(
            "UPDATE dispatches SET state='queued',blocked_reason=NULL,diagnostic=NULL WHERE task_id=? AND sequence=?",
          )
          .run(task.id, current.sequence);
        store.recordEvent(
          {
            runId: live.id,
            taskId: task.id,
            type: "dispatch.budget_admitted",
            correlationId: key,
            payload: {
              sequence: current.sequence,
              profileId: current.profileId,
              limit: live.limits.maxTotalWorkerLaunchesPerRun,
            },
          },
          `${key}:event`,
        );
        return dispatchSchema.parse({
          ...current,
          state: "queued",
          blockedReason: null,
          diagnostic: null,
        });
      },
    );
  }
}
