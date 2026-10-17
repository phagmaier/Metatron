import { z } from "zod";
import {
  type HumanRequest,
  humanRequestSchema,
  taskSchema,
} from "../../shared/domain/entities.ts";
import {
  assertTaskTransition,
  DomainError,
} from "../../shared/domain/states.ts";
import { nativeApprovalDecisionSchema } from "../../shared/native-approvals.ts";
import type {
  HarnessAdapter,
  ManagedSession,
  SessionEvent,
} from "../adapters/contract.ts";
import { mutate } from "../storage/mutations.ts";
import type { Engine } from "./engine.ts";

type Pending = {
  sessionId: string;
  adapter: HarnessAdapter;
  managed: ManagedSession;
  nativeRequestId: string;
};
const pending = new WeakMap<Engine, Map<string, Pending>>();

export function recordClaudeApproval(
  engine: Engine,
  sessionId: string,
  adapter: HarnessAdapter,
  managed: ManagedSession,
  event: Extract<SessionEvent, { type: "approval_requested" }>,
) {
  const { store } = engine;
  const session = store.getSession(sessionId);
  const attempt = store.getAttempt(session.attemptId);
  const task = store.getTask(attempt.taskId);
  if (
    session.adapter !== "claude-code" ||
    managed.adapter !== "claude-code" ||
    session.nativeSessionId !== managed.nativeSessionId ||
    attempt.status !== "running" ||
    !["RUNNING", "WAITING_HUMAN"].includes(task.status) ||
    !["busy", "waiting_permission"].includes(session.state)
  )
    throw new DomainError(
      "CONFLICT",
      "Native approval does not belong to an executing Claude worker",
    );
  const key = `claude-approval:${session.id}:${event.nativeRequestId}`;
  const request = mutate(
    store.db,
    key,
    "recordClaudeApproval",
    { sessionId, nativeRequestId: event.nativeRequestId },
    humanRequestSchema,
    () => {
      if (session.state === "busy")
        store.updateSession(
          {
            id: session.id,
            expectedState: "busy",
            state: "waiting_permission",
          },
          `${key}:pause`,
        );
      const created = store.createHumanRequest(
        {
          runId: task.runId,
          sessionId,
          affectedTaskIds: [task.id],
          type: "permission",
          urgency: "high",
          blocking: true,
          reason: event.details,
          suggestedAction:
            "Approve this one policy-checked native file operation or deny it. Approval grants no permission beyond this request and does not prove tool execution. Shell, delegation, unsafe paths and sensitive files cannot be approved.",
        },
        `${key}:request`,
      );
      const bound = humanRequestSchema.parse({
        ...created,
        nativeApproval: {
          adapter: "claude-code",
          nativeRequestId: event.nativeRequestId,
          decision: null,
          state: "pending",
        },
      });
      store.db
        .prepare("UPDATE human_requests SET data=? WHERE id=?")
        .run(JSON.stringify(bound), bound.id);
      store.recordEvent(
        {
          type: "native_approval.requested",
          runId: task.runId,
          taskId: task.id,
          attemptId: attempt.id,
          sessionId,
          correlationId: key,
          payload: {
            requestId: bound.id,
            nativeRequestId: event.nativeRequestId,
          },
        },
        `${key}:event`,
      );
      return bound;
    },
  );
  if (request.status !== "open" || request.nativeApproval?.state !== "pending")
    throw new DomainError(
      "CONFLICT",
      "A completed native permission request cannot be requested again",
    );
  let requests = pending.get(engine);
  if (!requests) {
    requests = new Map();
    pending.set(engine, requests);
  }
  requests.set(request.id, {
    sessionId,
    adapter,
    managed,
    nativeRequestId: event.nativeRequestId,
  });
  return request;
}

