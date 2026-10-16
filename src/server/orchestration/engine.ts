import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  artifactSchema,
  projectSchema,
  runSchema,
  type Task,
  taskSchema,
} from "../../shared/domain/entities.ts";
import {
  updateRunSchema,
  updateTaskSchema,
} from "../../shared/domain/inputs.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { hasNativeLead } from "../../shared/native.ts";
import {
  type Actor,
  openProjectSchema,
  ownerMessageSchema,
  ownerTaskSchema,
  startRunSchema,
} from "../../shared/orchestration.ts";
import { fakeTeamSnapshot } from "../../shared/presets.ts";
import { CodexAdapter } from "../adapters/codex.ts";
import type { HarnessAdapter } from "../adapters/contract.ts";
import { PiAdapter } from "../adapters/pi.ts";
import { Gateway } from "../gateway/mcp.ts";
import { inspectRepository, requireClean } from "../git/inspect.ts";
import { Worktrees } from "../git/worktrees.ts";
import { mutate } from "../storage/mutations.ts";
import { Scheduling } from "../storage/scheduling.ts";
import type { Store } from "../storage/store.ts";
import { executeFakeTurn } from "./execute.ts";
import { executeLeadTurn } from "./lead-execute.ts";
import { createLeadRun, notifyLead, ownerLeadMessage } from "./lead-run.ts";
import { executeNativeTurn } from "./native-execute.ts";
import { createNativeRun } from "./native-run.ts";
import { runTool } from "./tools.ts";

export class Engine {
  readonly store: Store;
  readonly scheduling: Scheduling;
  readonly directory: string;
  readonly pi: HarnessAdapter;
  readonly codex: HarnessAdapter;
  readonly gateway: Gateway;
  // Loopback MCP endpoint; null when no app server hosts the gateway.
  readonly gatewayUrl: string | null;
  readonly worktrees: Worktrees;
  readonly nativeStops = new Map<string, () => Promise<void>>();
  private readonly running = new Map<string, Promise<void>>();
  private pumping = false;
  private stopping = false;
  private readonly timer;
  constructor(
    store: Store,
    directory: string,
    pi: HarnessAdapter = new PiAdapter(directory),
    options: { codex?: HarnessAdapter; gatewayUrl?: string | null } = {},
  ) {
    this.store = store;
    this.directory = directory;
    this.pi = pi;
    this.codex = options.codex ?? new CodexAdapter(directory);
    this.gatewayUrl = options.gatewayUrl ?? null;
    this.gateway = new Gateway(this);
    this.worktrees = new Worktrees(store, directory);
    this.scheduling = new Scheduling(store, directory);
    for (const role of fakeTeamSnapshot.roles)
      store.db
        .prepare("INSERT OR IGNORE INTO role_templates VALUES (?,?)")
        .run(role.id, JSON.stringify(role));
    for (const profile of fakeTeamSnapshot.profiles)
      store.db
        .prepare("INSERT OR IGNORE INTO agent_profiles VALUES (?,?,?)")
        .run(profile.id, profile.roleId, JSON.stringify(profile));
    store.db
      .prepare("INSERT OR IGNORE INTO team_presets VALUES (?,?,?)")
      .run(
        fakeTeamSnapshot.preset.id,
        fakeTeamSnapshot.preset.leadProfileId,
        JSON.stringify(fakeTeamSnapshot.preset),
      );
    this.timer = setInterval(() => {
      void this.pump().catch((error: unknown) =>
        console.error(
          "Scheduler error",
          error instanceof Error ? error.name : "Unknown error",
        ),
      );
    }, 100);
  }
  presets() {
    return fakeTeamSnapshot;
  }
  isStopping() {
    return this.stopping;
  }
  startNativeRun(input: unknown, key: string) {
    return createNativeRun(this, input, key);
  }
  startLeadRun(input: unknown, key: string) {
    return createLeadRun(this, input, key);
  }
  async openProject(input: unknown, key: string) {
    const data = openProjectSchema.parse(input);
    const repository = await inspectRepository(data.repositoryPath);
    requireClean(repository);
    const nestedData = relative(repository.root, this.directory);
    if (
      nestedData === "" ||
      (nestedData !== ".." &&
        !nestedData.startsWith("../") &&
        !isAbsolute(nestedData))
    )
      throw new DomainError(
        "POLICY_DENIED",
        "App metadata must be outside the selected repository",
      );
    return mutate(
      this.store.db,
      key,
      "openProject",
      data,
      projectSchema,
      () => {
        const existing = this.store
          .listProjects()
          .find((project) => project.repositoryPath === repository.root);
        const project = existing
          ? projectSchema.parse({
              ...existing,
              name: data.name,
              repository,
              updatedAt: new Date().toISOString(),
            })
          : this.store.createProject(
              { ...data, repositoryPath: repository.root, repository },
              `${key}:create`,
            );
        if (existing)
          this.store.db
            .prepare("UPDATE projects SET data=? WHERE id=?")
            .run(JSON.stringify(project), project.id);
        this.store.recordEvent(
          {
            type: "project.opened",
            correlationId: key,
            payload: { projectId: project.id, baseSha: repository.baseSha },
          },
          `${key}:opened`,
        );
        return project;
      },
    );
  }

