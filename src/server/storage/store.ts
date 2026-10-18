import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  attemptSchema,
  eventSchema,
  humanRequestSchema,
  idSchema,
  projectSchema,
  runSchema,
  sessionSchema,
  taskSchema,
} from "../../shared/domain/entities.ts";
import {
  appendEventSchema,
  createAttemptSchema,
  createProjectSchema,
  createRunSchema,
  createSessionSchema,
  createTaskSchema,
  transitionTaskSchema,
  updateAttemptSchema,
  updateRunSchema,
  updateSessionSchema,
  updateTaskSchema,
} from "../../shared/domain/inputs.ts";
import {
  assertSessionTransition,
  assertTaskTransition,
  DomainError,
} from "../../shared/domain/states.ts";
import { openDatabase } from "./database.ts";
import {
  assertDependencyTransition,
  reconcileDependencyWaits,
  unmetDependencies,
} from "./dependencies.ts";
import {
  assertHumanWaitTransition,
  createHumanRequest,
  listTaskBlockers,
  updateHumanRequest,
} from "./human-requests.ts";
import { interruptIntegrations } from "./integrations.ts";
import { appendEvent, queryEvents } from "./journal.ts";
import { mutate } from "./mutations.ts";
import { recoverInterrupted } from "./recovery.ts";
import { reconcileCompletedRevisions } from "./revisions.ts";

type Table =
  | "projects"
  | "runs"
  | "tasks"
  | "attempts"
  | "sessions"
  | "human_requests";
const metadata = () => {
  const now = new Date().toISOString();
  return { id: randomUUID(), createdAt: now, updatedAt: now };
};

export class Store {
  readonly db;
  constructor(path: string) {
    this.db = openDatabase(path);
  }
  close() {
    this.db.close();
  }