function saveDecisionState(
  engine: Engine,
  request: HumanRequest,
  state: "accepted" | "failed",
  key: string,
) {
  return mutate(
    engine.store.db,
    key,
    "nativeApprovalReceipt",
    { id: request.id, state },
    humanRequestSchema,
    () => {
      const current = engine.store.getHumanRequest(request.id);
      if (!current.nativeApproval)
        throw new DomainError(
          "INVALID_REFERENCE",
          "Missing native approval binding",
        );
      const saved = humanRequestSchema.parse({
        ...current,
        nativeApproval: { ...current.nativeApproval, state },
        suggestedAction:
          state === "accepted"
            ? "The adapter accepted this one-shot decision. This is not proof of tool execution; inspect the retained result and worktree evidence."
            : "Permission delivery or its durable receipt failed. Inspect retained native execution and exit evidence; this callback cannot be replayed. Choose explicit recovery if needed.",
        updatedAt: new Date().toISOString(),
      });
      engine.store.db
        .prepare("UPDATE human_requests SET data=? WHERE id=?")
        .run(JSON.stringify(saved), saved.id);
      engine.store.recordEvent(
        {
          type: `native_approval.${state}`,
          runId: saved.runId,
          sessionId: saved.sessionId,
          correlationId: key,
          payload: {
            requestId: saved.id,
            decision: saved.nativeApproval?.decision ?? null,
          },
        },
        `${key}:event`,
      );
      return saved;
    },
  );
}

export async function decideClaudeApproval(
  engine: Engine,
  input: unknown,
  key: string,
) {
  const data = nativeApprovalDecisionSchema.parse(input);
  const { store } = engine;
  const request = mutate(
    store.db,
    key,
    "decideClaudeApproval",
    data,
    humanRequestSchema,
    () => {
      const previous = store.getHumanRequest(data.id);
      const binding = pending.get(engine)?.get(previous.id);
      if (
        !previous.nativeApproval ||
        !binding ||
        previous.status !== "open" ||
        previous.nativeApproval.state !== "pending" ||
        previous.sessionId !== binding.sessionId ||
        previous.nativeApproval.nativeRequestId !== binding.nativeRequestId
      )
        throw new DomainError(
          "CONFLICT",
          "Native permission is no longer pending in this app process; inspect recovery instead",
        );
      const session = store.getSession(binding.sessionId);
      const attempt = store.getAttempt(session.attemptId);
      const task = store.getTask(attempt.taskId);
      const run = store.getRun(task.runId);
      if (
        session.adapter !== "claude-code" ||
        session.nativeSessionId !== binding.managed.nativeSessionId ||
        session.state !== "waiting_permission" ||
        session.recovery !== "none" ||
        attempt.status !== "running" ||
        task.status !== "WAITING_HUMAN" ||
        previous.runId !== run.id ||
        previous.affectedTaskIds.length !== 1 ||
        previous.affectedTaskIds[0] !== task.id
      )
        throw new DomainError(
          "CONFLICT",
          "Native session or task changed while permission was pending",
        );
      if (
        data.decision === "approve" &&
        (run.status !== "active" ||
          run.mode === "chat_plan" ||
          store
            .listTaskBlockers(task.id)
            .some(
              (blocker) =>
                !blocker.nativeApproval || blocker.sessionId !== session.id,
            ))
      )
        throw new DomainError(
          "POLICY_DENIED",
          "Paused, Chat/Plan or otherwise blocked work cannot receive native approval",
        );
      if (
        ["stopped", "completed"].includes(run.status) ||
        session.stops.some((stop) => stop.status === "pending")
      )
        throw new DomainError(
          "CONFLICT",
          "Native execution is stopping; no permission can be delivered",
        );
      const now = new Date().toISOString();
      const saved = humanRequestSchema.parse({
        ...previous,
        status: data.decision === "approve" ? "answered" : "declined",
        ownerResponse:
          data.decision === "approve"
            ? "Approve this native operation once"
            : "Deny this native operation",
        resolvedAt: now,
        updatedAt: now,
        nativeApproval: { ...previous.nativeApproval, decision: data.decision },
      });
      store.db
        .prepare("UPDATE human_requests SET data=? WHERE id=?")
        .run(JSON.stringify(saved), saved.id);
      if (store.listTaskBlockers(task.id).length === 0) {
        // This is the live native permission handshake, not a generic inbox reply.
        // Only the exact in-memory callback can continue its still-owned attempt.
        assertTaskTransition(task.status, "RUNNING");
        const resumed = taskSchema.parse({
          ...task,
          status: "RUNNING",
          updatedAt: now,
        });
        store.db
          .prepare("UPDATE tasks SET data=? WHERE id=?")
          .run(JSON.stringify(resumed), task.id);
        store.updateSession(
          {
            id: session.id,
            expectedState: "waiting_permission",
            state: "busy",
          },
          `${key}:continue`,
        );
        store.recordEvent(
          {
            type: "task.transitioned",
            runId: run.id,
            taskId: task.id,
            attemptId: attempt.id,
            sessionId: session.id,
            correlationId: key,
            payload: {
              from: "WAITING_HUMAN",
              status: "RUNNING",
              reason: "Owner answered the live native permission callback",
            },
          },
          `${key}:task`,
        );
      }
      store.recordEvent(
        {
          type: "native_approval.decided",
          runId: run.id,
          taskId: task.id,
          attemptId: attempt.id,
          sessionId: session.id,
          correlationId: key,
          payload: { requestId: saved.id, decision: data.decision },
        },
        `${key}:event`,
      );
      return saved;
    },
  );
  const binding = pending.get(engine)?.get(request.id);
  // Idempotent replay/restart observes a recorded decision, never re-grants it.
  if (!binding) return store.getHumanRequest(request.id);
  pending.get(engine)?.delete(request.id);
  try {
    await binding.adapter.respondToApproval(
      binding.managed,
      binding.nativeRequestId,
      data.decision,
    );
    return saveDecisionState(engine, request, "accepted", `${key}:receipt`);
  } catch {
    try {
      saveDecisionState(engine, request, "failed", `${key}:receipt`);
    } catch {
      throw new DomainError(
        "STORAGE",
        "Native permission receipt could not be persisted; the tool may have received the decision. Inspect retained execution; never replay this callback",
      );
    } finally {
      // A journal failure must not skip cancellation after a native side effect.
      try {
        await binding.adapter.cancel(binding.managed);
      } catch {
        store.recordEvent(
          {
            type: "native_approval.cancel_failed",
            runId: request.runId,
            sessionId: request.sessionId,
            correlationId: key,
            payload: { requestId: request.id },
          },
          `${key}:cancel-failed`,
        );
      }
    }
    throw new DomainError(
      "NATIVE_TRANSPORT",
      "Permission delivery or its durable receipt failed; native execution is retained for inspection, never automatically replayed",
    );
  }
}

