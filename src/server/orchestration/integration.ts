import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Task } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  destinationBranchSchema,
  integrationDecisionRequestSchema,
  integrationPreviewSchema,
  integrationRequestSchema,
} from "../../shared/integration.ts";
import type { Actor } from "../../shared/orchestration.ts";
import { inspectRepository, sameRepository } from "../git/inspect.ts";
import { branchSha } from "../git/integration.ts";
import { listIntegrationCandidates } from "../storage/candidates.ts";
import {
  getIntegration,
  insertIntegration,
  listIntegrations,
  saveIntegrationDecision,
} from "../storage/integrations.ts";
import { mutate } from "../storage/mutations.ts";
import { listReviews } from "../storage/reviews.ts";
import {
  implementationLineage,
  revisionAncestors,
} from "../storage/revisions.ts";
import type { Engine } from "./engine.ts";
import { applyIntegration, planApplication } from "./integration-apply.ts";
import { prepareIntegration } from "./integration-prepare.ts";

// "review" awaits the owner's first verdict. "approved" is approved but not yet
// applied, e.g. after the destination moved: a new preview may be approved.
function integrationStage(lineage: Task[]) {
  if (lineage.every((task) => task.status === "AWAITING_REVIEW"))
    return "review";
  if (
    lineage.every((task) => task.status === "READY_TO_INTEGRATE") ||
    lineage.every((task) => task.status === "BLOCKED_CONFLICT")
  )
    return "approved";
  return null;
}

function rootTask(engine: Engine, taskId: string) {
  const task = engine.store.getTask(taskId);
  return revisionAncestors(engine.store, task).at(-1) ?? task;
}

// Owner-only: a preview runs owner-declared commands and creates Git metadata.
// No Lead/worker tool reaches it, and it grants no approval to apply anything.
export function requestIntegration(
  engine: Engine,
  actor: Actor,
  input: unknown,
  key: string,
) {
  if (actor.role !== "owner")
    throw new DomainError(
      "POLICY_DENIED",
      "Only the owner can prepare an integration preview",
    );
  const data = integrationRequestSchema.parse(input);
  const { store } = engine;
  const requested = store.getTask(data.taskId);
  const run = store.getRun(requested.runId);
  if (run.mode === "chat_plan")
    throw new DomainError(
      "POLICY_DENIED",
      "Chat/Plan cannot mutate the managed repository",
    );
  if (requested.kind !== "work" || requested.reviewCandidateId)
    throw new DomainError(
      "POLICY_DENIED",
      "Integrate an implementation task, not its review or Lead",
    );
  if (run.execution !== "native" || !run.repository)
    throw new DomainError(
      "CONFLICT",
      "Only native runs produce candidates to integrate",
    );
  if (engine.isStopping())
    throw new DomainError("CONFLICT", "The app is shutting down");
  if (!data.destinationBranch && run.repository.branch === "HEAD")
    throw new DomainError(
      "CONFLICT",
      "The run started on a detached HEAD; choose a destination branch",
    );
  const request = {
    ...data,
    destinationBranch: destinationBranchSchema.parse(
      data.destinationBranch ?? run.repository.branch,
    ),
  };
  return mutate(
    store.db,
    key,
    "requestIntegration",
    request,
    integrationPreviewSchema,
    () => {
      const root = rootTask(engine, requested.id);
      const lineage = implementationLineage(store, root);
      const [current] = lineage;
      const stage = integrationStage(lineage);
      if (!current || !stage)
        throw new DomainError(
          "CONFLICT",
          "Only work awaiting review or approved for integration can be previewed",
        );
      const candidate = listIntegrationCandidates(store, current.id).at(-1);
      if (!candidate)
        throw new DomainError("CONFLICT", "No captured candidate to integrate");
      const review = listReviews(store, current.id)
        .filter((r) => r.candidateId === candidate.id)
        .at(-1);
      if (review?.recommendation !== "pass")
        throw new DomainError(
          "CONFLICT",
          "The current candidate needs a passing independent review first",
        );
      if (candidate.humanDecision === "rejected")
        throw new DomainError(
          "CONFLICT",
          "You declined this candidate; request a revision to integrate new work",
        );
      if (stage === "approved" && candidate.humanDecision !== "approved")
        throw new DomainError(
          "CONFLICT",
          "Only the approved candidate can be previewed again",
        );
      if (
        listIntegrations(store, root.id).some((p) => p.status === "preparing")
      )
        throw new DomainError(
          "CONFLICT",
          "An integration preview is already being prepared",
        );
      const id = randomUUID();
      const now = new Date().toISOString();
      const preview = integrationPreviewSchema.parse({
        id,
        createdAt: now,
        updatedAt: now,
        runId: run.id,
        taskId: root.id,
        implementationTaskId: current.id,
        candidateId: candidate.id,
        reviewId: review.id,
        baseSha: candidate.baseSha,
        candidateSha: candidate.candidateSha,
        destinationBranch: request.destinationBranch,
        destinationSha: null,
        worktreePath: join(
          engine.directory,
          "worktrees",
          `integration-${id}`,
          "checkout",
        ),
        branch: `lao/integration-${id}`,
        tests: request.tests,
        timeoutSeconds: request.timeoutSeconds,
        status: "preparing",
        resultSha: null,
        files: [],
        checks: [],
        testResults: [],
        diffArtifactId: null,
        diagnostic: null,
      });
      insertIntegration(store, preview, key);
      return preview;
    },
  );
}

