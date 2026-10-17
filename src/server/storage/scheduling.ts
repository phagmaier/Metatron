import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { type AgentProfile, taskSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type Actor,
  assignSchema,
  type Dispatch,
  dispatchSchema,
} from "../../shared/orchestration.ts";
import { contextPlan } from "../orchestration/context-policy.ts";
import { authorize } from "../orchestration/policy.ts";
import { mutate } from "./mutations.ts";
import { revisionSource } from "./revisions.ts";
import type { Store } from "./store.ts";
import { assertWorkflowAssignment } from "./workflows.ts";

export class Scheduling {
  private readonly store: Store;
  private readonly directory: string;
  constructor(store: Store, directory: string) {
    this.store = store;
    this.directory = directory;
  }
  list() {
    return this.store.db
      .prepare(
        `SELECT sequence, task_id AS taskId, run_id AS runId, profile_id AS profileId, cwd, scenario, context_policy AS contextPolicy, resume_session_id AS resumeSessionId, state, attempt_id AS attemptId, diagnostic FROM dispatches ORDER BY sequence`,
      )
      .all()
      .map((row) => dispatchSchema.parse(row));
  }
  profile(runId: string, profileId: string): AgentProfile {
    const run = this.store.getRun(runId);
    const profile = run.teamSnapshot?.profiles.find((p) => p.id === profileId);
    if (!profile)
      throw new DomainError(
        "INVALID_REFERENCE",
        "Profile is not in this run's immutable team snapshot",
      );
    return profile;
  }
  // A Supervised Lead's assignment: recorded for owner approval, never dispatched.
  propose(taskId: string, profileId: string, key: string) {
    const task = this.store.getTask(taskId);
    const run = this.store.getRun(task.runId);
    this.profile(run.id, profileId);
    if (
      !run.teamSnapshot?.preset.workerProfileIds.includes(profileId) ||
      task.status !== "BACKLOG" ||
      task.ownerPinned
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Propose an unpinned backlog task for a roster worker",
      );
    return mutate(
      this.store.db,
      key,
      "proposeAssignment",
      { taskId: task.id, profileId },
      z.strictObject({
        outcome: z.literal("awaiting_owner_approval"),
        taskId: z.string(),
        profileId: z.string(),
      }),
      () => {
        const updated = taskSchema.parse({
          ...this.store.getTask(task.id),
          proposedProfileId: profileId,
          updatedAt: new Date().toISOString(),
        });
        this.store.db
          .prepare("UPDATE tasks SET data=? WHERE id=?")
          .run(JSON.stringify(updated), task.id);
        this.store.recordEvent(
          {
            runId: run.id,
            taskId: task.id,
            type: "assignment.proposed",
            correlationId: key,
            payload: { profileId },
          },
          `${key}:event`,
        );
        return {
          outcome: "awaiting_owner_approval" as const,
          taskId: task.id,
          profileId,
        };
      },
    );
  }
  enqueue(actor: Actor, input: unknown, key: string) {
    const data = assignSchema.parse(input);
    return mutate(
      this.store.db,
      key,
      "enqueue",
      { actor, ...data },
      dispatchSchema,
      () => {
        let task = this.store.getTask(data.taskId);
        const run = authorize(
          this.store,
          actor,
          task.runId,
          "assign_task",
          task.id,
        );
        const profile = this.profile(run.id, data.profileId);
        assertWorkflowAssignment(this.store, task.id);
        if (run.status !== "active")
          throw new DomainError("CONFLICT", "Run is paused or terminal");
        if (this.store.listTaskBlockers(task.id).length)
          throw new DomainError(
            "CONFLICT",
            "A human blocker prevents assignment",
          );
        if (
          task.kind === "lead" ||
          profile.permission === "coordinator" ||
          !run.teamSnapshot?.preset.workerProfileIds.includes(profile.id)
        )
          throw new DomainError(
            "POLICY_DENIED",
            "Choose a worker from this run's roster",
          );
        // Reviews inspect a candidate; a writer profile could alter its evidence.
        if (task.reviewCandidateId && profile.permission !== "read_only")
          throw new DomainError(
            "POLICY_DENIED",
            "A review task runs only on a read-only profile",
          );
        const source = revisionSource(this.store, task);
        if (
          source?.assignedProfileId &&
          this.profile(run.id, source.assignedProfileId).permission !==
            profile.permission
        )
          throw new DomainError(
            "POLICY_DENIED",
            "A revision must retain its implementer's permission class",
          );
        if (actor.role !== "owner" && task.ownerPinned)
          throw new DomainError("POLICY_DENIED", "Owner assignment is pinned");
        if (actor.role === "lead" && run.mode !== "autonomous_bounded")
          throw new DomainError(
            "POLICY_DENIED",
            "Supervised assignments require the owner",
          );
        // Resolving a request never continues work by itself; the owner's
        // assignment is the explicit continuation, and it rechecks every blocker.
        if (task.status === "WAITING_HUMAN") {
          if (actor.role !== "owner")
            throw new DomainError(
              "POLICY_DENIED",
              "Only the owner continues a task after a human wait",
            );
          task = this.store.transitionTask(
            {
              id: task.id,
              expectedStatus: task.status,
              status: "READY",
              reason: "Owner continued after every human blocker resolved",
            },
            `${key}:continue`,
          );
        }
        const previous = this.list().find((d) => d.taskId === task.id);
        if (
          previous?.state === "active" ||
          (previous?.state === "released" &&
            !["READY", "WAITING_DEPENDENCY"].includes(task.status))
        )
          throw new DomainError("CONFLICT", "Task was already dispatched");
        // The launch budget never grows during a run, so queued work counts too:
        // no actor may queue a launch that reservation must later refuse. A
        // reassignment keeps its already-counted queued slot.
        if (
          previous?.state !== "queued" &&
          this.committedLaunches(run.id) >=
            run.limits.maxTotalWorkerLaunchesPerRun
        )
          throw new DomainError(
            "BUDGET_EXCEEDED",
            "Worker launch budget exhausted for this run",
          );
        if (task.status === "BACKLOG")
          task = this.store.transitionTask(
            {
              id: task.id,
              expectedStatus: task.status,
              status: "READY",
              reason: "Validated assignment",
            },
            `${key}:ready`,
          );
        if (task.status === "READY")
          task = this.store.transitionTask(
            {
              id: task.id,
              expectedStatus: task.status,
              status: "QUEUED",
              reason: "Awaiting scheduling slot",
            },
            `${key}:queued`,
          );
        if (!["QUEUED", "WAITING_DEPENDENCY"].includes(task.status))
          throw new DomainError(
            "CONFLICT",
            "Only ready, queued or dependency-waiting tasks can be assigned",
          );
        if (
          actor.role === "owner" &&
          task.proposedProfileId &&
          task.proposedProfileId !== profile.id
        )
          this.store.recordEvent(
            {
              runId: run.id,
              taskId: task.id,
              type: "assignment.overridden",
              correlationId: key,
              payload: {
                proposedProfileId: task.proposedProfileId,
                chosenProfileId: profile.id,
              },
            },
            `${key}:override`,
          );
        task = taskSchema.parse({
          ...task,
          assignedProfileId: profile.id,
          proposedProfileId: null,
          ownerPinned: actor.role === "owner",
          updatedAt: new Date().toISOString(),
        });
        this.store.db
          .prepare("UPDATE tasks SET data = ? WHERE id = ?")
          .run(JSON.stringify(task), task.id);
        // Fake writers own simulated paths, never the owner's source checkout.
        const cwd =
          run.execution === "native"
            ? join(
                this.directory,
                "worktrees",
                `${task.id}-${randomUUID()}`,
                "checkout",
              )
            : profile.permission === "workspace_write"
              ? join(this.directory, "fake-workspaces", task.id)
              : this.store.getProject(run.projectId).repositoryPath;
        // An explicit resume that cannot be honoured is refused here, before
        // anything is queued; execution plans again against current facts.
        contextPlan(this.store, {
          task,
          profileId: profile.id,
          adapter: run.execution === "fake" ? "fake" : profile.harness,
          cwd,
          policy: data.contextPolicy,
          resumeSessionId: data.resumeSessionId,
          attemptId: null,
        });
        // The persisted sequence identifies a dispatch generation. Reassignment
        // keeps a queued generation; retries get a fresh FIFO slot and identity.
        this.store.db
          .prepare(
            `INSERT INTO dispatches(task_id,run_id,profile_id,cwd,scenario,context_policy,resume_session_id,state) VALUES (?,?,?,?,?,?,?,'queued')
             ON CONFLICT(task_id) DO UPDATE SET
               sequence=CASE WHEN dispatches.state='queued' THEN dispatches.sequence ELSE excluded.sequence END,
               profile_id=excluded.profile_id,cwd=excluded.cwd,scenario=excluded.scenario,
               context_policy=excluded.context_policy,resume_session_id=excluded.resume_session_id,
               state='queued',attempt_id=NULL,diagnostic=NULL`,
          )
          .run(
            task.id,
            run.id,
            profile.id,
            cwd,
            data.scenario,
            data.contextPolicy,
            data.resumeSessionId,
          );
        this.store.recordEvent(
          {
            runId: run.id,
            taskId: task.id,
            type: "task.assigned",
            correlationId: key,
            payload: {
              profileId: profile.id,
              ownerPinned: task.ownerPinned,
              execution: run.execution,
              contextPolicy: data.contextPolicy,
              resumeSessionId: data.resumeSessionId,
            },
          },
          `${key}:event`,
        );
        return dispatchSchema.parse(
          this.list().find((d) => d.taskId === task.id),
        );
      },
    );
  }
  committedLaunches(runId: string) {
    const attempts = this.store.listAttempts().filter((a) => {
      const t = this.store.getTask(a.taskId);
      return t.runId === runId && t.kind === "work";
    }).length;
    const queued = this.list().filter(
      (d) =>
        d.runId === runId &&
        d.state === "queued" &&
        this.store.getTask(d.taskId).kind === "work",
    ).length;
    return attempts + queued;
  }
  enqueueLead(taskId: string, scenario: Dispatch["scenario"], key: string) {
    const task = this.store.getTask(taskId);
    const run = this.store.getRun(task.runId);
    const profileId = run.teamSnapshot?.preset.leadProfileId;
    if (!profileId || task.kind !== "lead")
      throw new DomainError("INVALID_REFERENCE", "Missing Lead profile");
    return mutate(
      this.store.db,
      key,
      "enqueueLead",
      { taskId, scenario },
      dispatchSchema,
      () => {
        for (const status of ["READY", "QUEUED"] as const)
          this.store.transitionTask(
            {
              id: taskId,
              expectedStatus: this.store.getTask(taskId).status,
              status,
              reason: "Owner requested a Lead turn",
            },
            `${key}:${status}`,
          );
        this.store.db
          .prepare(
            // The Lead continues its own run thread whenever one exists.
            "INSERT INTO dispatches(task_id,run_id,profile_id,cwd,scenario,context_policy,state) VALUES (?,?,?,?,?,'auto','queued')",
          )
          .run(
            taskId,
            run.id,
            profileId,
            this.store.getProject(run.projectId).repositoryPath,
            scenario,
          );
        return dispatchSchema.parse(
          this.list().find((d) => d.taskId === taskId),
        );
      },
    );
  }
  reserve(dispatch: Dispatch) {
    const { db } = this.store;
    const { taskId, sequence } = dispatch;
    // Reject an obsolete queue copy before an idempotency replay can return its
    // old attempt and attach it to a later retry of the same task.
    const live = this.list().find((d) => d.taskId === taskId);
    if (
      live?.sequence !== sequence ||
      !["queued", "active"].includes(live.state)
    )
      return null;
    const key = `dispatch:${taskId}:${sequence}`;
    return mutate(
      db,
      `reserve:${taskId}:${sequence}`,
      "reserve",
      { taskId, sequence },
      z.string().uuid().nullable(),
      () => {
        const current = this.list().find((d) => d.taskId === taskId);
        if (current?.sequence !== sequence) return null;
        // Existing databases may have reserved this attempt with a legacy key.
        if (current.state === "active") return current.attemptId;
        if (current.state !== "queued") return null;
        const task = this.store.getTask(taskId);
        const run = this.store.getRun(task.runId);
        const profile = this.profile(run.id, current.profileId);
        assertWorkflowAssignment(this.store, task.id);
        if (
          run.status !== "active" ||
          task.status !== "QUEUED" ||
          this.store.listTaskBlockers(task.id).length > 0 ||
          (task.kind !== "lead" && run.mode === "chat_plan")
        )
          return null;
        if (
          task.dependencyIds.some(
            (id) => this.store.getTask(id).status !== "DONE",
          )
        )
          return null;
        const kind =
          task.kind === "lead"
            ? "lead"
            : profile.permission === "workspace_write"
              ? "writer"
              : "reader";
        const reservations = db.prepare("SELECT * FROM reservations").all();
        const activeRuns = [
          ...new Set(reservations.map((r) => String(r.run_id))),
        ].map((id) => this.store.getRun(id));
        const totalCap = Math.min(
          run.limits.maxConcurrentAgentsIncludingLead,
          ...activeRuns.map((r) => r.limits.maxConcurrentAgentsIncludingLead),
        );
        const writerCap = Math.min(
          run.limits.maxConcurrentWriters,
          ...activeRuns.map((r) => r.limits.maxConcurrentWriters),
        );
        const readerCap = Math.min(
          run.limits.maxConcurrentReadersReviewers,
          ...activeRuns.map((r) => r.limits.maxConcurrentReadersReviewers),
        );
        if (reservations.length >= totalCap) return null;
        if (
          kind === "writer" &&
          (reservations.filter((r) => r.kind === "writer").length >=
            writerCap ||
            reservations.some(
              (r) => r.kind === "writer" && r.cwd === current.cwd,
            ))
        )
          return null;
        if (
          kind === "reader" &&
          reservations.filter((r) => r.kind === "reader").length >= readerCap
        )
          return null;
        if (
          kind === "lead" &&
          reservations.some((r) => r.kind === "lead" && r.run_id === run.id)
        )
          return null;
        const workerLaunches = this.store.listAttempts().filter((a) => {
          const t = this.store.getTask(a.taskId);
          return t.runId === run.id && t.kind === "work";
        }).length;
        if (
          kind !== "lead" &&
          workerLaunches >= run.limits.maxTotalWorkerLaunchesPerRun
        )
          throw new DomainError(
            "BUDGET_EXCEEDED",
            "Worker launch budget exhausted",
          );
        const attempt = this.store.createAttempt(
          {
            taskId: task.id,
            profileId: profile.id,
            adapter: run.execution === "fake" ? "fake" : profile.harness,
            intendedOperation: `${run.execution === "fake" ? "FAKE" : `Native ${profile.harness}`} ${kind} execution`,
            cwd: current.cwd,
            worktreePath: run.execution === "native" ? current.cwd : null,
            baseSha: run.repository?.baseSha ?? null,
          },
          `${key}:attempt`,
        );
        db.prepare("INSERT INTO reservations VALUES (?,?,?,?)").run(
          attempt.id,
          run.id,
          kind,
          current.cwd,
        );
        db.prepare(
          "UPDATE dispatches SET state='active',attempt_id=? WHERE task_id=?",
        ).run(attempt.id, task.id);
        this.store.transitionTask(
          {
            id: task.id,
            expectedStatus: "QUEUED",
            status: "RUNNING",
            reason: "Atomic slot reservation",
          },
          `${key}:running`,
        );
        this.store.updateAttempt(
          { id: attempt.id, status: "running" },
          `${key}:started`,
        );
        return attempt.id;
      },
    );
  }
  release(dispatch: Dispatch, diagnostic: string | null = null) {
    const { taskId, sequence } = dispatch;
    return mutate(
      this.store.db,
      `release:${taskId}:${sequence}`,
      "release",
      { taskId, sequence, diagnostic },
      z.boolean(),
      () => {
        const current = this.list().find((d) => d.taskId === taskId);
        if (current?.sequence !== sequence) return false;
        if (current.attemptId)
          this.store.db
            .prepare("DELETE FROM reservations WHERE attempt_id=?")
            .run(current.attemptId);
        this.store.db
          .prepare(
            "UPDATE dispatches SET state='released',diagnostic=? WHERE task_id=?",
          )
          .run(diagnostic, taskId);
        return true;
      },
    );
  }
  block(dispatch: Dispatch, diagnostic: string) {
    const { taskId, sequence } = dispatch;
    const key = `blocked:${taskId}:${sequence}`;
    return mutate(
      this.store.db,
      key,
      "block",
      { taskId, sequence, diagnostic },
      z.boolean(),
      () => {
        const current = this.list().find((d) => d.taskId === taskId);
        if (current?.sequence !== sequence || current.state !== "queued")
          return false;
        this.store.db
          .prepare(
            "UPDATE dispatches SET state='blocked',diagnostic=? WHERE task_id=? AND state='queued'",
          )
          .run(diagnostic, taskId);
        const task = this.store.getTask(taskId);
        this.store.recordEvent(
          {
            runId: task.runId,
            taskId,
            type: "dispatch.blocked",
            correlationId: key,
            payload: { diagnostic },
          },
          `${key}:event`,
        );
        return true;
      },
    );
  }
}