export function endClaudeApprovals(engine: Engine, sessionId?: string) {
  const { store } = engine;
  for (const request of store.listHumanRequests()) {
    if (
      !request.nativeApproval ||
      (sessionId && request.sessionId !== sessionId) ||
      request.nativeApproval.state !== "pending"
    )
      continue;
    pending.get(engine)?.delete(request.id);
    const key = `native-approval-expired:${request.id}`;
    mutate(
      store.db,
      key,
      "expireNativeApproval",
      { id: request.id },
      z.boolean(),
      () => {
        const now = new Date().toISOString();
        const saved = humanRequestSchema.parse({
          ...request,
          status: request.status === "open" ? "declined" : request.status,
          resolvedAt: request.resolvedAt ?? now,
          updatedAt: now,
          nativeApproval: { ...request.nativeApproval, state: "expired" },
          suggestedAction:
            "The owning native session ended or the app restarted. This callback cannot be approved or replayed; inspect the retained task/session and choose explicit recovery if needed.",
        });
        store.db
          .prepare("UPDATE human_requests SET data=? WHERE id=?")
          .run(JSON.stringify(saved), saved.id);
        store.recordEvent(
          {
            type: "native_approval.expired",
            runId: saved.runId,
            sessionId: saved.sessionId,
            correlationId: key,
            payload: { requestId: saved.id },
          },
          `${key}:event`,
        );
        return true;
      },
    );
  }
}
