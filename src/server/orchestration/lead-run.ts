import { z } from "zod";
import {
  type Run,
  runSchema,
  taskSchema,
} from "../../shared/domain/entities.ts";
import type { createRunSchema } from "../../shared/domain/inputs.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { hasNativeLead, leadRunSchema, leadTeam } from "../../shared/native.ts";
import type { WorkflowRun } from "../../shared/workflows.ts";
import { inspectRepository, requireClean } from "../git/inspect.ts";
import { mutate } from "../storage/mutations.ts";
import type { Engine } from "./engine.ts";

type Capabilities = Awaited<ReturnType<Engine["pi"]["discover"]>>;
function requireSelection(
  capabilities: Capabilities,
  selection: { model: string; thinking: string | null },
  name: string,
) {
  const model = capabilities.models.find((m) => m.id === selection.model);
  if (
    !capabilities.installed ||
    !model ||
    (selection.thinking !== null &&
      !model.thinking.some((t) => t.id === selection.thinking))
  )
    throw new DomainError(
      "UNSUPPORTED",
      `${name} model/thinking is unavailable; refresh native capabilities`,
    );
}

export async function createLeadRun(
  engine: Engine,
  input: unknown,
  key: string,
) {
  const data = leadRunSchema.parse(input);
  const project = engine.store.getProject(data.projectId);
  const repository = await inspectRepository(project.repositoryPath);
  requireClean(repository);
  if (
    !project.repository ||
    project.repository.root !== repository.root ||
    project.repository.commonDirectory !== repository.commonDirectory
  )
    throw new DomainError("CONFLICT", "Project identity changed; reopen it");
  const [codex, pi] = await Promise.all([
    engine.codex.discover(),
    engine.pi.discover(),
  ]);
  if (codex.authenticated !== true)
    throw new DomainError(
      "UNSUPPORTED",
      codex.nextStep ?? "Codex app-owned login is required",
    );
  requireSelection(codex, data.lead, "Codex Lead");
  requireSelection(pi, data.worker, "Pi worker");
  return mutate(engine.store.db, key, "startLeadRun", data, runSchema, () =>
    beginLeadRun(
      engine,
      {
        projectId: project.id,
        title: data.title,
        initialPrompt: data.initialPrompt,
        mode: data.mode,
        limits: data.limits,
        teamSnapshot: { ...leadTeam(data), roles: engine.presets().roles },
        repository,
      },
      key,
    ),
  );
}

// Call inside the caller's transaction: the run, owner message and first Lead
// turn commit together.
export function beginLeadRun(
  engine: Engine,
  input: Omit<z.input<typeof createRunSchema>, "execution">,
  key: string,
) {
  const run = engine.store.createRun(
    { ...input, execution: "native" },
    `${key}:run`,
  );
  engine.store.recordEvent(
    {
      runId: run.id,
      type: "owner.message",
      correlationId: key,
      payload: { text: run.initialPrompt },
    },
    `${key}:message`,
  );
  requestLeadTurn(engine, run.id, "owner", run.initialPrompt, `${key}:lead`);
  return run;
}

