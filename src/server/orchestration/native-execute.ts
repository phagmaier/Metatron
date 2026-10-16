import { z } from "zod";
import { reviewResultSchema } from "../../shared/domain/entities.ts";
import {
  type Dispatch,
  handoffReportSchema,
} from "../../shared/orchestration.ts";
import type { Candidate } from "../../shared/worktrees.ts";
import type { ManagedSession } from "../adapters/contract.ts";
import { PiAdapter } from "../adapters/pi.ts";
import { GitError } from "../git/command.ts";
import { createIntegrationCandidate } from "../storage/candidates.ts";
import { mutate } from "../storage/mutations.ts";
import { createReview } from "../storage/reviews.ts";
import type { Engine } from "./engine.ts";
import { notifyLead } from "./lead-run.ts";
import { reviewPacket } from "./review.ts";

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
    const prompt =
      (await reviewPacket(engine, task, attemptId)) ?? task.objective;
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
    const resultInstructions = task.reviewCandidateId
      ? "Submit your structured review using the contract in the prompt and read_assignment. A recommendation grants no integration authority."
      : "Submit your structured report; report tests as not_run. List every file you created, changed or deleted in changedFiles, relative to the worktree root; undeclared new files block the candidate.";
    managed = await engine.pi.startSession({
      runId: run.id,
      taskId: task.id,
      attemptId,
      cwd: dispatch.cwd,
      roleInstructions: `${role.instructions}\n${profile.instructionOverride ?? ""}\nUse only this worktree. Do not access .git, credentials or other checkouts. Shell and delegation are disabled; report tests as not run.${token ? `\nCall mcp__lao__read_assignment first. Finish by calling mcp__lao__submit_result once. ${resultInstructions}` : ""}`,
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
    for await (const event of engine.pi.prompt(active, prompt)) {
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
        // Writers are gated by candidate capture below; readers and reviewers
        // by any change or a HEAD that left their starting commit.
        const start =
          engine.worktrees.reviewedCandidate(attemptId)?.candidateSha ??
          evidence.baseSha;
        if (
          profile.permission === "read_only" &&
          (evidence.files.length || evidence.headSha !== start)
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
