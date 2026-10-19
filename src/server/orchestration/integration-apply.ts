import { randomUUID } from "node:crypto";
import type { Repository } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  type ApplyPlan,
  applyRequestSchema,
  type IntegrationApplication,
  type IntegrationPreview,
  integrationPreviewSchema,
} from "../../shared/integration.ts";
import type { Actor } from "../../shared/orchestration.ts";
import {
  applyCommands,
  commitExists,
  destinationUse,
  isAncestor,
} from "../git/apply.ts";
import { git } from "../git/command.ts";
import { inspectRepository, sameRepository } from "../git/inspect.ts";
import { branchSha, worktreeState } from "../git/integration.ts";
import { listIntegrationCandidates } from "../storage/candidates.ts";
import {
  finishIntegrationApplication,
  getIntegration,
  listIntegrations,
  startIntegrationApplication,
} from "../storage/integrations.ts";
import { mutate } from "../storage/mutations.ts";
import { integrationReviewBlocker } from "../storage/reviews.ts";
import { implementationLineage } from "../storage/revisions.ts";
import type { Engine } from "./engine.ts";

// Database-side preconditions; checked for the plan and again in the claim.
function eligibility(engine: Engine, preview: IntegrationPreview) {
  const { store } = engine;
  const reviewBlocker = integrationReviewBlocker(store, preview);
  if (reviewBlocker) return reviewBlocker;
  const lineage = implementationLineage(store, store.getTask(preview.taskId));
  const [implementation] = lineage;
  if (
    !implementation ||
    !(
      lineage.every((task) => task.status === "READY_TO_INTEGRATE") ||
      lineage.every((task) => task.status === "BLOCKED_CONFLICT")
    )
  )
    return "Only approved work that is ready to integrate, or blocked from it, can be applied";
  if (preview.status !== "passed" || preview.decision?.outcome !== "approved")
    return "Only an approved, passed integration preview can be applied";
  const candidate = listIntegrationCandidates(store, implementation.id).at(-1);
  if (
    candidate?.id !== preview.candidateId ||
    candidate.humanDecision !== "approved" ||
    preview.implementationTaskId !== implementation.id
  )
    return "This preview is not for the approved current candidate";
  if (
    listIntegrations(store, preview.taskId).findLast(
      (p) => p.decision?.outcome === "approved",
    )?.id !== preview.id
  )
    return "A newer approved preview exists; apply that one";
  return null;
}

// Read-only and recomputed for every request: what applying would do now, and
// why it cannot. The owner confirms this plan; the apply accepts only a match.
export async function planApplication(
  engine: Engine,
  integrationId: string,
): Promise<ApplyPlan> {
  const { store } = engine;
  const preview = getIntegration(store, integrationId);
  const run = store.getRun(preview.runId);
  const { destinationSha: expectedSha, resultSha } = preview;
  if (!expectedSha || !resultSha || !run.repository)
    throw new DomainError("CONFLICT", "This preview has no result to apply");
  const blockers: string[] = [];
  const repository = await inspectRepository(
    store.getProject(run.projectId).repositoryPath,
  );
  if (!sameRepository(run.repository, repository))
    throw new DomainError(
      "CONFLICT",
      "Repository identity changed or is unverified; reopen the project and start a new run",
    );
  const branch = preview.destinationBranch;
  let currentSha: string | null = null;
  try {
    currentSha = await branchSha(repository.root, branch);
  } catch (error) {
    if (!(error instanceof DomainError) || error.code === "GIT") throw error;
    blockers.push(`${branch} no longer exists`);
  }
  if (!(await commitExists(repository.root, resultSha)))
    blockers.push("The approved result commit is missing");
  else if (!(await isAncestor(repository.root, expectedSha, resultSha)))
    blockers.push(
      "The approved result does not fast-forward the approved destination commit",
    );
  const use = await destinationUse(repository.root, branch, engine.directory);
  blockers.push(...use.blockers);
  if (currentSha && currentSha !== expectedSha && currentSha !== resultSha)
    blockers.push(
      `${branch} moved to ${currentSha} since the approved preview at ${expectedSha}; prepare and approve a new preview`,
    );
  if (use.checkedOut && !repository.clean)
    blockers.push(
      `Your checkout ${repository.root} is on ${branch} and has uncommitted or untracked changes; commit or clean them yourself (the app never stashes or resets them)`,
    );
  const method: ApplyPlan["method"] =
    currentSha === resultSha
      ? "record_existing"
      : use.checkedOut
        ? "fast_forward_checkout"
        : "update_ref";
  const ineligible = eligibility(engine, getIntegration(store, preview.id));
  if (ineligible) blockers.push(ineligible);
  return {
    integrationId: preview.id,
    destinationBranch: branch,
    expectedSha,
    currentSha,
    resultSha,
    method,
    checkoutPath: use.checkedOut ? repository.root : null,
    commands: applyCommands(method, {
      id: preview.id,
      root: repository.root,
      branch,
      expectedSha,
      resultSha,
    }),
    blockers,
  };
}

