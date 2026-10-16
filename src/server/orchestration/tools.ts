import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  artifactSchema,
  type Run,
  reviewResultSchema,
  type Task,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type Actor,
  handoffReportSchema,
  toolSchema,
} from "../../shared/orchestration.ts";
import { listIntegrationCandidates } from "../storage/candidates.ts";
import { mutate } from "../storage/mutations.ts";
import { listReviews } from "../storage/reviews.ts";
import type { Engine } from "./engine.ts";
import { notifyLead } from "./lead-run.ts";
import { authorize } from "./policy.ts";
import { requestReview, reviewInstructions } from "./review.ts";

const summary = (task: Task) => ({
  taskId: task.id,
  title: task.title,
  status: task.status,
  origin: task.origin,
  priority: task.priority,
  assignedProfileId: task.assignedProfileId,
  proposedProfileId: task.proposedProfileId,
  ownerPinned: task.ownerPinned,
  parentTaskId: task.parentTaskId,
  reviewCandidateId: task.reviewCandidateId,
});
function eventCount(engine: Engine, runId: string, type: string) {
  return Number(
    engine.store.db
      .prepare("SELECT count(*) AS n FROM events WHERE run_id=? AND type=?")
      .get(runId, type)?.n ?? 0,
  );
}
function latestPayload(engine: Engine, taskId: string, type: string) {
  const row = engine.store.db
    .prepare(
      "SELECT payload, attempt_id AS attemptId FROM events WHERE task_id=? AND type=? ORDER BY sequence DESC LIMIT 1",
    )
    .get(taskId, type);
  return row
    ? {
        attemptId: row.attemptId === null ? null : String(row.attemptId),
        payload: z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(String(row.payload))),
      }
    : null;
}
function roster(run: Run) {
  return (run.teamSnapshot?.preset.workerProfileIds ?? []).map((id) => {
    const profile = run.teamSnapshot?.profiles.find((p) => p.id === id);
    return {
      profileId: id,
      name: profile?.name,
      role: run.teamSnapshot?.roles.find((r) => r.id === profile?.roleId)?.name,
      permission: profile?.permission,
      harness: profile?.harness,
    };
  });
}
function workTask(engine: Engine, taskId: string) {
  const task = engine.store.getTask(taskId);
  if (task.kind !== "work")
    throw new DomainError("POLICY_DENIED", "Lead turns are not worker tasks");
  return task;
}
function revisionRoot(engine: Engine, task: Task) {
  let current = task;
  for (let depth = 0; current.parentTaskId && depth < 100; depth++)
    current = engine.store.getTask(current.parentTaskId);
  return current;
}
export function runTool(
  engine: Engine,
  actor: Actor,
  runId: string,
  input: unknown,
  key: string,
): unknown {
  const { store } = engine;
  const data = toolSchema.parse(input);
  const taskId = "taskId" in data ? data.taskId : undefined;
  const run = authorize(store, actor, runId, data.name, taskId);
  const ids = [
    ...(taskId ? [taskId] : []),
    ...("taskIds" in data ? data.taskIds : []),
  ];
  if (ids.some((id) => store.getTask(id).runId !== runId))
    throw new DomainError(
      "POLICY_DENIED",
      "Task is outside the authorized run",
    );
  const sessionId = actor.role === "owner" ? null : actor.sessionId;
  const attemptId = sessionId ? store.getSession(sessionId).attemptId : null;
  switch (data.name) {
    case "get_run_status":
      return {
        run: {
          runId: run.id,
          title: run.title,
          objective: run.initialPrompt,
          mode: run.mode,
          status: run.status,
        },
        roster: roster(run),
        limits: run.limits,
        budget: {
          workerLaunchesCommitted: engine.scheduling.committedLaunches(run.id),
          automaticLeadWakeups: eventCount(engine, run.id, "lead.wakeup"),
        },
        tasks: store
          .listTasks(run.id)
          .filter((t) => t.kind === "work")
          .map(summary),
      };
    case "list_tasks":
      return store
        .listTasks(run.id)
        .filter((t) => t.kind === "work")
        .map(summary);
    case "get_task": {
      const task = workTask(engine, data.taskId);
      const dispatch = engine.scheduling
        .list()
        .find((d) => d.taskId === task.id);
      return {
        ...summary(task),
        objective: task.objective,
        acceptanceCriteria: task.acceptanceCriteria,
        dependencyIds: task.dependencyIds,
        dispatch: dispatch
          ? { state: dispatch.state, diagnostic: dispatch.diagnostic }
          : null,
      };
    }
    case "get_worker_status": {
      const task = workTask(engine, data.taskId);
      const attempts = store.listAttempts().filter((a) => a.taskId === task.id);
      return {
        taskId: task.id,
        status: task.status,
        attempts: attempts.map((a) => {
          const session = store
            .listSessions()
            .find((s) => s.attemptId === a.id);
          return {
            attemptId: a.id,
            status: a.status,
            adapter: a.adapter,
            session: session
              ? { state: session.state, exitCode: session.exitCode }
              : null,
          };
        }),
        latestProgress:
          latestPayload(engine, task.id, "worker.progress")?.payload ?? null,
      };
    }
    case "read_report": {
      const task = workTask(engine, data.taskId);
      const result = latestPayload(engine, task.id, "worker.result");
      const saved = latestPayload(engine, task.id, "report.saved");
      const evidence = latestPayload(engine, task.id, "worktree.captured");
      const candidate = latestPayload(engine, task.id, "candidate.captured");
      const record = listIntegrationCandidates(store, task.id).find(
        (c) => c.attemptId === candidate?.attemptId,
      );
      const artifact = saved
        ? store.db
            .prepare("SELECT data FROM artifacts WHERE id=?")
            .get(String(saved.payload.artifactId))
        : undefined;
      const text = artifact
        ? readFileSync(
            artifactSchema.parse(JSON.parse(String(artifact.data))).path,
            "utf8",
          ).slice(0, 4000)
        : null;
      return {
        taskId: task.id,
        status: task.status,
        attemptId: result?.attemptId ?? saved?.attemptId ?? null,
        structuredReport:
          typeof result?.payload.report === "object"
            ? result.payload.report
            : null,
        toolSubmitted: Boolean(result),
        textExcerpt: text,
        gitEvidence: evidence
          ? {
              files: evidence.payload.files,
              diffCheck: evidence.payload.diffCheck,
              tests: evidence.payload.tests,
            }
          : null,
        candidate: candidate
          ? {
              candidateId: record?.id ?? null,
              status: candidate.payload.status,
              candidateSha: candidate.payload.candidateSha,
              branch: candidate.payload.branch,
              blockers: candidate.payload.blockers,
              declaredUnchanged: candidate.payload.declaredUnchanged,
            }
          : null,
        reviews: listReviews(store, task.id),
        note: "Git evidence and candidates are engine-captured; model claims are not verified by them. Review submissions stay provisional until completion and clean Git checks; only reviews contains recorded reviews. A recommendation grants no integration approval.",
      };
    }
    case "propose_task":
      return store.createTask(
        {
          runId,
          title: data.title,
          objective: data.objective,
          acceptanceCriteria: data.acceptanceCriteria,
          priority: data.priority,
          origin: "lead",
        },
        key,
      );
    case "assign_task": {
      if (actor.role === "lead" && run.mode === "supervised")
        return engine.scheduling.propose(
          workTask(engine, data.taskId).id,
          data.profileId,
          key,
        );
      return engine.scheduling.enqueue(
        actor,
        {
          taskId: data.taskId,
          profileId: data.profileId,
          scenario: data.scenario,
        },
        key,
      );
    }
    case "request_review":
      return requestReview(
        engine,
        actor,
        { taskId: data.taskId, profileId: data.profileId },
        key,
      );
    case "request_revision": {
      const task = workTask(engine, data.taskId);
      if (task.reviewCandidateId)
        throw new DomainError(
          "POLICY_DENIED",
          "Revise the implementation task, not its review",
        );
      if (task.status !== "AWAITING_REVIEW" || !task.assignedProfileId)
        throw new DomainError(
          "CONFLICT",
          "Only an assigned task awaiting review can be revised",
        );
      const profileId = task.assignedProfileId;
      const root = revisionRoot(engine, task);
      const cycles = Number(
        store.db
          .prepare(
            "SELECT count(*) AS n FROM events WHERE run_id=? AND type='task.revision_requested' AND json_extract(payload,'$.rootTaskId')=?",
          )
          .get(run.id, root.id)?.n ?? 0,
      );
      if (cycles >= run.limits.maxRevisionCyclesPerTask)
        throw new DomainError(
          "BUDGET_EXCEEDED",
          "Revision cycle budget exhausted for this task",
        );
      const previous = latestPayload(engine, task.id, "worker.result")?.payload
        .report;
      return mutate(store.db, key, "requestRevision", data, z.unknown(), () => {
        store.transitionTask(
          {
            id: task.id,
            expectedStatus: "AWAITING_REVIEW",
            status: "CHANGES_REQUESTED",
            reason: "Lead requested revision",
          },
          `${key}:changes`,
        );
        const revision = store.createTask(
          {
            runId,
            title: `Revision ${cycles + 1}: ${root.title}`.slice(0, 200),
            objective:
              `${root.objective}\n\nRevision feedback from the Lead:\n${data.feedback}\n\nPrevious attempt summary:\n${typeof previous === "object" && previous && "summary" in previous ? String(previous.summary) : "No structured report was submitted."}`.slice(
                0,
                32_000,
              ),
            acceptanceCriteria: root.acceptanceCriteria,
            parentTaskId: task.id,
            origin: "lead",
          },
          `${key}:task`,
        );
        store.recordEvent(
          {
            runId,
            taskId: task.id,
            type: "task.revision_requested",
            correlationId: key,
            payload: {
              rootTaskId: root.id,
              revisionTaskId: revision.id,
              cycle: cycles + 1,
              feedback: data.feedback,
            },
          },
          `${key}:event`,
        );
        return run.mode === "supervised"
          ? engine.scheduling.propose(revision.id, profileId, `${key}:proposal`)
          : {
              outcome: "queued",
              revisionTaskId: revision.id,
              dispatch: engine.scheduling.enqueue(
                actor,
                { taskId: revision.id, profileId },
                `${key}:assign`,
              ),
            };
      });
    }
    case "escalate_issue":
    case "request_human_input":
      return store.createHumanRequest(
        {
          runId,
          sessionId,
          affectedTaskIds: data.taskIds,
          type:
            data.name === "escalate_issue" ? "manual_check" : "clarification",
          urgency: data.urgency,
          reason: `${data.summary}\n\n${data.details}`.slice(0, 32_000),
          suggestedAction:
            data.name === "escalate_issue"
              ? "Review the Lead's escalation"
              : "Answer the Lead's question in a run message",
          // Blocking suspension of affected tasks is M6 scope; record honestly.
          blocking: false,
        },
        key,
      );
    case "read_assignment": {
      const task = store.getTask(data.taskId);
      const attempt = attemptId ? store.getAttempt(attemptId) : null;
      return {
        taskId: task.id,
        title: task.title,
        objective: task.objective,
        acceptanceCriteria: task.acceptanceCriteria,
        worktree: attempt?.worktreePath ?? null,
        baseSha: attempt?.baseSha ?? null,
        review: task.reviewCandidateId
          ? {
              ...latestPayload(engine, task.id, "review.packet")?.payload,
              rule: "Independently inspect the candidate and surrounding code. Do not modify files. Findings use repository-relative file paths and positive line numbers (candidate lines, or base lines for deleted files). Shell is disabled: tests must be not_run. Submit a structured recommendation through submit_result; text alone cannot complete a review.",
            }
          : null,
        reportShape: task.reviewCandidateId
          ? reviewInstructions
          : "submit_result: outcome, summary, changedFiles (every created, changed or deleted path relative to the worktree root; undeclared new files block the candidate), tests (not_run when shell is unavailable), findings, knownRisks, questions",
      };
    }
    case "report_progress": {
      const count = Number(
        store.db
          .prepare(
            "SELECT count(*) AS n FROM events WHERE attempt_id=? AND type='worker.progress'",
          )
          .get(attemptId)?.n ?? 0,
      );
      if (count >= 50)
        throw new DomainError(
          "BUDGET_EXCEEDED",
          "Progress note budget exhausted for this attempt",
        );
      return store.recordEvent(
        {
          runId,
          taskId: data.taskId,
          attemptId,
          sessionId,
          type: "worker.progress",
          correlationId: key,
          payload: { summary: data.summary },
        },
        key,
      );
    }
    case "submit_result": {
      const task = store.getTask(data.taskId);
      const report = task.reviewCandidateId
        ? reviewResultSchema.parse(data.report)
        : typeof data.report === "string"
          ? data.report
          : handoffReportSchema.parse(data.report);
      if (
        attemptId &&
        store.db
          .prepare(
            "SELECT 1 FROM events WHERE attempt_id=? AND type='worker.result'",
          )
          .get(attemptId)
      )
        throw new DomainError(
          "CONFLICT",
          "A result was already submitted for this attempt",
        );
      return store.recordEvent(
        {
          runId,
          taskId: data.taskId,
          attemptId,
          sessionId,
          type: "worker.result",
          correlationId: key,
          payload: { report },
        },
        key,
      );
    }
    case "report_issue": {
      const urgent = ["high", "urgent"].includes(data.urgency);
      const event = store.recordEvent(
        {
          runId,
          taskId: data.taskId,
          attemptId,
          sessionId,
          type: "worker.issue",
          correlationId: key,
          payload: {
            summary: data.summary,
            details: data.details,
            urgency: data.urgency,
          },
        },
        key,
      );
      notifyLead(
        engine,
        data.taskId,
        urgent ? "urgent_issue" : "issue",
        data.summary,
        `${key}:notify`,
      );
      return { recorded: event.id, leadWoken: urgent };
    }
  }
}
