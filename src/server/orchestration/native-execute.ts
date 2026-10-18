import { z } from "zod";
import {
  type RecoveryCause,
  type RecoveryCheck,
  reviewResultSchema,
} from "../../shared/domain/entities.ts";
import { harnessLabel } from "../../shared/native.ts";
import {
  type Dispatch,
  handoffReportSchema,
} from "../../shared/orchestration.ts";
import type { Candidate } from "../../shared/worktrees.ts";
import { ClaudeAdapter } from "../adapters/claude.ts";
import { CodexAdapter } from "../adapters/codex.ts";
import type { ManagedSession } from "../adapters/contract.ts";
import { OpenCodeAdapter } from "../adapters/opencode.ts";
import { PiAdapter } from "../adapters/pi.ts";
import { GitError } from "../git/command.ts";
import { createIntegrationCandidate } from "../storage/candidates.ts";
import { mutate } from "../storage/mutations.ts";
import { createReview } from "../storage/reviews.ts";
import { reconcileRevision } from "../storage/revisions.ts";
import { prepareContext } from "./context-policy.ts";
import type { Engine } from "./engine.ts";
import { notifyLead } from "./lead-run.ts";
import {
  endNativeApprovals,
  recordNativeApproval,
} from "./native-approvals.ts";
import { finishProviderFailure } from "./provider-failures.ts";
import { observeRecovery, processIdentity } from "./recovery-observe.ts";
import { reviewPacket } from "./review.ts";
import { revisionPacket } from "./revision.ts";
import { stopPending } from "./stops.ts";
import { finishWorkerHelp, pendingWorkerHelp } from "./worker-help.ts";

