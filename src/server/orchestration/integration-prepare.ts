import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { artifactSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import type {
  IntegrationCheck,
  IntegrationPreview,
} from "../../shared/integration.ts";
import { inspectRepository } from "../git/inspect.ts";
import {
  addIntegrationWorktree,
  applyCandidate,
  branchSha,
  candidateBranchSha,
  destinationDrift,
  mergeCandidate,
  silentMergeDrivers,
  verifyIntegrationDiff,
  worktreeState,
} from "../git/integration.ts";
import { getIntegrationCandidate } from "../storage/candidates.ts";
import { getIntegration, saveIntegration } from "../storage/integrations.ts";
import { mutate } from "../storage/mutations.ts";
import type { Engine } from "./engine.ts";
import { runTestCommand } from "./test-command.ts";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

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

// Builds the preview in its own worktree at the recorded destination SHA. An
// unmoved destination is fast-forwarded to the reviewed candidate; a moved one
// gets a merge commit whose conflicts are recorded and left unresolved, never
// settled by choosing a side. Every worktree, branch and artifact is retained.
export async function prepareIntegration(
  engine: Engine,
  id: string,
  abort: AbortSignal,
) {
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
    status: boolean | "warning" | "skipped",
    detail: string,
  ) => {
    checks.push({
      name,
      status: status === true ? "passed" : status === false ? "failed" : status,
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
    const branch = preview.destinationBranch;
    const destinationSha = await branchSha(repository.root, branch);
    const drift =
      destinationSha === preview.baseSha
        ? null
        : await destinationDrift(repository.root, {
            baseSha: preview.baseSha,
            candidateSha: preview.candidateSha,
            destinationSha,
          });
    if (destinationSha !== preview.baseSha && !drift) {
      check(
        "destination",
        false,
        `${branch} at ${destinationSha} shares no history with the candidate base ${preview.baseSha}; nothing was applied`,
      );
      return finish("failed", null, { destinationSha });
    }
    check(
      "destination",
      drift ? "warning" : true,
      drift
        ? `${branch} moved from the candidate base ${preview.baseSha} to ${destinationSha}: ${count(drift.commits, "commit")}, ${count(drift.files.length, "file")}${drift.filesTruncated ? "+" : ""} changed${drift.baseIsAncestor ? "" : "; its history no longer contains the candidate base"}. The candidate is merged onto it; nothing on it is overwritten.`
        : `${branch} is at the candidate base ${destinationSha}`,
    );
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
      return finish("failed", null, { destinationSha, drift });
    // The destination SHA and worktree path are durable before Git runs, so a
    // crash leaves an inspectable claim that restart marks interrupted.
    save({ destinationSha, drift }, "integration.worktree_creating");
    await addIntegrationWorktree(repository, engine.directory, {
      id,
      path: preview.worktreePath,
      branch: preview.branch,
      startSha: destinationSha,
    });
    let resultSha: string;
    if (drift) {
      const title = store.getTask(preview.taskId).title.split("\n")[0] ?? "";
      const merged = await mergeCandidate(
        preview.worktreePath,
        preview.candidateSha,
        {
          message: `lao integration: ${title.slice(0, 60)}\n\nCandidate: ${preview.candidateSha}\nDestination: ${branch} @ ${destinationSha}\nIntegration: ${id}\n`,
          date: preview.createdAt,
        },
      );
      if (!merged.resultSha) {
        check(
          "apply",
          false,
          `Merge conflicts in ${merged.conflicts.join(", ")}; left unresolved in the integration worktree`,
        );
        check("tests", "skipped", "Not run because the merge conflicts");
        return conflict(merged.conflicts, destinationSha);
      }
      resultSha = merged.resultSha;
    } else
      resultSha = await applyCandidate(
        preview.worktreePath,
        preview.candidateSha,
      );
    const applied = await worktreeState(preview.worktreePath);
    check(
      "apply",
      (drift !== null || resultSha === preview.candidateSha) &&
        applied.head === resultSha &&
        applied.branch === preview.branch &&
        applied.changed === 0,
      `${drift ? `Merged the candidate into ${preview.branch} as ${resultSha} (parents ${destinationSha}, ${preview.candidateSha})` : `Fast-forwarded ${preview.branch} to ${resultSha}`}${applied.changed ? `; ${applied.changed} unexpected working-copy changes` : ""}`,
    );
    const overlapping = drift?.overlapping ?? [];
    const silent = await silentMergeDrivers(
      preview.worktreePath,
      [destinationSha, preview.candidateSha],
      overlapping,
    );
    check(
      "overlap",
      !overlapping.length ? true : silent.length ? false : "warning",
      !overlapping.length
        ? "No file was changed on both sides"
        : silent.length
          ? `A union or custom merge driver may have merged ${silent.join(", ")} without reporting a conflict; owner review required`
          : `Changed on both sides and merged by Git without conflict: ${overlapping.join(", ")}. Inspect these files in the diff.`,
    );
    const diff = await verifyIntegrationDiff(preview.worktreePath, {
      baseSha: preview.baseSha,
      candidateSha: preview.candidateSha,
      destinationSha,
      resultSha,
      mergeBase: drift?.mergeBase ?? preview.baseSha,
    });
    check(
      "diff",
      diff.files.length > 0 &&
        !diff.unreviewed.length &&
        !diff.altered.length &&
        !diff.sensitive.length,
      diff.sensitive.length
        ? `Secret-sensitive paths: ${diff.sensitive.join(", ")}`
        : diff.unreviewed.length
          ? `Integrated paths outside the reviewed candidate: ${diff.unreviewed.join(", ")}`
          : diff.altered.length
            ? `Candidate content changed outside overlapping files: ${diff.altered.join(", ")}`
            : diff.files.length
              ? `${count(diff.files.length, "changed file")}, all from the reviewed candidate`
              : "The destination already contains every candidate change; nothing to integrate",
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
    const finalSha = await branchSha(repository.root, branch);
    check(
      "final_destination",
      finalSha === destinationSha,
      finalSha === destinationSha
        ? `${branch} unchanged during preparation`
        : `${branch} moved to ${finalSha} during preparation`,
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

  // The conflict and its owner request are recorded together. The owner
  // resolves it; the engine never picks a side or retries the merge.
  function conflict(files: string[], destinationSha: string) {
    mutate(
      store.db,
      `integration:${id}:conflict`,
      "integrationConflict",
      { id, files },
      z.boolean(),
      () => {
        finish("conflict", null, { conflicts: files });
        store.createHumanRequest(
          {
            runId: preview.runId,
            affectedTaskIds: [preview.taskId],
            type: "manual_check",
            urgency: "high",
            reason:
              `Integration preview conflicts with ${preview.destinationBranch} at ${destinationSha} in ${files.join(", ")}`.slice(
                0,
                4000,
              ),
            suggestedAction: `Nothing was applied and no side was chosen. Inspect the conflicted integration worktree ${preview.worktreePath}, reconcile the destination branch or request a revision, then prepare a new preview.`,
            blocking: false,
          },
          `integration:${id}:conflict-request`,
        );
        return true;
      },
    );
  }
}