const reviewInFlight = [
  "READY",
  "QUEUED",
  "RUNNING",
  "WAITING_HUMAN",
  "WAITING_DEPENDENCY",
];

// Owner-only verdict on one finished preview. Approval moves the whole
// revision lineage to READY_TO_INTEGRATE and applies nothing to any branch;
// decline rejects the candidate but keeps the task open for a revision.
export async function decideIntegration(
  engine: Engine,
  actor: Actor,
  input: unknown,
  key: string,
) {
  if (actor.role !== "owner")
    throw new DomainError(
      "POLICY_DENIED",
      "Only the owner can approve or decline an integration",
    );
  const data = integrationDecisionRequestSchema.parse(input);
  const { store } = engine;
  const preview = getIntegration(store, data.integrationId);
  const run = store.getRun(preview.runId);
  const approve = data.decision === "approve";
  if (approve && run.mode === "chat_plan")
    throw new DomainError(
      "POLICY_DENIED",
      "Chat/Plan cannot approve integration",
    );
  // Read-only, outside the transaction. The observed SHA is not part of the
  // idempotency fingerprint, so a replay returns the recorded decision.
  let observed: string | null = null;
  if (approve && run.repository) {
    const repository = await inspectRepository(
      store.getProject(run.projectId).repositoryPath,
    );
    if (!sameRepository(run.repository, repository))
      throw new DomainError(
        "CONFLICT",
        "Repository identity changed or is unverified; reopen the project and start a new run",
      );
    try {
      observed = await branchSha(
        run.repository.root,
        preview.destinationBranch,
      );
    } catch (error) {
      if (!(error instanceof DomainError) || error.code === "GIT") throw error;
    }
  }
  return mutate(
    store.db,
    key,
    "decideIntegration",
    data,
    integrationPreviewSchema,
    () => {
      const current = getIntegration(store, preview.id);
      const lineage = implementationLineage(
        store,
        store.getTask(current.taskId),
      );
      const [implementation] = lineage;
      const stage = integrationStage(lineage);
      if (!implementation || !stage)
        throw new DomainError(
          "CONFLICT",
          "Only work awaiting review or approved for integration can be decided",
        );
      const candidate = listIntegrationCandidates(store, implementation.id).at(
        -1,
      );
      if (
        !candidate ||
        candidate.id !== current.candidateId ||
        current.implementationTaskId !== implementation.id
      )
        throw new DomainError(
          "CONFLICT",
          "This preview is for an earlier candidate; prepare a new preview",
        );
      if (
        stage === "review"
          ? candidate.humanDecision !== null
          : candidate.humanDecision !== "approved"
      )
        throw new DomainError(
          "CONFLICT",
          "This candidate already has an owner decision",
        );
      if (stage === "approved" && !approve)
        throw new DomainError(
          "CONFLICT",
          "An approved candidate cannot be declined; cancel the task to abandon it",
        );
      if (current.status === "preparing")
        throw new DomainError(
          "CONFLICT",
          "Wait for the preview to finish before deciding",
        );
      if (approve) {
        if (current.status !== "passed")
          throw new DomainError(
            "CONFLICT",
            "Only a passed integration preview can be approved",
          );
        const latest = listReviews(store, implementation.id)
          .filter((review) => review.candidateId === candidate.id)
          .at(-1);
        if (latest?.id !== current.reviewId || latest.recommendation !== "pass")
          throw new DomainError(
            "CONFLICT",
            "A newer review of this candidate exists; prepare a new preview",
          );
        if (
          store
            .listTasks(run.id)
            .some(
              (task) =>
                task.reviewCandidateId === candidate.id &&
                reviewInFlight.includes(task.status),
            )
        )
          throw new DomainError(
            "CONFLICT",
            "A review of this candidate is still in progress",
          );
        if (observed !== current.destinationSha)
          throw new DomainError(
            "CONFLICT",
            `${current.destinationBranch} ${observed ? `moved to ${observed}` : "no longer exists"} since this preview; prepare a new preview`,
          );
      }
      const decided = saveIntegrationDecision(
        store,
        current,
        candidate,
        {
          outcome: approve ? "approved" : "declined",
          decidedAt: new Date().toISOString(),
          rationale: data.rationale || null,
        },
        key,
      );
      if (approve)
        for (const task of lineage.filter(
          (t) => t.status !== "READY_TO_INTEGRATE",
        ))
          store.transitionTask(
            {
              id: task.id,
              expectedStatus: task.status,
              status: "READY_TO_INTEGRATE",
              reason: `Owner approved integration preview ${current.id} for ${current.destinationBranch}`,
            },
            `${key}:${task.id}:ready`,
          );
      return decided;
    },
  );
}