  private get<T>(table: Table, schema: z.ZodType<T>, id: string): T {
    idSchema.parse(id);
    const row = this.db
      .prepare(`SELECT data FROM ${table} WHERE id = ?`)
      .get(id);
    if (!row) throw new DomainError("NOT_FOUND", `${table} record not found`);
    return schema.parse(JSON.parse(String(row.data)));
  }
  private list<T>(table: Table, schema: z.ZodType<T>): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table} ORDER BY rowid`)
      .all()
      .map((row) => schema.parse(JSON.parse(String(row.data))));
  }
  private save(table: Table, entity: { id: string }) {
    this.db
      .prepare(`UPDATE ${table} SET data = ? WHERE id = ?`)
      .run(JSON.stringify(entity), entity.id);
  }

  listProjects() {
    return this.list("projects", projectSchema);
  }
  listRuns(projectId?: string) {
    if (projectId) idSchema.parse(projectId);
    return this.list("runs", runSchema).filter(
      (run) => !projectId || run.projectId === projectId,
    );
  }
  listTasks(runId?: string) {
    if (runId) idSchema.parse(runId);
    return this.list("tasks", taskSchema).filter(
      (task) => !runId || task.runId === runId,
    );
  }
  listSessions() {
    return this.list("sessions", sessionSchema);
  }
  listAttempts() {
    return this.list("attempts", attemptSchema);
  }
  listHumanRequests() {
    return this.list("human_requests", humanRequestSchema);
  }
  getHumanRequest(id: string) {
    return this.get("human_requests", humanRequestSchema, id);
  }
  listTaskBlockers(taskId: string) {
    return listTaskBlockers(this, taskId);
  }
  events(query: unknown = {}) {
    return queryEvents(this.db, query);
  }
  getRun(id: string) {
    return this.get("runs", runSchema, id);
  }
  getProject(id: string) {
    return this.get("projects", projectSchema, id);
  }
  getTask(id: string) {
    return this.get("tasks", taskSchema, id);
  }
  getAttempt(id: string) {
    return this.get("attempts", attemptSchema, id);
  }
  getSession(id: string) {
    return this.get("sessions", sessionSchema, id);
  }

  createProject(input: unknown, key: string) {
    const data = createProjectSchema.parse(input);
    return mutate(this.db, key, "createProject", data, projectSchema, () => {
      const project = projectSchema.parse({ ...data, ...metadata() });
      this.db
        .prepare(
          "INSERT INTO projects(id, repository_path, data) VALUES (?, ?, ?)",
        )
        .run(project.id, project.repositoryPath, JSON.stringify(project));
      appendEvent(this.db, {
        type: "project.created",
        correlationId: key,
        payload: { projectId: project.id },
      });
      return project;
    });
  }
  createRun(input: unknown, key: string) {
    const data = createRunSchema.parse(input);
    return mutate(this.db, key, "createRun", data, runSchema, () => {
      this.get("projects", projectSchema, data.projectId);
      if (data.execution === "native" && !data.teamSnapshot)
        throw new DomainError(
          "INVALID_REFERENCE",
          "Native runs require a team snapshot",
        );
      const run = runSchema.parse({ ...data, ...metadata(), status: "active" });
      this.db
        .prepare("INSERT INTO runs(id, project_id, data) VALUES (?, ?, ?)")
        .run(run.id, run.projectId, JSON.stringify(run));
      appendEvent(this.db, {
        type: "run.created",
        runId: run.id,
        correlationId: key,
        payload: { execution: run.execution },
      });
      return run;
    });
  }
  updateRun(input: unknown, key: string) {
    const data = updateRunSchema.parse(input);
    return mutate(this.db, key, "updateRun", data, runSchema, () => {
      const previous = this.getRun(data.id);
      if (previous.status === "stopped" || previous.status === "completed")
        throw new DomainError("CONFLICT", "Run is terminal");
      const run = runSchema.parse({
        ...previous,
        ...data,
        updatedAt: new Date().toISOString(),
      });
      this.save("runs", run);
      appendEvent(this.db, {
        type: "run.updated",
        runId: run.id,
        correlationId: key,
        payload: { mode: run.mode, status: run.status },
      });
      return run;
    });
  }
  // Runs inside the integration's transaction. Only this app's own approved
  // application from the run's recorded base may move it, so later worktrees
  // start from the integrated result; any other branch movement (an owner
  // commit, another run's integration) still fails the dispatch identity check.
  advanceRunBase(
    runId: string,
    branch: string,
    from: string,
    to: string,
    integrationId: string,
  ) {
    const run = this.getRun(runId);
    if (run.repository?.branch !== branch || run.repository.baseSha !== from)
      return;
    this.save(
      "runs",
      runSchema.parse({
        ...run,
        repository: { ...run.repository, baseSha: to },
        updatedAt: new Date().toISOString(),
      }),
    );
    appendEvent(this.db, {
      type: "run.base_advanced",
      runId,
      correlationId: integrationId,
      payload: { branch, from, to, integrationId },
    });
  }
  createTask(input: unknown, key: string) {
    const data = createTaskSchema.parse(input);
    return mutate(this.db, key, "createTask", data, taskSchema, () => {
      this.getRun(data.runId);
      const references = [
        ...data.dependencyIds,
        ...(data.parentTaskId ? [data.parentTaskId] : []),
      ];
      for (const id of references) {
        if (this.getTask(id).runId !== data.runId)
          throw new DomainError(
            "INVALID_REFERENCE",
            "Task references must belong to the same run",
          );
      }
      const task = taskSchema.parse({
        ...data,
        ...metadata(),
        status: "BACKLOG",
        assignedProfileId: null,
        ownerPinned: false,
      });
      this.db
        .prepare(
          "INSERT INTO tasks(id, run_id, parent_task_id, data) VALUES (?, ?, ?, ?)",
        )
        .run(task.id, task.runId, task.parentTaskId, JSON.stringify(task));
      for (const id of task.dependencyIds)
        this.db
          .prepare("INSERT INTO task_dependencies VALUES (?, ?)")
          .run(task.id, id);
      appendEvent(this.db, {
        type: "task.created",
        runId: task.runId,
        taskId: task.id,
        correlationId: key,
        payload: { status: task.status },
      });
      return task;
    });
  }
  transitionTask(input: unknown, key: string) {
    const data = transitionTaskSchema.parse(input);
    return mutate(this.db, key, "transitionTask", data, taskSchema, () => {
      const task = this.getTask(data.id);
      if (task.status !== data.expectedStatus)
        throw new DomainError("CONFLICT", "Task status changed");
      assertTaskTransition(task.status, data.status);
      assertHumanWaitTransition(this, task, data.status);
      assertDependencyTransition(this, task, data.status);
      const updated = taskSchema.parse({
        ...task,
        status: data.status,
        updatedAt: new Date().toISOString(),
      });
      this.save("tasks", updated);
      appendEvent(this.db, {
        type: "task.transitioned",
        runId: task.runId,
        taskId: task.id,
        correlationId: key,
        payload: { from: task.status, to: data.status, reason: data.reason },
      });
      reconcileDependencyWaits(this, key, task.runId);
      return this.getTask(task.id);
    });
  }
  updateTask(input: unknown, key: string) {
    const data = updateTaskSchema.parse(input);
    return mutate(this.db, key, "updateTask", data, taskSchema, () => {
      const previous = this.getTask(data.id);
      const task = taskSchema.parse({
        ...previous,
        ...data,
        updatedAt: new Date().toISOString(),
      });
      this.save("tasks", task);
      appendEvent(this.db, {
        type: "task.updated",
        runId: task.runId,
        taskId: task.id,
        correlationId: key,
        payload: { before: previous, after: task },
      });
      return task;
    });
  }
  createAttempt(input: unknown, key: string) {
    const data = createAttemptSchema.parse(input);
    return mutate(this.db, key, "createAttempt", data, attemptSchema, () => {
      const task = this.getTask(data.taskId);
      const run = this.getRun(task.runId);
      if (
        task.status === "WAITING_HUMAN" ||
        this.listTaskBlockers(task.id).length
      )
        throw new DomainError(
          "CONFLICT",
          "A human blocker prevents a new attempt",
        );
      if (
        task.status === "WAITING_DEPENDENCY" ||
        unmetDependencies(this, task).length
      )
        throw new DomainError(
          "CONFLICT",
          "Unfinished prerequisites prevent a new attempt",
        );
      if ((run.execution === "fake") !== (data.adapter === "fake"))
        throw new DomainError(
          "INVALID_REFERENCE",
          "Adapter does not match run execution kind",
        );
      const attempt = attemptSchema.parse({
        ...data,
        ...metadata(),
        dispatchId: randomUUID(),
        status: "created",
      });
      this.db
        .prepare(
          "INSERT INTO attempts(id, task_id, dispatch_id, data) VALUES (?, ?, ?, ?)",
        )
        .run(attempt.id, task.id, attempt.dispatchId, JSON.stringify(attempt));
      appendEvent(this.db, {
        type: "attempt.created",
        runId: task.runId,
        taskId: task.id,
        attemptId: attempt.id,
        correlationId: key,
        payload: {
          intendedOperation: attempt.intendedOperation,
          adapter: attempt.adapter,
        },
      });
      return attempt;
    });
  }
  updateAttempt(input: unknown, key: string) {
    const data = updateAttemptSchema.parse(input);
    return mutate(this.db, key, "updateAttempt", data, attemptSchema, () => {
      const previous = this.getAttempt(data.id);
      const allowed =
        previous.status === "created"
          ? ["running", "cancelled", "RECOVERY_REQUIRED"]
          : previous.status === "running"
            ? [
                "completed",
                "failed",
                "interrupted",
                "cancelled",
                "RECOVERY_REQUIRED",
              ]
            : [];
      if (!allowed.includes(data.status))
        throw new DomainError(
          "INVALID_TRANSITION",
          "Attempt transition requires a new attempt or recovery decision",
        );
      const attempt = attemptSchema.parse({
        ...previous,
        status: data.status,
        updatedAt: new Date().toISOString(),
      });
      this.save("attempts", attempt);
      const task = this.getTask(attempt.taskId);
      appendEvent(this.db, {
        type: "attempt.updated",
        runId: task.runId,
        taskId: task.id,
        attemptId: attempt.id,
        correlationId: key,
        payload: { status: attempt.status },
      });
      return attempt;
    });
  }
  createSession(input: unknown, key: string) {
    const data = createSessionSchema.parse(input);
    return mutate(this.db, key, "createSession", data, sessionSchema, () => {
      const attempt = this.getAttempt(data.attemptId);
      const task = this.getTask(attempt.taskId);
      const session = sessionSchema.parse({
        ...data,
        ...metadata(),
        adapter: attempt.adapter,
        processId: null,
        state: "not_started",
        exitCode: null,
        recovery: "none",
      });
      this.db
        .prepare("INSERT INTO sessions(id, attempt_id, data) VALUES (?, ?, ?)")
        .run(session.id, attempt.id, JSON.stringify(session));
      appendEvent(this.db, {
        type: "session.created",
        runId: task.runId,
        taskId: task.id,
        attemptId: attempt.id,
        sessionId: session.id,
        correlationId: key,
        payload: { adapter: session.adapter },
      });
      return session;
    });
  }
  updateSession(input: unknown, key: string) {
    const data = updateSessionSchema.parse(input);
    return mutate(this.db, key, "updateSession", data, sessionSchema, () => {
      const previous = this.getSession(data.id);
      if (previous.state !== data.expectedState)
        throw new DomainError("CONFLICT", "Session state changed");
      assertSessionTransition(previous.state, data.state);
      if (
        previous.recovery === "RECOVERY_REQUIRED" &&
        data.state === "starting"
      )
        throw new DomainError(
          "CONFLICT",
          "Session requires an explicit recovery decision",
        );
      if (
        previous.nativeSessionId &&
        data.nativeSessionId &&
        previous.nativeSessionId !== data.nativeSessionId
      )
        throw new DomainError(
          "CONFLICT",
          "Native session identity cannot change",
        );
      const { expectedState: _, ...patch } = data;
      const session = sessionSchema.parse({
        ...previous,
        ...patch,
        updatedAt: new Date().toISOString(),
        recovery:
          data.state === "crashed" || data.state === "disconnected"
            ? "RECOVERY_REQUIRED"
            : previous.recovery,
      });
      this.save("sessions", session);
      const attempt = this.getAttempt(session.attemptId);
      const task = this.getTask(attempt.taskId);
      // Process exit and idle never complete a task; only orchestration may do that.
      appendEvent(this.db, {
        type: "session.transitioned",
        runId: task.runId,
        taskId: task.id,
        attemptId: attempt.id,
        sessionId: session.id,
        correlationId: key,
        payload: {
          from: previous.state,
          to: session.state,
          exitCode: session.exitCode,
        },
      });
      return session;
    });
  }
  createHumanRequest(input: unknown, key: string) {
    return createHumanRequest(this, input, key);
  }
  updateHumanRequest(input: unknown, key: string) {
    return updateHumanRequest(this, input, key);
  }
  private validateLinks(links: {
    runId?: string | null;
    taskId?: string | null;
    attemptId?: string | null;
    sessionId?: string | null;
  }) {
    const session = links.sessionId ? this.getSession(links.sessionId) : null;
    const attempt = links.attemptId
      ? this.getAttempt(links.attemptId)
      : session
        ? this.getAttempt(session.attemptId)
        : null;
    const task = links.taskId
      ? this.getTask(links.taskId)
      : attempt
        ? this.getTask(attempt.taskId)
        : null;
    if (
      (session && attempt && session.attemptId !== attempt.id) ||
      (attempt && task && attempt.taskId !== task.id) ||
      (task && links.runId && task.runId !== links.runId)
    )
      throw new DomainError("INVALID_REFERENCE", "Event ownership mismatch");
    if (links.runId) this.getRun(links.runId);
  }
  recordEvent(input: unknown, key: string) {
    const data = appendEventSchema.parse(input);
    return mutate(this.db, key, "recordEvent", data, eventSchema, () => {
      this.validateLinks(data);
      return appendEvent(this.db, data);
    });
  }

  recoverInterrupted() {
    recoverInterrupted(this.db, this);
    interruptIntegrations(this);
    reconcileCompletedRevisions(this);
    reconcileDependencyWaits(this, "dependencies:recovery");
  }
}
