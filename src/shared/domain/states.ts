import { z } from "zod";

export const taskStatusSchema = z.enum([
  "BACKLOG",
  "READY",
  "QUEUED",
  "RUNNING",
  "AWAITING_REVIEW",
  "CHANGES_REQUESTED",
  "WAITING_HUMAN",
  "WAITING_DEPENDENCY",
  "INTERRUPTED",
  "FAILED",
  "RETRY_DECISION",
  "CANCELLED",
  "READY_TO_INTEGRATE",
  "INTEGRATING",
  "BLOCKED_CONFLICT",
  "DONE",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskTransitions = {
  BACKLOG: ["READY", "WAITING_HUMAN", "CANCELLED"],
  READY: ["QUEUED", "WAITING_HUMAN", "WAITING_DEPENDENCY", "CANCELLED"],
  QUEUED: [
    "RUNNING",
    "WAITING_HUMAN",
    "WAITING_DEPENDENCY",
    "INTERRUPTED",
    "FAILED",
    "CANCELLED",
  ],
  RUNNING: [
    "AWAITING_REVIEW",
    "WAITING_HUMAN",
    "WAITING_DEPENDENCY",
    "INTERRUPTED",
    "FAILED",
    "CANCELLED",
  ],
  AWAITING_REVIEW: ["READY_TO_INTEGRATE", "CHANGES_REQUESTED", "CANCELLED"],
  CHANGES_REQUESTED: ["READY", "AWAITING_REVIEW", "CANCELLED"],
  WAITING_HUMAN: ["READY", "RUNNING", "INTERRUPTED", "CANCELLED"],
  WAITING_DEPENDENCY: ["READY", "WAITING_HUMAN", "INTERRUPTED", "CANCELLED"],
  INTERRUPTED: ["RETRY_DECISION"],
  FAILED: ["RETRY_DECISION"],
  // Only an explicit recovery decision can make failed work eligible again.
  RETRY_DECISION: ["READY", "CANCELLED"],
  CANCELLED: [],
  READY_TO_INTEGRATE: [
    "AWAITING_REVIEW",
    "INTEGRATING",
    "BLOCKED_CONFLICT",
    "CANCELLED",
  ],
  INTEGRATING: ["DONE", "BLOCKED_CONFLICT", "INTERRUPTED", "FAILED"],
  BLOCKED_CONFLICT: ["AWAITING_REVIEW", "READY_TO_INTEGRATE", "CANCELLED"],
  DONE: [],
} as const satisfies Record<TaskStatus, readonly TaskStatus[]>;

export const processStateSchema = z.enum([
  "not_started",
  "starting",
  "busy",
  "idle",
  "waiting_permission",
  "disconnected",
  "exited",
  "crashed",
  "stopping",
]);
export type ProcessState = z.infer<typeof processStateSchema>;
export const sessionTransitions = {
  not_started: ["starting"],
  starting: ["busy", "idle", "disconnected", "crashed", "exited", "stopping"],
  busy: [
    "idle",
    "waiting_permission",
    "disconnected",
    "crashed",
    "exited",
    "stopping",
  ],
  idle: ["busy", "disconnected", "crashed", "exited", "stopping"],
  waiting_permission: [
    "busy",
    "idle",
    "disconnected",
    "crashed",
    "exited",
    "stopping",
  ],
  disconnected: ["starting", "stopping", "exited", "crashed"],
  stopping: ["exited", "crashed", "disconnected"],
  exited: [],
  crashed: [],
} as const satisfies Record<ProcessState, readonly ProcessState[]>;

export class DomainError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "CONFLICT"
    | "INVALID_TRANSITION"
    | "INVALID_REFERENCE"
    | "UNSUPPORTED"
    | "NATIVE_REJECTED"
    | "NATIVE_TRANSPORT"
    | "NOT_INSTALLED"
    | "STORAGE"
    | "POLICY_DENIED"
    | "BUDGET_EXCEEDED"
    | "GIT";
  constructor(code: DomainError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DomainError";
  }
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus) {
  const allowed: readonly TaskStatus[] = taskTransitions[from];
  if (!allowed.includes(to))
    throw new DomainError(
      "INVALID_TRANSITION",
      `Task cannot transition from ${from} to ${to}`,
    );
}

export function assertSessionTransition(from: ProcessState, to: ProcessState) {
  const allowed: readonly ProcessState[] = sessionTransitions[from];
  if (!allowed.includes(to))
    throw new DomainError(
      "INVALID_TRANSITION",
      `Session cannot transition from ${from} to ${to}`,
    );
}

export const humanRequestStatusSchema = z.enum([
  "open",
  "deferred",
  "answered",
  "completed",
  "declined",
]);
type HumanRequestStatus = z.infer<typeof humanRequestStatusSchema>;
export const humanRequestTransitions: Record<
  HumanRequestStatus,
  readonly HumanRequestStatus[]
> = {
  open: ["deferred", "answered", "completed", "declined"],
  deferred: ["open", "answered", "completed", "declined"],
  answered: [],
  completed: [],
  declined: [],
};
export function assertHumanRequestTransition(
  from: HumanRequestStatus,
  to: HumanRequestStatus,
) {
  if (!humanRequestTransitions[from].includes(to))
    throw new DomainError(
      "INVALID_TRANSITION",
      `Human request cannot transition from ${from} to ${to}`,
    );
}
