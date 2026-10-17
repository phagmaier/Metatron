import type { Run } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type Actor,
  leadReadTools,
  type ToolName,
  workerTools,
} from "../../shared/orchestration.ts";
import type { Store } from "../storage/store.ts";
import { pendingWorkerHelp } from "./worker-help.ts";

const planningTools: readonly ToolName[] = [
  ...leadReadTools,
  "propose_task",
  "escalate_issue",
  "request_human_input",
];
// Backend allowlist per spec §4.2. Supervised assignment/revision calls become
// owner-approval proposals; only Autonomous mode lets the Lead dispatch.
const leadTools: Record<Run["mode"], readonly ToolName[]> = {
  chat_plan: planningTools,
  supervised: [
    ...planningTools,
    "assign_task",
    "request_revision",
    "request_review",
  ],
  autonomous_bounded: [
    ...planningTools,
    "assign_task",
    "request_revision",
    "request_review",
  ],
};
export function toolsFor(role: "lead" | "worker", mode: Run["mode"]) {
  return role === "lead" ? leadTools[mode] : workerTools;
}
const runningOnly: readonly ToolName[] = [
  "submit_result",
  "report_progress",
  "report_issue",
  "request_human_action",
];

export function authorize(
  store: Store,
  actor: Actor,
  runId: string,
  operation: ToolName,
  taskId?: string,
) {
  const run = store.getRun(runId);
  if (actor.role !== "owner") {
    const session = store.getSession(actor.sessionId);
    const attempt = store.getAttempt(session.attemptId);
    const task = store.getTask(attempt.taskId);
    if (
      task.runId !== runId ||
      session.recovery !== "none" ||
      ["exited", "crashed", "disconnected"].includes(session.state)
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Session is outside this active run",
      );
    const isLead =
      task.kind === "lead" &&
      attempt.profileId === run.teamSnapshot?.preset.leadProfileId;
    if ((actor.role === "lead") !== isLead)
      throw new DomainError(
        "POLICY_DENIED",
        "Session role does not match its assignment",
      );
    if (!toolsFor(actor.role, run.mode).includes(operation))
      throw new DomainError(
        "POLICY_DENIED",
        actor.role === "lead"
          ? `${operation} is not permitted for the Lead in ${run.mode} mode`
          : "Worker cannot schedule or act on another assignment",
      );
    if (actor.role === "worker" && taskId !== task.id)
      throw new DomainError(
        "POLICY_DENIED",
        "Worker cannot schedule or act on another assignment",
      );
    if (
      actor.role === "worker" &&
      runningOnly.includes(operation) &&
      (attempt.status !== "running" || task.status !== "RUNNING")
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Worker reports require the current running attempt",
      );
    if (
      actor.role === "worker" &&
      !["read_assignment", "request_human_action", "report_issue"].includes(
        operation,
      ) &&
      pendingWorkerHelp(store, attempt.id)
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Worker is stopping for owner help; further reports/results are refused",
      );
  }
  if (
    operation === "assign_task" ||
    operation === "request_revision" ||
    operation === "request_review"
  ) {
    if (run.mode === "chat_plan")
      throw new DomainError(
        "POLICY_DENIED",
        "Chat/Plan cannot dispatch workers or mutate source",
      );
  }
  return run;
}
