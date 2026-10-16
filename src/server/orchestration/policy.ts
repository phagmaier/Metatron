import { DomainError } from "../../shared/domain/states.ts";
import type { Actor } from "../../shared/orchestration.ts";
import type { Store } from "../storage/store.ts";

export function authorize(
  store: Store,
  actor: Actor,
  runId: string,
  operation:
    | "propose_task"
    | "assign_task"
    | "submit_result"
    | "read_assignment",
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
    if (
      actor.role === "worker" &&
      ((operation !== "submit_result" && operation !== "read_assignment") ||
        taskId !== task.id)
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Worker cannot schedule or act on another assignment",
      );
    if (actor.role === "lead" && operation === "submit_result")
      throw new DomainError(
        "POLICY_DENIED",
        "Lead cannot submit a worker result",
      );
    if (
      actor.role === "worker" &&
      operation === "submit_result" &&
      (attempt.status !== "running" || task.status !== "RUNNING")
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Result submission requires the current running attempt",
      );
  }
  if (operation === "assign_task") {
    if (run.mode === "chat_plan")
      throw new DomainError(
        "POLICY_DENIED",
        "Chat/Plan cannot dispatch workers or mutate source",
      );
    if (actor.role === "lead" && run.mode === "supervised")
      throw new DomainError(
        "POLICY_DENIED",
        "Supervised assignments require the owner",
      );
  }
  return run;
}
