import { z } from "zod";
import type { RecoveryCause, Run } from "../../shared/domain/entities.ts";
import type { Dispatch } from "../../shared/orchestration.ts";
import { CodexAdapter } from "../adapters/codex.ts";
import type { ManagedSession } from "../adapters/contract.ts";
import { git } from "../git/command.ts";
import { mutate } from "../storage/mutations.ts";
import type { Engine } from "./engine.ts";
import { leadDigest } from "./lead-run.ts";
import { recordNativePermissionDenial } from "./native-permissions.ts";
import { finishProviderFailure } from "./provider-failures.ts";
import { processIdentity } from "./recovery-observe.ts";
import { stopPending } from "./stops.ts";

const rules = `You are the Lead of a Local Agent Orchestrator run. You coordinate; you never implement.
Rules the engine enforces (not only this text):
- Your sandbox is read-only without network. Never edit files, commit or run mutating commands; workers change code in isolated worktrees.
- Orchestrate only through the lao MCP tools. Calls are authorized server-side for your role, run, mode, owner overrides and budgets. A denied call returns a structured error: report it and do not retry it unchanged.
- Do not use native sub-agents, delegation or background tasks.
- Owner decisions (pinned assignments, cancellations, mode changes) take precedence; never try to reverse them.
- After proposing or assigning work, end your turn. Do not poll or wait. The engine wakes you when a worker completes, fails or reports an urgent issue.
- When woken, call read_report for the task and explain the outcome to the owner: what was done, the evidence (structured report and engine-captured Git evidence) and what was not verified.
- A task with a captured candidate can get an independent review: request_review with a read-only roster profile (normally the Reviewer).`;
const modeGuidance: Record<Run["mode"], string> = {
  chat_plan:
    "Chat/Plan: discuss and plan only. You may read the repository and propose backlog tasks; you cannot dispatch workers.",
  supervised:
    "Supervised: assign_task, request_revision and request_review record proposals for owner approval; nothing runs until the owner approves.",
  autonomous_bounded:
    "Autonomous (bounded): assign roster workers to tasks necessary for the run objective, within budgets. Unrelated ideas stay proposals.",
};
function previousThread(engine: Engine, runId: string) {
  const { store } = engine;
  return store
    .listSessions()
    .filter((s) => {
      if (s.adapter !== "codex" || !s.nativeSessionId) return false;
      const task = store.getTask(store.getAttempt(s.attemptId).taskId);
      return task.runId === runId && task.kind === "lead";
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
}
async function checkout(root: string) {
  return `${await git(root, ["rev-parse", "HEAD"])}\n${await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ])}`;
}

export async function executeLeadTurn(
  engine: Engine,
  dispatch: Dispatch,
  attemptId: string,
) {
  const { store } = engine;
  const task = store.getTask(dispatch.taskId);
  const run = store.getRun(task.runId);
  const profile = engine.scheduling.profile(run.id, dispatch.profileId);
  const role = run.teamSnapshot?.roles.find((r) => r.id === profile.roleId);
  const previous = previousThread(engine, run.id);
  const resumeId = previous?.nativeSessionId;
  const session = store.createSession(
    {
      attemptId,
      contextPolicy: resumeId ? "resume" : "fresh",
      context: {
        effective: resumeId ? "resume" : "fresh",
        reason: resumeId
          ? "The Lead continues its run thread"
          : "First Lead turn of this run",
        predecessorAttemptId: previous?.attemptId ?? null,
        predecessorSessionId: previous?.id ?? null,
        checkpointArtifactId: null,
      },
    },
    `session:${attemptId}`,
  );
  store.updateSession(
    { id: session.id, expectedState: "not_started", state: "starting" },
    `session:${attemptId}:starting`,
  );
  const token = engine.gateway.issue({
    role: "lead",
    sessionId: session.id,
    runId: run.id,
    taskId: task.id,
    attemptId,
  });
  const record = (type: string, payload: object, key: string) =>
    store.recordEvent(
      {
        runId: run.id,
        taskId: task.id,
        attemptId,
        sessionId: session.id,
        type,
        correlationId: attemptId,
        payload,
      },
      key,
    );
  const root = store.getProject(run.projectId).repositoryPath;
  let before: string | null = null;
  let managed: ManagedSession | undefined;
  let text = "";
  let terminal: "completed" | "failed" | "interrupted" | null = null;
  let diagnostic = "Lead turn did not complete";
  let interrupted = false;
  let stopped = false;
  let lost: RecoveryCause | null = null;
  let index = 0;
  const changeState = (
    state: "busy" | "idle" | "exited" | "crashed",
    exitCode?: number | null,
  ) => {
    const current = store.getSession(session.id);
    if (
      current.state === state ||
      ["exited", "crashed"].includes(current.state)
    )
      return;
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
    before = await checkout(root);
    if (!engine.gatewayUrl || !role || profile.harness !== "codex")
      throw new Error("Native Lead requires the app server's tool gateway");
    if (
      engine.isStopping() ||
      stopPending(store, attemptId) ||
      store.getTask(task.id).status === "CANCELLED"
    ) {
      interrupted = true;
      throw new Error("Lead turn cancelled before launch");
    }
    const input = {
      runId: run.id,
      taskId: task.id,
      attemptId,
      cwd: dispatch.cwd,
      roleInstructions: `${role.instructions}\n\nExpected output:\n${role.expectedOutput}\n\n${rules}`,
      model: profile.model,
      thinking: profile.thinking,
      permission: "coordinator" as const,
      contextPolicy: resumeId ? ("resume" as const) : ("fresh" as const),
      contextPacket: `Run ${run.id}`,
      toolEndpoint: engine.gatewayUrl,
      environment: { LAO_GATEWAY_TOKEN: token },
    };
    managed = resumeId
      ? await engine.codex.resume(resumeId, input)
      : await engine.codex.startSession(input);
    store.updateSession(
      {
        id: session.id,
        expectedState: "starting",
        state: "busy",
        nativeSessionId: managed.nativeSessionId,
        ...(managed.processId
          ? {
              processId: managed.processId,
              processIdentity: await processIdentity(managed.processId),
            }
          : {}),
      },
      `session:${attemptId}:busy`,
    );
    record(
      "lead.session_configured",
      {
        threadId: managed.nativeSessionId,
        resumed: Boolean(resumeId),
        model: profile.model,
        thinking: profile.thinking,
        sandbox: "read-only (no network)",
        approvals: "never",
      },
      `lead:${attemptId}:configured`,
    );
    const active = managed;
    engine.nativeStops.set(task.id, async (reason) => {
      interrupted = true;
      if (reason === "emergency" && engine.codex instanceof CodexAdapter)
        await engine.codex.exit(active);
      else await engine.codex.cancel(active);
    });
    if (
      engine.isStopping() ||
      stopPending(store, attemptId) ||
      store.getTask(task.id).status === "CANCELLED"
    ) {
      interrupted = true;
      throw new Error("Lead turn cancelled during startup");
    }
    const current = store.getRun(run.id);
    const digest = leadDigest(engine, run.id);
    const prompt = [
      resumeId ? "" : `Run objective from the owner:\n${current.initialPrompt}`,
      `Mode: ${current.mode}. ${modeGuidance[current.mode]}`,
      `Launch budget: ${engine.scheduling.committedLaunches(run.id)}/${current.limits.maxTotalWorkerLaunchesPerRun} worker launches committed.`,
      digest.lines.length
        ? `New since your last turn:\n${digest.lines.map((l) => `- ${l}`).join("\n")}`
        : "No new events since your last turn.",
      "Start with get_run_status to see the roster and tasks.",
    ]
      .filter(Boolean)
      .join("\n\n");
    // The delivery cursor is durable before the prompt is sent, so a crashed
    // turn never silently re-delivers (or replays) the same inputs.
    record(
      "lead.turn.delivered",
      { upTo: digest.upTo, items: digest.lines.length },
      `lead:${attemptId}:delivered`,
    );
    for await (const event of engine.codex.prompt(active, prompt)) {
      if (event.type === "approval_denied")
        recordNativePermissionDenial(store, session.id, event.permission);
      else
        record(`codex.${event.type}`, event, `codex:${attemptId}:${index++}`);
      if (event.type === "text_delta")
        text = (text + event.text).slice(0, 16_000);
      if (event.type === "process_state") {
        changeState(event.state === "exited" ? "exited" : "crashed");
        if (event.state !== "exited") lost = "crashed";
        interrupted = true;
        diagnostic = "Codex exited without authoritative completion; no retry";
      }
      if (event.type === "session_error") {
        diagnostic = event.message;
        if (["protocol", "delegation_blocked"].includes(event.code))
          interrupted = true;
        if (event.code === "protocol") lost ??= "disconnected";
      }
      if (event.type === "turn_completed") {
        terminal = event.nativeStatus;
        if (
          terminal !== "completed" &&
          diagnostic === "Lead turn did not complete"
        )
          diagnostic = `Codex turn ${terminal}; explicit decision required`;
      }
    }
    if (terminal === "completed") changeState("idle");
  } catch (error) {
    diagnostic =
      error instanceof Error ? error.message : "Lead boundary failed";
  } finally {
    engine.gateway.revoke(token);
    engine.nativeStops.delete(task.id);
    if (managed) {
      try {
        const exit =
          engine.codex instanceof CodexAdapter
            ? await engine.codex.exit(managed)
            : null;
        changeState("exited", exit?.code ?? null);
        if (exit)
          record(
            "codex.process_exit",
            { exitCode: exit.code, signal: exit.signal, interrupted },
            `process-exit:${attemptId}`,
          );
        await engine.codex.dispose(managed);
        stopped = !exit || (exit.code === 0 && !exit.signal);
        if (!stopped) {
          terminal = "failed";
          lost = "crashed";
          diagnostic =
            "Codex process did not shut down cleanly; retained for recovery";
        }
      } catch {
        terminal = "failed";
        lost = "recovery_required";
        diagnostic = "Codex shutdown failed; owner inspection required";
      }
    } else changeState("exited");
    try {
      if (before !== null && (await checkout(root)) !== before) {
        terminal = "failed";
        lost = "recovery_required";
        diagnostic =
          "Owner checkout changed during a read-only Lead turn; run paused for inspection";
        record(
          "lead.policy_violation",
          { diagnostic },
          `violation:${attemptId}`,
        );
        if (store.getRun(run.id).status === "active")
          store.updateRun(
            { id: run.id, status: "paused" },
            `violation:${attemptId}:pause`,
          );
      }
    } catch {
      terminal = "failed";
      lost = "recovery_required";
      diagnostic = "Cannot verify the owner checkout after the Lead turn";
    }
  }
  if (
    terminal !== "completed" ||
    interrupted ||
    store.getTask(task.id).status === "CANCELLED"
  ) {
    if (
      terminal === "failed" &&
      !interrupted &&
      !lost &&
      stopped &&
      finishProviderFailure(engine, attemptId, true)
    )
      return;
    engine.fail(
      task.id,
      attemptId,
      diagnostic,
      lost ??
        (interrupted || terminal === "interrupted" || terminal === null
          ? "interrupted"
          : "failed"),
    );
    finishProviderFailure(engine, attemptId, false);
    return;
  }
  mutate(
    store.db,
    `complete:${attemptId}`,
    "completeLeadTurn",
    { attemptId },
    z.boolean(),
    () => {
      store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          sessionId: session.id,
          type: "lead.message",
          correlationId: attemptId,
          payload: {
            text: text.trim() || "Codex Lead ended the turn without a message.",
          },
        },
        `lead:${attemptId}:reply`,
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
          reason: "Lead turn completed",
        },
        `task:${attemptId}:review`,
      );
      return true;
    },
  );
}