  async startRun(input: unknown, key: string) {
    const data = startRunSchema.parse(input);
    const project = this.store.getProject(data.projectId);
    const repository = await inspectRepository(project.repositoryPath);
    requireClean(repository);
    if (
      !project.repository ||
      project.repository.commonDirectory !== repository.commonDirectory ||
      project.repository.root !== repository.root
    )
      throw new DomainError(
        "CONFLICT",
        "Project identity changed; reopen it before starting",
      );
    const snapshot = fakeTeamSnapshot;
    if (data.leadProfileId !== snapshot.preset.leadProfileId)
      throw new DomainError(
        "INVALID_REFERENCE",
        "Choose the available fake Lead profile",
      );
    return mutate(this.store.db, key, "startRun", data, runSchema, () => {
      const run = this.store.createRun(
        {
          projectId: project.id,
          title: data.title,
          initialPrompt: data.initialPrompt,
          mode: data.mode,
          limits: data.limits,
          teamSnapshot: snapshot,
          repository,
          execution: "fake",
        },
        `${key}:run`,
      );
      this.message(
        { runId: run.id, text: data.initialPrompt, scenario: data.scenario },
        `${key}:initial`,
      );
      return run;
    });
  }
  message(input: unknown, key: string) {
    const data = ownerMessageSchema.parse(input);
    const target = this.store.getRun(data.runId);
    if (hasNativeLead(target))
      return ownerLeadMessage(this, target, data.text, key);
    return mutate(this.store.db, key, "ownerMessage", data, taskSchema, () => {
      const run = this.store.getRun(data.runId);
      if (
        run.execution !== "fake" ||
        !run.teamSnapshot ||
        run.status !== "active"
      )
        throw new DomainError(
          "CONFLICT",
          "Choose an active fake run with a saved team",
        );
      this.store.recordEvent(
        {
          runId: run.id,
          type: "owner.message",
          correlationId: key,
          payload: { text: data.text },
        },
        `${key}:event`,
      );
      const task = this.store.createTask(
        {
          runId: run.id,
          title: "FAKE Lead · planning",
          objective: data.text,
          kind: "lead",
        },
        `${key}:task`,
      );
      this.scheduling.enqueueLead(task.id, data.scenario, `${key}:lead`);
      return task;
    });
  }
  createTask(input: unknown, key: string) {
    const data = ownerTaskSchema.parse(input);
    return this.store.createTask({ ...data, origin: "owner" }, key);
  }
  updateTask(input: unknown, key: string) {
    return this.store.updateTask(updateTaskSchema.parse(input), key);
  }
  updateRun(input: unknown, key: string) {
    return this.store.updateRun(updateRunSchema.parse(input), key);
  }
  tool(actor: Actor, runId: string, input: unknown, key: string) {
    return runTool(this, actor, runId, input, key);
  }
  cancel(taskId: string, key: string) {
    const cancelled = mutate(
      this.store.db,
      key,
      "cancelTask",
      { taskId },
      taskSchema,
      () => {
        let task = this.store.getTask(taskId);
        if (task.status === "CANCELLED") return task;
        if (["FAILED", "INTERRUPTED"].includes(task.status))
          task = this.store.transitionTask(
            {
              id: task.id,
              expectedStatus: task.status,
              status: "RETRY_DECISION",
              reason: "Owner cancelling failed work",
            },
            `${key}:retry`,
          );
        task = this.store.transitionTask(
          {
            id: task.id,
            expectedStatus: task.status,
            status: "CANCELLED",
            reason: "Owner cancelled",
          },
          `${key}:cancel`,
        );
        const dispatch = this.scheduling
          .list()
          .find((d) => d.taskId === task.id);
        if (dispatch?.state !== "active") this.scheduling.release(task.id);
        return task;
      },
    );
    const stop = this.nativeStops.get(taskId);
    if (stop)
      void stop().catch(() =>
        this.store.recordEvent(
          {
            runId: cancelled.runId,
            taskId,
            type: "cancel.diagnostic",
            correlationId: key,
            payload: {
              diagnostic:
                "Native abort did not acknowledge; bounded process shutdown/recovery required",
            },
          },
          `${key}:abort-diagnostic`,
        ),
      );
    return cancelled;
  }
  async pump() {
    if (this.pumping || this.stopping) return;
    this.pumping = true;
    try {
      const queued = this.scheduling
        .list()
        .filter((d) => d.state === "queued")
        .sort(
          (a, b) =>
            this.store.getTask(b.taskId).priority -
              this.store.getTask(a.taskId).priority || a.sequence - b.sequence,
        );
      for (const dispatch of queued) {
        if (this.stopping) break;
        const run = this.store.getRun(dispatch.runId);
        if (
          run.status !== "active" ||
          (this.store.getTask(dispatch.taskId).kind === "work" &&
            run.mode === "chat_plan")
        )
          continue;
        try {
          const repository = await inspectRepository(
            this.store.getProject(run.projectId).repositoryPath,
          );
          requireClean(repository);
          if (
            !run.repository ||
            repository.baseSha !== run.repository.baseSha ||
            repository.commonDirectory !== run.repository.commonDirectory ||
            repository.root !== run.repository.root
          )
            throw new DomainError(
              "CONFLICT",
              "Repository identity or HEAD changed since this run started",
            );
          if (this.stopping) break;
          const attemptId = this.scheduling.reserve(dispatch);
          if (!attemptId || this.running.has(dispatch.taskId)) continue;
          // Owner assignments may change while Git inspection awaits; execute
          // the assignment committed by reservation, not the earlier queue copy.
          const reserved = this.scheduling
            .list()
            .find(
              (item) => item.attemptId === attemptId && item.state === "active",
            );
          if (!reserved)
            throw new DomainError("CONFLICT", "Reserved dispatch is missing");
          const execution = (
            run.execution === "fake"
              ? executeFakeTurn(this, reserved, attemptId)
              : this.store.getTask(reserved.taskId).kind === "lead"
                ? executeLeadTurn(this, reserved, attemptId)
                : executeNativeTurn(this, reserved, attemptId)
          )
            .catch((error: unknown) => {
              this.fail(
                dispatch.taskId,
                attemptId,
                error instanceof Error
                  ? error.message
                  : "Unknown adapter error",
              );
              const session = this.store
                .listSessions()
                .find((item) => item.attemptId === attemptId);
              if (session && ["busy", "starting"].includes(session.state))
                this.store.updateSession(
                  {
                    id: session.id,
                    expectedState: session.state,
                    state: "idle",
                  },
                  `session:${attemptId}:error-idle`,
                );
            })
            .finally(() => {
              this.scheduling.release(dispatch.taskId);
              this.running.delete(dispatch.taskId);
            })
            .catch((error: unknown) => {
              this.running.delete(dispatch.taskId);
              console.error(
                "Execution persistence failed; recovery required",
                error instanceof Error ? error.name : "Unknown error",
              );
              process.exitCode = 1;
            });
          this.running.set(dispatch.taskId, execution);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          this.scheduling.block(dispatch.taskId, error.message);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
  fail(
    taskId: string,
    attemptId: string,
    diagnostic: string,
    interrupted = false,
  ) {
    const task = this.store.getTask(taskId);
    const key = `finish:${attemptId}`;
    mutate(
      this.store.db,
      key,
      "failAttempt",
      { taskId, diagnostic, interrupted },
      z.boolean(),
      () => {
        const attempt = this.store.getAttempt(attemptId);
        if (attempt.status === "running")
          this.store.updateAttempt(
            {
              id: attemptId,
              status:
                task.status === "CANCELLED"
                  ? "cancelled"
                  : interrupted
                    ? "interrupted"
                    : "failed",
            },
            `${key}:attempt`,
          );
        if (task.status === "RUNNING") {
          this.store.transitionTask(
            {
              id: taskId,
              expectedStatus: "RUNNING",
              status: interrupted ? "INTERRUPTED" : "FAILED",
              reason: diagnostic,
            },
            `${key}:failed`,
          );
          this.store.transitionTask(
            {
              id: taskId,
              expectedStatus: interrupted ? "INTERRUPTED" : "FAILED",
              status: "RETRY_DECISION",
              reason: "Explicit owner decision required",
            },
            `${key}:decision`,
          );
        }
        this.store.recordEvent(
          {
            runId: task.runId,
            taskId,
            attemptId,
            type: "attempt.diagnostic",
            correlationId: key,
            payload: { diagnostic },
          },
          `${key}:event`,
        );
        notifyLead(
          this,
          taskId,
          this.store.getTask(taskId).status === "CANCELLED"
            ? "cancelled"
            : "failed",
          diagnostic,
          `${key}:notify`,
        );
        return true;
      },
    );
  }
  // A reference (a reviewer's context packet) is kept beside the attempt's report.
  async saveReport(
    task: Task,
    attemptId: string,
    report: string,
    reference?: string,
  ) {
    const path = join(
      this.directory,
      "artifacts",
      reference ? `${attemptId}-reference.txt` : `${attemptId}.txt`,
    );
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, report, { flag: "wx", mode: 0o600 });
    const now = new Date().toISOString();
    const artifact = artifactSchema.parse({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      taskId: task.id,
      attemptId,
      kind: reference ? "reference" : "report",
      path,
      mediaType: "text/plain",
      summary:
        reference ??
        (this.store.getRun(task.runId).execution === "fake"
          ? "FAKE worker report"
          : "Native Pi worker report"),
    });
    return artifact;
  }
  async reports(taskId: string) {
    this.store.getTask(taskId);
    const artifacts = this.store.db
      .prepare("SELECT data FROM artifacts WHERE task_id=?")
      .all(taskId)
      .map((row) => artifactSchema.parse(JSON.parse(String(row.data))));
    return Promise.all(
      artifacts.map(async (artifact) => ({
        artifact,
        content: await readFile(artifact.path, "utf8"),
      })),
    );
  }
  async idle() {
    for (let i = 0; i < 8000; i++) {
      await this.pump();
      if (!this.pumping && this.running.size === 0) return;
      await delay(25);
    }
    throw new Error("Engine did not become idle within its deadline");
  }
  async close() {
    this.stopping = true;
    clearInterval(this.timer);
    this.gateway.revokeAll();
    while (this.pumping) await delay(10);
    await Promise.allSettled(
      [...this.nativeStops.values()].map((stop) => stop()),
    );
    await Promise.all(this.running.values());
  }
}
