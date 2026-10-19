import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  artifactSchema,
  type Harness,
  projectSchema,
  type RecoveryCause,
  type RecoveryCheck,
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
import {
  fakeExploreSubsystemTemplate,
  fakeReviewImplementationTemplate,
  fakeTeamSnapshot,
} from "../../shared/presets.ts";
import { ClaudeAdapter } from "../adapters/claude.ts";
import { CodexAdapter } from "../adapters/codex.ts";
import type { HarnessAdapter } from "../adapters/contract.ts";
import { OpenCodeAdapter } from "../adapters/opencode.ts";
import { PiAdapter } from "../adapters/pi.ts";
import { Gateway } from "../gateway/mcp.ts";
import {
  inspectRepository,
  requireClean,
  sameRepository,
} from "../git/inspect.ts";
import { Worktrees } from "../git/worktrees.ts";
import { admitBudgetWaits } from "../storage/budget-waits.ts";
import { reconcileDependencyWaits } from "../storage/dependencies.ts";
import { mutate } from "../storage/mutations.ts";
import { Profiles } from "../storage/profiles.ts";
import { saveAttemptRecovery } from "../storage/recovery.ts";
import { implementationTask, revisionTaskIds } from "../storage/revisions.ts";
import { getRole } from "../storage/roles.ts";
import { Scheduling } from "../storage/scheduling.ts";
import type { Store } from "../storage/store.ts";
import { executeFakeTurn } from "./execute.ts";
import { Integrations } from "./integration.ts";
import { executeLeadTurn } from "./lead-execute.ts";
import { createLeadRun, notifyLead, ownerLeadMessage } from "./lead-run.ts";
import { endNativeApprovals } from "./native-approvals.ts";
import { executeNativeTurn } from "./native-execute.ts";
import { createNativeRun } from "./native-run.ts";
import { recoverProviderFailures } from "./provider-failures.ts";
import {
  pauseRequested,
  recordStops,
  recoverStops,
  settleStops,
  signalStops,
} from "./stops.ts";
import { runTool } from "./tools.ts";
import { recoverWorkerHelp } from "./worker-help.ts";
import { WorkerMessages } from "./worker-messages.ts";
import { Workflows } from "./workflows.ts";