// The result is whatever Git shows afterwards. A refusal that verifiably left
// the branch (and checkout) where they were is "blocked"; anything else is
// "interrupted" for the owner to inspect.
async function execute(
  repository: Repository,
  branch: string,
  application: IntegrationApplication,
) {
  const root = repository.root;
  const { expectedSha, resultSha, checkoutPath } = application;
  let refusal: string | null = null;
  let ran = false;
  try {
    if (!sameRepository(repository, await inspectRepository(root)))
      throw new DomainError(
        "CONFLICT",
        "Repository directories changed before applying; nothing was submitted",
      );
    // `git merge` fast-forwards whichever branch is checked out, so the
    // checkout is rechecked immediately before it runs.
    const before = checkoutPath ? await worktreeState(checkoutPath) : null;
    if (
      before &&
      (before.branch !== branch ||
        before.head !== expectedSha ||
        before.changed)
    )
      refusal = `your checkout changed just before applying (now ${before.branch} at ${before.head}, ${before.changed} changed paths), so no Git command ran`;
    else
      for (const command of application.commands) {
        ran = true;
        await git(command.cwd, command.args);
      }
  } catch (error) {
    refusal =
      error instanceof DomainError
        ? `Git refused the update (${error.message})`
        : `the update failed (${error instanceof Error ? error.name : "unknown error"})`;
  }
  try {
    if (!sameRepository(repository, await inspectRepository(root)))
      return {
        status: "interrupted" as const,
        observedSha: null,
        diagnostic:
          "Repository directories changed during application; inspect the retained state before any recovery decision",
      };
    const observedSha = await branchSha(root, branch);
    const after = checkoutPath ? await worktreeState(checkoutPath) : null;
    const at = (sha: string) =>
      observedSha === sha &&
      (!after || (after.branch === branch && after.head === sha));
    if (at(resultSha))
      return {
        status: "applied" as const,
        observedSha,
        diagnostic: after?.changed
          ? `Your checkout shows ${after.changed} changed paths after the fast-forward; inspect them`
          : null,
      };
    if (!ran || (refusal && at(expectedSha)))
      return {
        status: "blocked" as const,
        observedSha,
        diagnostic: `Nothing was applied: ${refusal ?? `${branch} no longer points at the approved result`}. ${branch} is at ${observedSha}.`,
      };
    return {
      status: "interrupted" as const,
      observedSha,
      diagnostic:
        `${branch} is at ${observedSha}${after ? `; your checkout is on ${after.branch} at ${after.head}` : ""}; the confirmed update was ${expectedSha} → ${resultSha}${refusal ? ` (${refusal})` : ""}`.slice(
          0,
          2000,
        ),
    };
  } catch (error) {
    return {
      status: "interrupted" as const,
      observedSha: null,
      diagnostic: `Git state could not be read after applying (${error instanceof Error ? error.name : "unknown error"})`,
    };
  }
}

// Owner-only. The claim (task INTEGRATING, application "applying") commits
// before Git runs; a replayed request returns the record and never reruns Git.
export async function applyIntegration(
  engine: Engine,
  actor: Actor,
  input: unknown,
  key: string,
) {
  if (actor.role !== "owner")
    throw new DomainError(
      "POLICY_DENIED",
      "Only the owner can apply an integration",
    );
  const data = applyRequestSchema.parse(input);
  const { store } = engine;
  const preview = getIntegration(store, data.integrationId);
  const run = store.getRun(preview.runId);
  if (run.mode === "chat_plan")
    throw new DomainError(
      "POLICY_DENIED",
      "Chat/Plan cannot mutate the managed repository",
    );
  if (engine.isStopping())
    throw new DomainError("CONFLICT", "The app is shutting down");
  const plan = await planApplication(engine, preview.id);
  const claim: { application?: IntegrationApplication } = {};
  const started = mutate(
    store.db,
    key,
    "applyIntegration",
    data,
    integrationPreviewSchema,
    () => {
      // Planning can outlive a mode change or shutdown. Check again at the
      // durable claim, with no await between policy and INTEGRATING.
      if (store.getRun(preview.runId).mode === "chat_plan")
        throw new DomainError(
          "POLICY_DENIED",
          "Chat/Plan cannot mutate the managed repository",
        );
      if (engine.isStopping())
        throw new DomainError("CONFLICT", "The app is shutting down");
      const current = getIntegration(store, preview.id);
      const ineligible = eligibility(engine, current);
      if (ineligible) throw new DomainError("CONFLICT", ineligible);
      if (plan.blockers.length)
        throw new DomainError("CONFLICT", plan.blockers.join("; "));
      const { confirm } = data;
      if (
        plan.method !== confirm.method ||
        plan.checkoutPath !== confirm.checkoutPath ||
        plan.expectedSha !== confirm.expectedSha ||
        plan.resultSha !== confirm.resultSha
      )
        throw new DomainError(
          "CONFLICT",
          "Git state changed since you reviewed the plan; review the new plan and confirm again",
        );
      claim.application = {
        id: randomUUID(),
        status: "applying",
        method: plan.method,
        checkoutPath: plan.checkoutPath,
        expectedSha: plan.expectedSha,
        resultSha: plan.resultSha,
        commands: plan.commands,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        observedSha: null,
        diagnostic: null,
      };
      return startIntegrationApplication(
        store,
        current,
        claim.application,
        key,
      );
    },
  );
  const { application } = claim;
  if (!application || !run.repository) return getIntegration(store, started.id);
  const outcome = await execute(
    run.repository,
    preview.destinationBranch,
    application,
  );
  return finishIntegrationApplication(
    store,
    preview.id,
    outcome,
    `${key}:finish`,
  );
}
