import { z } from "zod";
import type { Dispatch } from "../../shared/orchestration.ts";
import type { ManagedSession } from "../adapters/contract.ts";
import { PiAdapter } from "../adapters/pi.ts";
import { mutate } from "../storage/mutations.ts";
import type { Engine } from "./engine.ts";
import { notifyLead } from "./lead-run.ts";

export async function executeNativeTurn(
  engine: Engine,
  dispatch: Dispatch,
  attemptId: string,
) {
  const { store } = engine;
  const task = store.getTask(dispatch.taskId);
  const run = store.getRun(task.runId);
  const profile = engine.scheduling.profile(run.id, dispatch.profileId);
  const role = run.teamSnapshot?.roles.find((r) => r.id === profile.roleId);
  const session = store.createSession({ attemptId }, `session:${attemptId}`);
  store.updateSession(
    { id: session.id, expectedState: "not_started", state: "starting" },
    `session:${attemptId}:starting`,
  );
  const token = engine.gatewayUrl
    ? engine.gateway.issue({
        role: "worker",
        sessionId: session.id,
        runId: run.id,
        taskId: task.id,
        attemptId,
      })
    : null;
  let managed: ManagedSession | undefined;
  let output = "";
  let terminal = "failed";
  let diagnostic = "Native attempt did not complete";
  let index = 0;
  let interrupted = false;
  const changeState = (
    state: "busy" | "idle" | "exited" | "crashed",
    exitCode?: number | null,
  ) => {
    const current = store.getSession(session.id);
    if (current.state === state) return;
    if (["exited", "crashed"].includes(current.state)) return;
    store.updateSession(
      {
        id: session.id,
        expectedState: current.state,
        state,
        ...(exitCode !== undefined ? { exitCode } : {}),
      },
      `session:${attemptId}:${state}`,
    );
  };
  try {
    await engine.worktrees.prepare(attemptId);
    if (store.getTask(task.id).status === "CANCELLED") {
      interrupted = true;
      throw new Error("Owner cancelled before native process launch");
    }
    const freshRun = store.getRun(run.id);
    if (
      engine.isStopping() ||
      freshRun.status !== "active" ||
      freshRun.mode === "chat_plan"
    ) {
      interrupted = true;
      throw new Error(
        "Run paused, stopping or Chat/Plan selected before native process launch",
      );
    }
    if (!role || profile.harness !== "pi")
      throw new Error("Native worker configuration is unsupported");
    managed = await engine.pi.startSession({
      runId: run.id,
      taskId: task.id,
      attemptId,
      cwd: dispatch.cwd,
      roleInstructions: `${role.instructions}\n${profile.instructionOverride ?? ""}\nUse only this worktree. Do not access .git, credentials or other checkouts. Shell and delegation are disabled; report tests as not run.${token ? "\nCall mcp__lao__read_assignment first. Finish by calling mcp__lao__submit_result once with your structured report; report tests as not_run." : ""}`,
      model: profile.model,
      thinking: profile.thinking,
      permission: profile.permission,
      contextPolicy: "fresh",
      contextPacket: task.objective,
      toolEndpoint: token ? engine.gatewayUrl : null,
      environment: token ? { LAO_GATEWAY_TOKEN: token } : {},
    });
    store.updateSession(
      {
        id: session.id,
        expectedState: "starting",
        state: "busy",
        nativeSessionId: managed.nativeSessionId,
        ...(managed.processId ? { processId: managed.processId } : {}),
      },
      `session:${attemptId}:busy`,
    );
    const active = managed;
    engine.nativeStops.set(task.id, async () => {
      interrupted = true;
      await engine.pi.cancel(active);
    });
    if (engine.isStopping() || store.getTask(task.id).status === "CANCELLED") {
      interrupted = true;
      throw new Error("Owner cancelled/stopped during native startup");
    }
    for await (const event of engine.pi.prompt(active, task.objective)) {
      store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          attemptId,
          sessionId: session.id,
          type: `pi.${event.type}`,
          correlationId: attemptId,
          payload: event,
        },
        `pi:${attemptId}:${index++}`,
      );
      if (event.type === "text_delta")
        output = (output + event.text).slice(0, 32_000);
      if (
        event.type === "process_state" &&
        ["crashed", "exited", "disconnected"].includes(event.state)
      ) {
        changeState(
          event.state === "exited" ? "exited" : "crashed",
          event.exitCode,
        );
        interrupted = true;
        diagnostic =
          "Pi exited without authoritative completion; no automatic retry";
      }
      if (event.type === "session_error") {
        diagnostic = event.message;
        if (["protocol", "deadline"].includes(event.code)) interrupted = true;
      }
      if (event.type === "turn_completed") {
        terminal = event.nativeStatus;
        if (
          terminal !== "completed" &&
          diagnostic === "Native attempt did not complete"
        )
          diagnostic = `Pi ${terminal}; explicit retry decision required`;
      }
    }
    if (terminal === "completed") changeState("idle");
  } catch (error) {
    diagnostic =
      error instanceof Error ? error.message : "Native boundary failed";
  } finally {
    if (token) engine.gateway.revoke(token);
    engine.nativeStops.delete(task.id);
    if (managed) {
      try {
        // Pi exposes an explicit process shutdown result in addition to turn
        // completion. Exiting alone never changes task success.
        const exit =
          engine.pi instanceof PiAdapter ? await engine.pi.exit(managed) : null;
        changeState(
          !interrupted && exit && (exit.code !== 0 || exit.signal)
            ? "crashed"
            : "exited",
          exit?.code ?? null,
        );
        if (exit)
          store.recordEvent(
            {
              runId: run.id,
              taskId: task.id,
              attemptId,
              sessionId: session.id,
              type: "pi.process_exit",
              correlationId: attemptId,
              payload: {
                exitCode: exit.code,
                signal: exit.signal,
                interrupted,
              },
            },
            `process-exit:${attemptId}`,
          );
        await engine.pi.dispose(managed);
        if (!interrupted && exit && (exit.code !== 0 || exit.signal)) {
          terminal = "failed";
          interrupted = true;
          diagnostic =
            "Pi process did not shut down cleanly; retained for recovery";
        }
      } catch {
        terminal = "failed";
        interrupted = true;
        diagnostic =
          "Pi shutdown failed; process/worktree require owner inspection";
      }
    } else changeState("exited", null);
    try {
      if (
        engine.worktrees
          .list()
          .some((w) => w.attemptId === attemptId && w.state === "ready")
      ) {
        const evidence = await engine.worktrees.capture(attemptId);
        store.recordEvent(
          {
            runId: run.id,
            taskId: task.id,
            attemptId,
            sessionId: session.id,
            type: "worktree.captured",
            correlationId: attemptId,
            payload: evidence,
          },
          `evidence:${attemptId}`,
        );
        if (
          evidence.files.some((f) => f.sensitive) ||
          evidence.diffCheck !== "passed" ||
          (profile.permission === "read_only" && evidence.files.length)
        ) {
          terminal = "failed";
          diagnostic =
            "Git evidence requires owner inspection; no success inferred from model output";
        }
      }
    } catch {
      terminal = "failed";
      diagnostic =
        "Cannot verify final worktree identity/status; retained for owner inspection";
    }
    engine.worktrees.retain(attemptId);
  }
  if (
    terminal !== "completed" ||
    interrupted ||
    store.getTask(task.id).status === "CANCELLED"
  ) {
    engine.fail(
      task.id,
      attemptId,
      diagnostic,
      interrupted || terminal === "interrupted",
    );
    return;
  }
  const submitted = store.db
    .prepare(
      "SELECT payload FROM events WHERE attempt_id=? AND type='worker.result' ORDER BY sequence DESC LIMIT 1",
    )
    .get(attemptId);
  const structured = submitted
    ? z
        .object({ report: z.unknown() })
        .parse(JSON.parse(String(submitted.payload))).report
    : null;
  const text =
    output ||
    "Pi completed without text output. Inspect native events and Git evidence.";
  // A missing tool submission is survivable (spec §6.2) but stays unverified.
  const artifact = await engine.saveReport(
    task,
    attemptId,
    structured
      ? `Structured report (tool-submitted):\n${JSON.stringify(structured, null, 2)}\n\nFinal text:\n${text}`
      : `UNVERIFIED: no structured report was submitted through the gateway.\n\n${text}`,
  );
  mutate(
    store.db,
    `complete:${attemptId}`,
    "completeNativeAttempt",
    { attemptId },
    z.boolean(),
    () => {
      store.db
        .prepare("INSERT INTO artifacts VALUES (?,?,?,?)")
        .run(artifact.id, task.id, attemptId, JSON.stringify(artifact));
      store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          attemptId,
          sessionId: session.id,
          type: "report.saved",
          correlationId: attemptId,
          payload: {
            artifactId: artifact.id,
            summary: artifact.summary,
            toolSubmitted: Boolean(structured),
          },
        },
        `report:${attemptId}`,
      );
      store.updateAttempt(
        { id: attemptId, status: "completed" },
        `attempt:${attemptId}:completed`,
      );
      store.transitionTask(
        {
          id: task.id,
          expectedStatus: "RUNNING",
          status: "AWAITING_REVIEW",
          reason: "Native result and Git evidence captured; not integrated",
        },
        `task:${attemptId}:review`,
      );
      notifyLead(
        engine,
        task.id,
        "completed",
        structured && typeof structured === "object" && "summary" in structured
          ? String(structured.summary)
          : "text-only report (no structured submission)",
        `notify:${attemptId}`,
      );
      return true;
    },
  );
}
