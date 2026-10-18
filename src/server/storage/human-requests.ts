import { randomUUID } from "node:crypto";
import { humanRequestSchema, type Task } from "../../shared/domain/entities.ts";
import {
  createHumanRequestSchema,
  updateHumanRequestSchema,
} from "../../shared/domain/inputs.ts";
import {
  assertHumanRequestTransition,
  DomainError,
  type TaskStatus,
} from "../../shared/domain/states.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
import type { Store } from "./store.ts";

export function listTaskBlockers(store: Store, taskId: string) {
  store.getTask(taskId);
  return store.db
    .prepare(`
    SELECT r.data FROM human_requests r
    JOIN human_request_tasks t ON t.request_id=r.id
    WHERE t.task_id=? AND json_extract(r.data,'$.blocking')=1
      AND json_extract(r.data,'$.status') IN ('open','deferred')
    ORDER BY r.rowid
  `)
    .all(taskId)
    .map((row) => humanRequestSchema.parse(JSON.parse(String(row.data))));
}

const unfinishedAttempts = (store: Store, taskId: string) =>
  store
    .listAttempts()
    .filter(
      (attempt) =>
        attempt.taskId === taskId &&
        ["created", "running"].includes(attempt.status),
    );

export function assertHumanWaitTransition(
  store: Store,
  task: Task,
  status: TaskStatus,
) {
  // Request links enforce the hold even for records created before task waits
  // were implemented. Recovery and cancellation remain possible while blocked.
  if (
    [
      "READY",
      "QUEUED",
      "RUNNING",
      "AWAITING_REVIEW",
      "READY_TO_INTEGRATE",
      "INTEGRATING",
      "DONE",
    ].includes(status) &&
    store.listTaskBlockers(task.id).length
  )
    throw new DomainError(
      "CONFLICT",
      "Resolve every open or deferred human blocker before continuing this task",
    );
  if (
    task.status === "WAITING_HUMAN" &&
    (status === "READY" || status === "RUNNING")
  ) {
    const latest = store
      .listAttempts()
      .filter((attempt) => attempt.taskId === task.id)
      .at(-1);
    // A reply is evidence only. Reusing a live/ambiguous session or restoring
    // RUNNING needs a native continuation handshake, outside this storage step.
    if (
      status === "RUNNING" ||
      unfinishedAttempts(store, task.id).length ||
      latest?.status === "RECOVERY_REQUIRED"
    )
      throw new DomainError(
        "CONFLICT",
        "Native continuation or a recovery decision is required; replying cannot resume an attempt",
      );
  }
}

function assertCanWait(store: Store, task: Task) {
  if (
    ![
      "BACKLOG",
      "READY",
      "QUEUED",
      "RUNNING",
      "WAITING_HUMAN",
      "WAITING_DEPENDENCY",
    ].includes(task.status)
  )
    throw new DomainError(
      "CONFLICT",
      "Only pending or executing tasks can enter a human wait",
    );
  for (const attempt of unfinishedAttempts(store, task.id)) {
    const session = store
      .listSessions()
      .find((session) => session.attemptId === attempt.id);
    // Never label a busy harness as suspended or free its execution slot just
    // because a request asks it to wait. Active worker suspension follows in M6.
    if (session?.state !== "waiting_permission" || session.recovery !== "none")
      throw new DomainError(
        "CONFLICT",
        "Active execution must reach a supported pause before a blocking request can be recorded",
      );
  }
}