export class Engine {
  readonly store: Store;
  readonly scheduling: Scheduling;
  readonly directory: string;
  readonly pi: HarnessAdapter;
  readonly codex: HarnessAdapter;
  readonly claude: HarnessAdapter;
  readonly opencode: HarnessAdapter;
  readonly adapters: Record<Harness, HarnessAdapter>;
  readonly profiles: Profiles;
  readonly gateway: Gateway;
  // Loopback MCP endpoint; null when no app server hosts the gateway.
  readonly gatewayUrl: string | null;
  readonly worktrees: Worktrees;
  readonly integrations: Integrations;
  readonly workerMessages: WorkerMessages;
  readonly workflows: Workflows;
  readonly nativeStops = new Map<
    string,
    (reason?: "human_request" | "emergency") => Promise<void>
  >();
  private readonly running = new Map<string, Promise<void>>();
  private pumping = false;
  private stopping = false;
  private readonly timer;
  constructor(
    store: Store,
    directory: string,
    pi: HarnessAdapter = new PiAdapter(directory),
    options: {
      codex?: HarnessAdapter;
      claude?: HarnessAdapter;
      opencode?: HarnessAdapter;
      gatewayUrl?: string | null;
    } = {},
  ) {
    this.store = store;
    this.directory = directory;
    this.pi = pi;
    this.codex = options.codex ?? new CodexAdapter(directory);
    this.claude = options.claude ?? new ClaudeAdapter(directory);
    this.opencode = options.opencode ?? new OpenCodeAdapter(directory);
    this.adapters = {
      pi: this.pi,
      codex: this.codex,
      "claude-code": this.claude,
      opencode: this.opencode,
    };
    this.profiles = new Profiles(store, this.adapters);
    this.gatewayUrl = options.gatewayUrl ?? null;
    this.gateway = new Gateway(this);
    this.worktrees = new Worktrees(store, directory);
    this.integrations = new Integrations(this);
    this.scheduling = new Scheduling(store, directory);
    this.workerMessages = new WorkerMessages(this);
    this.workflows = new Workflows(this);
    endNativeApprovals(this);
    recoverWorkerHelp(this);
    recoverProviderFailures(this);
    recoverStops(store);
    for (const role of fakeTeamSnapshot.roles)
      store.db
        .prepare("INSERT OR IGNORE INTO role_templates VALUES (?,?)")
        .run(role.id, JSON.stringify(role));
    for (const profile of fakeTeamSnapshot.profiles)
      store.db
        .prepare("INSERT OR IGNORE INTO agent_profiles VALUES (?,?,?)")
        .run(profile.id, profile.roleId, JSON.stringify(profile));
    for (const template of [
      fakeExploreSubsystemTemplate,
      fakeReviewImplementationTemplate,
    ])
      store.db
        .prepare("INSERT OR IGNORE INTO workflow_templates VALUES (?,?)")
        .run(template.id, JSON.stringify(template));
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
    return {
      ...fakeTeamSnapshot,
      roles: fakeTeamSnapshot.roles.map((role) =>
        getRole(this.store, { id: role.id }),
      ),
    };
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
    if (!project.repository || !sameRepository(project.repository, repository))
      throw new DomainError(
        "CONFLICT",
        "Project identity changed or is unverified; reopen it before starting a new run",
      );
    const snapshot = this.presets();
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
    const data = updateRunSchema.parse(input);
    // A terminal label alone would leave live sessions running unnoticed.
    if (data.status === "stopped" || data.status === "completed")
      throw new DomainError(
        "CONFLICT",
        "Use Stop run; a status change alone does not cancel sessions",
      );
    return this.store.updateRun(data, key);
  }
  tool(actor: Actor, runId: string, input: unknown, key: string) {
    return runTool(this, actor, runId, input, key);
  }
  cancel(taskId: string, key: string) {
    const stops: string[] = [];
    const task = this.cancelTask(taskId, key, stops);
    for (const stopId of stops) signalStops(this, stopId);
    return task;
  }
  // Pass stops = null when the caller already journaled stop intent for the
  // task's sessions; otherwise collected stops are signalled after commit.
  cancelTask(taskId: string, key: string, stops: string[] | null): Task {
    return mutate(
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
        if (stops) {
          const stop = recordStops(this, "task", (_, id) => id === task.id);
          if (stop.sessionIds.length) stops.push(stop.stopId);
        }
        const dispatch = this.scheduling
          .list()
          .find((d) => d.taskId === task.id);
        if (dispatch && dispatch.state !== "active")
          this.scheduling.release(dispatch);
        const revision = implementationTask(this.store, task);
        if (
          revision.id !== task.id &&
          [
            "BACKLOG",
            "READY",
            "QUEUED",
            "RUNNING",
            "AWAITING_REVIEW",
            "CHANGES_REQUESTED",
            "READY_TO_INTEGRATE",
            "BLOCKED_CONFLICT",
            "RETRY_DECISION",
            "FAILED",
            "INTERRUPTED",
          ].includes(revision.status)
        )
          this.cancelTask(revision.id, `${key}:revision`, stops);
        return task;
      },
    );
  }
  async pump() {
    if (this.pumping || this.stopping) return;
    this.pumping = true;
    try {
      reconcileDependencyWaits(this.store, "dependencies:scheduler");
      admitBudgetWaits(this.store, this.scheduling);
      await this.workflows.reconcile();
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
        // Dependency waits remain budgeted in the queue but require no Git
        // inspection or adapter activity until their prerequisites finish.
        if (this.store.getTask(dispatch.taskId).status !== "QUEUED") continue;
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
            !sameRepository(run.repository, repository)
          )
            throw new DomainError(
              "CONFLICT",
              "Repository identity or HEAD changed or is unverified; reopen the project and start a new run",
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
              this.scheduling.release(reserved);
              this.running.delete(dispatch.taskId);
              settleStops(this.store, attemptId);
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
          this.scheduling.block(dispatch, error.message);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
  // `check` is an observation taken when the failure itself could not verify
  // the worktree; it becomes the first recorded recovery fact.
  fail(
    taskId: string,
    attemptId: string,
    observed: string,
    cause: RecoveryCause = "failed",
    check: RecoveryCheck | null = null,
  ) {
    const task = this.store.getTask(taskId);
    const key = `finish:${attemptId}`;
    const interrupted = cause !== "failed";
    const paused =
      task.status !== "CANCELLED" && pauseRequested(this.store, attemptId);
    const diagnostic = paused
      ? `Owner paused this worker: ${observed}`
      : observed;
    mutate(
      this.store.db,
      key,
      "failAttempt",
      { taskId, diagnostic, cause, checkId: check?.id ?? null },
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
          saveAttemptRecovery(this.store.db, this.store.getAttempt(attemptId), {
            cause,
            reason: diagnostic,
            recordedAt: new Date().toISOString(),
            checks: check ? [check] : [],
            decision: null,
          });
        }
        this.store.recordEvent(
          {
            runId: task.runId,
            taskId,
            attemptId,
            type: "attempt.diagnostic",
            correlationId: key,
            payload: { diagnostic, cause },
          },
          `${key}:event`,
        );
        notifyLead(
          this,
          taskId,
          this.store.getTask(taskId).status === "CANCELLED"
            ? "cancelled"
            : paused
              ? "paused"
              : "failed",
          diagnostic,
          `${key}:notify`,
        );
        return true;
      },
    );
  }
  // A reference (a context packet or checkpoint) is kept beside the attempt's
  // report; `name` separates references one attempt may both have.
  async saveReport(
    task: Task,
    attemptId: string,
    report: string,
    reference?: string,
    name = "reference",
  ) {
    const path = join(
      this.directory,
      "artifacts",
      reference ? `${attemptId}-${name}.txt` : `${attemptId}.txt`,
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
          : "Native worker report"),
    });
    return artifact;
  }
  async reports(taskId: string) {
    const task = this.store.getTask(taskId);
    const artifacts = revisionTaskIds(this.store, task).flatMap((id) =>
      this.store.db
        .prepare("SELECT data FROM artifacts WHERE task_id=?")
        .all(id)
        .map((row) => artifactSchema.parse(JSON.parse(String(row.data)))),
    );
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
    const integrations = this.integrations.close();
    this.gateway.revokeAll();
    while (this.pumping) await delay(10);
    await Promise.allSettled(
      [...this.nativeStops.values()].map((stop) => stop()),
    );
    await Promise.all(this.running.values());
    await integrations;
  }
}
