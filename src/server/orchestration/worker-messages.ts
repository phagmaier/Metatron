import { randomUUID } from "node:crypto";
import {
  sessionSchema,
  type WorkerMessage,
  workerMessageSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import type { Actor } from "../../shared/orchestration.ts";
import { sendWorkerMessageSchema } from "../../shared/worker-messages.ts";
import type { HarnessAdapter, ManagedSession } from "../adapters/contract.ts";
import { mutate } from "../storage/mutations.ts";
import type { Engine } from "./engine.ts";
import { pendingWorkerHelp } from "./worker-help.ts";

type Target = { adapter: HarnessAdapter; managed: ManagedSession };
export class WorkerMessages {
  private readonly active = new Map<string, Target>();
  private readonly engine: Engine;
  constructor(engine: Engine) {
    this.engine = engine;
    // Restart never resubmits a potentially accepted native input.
    for (const session of engine.store.listSessions()) this.end(session.id);
  }
  register(
    sessionId: string,
    adapter: HarnessAdapter,
    managed: ManagedSession,
  ) {
    this.active.set(sessionId, { adapter, managed });
  }
  list(taskId: string) {
    this.engine.store.getTask(taskId);
    return this.engine.store
      .listSessions()
      .flatMap((session) => session.ownerMessages)
      .filter((message) => message.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  private get(sessionId: string, id: string) {
    const message = this.engine.store
      .getSession(sessionId)
      .ownerMessages.find((item) => item.id === id);
    if (!message)
      throw new DomainError("NOT_FOUND", "Worker message not found");
    return message;
  }
  private save(message: WorkerMessage) {
    const { store } = this.engine;
    const session = store.getSession(message.sessionId);
    const ownerMessages = session.ownerMessages.filter(
      (item) => item.id !== message.id,
    );
    ownerMessages.push(message);
    const updated = sessionSchema.parse({
      ...session,
      ownerMessages,
      updatedAt: message.updatedAt,
    });
    store.db
      .prepare("UPDATE sessions SET data=? WHERE id=?")
      .run(JSON.stringify(updated), session.id);
    store.recordEvent(
      {
        runId: message.runId,
        taskId: message.taskId,
        attemptId: message.attemptId,
        sessionId: session.id,
        type: "owner.worker_message",
        correlationId: message.id,
        payload: message,
      },
      `worker-message:${message.id}:${message.status}`,
    );
    return message;
  }
  private update(
    sessionId: string,
    id: string,
    status: WorkerMessage["status"],
    diagnostic: string,
  ) {
    const { store } = this.engine;
    mutate(
      store.db,
      `worker-message:${id}:status:${status}`,
      "workerMessageStatus",
      { sessionId, id, status },
      workerMessageSchema,
      () => {
        const previous = this.get(sessionId, id);
        // Consumption can arrive before the command acknowledgement. Never
        // downgrade its evidence to queued or ambiguous afterward.
        if (previous.status === "delivered") return previous;
        return this.save({
          ...previous,
          status,
          diagnostic,
          updatedAt: new Date().toISOString(),
        });
      },
    );
    return this.get(sessionId, id);
  }
  delivered(sessionId: string, id: string) {
    this.get(sessionId, id);
    return this.update(
      sessionId,
      id,
      "delivered",
      "Native user-message event confirmed delivery to this session; compliance is not verified.",
    );
  }
  end(sessionId: string) {
    this.active.delete(sessionId);
    for (const message of this.engine.store.getSession(sessionId)
      .ownerMessages) {
      if (["sending", "queued"].includes(message.status))
        this.update(
          sessionId,
          message.id,
          "unconfirmed",
          "Session ended or app restarted before delivery was confirmed. This message will not be replayed.",
        );
    }
  }
  async send(actor: Actor, input: unknown, key: string) {
    if (actor.role !== "owner")
      throw new DomainError(
        "POLICY_DENIED",
        "Only the owner can message a worker",
      );
    const data = sendWorkerMessageSchema.parse(input);
    const { store } = this.engine;
    let created = false;
    const claimed = mutate(
      store.db,
      key,
      "sendWorkerMessage",
      data,
      workerMessageSchema,
      () => {
        const task = store.getTask(data.taskId);
        const session = store.getSession(data.sessionId);
        const attempt = store.getAttempt(session.attemptId);
        const run = store.getRun(task.runId);
        if (task.kind !== "work" || attempt.taskId !== task.id)
          throw new DomainError(
            "INVALID_REFERENCE",
            "Choose the worker session belonging to this task",
          );
        if (session.ownerMessages.length >= 256)
          throw new DomainError(
            "POLICY_DENIED",
            "Session owner-message limit reached",
          );
        const target = this.active.get(session.id);
        const eligible =
          run.status === "active" &&
          run.mode !== "chat_plan" &&
          !this.engine.isStopping() &&
          task.status === "RUNNING" &&
          attempt.status === "running" &&
          session.state === "busy" &&
          session.recovery === "none" &&
          !pendingWorkerHelp(store, attempt.id) &&
          target?.managed.nativeSessionId === session.nativeSessionId &&
          target.managed.input.attemptId === attempt.id &&
          target.managed.input.taskId === task.id &&
          target.managed.input.runId === run.id;
        const now = new Date().toISOString();
        created = true;
        return this.save(
          workerMessageSchema.parse({
            ...data,
            id: randomUUID(),
            runId: run.id,
            attemptId: attempt.id,
            createdAt: now,
            updatedAt: now,
            status: eligible ? "sending" : "unsupported",
            diagnostic: eligible
              ? "Submitting once to the current worker; native acceptance is not yet confirmed."
              : "No eligible live worker in this mode/session. No message sent, task started or session resumed.",
          }),
        );
      },
    );
    if (!created || claimed.status !== "sending")
      return this.get(claimed.sessionId, claimed.id);
    const target = this.active.get(claimed.sessionId);
    if (!target)
      return this.update(
        claimed.sessionId,
        claimed.id,
        "unsupported",
        "Worker input is no longer available; nothing sent.",
      );
    let result: "sent" | "queued" | "unsupported";
    try {
      result = await target.adapter.steer(target.managed, data.text, {
        kind: data.kind,
        messageId: claimed.id,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === "NATIVE_REJECTED")
        return this.update(
          claimed.sessionId,
          claimed.id,
          "unsupported",
          "Native input was rejected before acceptance. No replay or restart.",
        );
      // Transport errors may follow acceptance; raw native errors may contain
      // secrets. Keep a bounded diagnostic and never retry the native command.
      return this.update(
        claimed.sessionId,
        claimed.id,
        "unconfirmed",
        "Native message outcome is unconfirmed. Inspect the retained session; retrying this request will not resend it.",
      );
    }
    const status = result === "sent" ? "delivered" : result;
    if (status === "queued" && !this.active.has(claimed.sessionId))
      return this.update(
        claimed.sessionId,
        claimed.id,
        "unconfirmed",
        "Worker ended before delivery was confirmed; no replay.",
      );
    return this.update(
      claimed.sessionId,
      claimed.id,
      status,
      status === "delivered"
        ? "Adapter confirmed input delivery; compliance is not verified."
        : status === "queued"
          ? "Native queue accepted the message. Waiting for a matching user-message event before marking delivered."
          : "This adapter cannot accept the message at this input boundary. Nothing was restarted or resumed.",
    );
  }
}
