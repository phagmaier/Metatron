import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  destinationBranchSchema,
  type IntegrationCheck,
  type IntegrationPreview,
  integrationPreviewSchema,
  integrationRequestSchema,
} from "../../shared/integration.ts";
import type { Actor } from "../../shared/orchestration.ts";
import { inspectRepository } from "../git/inspect.ts";
import {
  addIntegrationWorktree,
  applyCandidate,
  branchSha,
  candidateBranchSha,
  verifyIntegrationDiff,
  worktreeState,
} from "../git/integration.ts";
import {
  getIntegrationCandidate,
  listIntegrationCandidates,
} from "../storage/candidates.ts";
import {
  getIntegration,
  insertIntegration,
  listIntegrations,
  saveIntegration,
} from "../storage/integrations.ts";
import { mutate } from "../storage/mutations.ts";
import { listReviews } from "../storage/reviews.ts";
import { implementationTask, revisionAncestors } from "../storage/revisions.ts";
import type { Engine } from "./engine.ts";
import { runTestCommand } from "./test-command.ts";

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

async function saveArtifact(
  engine: Engine,
  preview: IntegrationPreview,
  name: string,
  kind: "log" | "reference",
  summary: string,
  content: string,
) {
  const path = join(
    engine.directory,
    "artifacts",
    `integration-${preview.id}-${name}`,
  );
  await mkdir(join(engine.directory, "artifacts"), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(path, content, { flag: "wx", mode: 0o600 });
  const now = new Date().toISOString();
  const artifact = artifactSchema.parse({
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    taskId: preview.taskId,
    attemptId: null,
    kind,
    path,
    mediaType: "text/plain",
    summary,
  });
  engine.store.db
    .prepare("INSERT INTO artifacts VALUES (?,?,?,?)")
    .run(artifact.id, artifact.taskId, null, JSON.stringify(artifact));
  return artifact.id;
}

// Builds the preview in its own worktree at the recorded destination SHA and
// fast-forwards it to the reviewed candidate. A moved destination fails before
// any Git mutation (drift/conflict merging is not attempted here). Every
// worktree, branch and artifact is retained whatever the outcome.
async function prepare(engine: Engine, id: string, abort: AbortSignal) {
  const { store } = engine;
  let preview = getIntegration(store, id);
  const checks: IntegrationCheck[] = [];
  let phase = 0;
  const save = (changes: Partial<IntegrationPreview>, type: string) => {
    preview = saveIntegration(
      store,
      { ...preview, ...changes, checks: [...checks] },
      type,
      `integration:${id}:${++phase}`,
    );
  };
  const check = (
    name: IntegrationCheck["name"],
    status: boolean | "skipped",
    detail: string,
  ) => {
    checks.push({
      name,
      status: status === "skipped" ? status : status ? "passed" : "failed",
      detail: detail.slice(0, 2000),
    });
    return status !== false;
  };
  const finish = (
    status: IntegrationPreview["status"],
    diagnostic: string | null = null,
    changes: Partial<IntegrationPreview> = {},
  ) => save({ ...changes, status, diagnostic }, `integration.${status}`);
  try {
    const run = store.getRun(preview.runId);
    const repository = await inspectRepository(
      store.getProject(run.projectId).repositoryPath,
    );
    if (
      !run.repository ||
      repository.root !== run.repository.root ||
      repository.commonDirectory !== run.repository.commonDirectory
    )
      throw new DomainError(
        "CONFLICT",
        "Repository identity changed; reopen the project",
      );
    const destinationSha = await branchSha(
      repository.root,
      preview.destinationBranch,
    );
    if (
      !check(
        "destination",
        destinationSha === preview.baseSha,
        destinationSha === preview.baseSha
          ? `${preview.destinationBranch} is at the candidate base ${destinationSha}`
          : `${preview.destinationBranch} moved from the candidate base ${preview.baseSha} to ${destinationSha}; nothing was applied`,
      )
    )
      return finish("failed", null, { destinationSha });
    const candidateSha = await candidateBranchSha(
      repository.root,
      getIntegrationCandidate(store, preview.candidateId).attemptId,
    );
    if (
      !check(
        "candidate",
        candidateSha === preview.candidateSha,
        candidateSha === preview.candidateSha
          ? `Candidate branch still records ${candidateSha}`
          : "Candidate branch no longer matches its record; owner review required",
      )
    )
      return finish("failed");
    // The destination SHA and worktree path are durable before Git runs, so a
    // crash leaves an inspectable claim that restart marks interrupted.
    save({ destinationSha }, "integration.worktree_creating");
    await addIntegrationWorktree(repository, engine.directory, {
      id,
      path: preview.worktreePath,
      branch: preview.branch,
      startSha: destinationSha,
    });
    const resultSha = await applyCandidate(
      preview.worktreePath,
      preview.candidateSha,
    );
    const applied = await worktreeState(preview.worktreePath);
    check(
      "apply",
      resultSha === preview.candidateSha &&
        applied.branch === preview.branch &&
        applied.changed === 0,
      `Fast-forwarded ${preview.branch} to ${resultSha}${applied.changed ? `; ${applied.changed} unexpected working-copy changes` : ""}`,
    );
    const diff = await verifyIntegrationDiff(preview.worktreePath, {
      baseSha: preview.baseSha,
      candidateSha: preview.candidateSha,
      destinationSha,
      resultSha,
    });
    check(
      "diff",
      diff.matchesCandidate && diff.files.length > 0 && !diff.sensitive.length,
      diff.sensitive.length
        ? `Secret-sensitive paths: ${diff.sensitive.join(", ")}`
        : diff.matchesCandidate
          ? `${diff.files.length} changed files, identical to the reviewed candidate`
          : "Integrated files differ from the reviewed candidate",
    );
    check(
      "diff_check",
      diff.diffCheck,
      diff.diffCheck
        ? "git diff --check passed"
        : "git diff --check found whitespace errors or conflict markers",
    );
    const diffArtifactId = await saveArtifact(
      engine,
      preview,
      "diff.patch",
      "reference",
      `Integration diff ${destinationSha.slice(0, 12)}..${resultSha.slice(0, 12)}`,
      diff.patch,
    );
    save(
      { resultSha, files: diff.files, diffArtifactId },
      "integration.applied",
    );
    if (checks.some((c) => c.status === "failed")) {
      check("tests", "skipped", "Not run because an earlier check failed");
      return finish("failed");
    }
    const testResults: IntegrationPreview["testResults"] = [];
    for (const [index, argv] of preview.tests.entries()) {
      const result = await runTestCommand(
        argv,
        preview.worktreePath,
        preview.timeoutSeconds * 1000,
        abort,
      );
      const artifactId = await saveArtifact(
        engine,
        preview,
        `test-${index + 1}.log`,
        "log",
        `Integration test ${index + 1}: ${argv.join(" ").slice(0, 200)}`,
        `$ ${argv.join(" ")}\n${result.truncated ? "[earlier output truncated]\n" : ""}${result.output}`,
      );
      testResults.push({
        argv,
        result: result.aborted
          ? "interrupted"
          : result.timedOut
            ? "timed_out"
            : result.spawnError
              ? "error"
              : result.exitCode === 0
                ? "passed"
                : "failed",
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        artifactId,
        outputTruncated: result.truncated,
      });
      save({ testResults: [...testResults] }, "integration.test_finished");
      if (result.aborted)
        return finish(
          "interrupted",
          "App shut down during integration tests; request a new preview",
        );
    }
    const after = await worktreeState(preview.worktreePath);
    const passed = testResults.filter((t) => t.result === "passed").length;
    check(
      "tests",
      !preview.tests.length
        ? "skipped"
        : passed === testResults.length &&
            after.head === resultSha &&
            after.branch === preview.branch,
      !preview.tests.length
        ? "No tests declared"
        : after.head !== resultSha || after.branch !== preview.branch
          ? "Tests moved the integration HEAD or branch"
          : `${passed}/${testResults.length} declared commands passed${after.changed ? `; tests left ${after.changed} changed paths in the scratch worktree (the verified result is commit ${resultSha})` : ""}`,
    );
    const finalSha = await branchSha(
      repository.root,
      preview.destinationBranch,
    );
    check(
      "final_destination",
      finalSha === destinationSha,
      finalSha === destinationSha
        ? `${preview.destinationBranch} unchanged during preparation`
        : `${preview.destinationBranch} moved to ${finalSha} during preparation`,
    );
    return finish(
      checks.some((c) => c.status === "failed") ? "failed" : "passed",
    );
  } catch (error) {
    // Filesystem/process failures must not leave a preview stuck preparing.
    return finish(
      "failed",
      error instanceof DomainError
        ? error.message
        : `Integration preparation failed (${error instanceof Error ? error.name : "unknown error"}); retained for inspection`,
    );
  }
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
      const done = prepare(this.engine, preview.id, abort.signal)
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
