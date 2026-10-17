import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { taskSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import type { Dispatch } from "../../shared/orchestration.ts";
import type { SessionEvent } from "../adapters/contract.ts";
import { FakeAdapter } from "../adapters/fake.ts";
import { mutate } from "../storage/mutations.ts";
import { reconcileRevision } from "../storage/revisions.ts";
import type { Engine } from "./engine.ts";
import { stopPending } from "./stops.ts";
import { finishWorkerHelp, pendingWorkerHelp } from "./worker-help.ts";

const proposalSchema = z.strictObject({
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(8000),
});
export async function executeFakeTurn(
  engine: Engine,
  dispatch: Dispatch,
  attemptId: string,
) {
  const { store } = engine;
  const task = store.getTask(dispatch.taskId);
  const run = store.getRun(task.runId);
  const profile = engine.scheduling.profile(run.id, dispatch.profileId);
  const role = run.teamSnapshot?.roles.find(
    (item) => item.id === profile.roleId,
  );
  if (!role)
    throw new DomainError("INVALID_REFERENCE", "Missing role snapshot");
  const lead = task.kind === "lead";
  const text = lead
    ? run.mode === "chat_plan"
      ? `FAKE plan: ${task.objective.slice(0, 8000)}. Chat/Plan permits discussion only; no worker will be dispatched.`
      : JSON.stringify({
          title: "FAKE · scoped worker task",
          objective: task.objective.slice(0, 8000),
        })
    : `FAKE report for ${task.title}: scripted simulation of ${task.objective.slice(0, 8000)}. No repository files were read or edited; native execution and tests were not performed.`;
  const events: SessionEvent[] =
    lead || dispatch.scenario === "success"
      ? [
          { type: "text_delta", text },
          { type: "turn_completed", nativeStatus: "completed" },
        ]
      : dispatch.scenario === "disconnect"
        ? [
            {
              type: "text_delta",
              text: "FAKE: disconnect before an authoritative result.",
            },
            { type: "process_state", state: "disconnected", exitCode: null },
          ]
        : [
            {
              type: "session_error",
              code: "fake_failure",
              recoverable: true,
              message: "Deliberately simulated worker failure",
            },
            { type: "turn_completed", nativeStatus: "failed" },
          ];
  const adapter = new FakeAdapter([events]);
  const session = store.createSession({ attemptId }, `session:${attemptId}`);
  store.updateSession(
    { id: session.id, expectedState: "not_started", state: "starting" },
    `session:${attemptId}:starting`,
  );
  const managed = await adapter.startSession({
    runId: run.id,
    taskId: task.id,
    attemptId,
    cwd: dispatch.cwd,
    roleInstructions: role.instructions,
    model: "fake-deterministic",
    thinking: null,
    permission: profile.permission,
    contextPolicy: "fresh",
    contextPacket: task.objective,
    toolEndpoint: null,
    environment: {},
  });
  store.updateSession(
    {
      id: session.id,
      expectedState: "starting",
      state: "busy",
      nativeSessionId: managed.nativeSessionId,
    },
    `session:${attemptId}:busy`,
  );
  let index = 0;
  let cause: string | null = null;
  let completed = false;
  let output = "";
  engine.nativeStops.set(task.id, () => adapter.cancel(managed));
  engine.workerMessages.register(session.id, adapter, managed);
  try {
    for await (const event of adapter.prompt(managed, task.objective)) {
      // Short simulated latency makes owner cancellation and streaming observable.
      await delay(120);
      if (event.type === "owner_message_delivered")
        engine.workerMessages.delivered(session.id, event.messageId);
      if (pendingWorkerHelp(store, attemptId)) {
        await adapter.cancel(managed);
        break;
      }
      // Task and run stops cancel the task; an emergency stop leaves it for an
      // explicit retry decision instead of a simulated failure.
      const cancelled = store.getTask(task.id).status === "CANCELLED";
      if (cancelled || stopPending(store, attemptId)) {
        await adapter.cancel(managed);
        engine.fail(
          task.id,
          attemptId,
          cancelled
            ? "Owner cancelled"
            : "Emergency stop interrupted this FAKE session; explicit retry decision required",
          true,
        );
        store.updateSession(
          { id: session.id, expectedState: "busy", state: "stopping" },
          `session:${attemptId}:stopping`,
        );
        store.updateSession(
          {
            id: session.id,
            expectedState: "stopping",
            state: "exited",
            exitCode: 0,
          },
          `session:${attemptId}:cancelled`,
        );
        return;
      }
      const recorded = store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          attemptId,
          sessionId: session.id,
          type: `fake.${event.type}`,
          correlationId: attemptId,
          causationId: cause,
          payload: event,
        },
        `event:${attemptId}:${index++}`,
      );
      cause = recorded.id;
      if (event.type === "text_delta") output += event.text;
      if (event.type === "process_state" && event.state === "disconnected") {
        store.updateSession(
          { id: session.id, expectedState: "busy", state: "disconnected" },
          `session:${attemptId}:disconnect`,
        );
        engine.fail(
          task.id,
          attemptId,
          "Ambiguous fake disconnect; never rerun automatically",
          true,
        );
        return;
      }
      if (event.type !== "turn_completed") continue;
      if (event.nativeStatus !== "completed") {
        engine.fail(
          task.id,
          attemptId,
          "Deliberately simulated worker failure",
        );
        store.updateSession(
          { id: session.id, expectedState: "busy", state: "idle" },
          `session:${attemptId}:idle`,
        );
        return;
      }
      if (lead) {
        store.recordEvent(
          {
            runId: run.id,
            taskId: task.id,
            sessionId: session.id,
            type: "lead.message",
            correlationId: attemptId,
            payload: {
              text:
                store.getRun(run.id).mode === "chat_plan"
                  ? `FAKE plan only: ${task.objective.slice(0, 8000)}`
                  : "FAKE Lead proposed a scoped task. Owner approval is required in Supervised mode.",
            },
          },
          `lead:${attemptId}:reply`,
        );
        if (store.getRun(run.id).mode !== "chat_plan") {
          const proposal = proposalSchema.parse(JSON.parse(output));
          const proposedTask = taskSchema.parse(
            engine.tool(
              { role: "lead", sessionId: session.id },
              run.id,
              { name: "propose_task", ...proposal },
              `lead:${attemptId}:proposal`,
            ),
          );
          const workerId = run.teamSnapshot?.preset.workerProfileIds.find(
            (id) =>
              engine.scheduling.profile(run.id, id).permission === "read_only",
          );
          if (workerId && store.getRun(run.id).mode === "autonomous_bounded")
            engine.tool(
              { role: "lead", sessionId: session.id },
              run.id,
              {
                name: "assign_task",
                taskId: proposedTask.id,
                profileId: workerId,
                scenario: dispatch.scenario,
              },
              `lead:${attemptId}:assign`,
            );
        }
      }
      const artifact = lead
        ? null
        : await engine.saveReport(task, attemptId, output);
      mutate(
        store.db,
        `complete:${attemptId}`,
        "completeAttempt",
        { attemptId },
        z.boolean(),
        () => {
          if (artifact) {
            store.db
              .prepare("INSERT INTO artifacts VALUES (?,?,?,?)")
              .run(artifact.id, task.id, attemptId, JSON.stringify(artifact));
            engine.tool(
              { role: "worker", sessionId: session.id },
              run.id,
              { name: "submit_result", taskId: task.id, report: output },
              `result:${attemptId}`,
            );
            store.recordEvent(
              {
                runId: run.id,
                taskId: task.id,
                attemptId,
                type: "report.saved",
                correlationId: attemptId,
                payload: { artifactId: artifact.id, summary: artifact.summary },
              },
              `report:${attemptId}`,
            );
          }
          store.updateAttempt(
            { id: attemptId, status: "completed" },
            `attempt:${attemptId}:completed`,
          );
          store.transitionTask(
            {
              id: task.id,
              expectedStatus: "RUNNING",
              status: "AWAITING_REVIEW",
              reason: lead
                ? "Lead turn completed"
                : "Fake report ready for independent review; not integrated",
            },
            `task:${attemptId}:review`,
          );
          reconcileRevision(store, task.id, attemptId);
          store.updateSession(
            { id: session.id, expectedState: "busy", state: "idle" },
            `session:${attemptId}:idle`,
          );
          return true;
        },
      );
      completed = true;
    }
    if (!completed && !pendingWorkerHelp(store, attemptId))
      engine.fail(
        task.id,
        attemptId,
        "No authoritative fake completion event",
        true,
      );
  } finally {
    engine.nativeStops.delete(task.id);
    await adapter.dispose(managed);
    engine.workerMessages.end(session.id);
    if (pendingWorkerHelp(store, attemptId)) {
      const current = store.getSession(session.id);
      if (current.state === "busy")
        store.updateSession(
          { id: session.id, expectedState: "busy", state: "stopping" },
          `session:${attemptId}:help-stopping`,
        );
      if (store.getSession(session.id).state === "stopping")
        store.updateSession(
          {
            id: session.id,
            expectedState: "stopping",
            state: "exited",
            exitCode: 0,
          },
          `session:${attemptId}:help-exited`,
        );
      finishWorkerHelp(
        engine,
        attemptId,
        store.getSession(session.id).state === "exited",
      );
    }
  }
}
