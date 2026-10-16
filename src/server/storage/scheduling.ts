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
import { authorize } from "../orchestration/policy.ts";
import { mutate } from "./mutations.ts";
import type { Store } from "./store.ts";

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
        `SELECT sequence, task_id AS taskId, run_id AS runId, profile_id AS profileId, cwd, scenario, state, attempt_id AS attemptId, diagnostic FROM dispatches ORDER BY sequence`,
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
        if (run.status !== "active")
          throw new DomainError("CONFLICT", "Run is paused or terminal");
        if (
          task.kind === "lead" ||
          profile.permission === "coordinator" ||
          !run.teamSnapshot?.preset.workerProfileIds.includes(profile.id)
        )
          throw new DomainError(
            "POLICY_DENIED",
            "Choose a worker from this run's roster",
          );
        if (actor.role !== "owner" && task.ownerPinned)
          throw new DomainError("POLICY_DENIED", "Owner assignment is pinned");
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
        if (task.status !== "QUEUED")
          throw new DomainError(
            "CONFLICT",
            "Only ready or queued tasks can be assigned",
          );
        const previous = this.list().find((d) => d.taskId === task.id);
        if (previous && ["active", "released"].includes(previous.state))
          throw new DomainError("CONFLICT", "Task was already dispatched");
        task = taskSchema.parse({
          ...task,
          assignedProfileId: profile.id,
          ownerPinned: actor.role === "owner",
          updatedAt: new Date().toISOString(),
        });
        this.store.db
          .prepare("UPDATE tasks SET data = ? WHERE id = ?")
          .run(JSON.stringify(task), task.id);
        // Fake writers own simulated paths, never the owner's source checkout.
        const cwd =
          profile.permission === "workspace_write"
            ? join(this.directory, "fake-workspaces", task.id)
            : this.store.getProject(run.projectId).repositoryPath;
        this.store.db
          .prepare(
            `INSERT INTO dispatches(task_id,run_id,profile_id,cwd,scenario,state) VALUES (?,?,?,?,?,'queued') ON CONFLICT(task_id) DO UPDATE SET profile_id=excluded.profile_id,cwd=excluded.cwd,scenario=excluded.scenario,state='queued',diagnostic=NULL`,
          )
          .run(task.id, run.id, profile.id, cwd, data.scenario);
        this.store.recordEvent(
          {
            runId: run.id,
            taskId: task.id,
            type: "task.assigned",
            correlationId: key,
            payload: {
              profileId: profile.id,
              ownerPinned: task.ownerPinned,
              execution: "fake",
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
            "INSERT INTO dispatches(task_id,run_id,profile_id,cwd,scenario,state) VALUES (?,?,?,?,?,'queued')",
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
    return mutate(
      db,
      `reserve:${dispatch.taskId}`,
      "reserve",
      { taskId: dispatch.taskId },
      z.string().uuid().nullable(),
      () => {
        const current = this.list().find((d) => d.taskId === dispatch.taskId);
        if (current?.state !== "queued") return null;
        const task = this.store.getTask(dispatch.taskId);
        const run = this.store.getRun(task.runId);
        const profile = this.profile(run.id, current.profileId);
        if (
          run.status !== "active" ||
          task.status !== "QUEUED" ||
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
            adapter: "fake",
            intendedOperation: `FAKE ${kind} execution`,
            cwd: current.cwd,
            baseSha: run.repository?.baseSha ?? null,
          },
          `dispatch:${task.id}:attempt`,
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
          `dispatch:${task.id}:running`,
        );
        this.store.updateAttempt(
          { id: attempt.id, status: "running" },
          `dispatch:${task.id}:started`,
        );
        return attempt.id;
      },
    );
  }
  release(taskId: string, diagnostic: string | null = null) {
    const dispatch = this.list().find((d) => d.taskId === taskId);
    if (!dispatch) return;
    return mutate(
      this.store.db,
      `release:${taskId}`,
      "release",
      { taskId, diagnostic },
      z.boolean(),
      () => {
        if (dispatch.attemptId)
          this.store.db
            .prepare("DELETE FROM reservations WHERE attempt_id=?")
            .run(dispatch.attemptId);
        this.store.db
          .prepare(
            "UPDATE dispatches SET state='released',diagnostic=? WHERE task_id=?",
          )
          .run(diagnostic, taskId);
        return true;
      },
    );
  }
  block(taskId: string, diagnostic: string) {
    return mutate(
      this.store.db,
      `blocked:${taskId}`,
      "block",
      { taskId, diagnostic },
      z.boolean(),
      () => {
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
            correlationId: `blocked:${taskId}`,
            payload: { diagnostic },
          },
          `blocked:${taskId}:event`,
        );
        return true;
      },
    );
  }
}