export async function executeNativeTurn(
  engine: Engine,
  dispatch: Dispatch,
  attemptId: string,
) {
  const { store } = engine;
  const task = store.getTask(dispatch.taskId);
  const run = store.getRun(task.runId);
  const profile = engine.scheduling.profile(run.id, dispatch.profileId);
  const adapter = engine.adapters[profile.harness];
  const label = harnessLabel[profile.harness];
  const codex = profile.harness === "codex";
  const role = run.teamSnapshot?.roles.find((r) => r.id === profile.roleId);
  const planned = await prepareContext(engine, dispatch, attemptId);
  if ("refused" in planned) {
    engine.fail(task.id, attemptId, planned.refused);
    return;
  }
  const session = store.createSession(
    {
      attemptId,
      contextPolicy: dispatch.contextPolicy,
      context: planned.context,
    },
    `session:${attemptId}`,
  );
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
  let terminal: "completed" | "failed" | "interrupted" | null = null;
  let diagnostic = "Native attempt did not complete";
  let index = 0;
  let interrupted = false;
  let stopped = false;
  // Explicit loss cause; otherwise derived from `interrupted` and `terminal`.
  let lost: RecoveryCause | null = null;
  let check: RecoveryCheck | null = null;
  const changeState = (
    state: "busy" | "idle" | "exited" | "crashed" | "disconnected",
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
    const packet =
      (await reviewPacket(engine, task, attemptId)) ??
      (await revisionPacket(engine, task, attemptId)) ??
      task.objective;
    const prompt = planned.checkpoint
      ? `${packet}\n\n${planned.checkpoint}`.slice(0, 32_768)
      : packet;
    if (store.getTask(task.id).status === "CANCELLED") {
      interrupted = true;
      throw new Error("Owner cancelled before native process launch");
    }
    const freshRun = store.getRun(run.id);
    if (
      engine.isStopping() ||
      stopPending(store, attemptId) ||
      freshRun.status !== "active" ||
      freshRun.mode === "chat_plan"
    ) {
      interrupted = true;
      throw new Error(
        "Run paused, stopping or Chat/Plan selected before native process launch",
      );
    }
    if (
      !role ||
      profile.permission === "coordinator" ||
      (codex && profile.permission !== "read_only")
    )
      throw new Error("Native worker configuration is unsupported");
    const resultInstructions = task.reviewCandidateId
      ? "Submit your structured review using the contract in the prompt and read_assignment. A recommendation grants no integration authority."
      : "Submit your structured report; report tests as not_run. List every file you created, changed or deleted in changedFiles, relative to the worktree root; undeclared new files block the candidate.";
    // Codex Lead prompts already name gateway tools bare.
    const gatewayPrefix =
      profile.harness === "opencode" ? "lao_" : codex ? "" : "mcp__lao__";
    const sandbox = codex
      ? "Shell commands run in Codex's read-only sandbox without network; delegation is disabled"
      : "Shell and delegation are disabled";
    managed = await adapter.startSession({
      runId: run.id,
      taskId: task.id,
      attemptId,
      cwd: dispatch.cwd,
      roleInstructions: `${role.instructions}\n\nExpected output:\n${role.expectedOutput}\n${profile.instructionOverride ?? ""}\nUse only this worktree. Do not access .git, credentials or other checkouts. ${sandbox}; report tests as not run.${token ? `\nCall ${gatewayPrefix}read_assignment first. Finish by calling ${gatewayPrefix}submit_result once. ${resultInstructions}` : ""}`,
      model: profile.model,
      thinking: profile.thinking,
      permission: profile.permission,
      // Every assignment owns a new checkout; native SDK resume stays same-cwd only.
      contextPolicy: planned.context.effective,
      contextPacket: prompt,
      toolEndpoint: token ? engine.gatewayUrl : null,
      environment: token ? { LAO_GATEWAY_TOKEN: token } : {},
    });
    store.updateSession(
      {
        id: session.id,
        expectedState: "starting",
        state: "busy",
        nativeSessionId: managed.nativeSessionId,
        transcriptPath: managed.transcriptPath ?? null,
        ...(managed.processId
          ? {
              processId: managed.processId,
              processIdentity: await processIdentity(managed.processId),
            }
          : {}),
      },
      `session:${attemptId}:busy`,
    );
    const active = managed;
    engine.workerMessages.register(session.id, adapter, active);
    engine.nativeStops.set(task.id, async (reason) => {
      interrupted = true;
      // Emergency skips cooperative abort and closes only this owned child,
      // bounded by TERM/KILL deadlines. Its descendants are not tracked.
      if (
        reason === "emergency" &&
        (adapter instanceof PiAdapter ||
          adapter instanceof ClaudeAdapter ||
          adapter instanceof OpenCodeAdapter ||
          adapter instanceof CodexAdapter)
      ) {
        await adapter.exit(active);
        return;
      }
      try {
        await adapter.cancel(active);
      } finally {
        // A help request ends the owned child rather than claiming suspension.
        if (
          reason === "human_request" &&
          (adapter instanceof PiAdapter ||
            adapter instanceof ClaudeAdapter ||
            adapter instanceof OpenCodeAdapter ||
            adapter instanceof CodexAdapter)
        )
          await adapter.exit(active);
      }
    });
    if (
      engine.isStopping() ||
      stopPending(store, attemptId) ||
      store.getTask(task.id).status === "CANCELLED"
    ) {
      interrupted = true;
      throw new Error("Owner cancelled/stopped during native startup");
    }
    for await (const event of adapter.prompt(active, prompt)) {
      if (event.type === "owner_message_delivered")
        engine.workerMessages.delivered(session.id, event.messageId);
      store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          attemptId,
          sessionId: session.id,
          type: `${profile.harness}.${event.type}`,
          correlationId: attemptId,
          payload: event,
        },
        `${profile.harness}:${attemptId}:${index++}`,
      );
      if (event.type === "approval_requested")
        recordNativeApproval(engine, session.id, adapter, active, event);
      if (event.type === "text_delta")
        output = (output + event.text).slice(0, 32_000);
      if (
        event.type === "process_state" &&
        ["crashed", "exited", "disconnected"].includes(event.state)
      ) {
        const state =
          event.state === "exited" || event.state === "disconnected"
            ? event.state
            : "crashed";
        if (!pendingWorkerHelp(store, attemptId))
          changeState(state, event.exitCode);
        // Native adapters can publish owned exit before their verified result.
        // A clean exit is not success or failure; evaluate the full stream below.
        // The private OpenCode foreground server reports 130 for its verified normal shutdown.
        if (
          state !== "exited" ||
          (event.exitCode !== 0 &&
            !(profile.harness === "opencode" && event.exitCode === 130))
        ) {
          if (state !== "exited") lost = state;
          interrupted = true;
          diagnostic = `${label} exited without safe authoritative completion; no automatic retry`;
        }
      }
      if (event.type === "session_error") {
        diagnostic = event.message;
        if (["protocol", "deadline"].includes(event.code)) interrupted = true;
        // The RPC channel failed; the child may live until the owned exit below.
        if (event.code === "protocol") lost ??= "disconnected";
      }
      if (event.type === "turn_completed") {
        terminal = event.nativeStatus;
        if (
          terminal !== "completed" &&
          diagnostic === "Native attempt did not complete"
        )
          diagnostic = `${label} ${terminal}; explicit retry decision required`;
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
        // Process exit is separate evidence; it never establishes task success.
        const exit =
          adapter instanceof PiAdapter ||
          adapter instanceof ClaudeAdapter ||
          adapter instanceof OpenCodeAdapter ||
          adapter instanceof CodexAdapter
            ? await adapter.exit(managed)
            : null;
        const cleanExit =
          !exit ||
          ("expected" in exit
            ? exit.expected === true
            : exit.code === 0 && !exit.signal);
        changeState(
          !interrupted && !cleanExit ? "crashed" : "exited",
          exit?.code ?? null,
        );
        if (exit)
          store.recordEvent(
            {
              runId: run.id,
              taskId: task.id,
              attemptId,
              sessionId: session.id,
              type: `${profile.harness}.process_exit`,
              correlationId: attemptId,
              payload: {
                exitCode: exit.code,
                signal: exit.signal,
                interrupted,
              },
            },
            `process-exit:${attemptId}`,
          );
        await adapter.dispose(managed);
        stopped = true;
        if (!interrupted && !cleanExit) {
          terminal = "failed";
          interrupted = true;
          lost = "crashed";
          diagnostic = `${label} process did not shut down cleanly; retained for recovery`;
        }
      } catch {
        terminal = "failed";
        interrupted = true;
        lost = "recovery_required";
        diagnostic = `${label} shutdown failed; process/worktree require owner inspection`;
      }
    } else changeState("exited", null);
    if (profile.harness === "claude-code" || profile.harness === "opencode")
      endNativeApprovals(engine, session.id);
    engine.workerMessages.end(session.id);
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
        // Writers are gated by candidate capture below; readers and reviewers
        // by any change or a HEAD that left their starting commit.
        const start =
          engine.worktrees.startingCandidate(attemptId)?.candidateSha ??
          evidence.baseSha;
        if (
          profile.permission === "read_only" &&
          (evidence.files.length || evidence.headSha !== start)
        ) {
          terminal = "failed";
          lost = "recovery_required";
          diagnostic =
            "Git evidence requires owner inspection; no success inferred from model output";
        }
      }
    } catch {
      terminal = "failed";
      lost = "recovery_required";
      diagnostic =
        "Cannot verify final worktree identity/status; retained for owner inspection";
      // Classify missing/inaccessible/replaced now; if even observation fails,
      // the generic diagnostic stands and the owner can recheck later.
      check = await observeRecovery(engine, attemptId).catch(() => null);
      if (check && check.worktree.state !== "verified")
        diagnostic = `Worktree ${check.worktree.state}: ${check.worktree.reason.replace(/\.$/, "")}; retained for owner inspection`;
    }
    engine.worktrees.retain(attemptId);
  }
  if (
    finishWorkerHelp(
      engine,
      attemptId,
      stopped && store.getSession(session.id).state === "exited",
    )
  )
    return;
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
      check,
    );
    finishProviderFailure(engine, attemptId, false);
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
  const report = handoffReportSchema.safeParse(structured);
  const review = task.reviewCandidateId
    ? reviewResultSchema.safeParse(structured)
    : null;
  let candidate: Candidate | null = null;
  let blocked: string | null = null;
  if (profile.permission === "workspace_write") {
    try {
      const captured = await engine.worktrees.candidate(
        attemptId,
        report.success ? report.data.changedFiles : [],
      );
      candidate = captured;
      store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          attemptId,
          sessionId: session.id,
          type: "candidate.captured",
          correlationId: attemptId,
          payload: captured,
        },
        `candidate:${attemptId}`,
      );
      if (captured.status === "blocked")
        blocked =
          `Candidate blocked for owner review: ${captured.blockers.join("; ")}`.slice(
            0,
            4000,
          );
    } catch (error) {
      blocked = `Candidate capture failed; worktree retained for owner inspection: ${
        error instanceof GitError
          ? `${error.message} (exit ${error.exitCode ?? error.signal ?? "unknown"})`
          : error instanceof Error
            ? error.message
            : "unknown error"
      }`;
    }
  }
  const text =
    output ||
    "Pi completed without text output. Inspect native events and Git evidence.";
  // Ordinary text-only reports stay unverified (spec §6.2). A reviewer needs
  // an explicit validated recommendation; text alone never clears that gate.
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
      if (blocked) {
        // Unknown or sensitive paths are never committed, copied or deleted.
        store.createHumanRequest(
          {
            runId: run.id,
            sessionId: session.id,
            affectedTaskIds: [task.id],
            type: "manual_check",
            urgency: "high",
            reason: blocked,
            suggestedAction: `Inspect the retained worktree ${dispatch.cwd}; blocked paths were left untouched. Cancel the task or decide on a retry.`,
            blocking: false,
          },
          `candidate-review:${attemptId}`,
        );
        engine.fail(task.id, attemptId, blocked);
        return true;
      }
      if (task.reviewCandidateId) {
        if (!review?.success) {
          engine.fail(
            task.id,
            attemptId,
            "Review requires a valid structured recommendation and findings submitted through the gateway; text-only or invalid output needs an explicit retry decision",
          );
          return true;
        }
        createReview(
          store,
          { reviewerAttemptId: attemptId, result: review.data },
          `review:${attemptId}`,
        );
      }
      if (candidate?.status === "captured")
        createIntegrationCandidate(
          store,
          {
            attemptId,
            baseSha: candidate.baseSha,
            candidateSha: candidate.candidateSha,
            reportSubmitted: report.success,
          },
          `integration-candidate:${attemptId}`,
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
          reason: review?.success
            ? `Independent review saved: ${review.data.recommendation}; no integration approved`
            : candidate?.status === "captured"
              ? `Candidate ${candidate.candidateSha} captured on ${candidate.branch}; not integrated`
              : "Native result and Git evidence captured; not integrated",
        },
        `task:${attemptId}:review`,
      );
      reconcileRevision(store, task.id, attemptId);
      notifyLead(
        engine,
        task.id,
        "completed",
        review?.success
          ? `${review.data.recommendation}: ${review.data.summary}`
          : structured &&
              typeof structured === "object" &&
              "summary" in structured
            ? String(structured.summary)
            : "text-only report (no structured submission)",
        `notify:${attemptId}`,
      );
      return true;
    },
  );
}