export class Integrations {
  private readonly engine: Engine;
  private readonly jobs = new Map<
    string,
    { abort: AbortController; done: Promise<void> }
  >();
  private readonly applying = new Set<Promise<unknown>>();
  constructor(engine: Engine) {
    this.engine = engine;
  }
  request(actor: Actor, input: unknown, key: string) {
    const preview = requestIntegration(this.engine, actor, input, key);
    if (
      !this.jobs.has(preview.id) &&
      getIntegration(this.engine.store, preview.id).status === "preparing"
    ) {
      const abort = new AbortController();
      const done = prepareIntegration(this.engine, preview.id, abort.signal)
        .catch((error: unknown) =>
          console.error(
            "Integration preview persistence failed; restart marks it interrupted",
            error instanceof Error ? error.name : "Unknown error",
          ),
        )
        .finally(() => this.jobs.delete(preview.id));
      this.jobs.set(preview.id, { abort, done });
    }
    return getIntegration(this.engine.store, preview.id);
  }
  decide(actor: Actor, input: unknown, key: string) {
    return decideIntegration(this.engine, actor, input, key);
  }
  plan(integrationId: string) {
    return planApplication(this.engine, integrationId);
  }
  // Shutdown waits for an application in progress; it is never aborted midway.
  apply(actor: Actor, input: unknown, key: string) {
    const done = applyIntegration(this.engine, actor, input, key);
    const forget = () => this.applying.delete(done);
    this.applying.add(done);
    done.then(forget, forget);
    return done;
  }
  list(taskId: string) {
    return listIntegrations(
      this.engine.store,
      rootTask(this.engine, taskId).id,
    );
  }
  async idle() {
    await Promise.all([...this.jobs.values()].map((job) => job.done));
    await Promise.allSettled(this.applying);
  }
  async close() {
    for (const job of this.jobs.values()) job.abort.abort();
    await this.idle();
  }
}