export function createHumanRequest(store: Store, input: unknown, key: string) {
  const data = createHumanRequestSchema.parse(input);
  return mutate(
    store.db,
    key,
    "createHumanRequest",
    data,
    humanRequestSchema,
    () => {
      const run = store.getRun(data.runId);
      const tasks = data.affectedTaskIds.map((id) => store.getTask(id));
      if (tasks.some((task) => task.runId !== run.id))
        throw new DomainError(
          "INVALID_REFERENCE",
          "Human request crosses runs",
        );
      if (data.sessionId) {
        const session = store.getSession(data.sessionId);
        const source = store.getTask(
          store.getAttempt(session.attemptId).taskId,
        );
        if (source.runId !== run.id)
          throw new DomainError(
            "INVALID_REFERENCE",
            "Human request session crosses runs",
          );
      }
      if (data.blocking) {
        if (["stopped", "completed"].includes(run.status))
          throw new DomainError(
            "CONFLICT",
            "A terminal run cannot enter a human wait",
          );
        for (const task of tasks) assertCanWait(store, task);
      }
      const now = new Date().toISOString();
      const request = humanRequestSchema.parse({
        ...data,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        status: "open",
        ownerResponse: null,
        resolvedAt: null,
      });
      store.db
        .prepare(
          "INSERT INTO human_requests(id,run_id,session_id,data) VALUES (?,?,?,?)",
        )
        .run(request.id, run.id, request.sessionId, JSON.stringify(request));
      for (const task of tasks) {
        store.db
          .prepare("INSERT INTO human_request_tasks VALUES (?,?)")
          .run(request.id, task.id);
        if (data.blocking && task.status !== "WAITING_HUMAN")
          store.transitionTask(
            {
              id: task.id,
              expectedStatus: task.status,
              status: "WAITING_HUMAN",
              reason: `Blocking human request ${request.id}`,
            },
            `${key}:wait:${task.id}`,
          );
      }
      appendEvent(store.db, {
        type: "human_request.created",
        runId: run.id,
        sessionId: request.sessionId,
        correlationId: key,
        payload: {
          requestId: request.id,
          blocking: request.blocking,
          urgency: request.urgency,
          type: request.type,
          affectedTaskIds: request.affectedTaskIds,
        },
      });
      return request;
    },
  );
}

export function updateHumanRequest(store: Store, input: unknown, key: string) {
  const data = updateHumanRequestSchema.parse(input);
  return mutate(
    store.db,
    key,
    "updateHumanRequest",
    data,
    humanRequestSchema,
    () => {
      const previous = store.getHumanRequest(data.id);
      if (previous.nativeApproval)
        throw new DomainError(
          "POLICY_DENIED",
          "Use the native approval decision control; a generic inbox reply cannot grant or resume native permission",
        );
      if (previous.status !== data.expectedStatus)
        throw new DomainError(
          "CONFLICT",
          "Human request status changed; refresh before replying",
        );
      assertHumanRequestTransition(previous.status, data.status);
      if (previous.blocking)
        for (const id of previous.affectedTaskIds) {
          const task = store.getTask(id);
          // Older requests linked a blocker without setting WAITING_HUMAN. Put
          // pending work on hold before clearing that link's active status, or a
          // reply could silently dispatch the old queued assignment.
          if (
            [
              "BACKLOG",
              "READY",
              "QUEUED",
              "RUNNING",
              "WAITING_DEPENDENCY",
            ].includes(task.status)
          ) {
            assertCanWait(store, task);
            store.transitionTask(
              {
                id,
                expectedStatus: task.status,
                status: "WAITING_HUMAN",
                reason: `Preserve human wait for request ${previous.id}`,
              },
              `${key}:wait:${id}`,
            );
          }
        }
      const now = new Date().toISOString();
      const request = humanRequestSchema.parse({
        ...previous,
        status: data.status,
        ownerResponse: data.ownerResponse ?? null,
        updatedAt: now,
        resolvedAt: ["open", "deferred"].includes(data.status) ? null : now,
      });
      // Resolving the request never dispatches work, grants native permission or
      // asserts that the requested dependency/action succeeded.
      store.db
        .prepare("UPDATE human_requests SET data=? WHERE id=?")
        .run(JSON.stringify(request), request.id);
      appendEvent(store.db, {
        type: "human_request.updated",
        runId: request.runId,
        sessionId: request.sessionId,
        correlationId: key,
        payload: {
          requestId: request.id,
          from: previous.status,
          status: request.status,
          ownerResponse: request.ownerResponse,
          affectedTaskIds: request.affectedTaskIds,
        },
      });
      return request;
    },
  );
}

// Owner-provided facts for an implementation lineage. Reviews and revisions
// see them, unlike the implementer's report, so an answer the owner gave is
// never mistaken for a guess.
export function ownerAnswers(store: Store, taskIds: string[]) {
  const answers = store
    .listHumanRequests()
    .filter(
      (r) =>
        r.ownerResponse && r.affectedTaskIds.some((id) => taskIds.includes(id)),
    )
    .slice(-5)
    .map(
      (r) =>
        `- ${r.type} request "${r.reason.slice(0, 300)}": owner answered "${r.ownerResponse?.slice(0, 1000)}"`,
    );
  return `Owner answers to this task's requests (owner-provided facts, bounded):\n${answers.join("\n") || "- none"}`;
}