// One Lead turn per run may run at a time (reservation index). A queued turn
// absorbs later inputs, so the Lead receives them together in its next turn.
export function requestLeadTurn(
  engine: Engine,
  runId: string,
  trigger: "owner" | "automatic",
  reason: string,
  key: string,
) {
  const { store } = engine;
  return mutate(
    store.db,
    key,
    "requestLeadTurn",
    { runId, trigger, reason },
    z.union([taskSchema, z.null()]),
    () => {
      const run = store.getRun(runId);
      if (!hasNativeLead(run) || ["stopped", "completed"].includes(run.status))
        return null;
      const lastLead = store
        .listTasks(runId)
        .filter((task) => task.kind === "lead")
        .at(-1);
      const providerHold = lastLead
        ? store
            .listHumanRequests()
            .findLast(
              (request) =>
                request.providerFailure &&
                request.affectedTaskIds.includes(lastLead.id),
            )
        : null;
      if (
        lastLead &&
        ["WAITING_HUMAN", "RETRY_DECISION"].includes(lastLead.status) &&
        providerHold
      ) {
        // Worker notifications must not reopen a failed Lead's native thread.
        if (trigger === "automatic") return null;
        if (
          providerHold.affectedTaskIds.some(
            (id) =>
              store.getTask(id).status === "RETRY_DECISION" ||
              store.listTaskBlockers(id).length > 0,
          )
        )
          throw new DomainError(
            "CONFLICT",
            "Resolve the Lead's provider blocker and any recovery decision before requesting another turn",
          );
      }
      const queued = store
        .listTasks(runId)
        .find(
          (t) => t.kind === "lead" && ["READY", "QUEUED"].includes(t.status),
        );
      if (queued) return queued;
      if (trigger === "automatic") {
        const used = Number(
          store.db
            .prepare(
              "SELECT count(*) AS n FROM events WHERE run_id=? AND type='lead.wakeup'",
            )
            .get(runId)?.n ?? 0,
        );
        if (used >= run.limits.maxAutomaticLeadWakeupsPerRun) {
          store.recordEvent(
            {
              runId,
              type: "lead.wakeup.suppressed",
              correlationId: key,
              payload: {
                reason: "Automatic Lead wake-up budget exhausted",
                used,
              },
            },
            `${key}:suppressed`,
          );
          return null;
        }
      }
      const task = store.createTask(
        {
          runId,
          title:
            trigger === "owner"
              ? "Codex Lead · owner turn"
              : "Codex Lead · wake-up",
          objective: reason.slice(0, 8000),
          kind: "lead",
          origin: trigger === "owner" ? "owner" : "worker",
        },
        `${key}:task`,
      );
      if (trigger === "automatic")
        store.recordEvent(
          {
            runId,
            taskId: task.id,
            type: "lead.wakeup",
            correlationId: key,
            payload: { reason: reason.slice(0, 2000) },
          },
          `${key}:wakeup`,
        );
      engine.scheduling.enqueueLead(task.id, "success", `${key}:enqueue`);
      return task;
    },
  );
}

export function notifyLead(
  engine: Engine,
  taskId: string,
  kind:
    | "completed"
    | "failed"
    | "cancelled"
    | "paused"
    | "urgent_issue"
    | "issue"
    | "human_request",
  text: string,
  key: string,
) {
  const task = engine.store.getTask(taskId);
  const run = engine.store.getRun(task.runId);
  if (task.kind !== "work" || !hasNativeLead(run)) return false;
  const summary = `${kind}: ${task.title} (${task.id}) — ${text}`.slice(
    0,
    2000,
  );
  return mutate(
    engine.store.db,
    key,
    "notifyLead",
    { taskId, kind, text },
    z.boolean(),
    () => {
      engine.store.recordEvent(
        {
          runId: run.id,
          taskId,
          type: "lead.notification",
          correlationId: key,
          payload: { kind, summary },
        },
        `${key}:event`,
      );
      // A workflow child's outcome reaches the Lead once, when its workflow
      // settles, instead of one paid Lead turn per child.
      const wakes = task.workflowId
        ? ["urgent_issue", "human_request"]
        : ["completed", "failed", "urgent_issue", "human_request"];
      if (wakes.includes(kind))
        return Boolean(
          requestLeadTurn(engine, run.id, "automatic", summary, `${key}:turn`),
        );
      return false;
    },
  );
}

export function notifyWorkflowSettled(
  engine: Engine,
  workflow: WorkflowRun,
  key: string,
) {
  const run = engine.store.getRun(workflow.runId);
  if (!hasNativeLead(run)) return false;
  const results = workflow.template.results.map((result) => {
    const state = workflow.stages.find((s) => s.stageId === result.stageId);
    return `${result.name} from stage ${result.stageId} (${state?.status ?? "missing"}; tasks ${state?.taskIds.join(", ") || "none"})`;
  });
  const summary =
    `${workflow.status}: ${workflow.template.name} (${workflow.id}) — ${results.join("; ")}`.slice(
      0,
      2000,
    );
  return mutate(
    engine.store.db,
    key,
    "notifyWorkflowSettled",
    { workflowId: workflow.id, status: workflow.status },
    z.boolean(),
    () => {
      engine.store.recordEvent(
        {
          runId: run.id,
          type: "lead.notification",
          correlationId: key,
          payload: { kind: "workflow", summary },
        },
        `${key}:event`,
      );
      return Boolean(
        requestLeadTurn(
          engine,
          run.id,
          "automatic",
          `Workflow ${summary}`,
          `${key}:turn`,
        ),
      );
    },
  );
}

