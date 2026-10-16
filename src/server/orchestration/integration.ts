import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DomainError } from "../../shared/domain/states.ts";
import {
  destinationBranchSchema,
  integrationPreviewSchema,
  integrationRequestSchema,
} from "../../shared/integration.ts";
import type { Actor } from "../../shared/orchestration.ts";
import { listIntegrationCandidates } from "../storage/candidates.ts";
import {
  getIntegration,
  insertIntegration,
  listIntegrations,
} from "../storage/integrations.ts";
import { mutate } from "../storage/mutations.ts";
import { listReviews } from "../storage/reviews.ts";
import { implementationTask, revisionAncestors } from "../storage/revisions.ts";
import type { Engine } from "./engine.ts";
import { prepareIntegration } from "./integration-prepare.ts";

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
      const current = implementationTask(store, root);
      if (
        root.status !== "AWAITING_REVIEW" ||
        current.status !== "AWAITING_REVIEW"
      )
        throw new DomainError(
          "CONFLICT",
          "Only work awaiting review can be previewed for integration",
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

export class Integrations {
  private readonly engine: Engine;
  private readonly jobs = new Map<
    string,
    { abort: AbortController; done: Promise<void> }
  >();
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
  list(taskId: string) {
    return listIntegrations(
      this.engine.store,
      rootTask(this.engine, taskId).id,
    );
  }
  async idle() {
    await Promise.all([...this.jobs.values()].map((job) => job.done));
  }
  async close() {
    for (const job of this.jobs.values()) job.abort.abort();
    await this.idle();
  }
}