export function ownerLeadMessage(
  engine: Engine,
  run: Run,
  text: string,
  key: string,
) {
  return mutate(
    engine.store.db,
    key,
    "ownerLeadMessage",
    { runId: run.id, text },
    z.union([taskSchema, z.null()]),
    () => {
      if (run.status !== "active")
        throw new DomainError("CONFLICT", "Resume the run before messaging");
      engine.store.recordEvent(
        {
          runId: run.id,
          type: "owner.message",
          correlationId: key,
          payload: { text },
        },
        `${key}:event`,
      );
      return requestLeadTurn(engine, run.id, "owner", text, `${key}:turn`);
    },
  );
}

const digestTypes = [
  "owner.worker_message",
  "owner.message",
  "lead.notification",
  "assignment.overridden",
  "task.assigned",
  "task.updated",
  "run.updated",
  "task.transitioned",
];
// Builds the next Lead input from journal events after the last delivery,
// including owner overrides the Lead must respect (spec §4.5, §6.4).
export function leadDigest(engine: Engine, runId: string) {
  const { db } = engine.store;
  const cursor = Number(
    db
      .prepare(
        "SELECT max(json_extract(payload,'$.upTo')) AS upTo FROM events WHERE run_id=? AND type='lead.turn.delivered'",
      )
      .get(runId)?.upTo ?? 0,
  );
  const rows = db
    .prepare(
      `SELECT sequence, type, task_id AS taskId, payload FROM events WHERE run_id=? AND sequence>? AND type IN (${digestTypes.map(() => "?").join(",")}) ORDER BY sequence LIMIT 200`,
    )
    .all(runId, cursor, ...digestTypes);
  const lines: string[] = [];
  // Each owner input may emit sending/queued/delivered events. Include its
  // latest state once so delivery bookkeeping does not multiply Lead context.
  const ownerInputSequences = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== "owner.worker_message") continue;
    const payload = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(String(row.payload)));
    ownerInputSequences.set(String(payload.id), Number(row.sequence));
  }
  let upTo = cursor;
  for (const row of rows) {
    upTo = Number(row.sequence);
    const payload = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(String(row.payload)));
    const task = row.taskId ? ` task ${String(row.taskId)}` : "";
    switch (row.type) {
      case "owner.worker_message":
        if (
          ownerInputSequences.get(String(payload.id)) === Number(row.sequence)
        )
          lines.push(
            `Owner ${String(payload.kind)}${task} (${String(payload.status)}): ${String(payload.text)}`,
          );
        break;
      case "owner.message":
        lines.push(`Owner message: ${String(payload.text)}`);
        break;
      case "lead.notification":
        lines.push(
          `${payload.kind === "workflow" ? "Workflow" : "Worker"} ${String(payload.summary)}`,
        );
        break;
      case "assignment.overridden":
        lines.push(
          `Owner override:${task} assigned to ${String(payload.chosenProfileId)} instead of your proposal ${String(payload.proposedProfileId)}.`,
        );
        break;
      case "task.assigned":
        if (payload.ownerPinned === true)
          lines.push(
            `Owner assigned${task} to ${String(payload.profileId)}; this assignment is pinned and you cannot change it.`,
          );
        break;
      case "task.updated":
        lines.push(`Owner edited${task}.`);
        break;
      case "run.updated":
        lines.push(
          `Run is now mode ${String(payload.mode)}, status ${String(payload.status)}. Apply this before your next tool call.`,
        );
        break;
      case "task.transitioned":
        if (
          payload.to === "CANCELLED" &&
          row.taskId &&
          engine.store.getTask(String(row.taskId)).kind === "work"
        )
          lines.push(`Task${task} was cancelled: ${String(payload.reason)}.`);
        break;
    }
  }
  return { lines, upTo };
}
