import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { startApp } from "../src/server/app.ts";
import type { decideIntegration } from "../src/server/orchestration/integration.ts";
import { requestReview } from "../src/server/orchestration/review.ts";
import { requestRevision } from "../src/server/orchestration/revision.ts";
import {
  getIntegrationCandidate,
  listIntegrationCandidates,
} from "../src/server/storage/candidates.ts";
import {
  getIntegration,
  listIntegrations,
} from "../src/server/storage/integrations.ts";
import {
  artifactContentResponseSchema,
  candidateDiffResponseSchema,
  reviewHistoryResponseSchema,
} from "../src/shared/api.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { integrationPreviewSchema } from "../src/shared/integration.ts";
import {
  api,
  integrationBranches,
  node,
  owner,
  ownerCommit,
  reviewed,
} from "./helpers/integration-fixture.ts";

type Fixture = Awaited<ReturnType<typeof reviewed>>;
const reviewer = "00000000-0000-4000-8000-000000000012";
const denied = (code: DomainError["code"]) => (error: unknown) =>
  error instanceof DomainError && error.code === code;

async function preview(f: Fixture, key: string, tests: string[][] = []) {
  const { id } = f.engine.integrations.request(
    owner,
    { taskId: f.original.id, tests },
    key,
  );
  await f.engine.integrations.idle();
  return getIntegration(f.store, id);
}

const decide = (
  f: Fixture,
  integrationId: string,
  decision: "approve" | "decline",
  actor: Parameters<typeof decideIntegration>[1] = owner,
) =>
  f.engine.integrations.decide(
    actor,
    { integrationId, decision },
    randomUUID(),
  );

test("owner approval over HTTP records the verdict on one passed preview, moves the task to READY_TO_INTEGRATE and applies nothing", async () => {
  const f = await reviewed();
  try {
    await writeFile(join(f.repo.directory, "README.md"), "# Owner WIP\n");
    const ownerStatus = await f.repo.git("status", "--porcelain");
    const passed = await preview(f, "preview", [
      [node, "-e", "console.log('fixture tests ok')"],
    ]);
    assert.equal(passed.status, "passed");

    const history = reviewHistoryResponseSchema.parse(
      (await api(f, `reviews?taskId=${f.original.id}`)).value,
    );
    assert.equal(history.currentCandidateId, f.candidate.id);
    assert.deepEqual(
      history.reviews.map((r) => [
        r.review.recommendation,
        r.review.candidateId,
        r.reviewerProfileId,
      ]),
      [["pass", f.candidate.id, reviewer]],
    );
    const diff = candidateDiffResponseSchema.parse(
      (await api(f, `candidates/diff?candidateId=${f.candidate.id}`)).value,
    );
    assert.deepEqual(diff.files, [{ status: "M", path: "README.md" }]);
    assert.match(diff.patch, /^\+Protocol fixture result$/m);
    assert.equal(diff.truncated, false);
    const log = artifactContentResponseSchema.parse(
      (await api(f, `artifacts?id=${passed.testResults[0]?.artifactId}`)).value,
    );
    assert.match(log.content, /fixture tests ok/);

    const approval = {
      input: {
        integrationId: passed.id,
        decision: "approve",
        rationale: "Reviewed",
      },
      key: "approve",
    };
    const first = await api(f, "integrations/decision", approval);
    assert.equal(first.status, 200);
    const approved = integrationPreviewSchema.parse(first.value);
    assert.equal(approved.decision?.outcome, "approved");
    assert.equal(approved.decision?.rationale, "Reviewed");
    assert.deepEqual((await api(f, "integrations/decision", approval)).value, {
      ...approved,
    });
    const late = await api(f, "integrations/decision", {
      input: { integrationId: passed.id, decision: "decline" },
      key: "late-decline",
    });
    assert.equal(late.status, 409);

    assert.equal(f.store.getTask(f.original.id).status, "READY_TO_INTEGRATE");
    const candidate = getIntegrationCandidate(f.store, f.candidate.id);
    assert.deepEqual(
      [candidate.status, candidate.humanDecision],
      ["approved", "approved"],
    );
    assert.equal(
      f.store
        .events({ limit: 500 })
        .filter((e) => e.type === "integration.approved").length,
      1,
    );
    // Approval applies nothing: branches and the owner's dirty checkout are as before.
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      f.candidate.baseSha,
    );
    assert.equal(await f.repo.git("status", "--porcelain"), ownerStatus);
    assert.equal(
      await readFile(join(f.repo.directory, "README.md"), "utf8"),
      "# Owner WIP\n",
    );
    assert.equal(
      await f.repo.git("rev-parse", passed.branch),
      f.candidate.candidateSha,
    );

    const attempts = f.store.listAttempts().length;
    await f.app.close();
    const app = await startApp({
      development: false,
      port: 0,
      databasePath: join(f.data, "state.sqlite"),
    });
    try {
      assert.ok(app.engine);
      assert.deepEqual(getIntegration(app.engine.store, passed.id), approved);
      assert.equal(
        app.engine.store.getTask(f.original.id).status,
        "READY_TO_INTEGRATE",
      );
      assert.equal(app.engine.store.listAttempts().length, attempts);
    } finally {
      await app.close();
    }
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});

test("approval is owner-only, outside Chat/Plan, and refuses failed, re-reviewed, still-reviewing or stale previews without changing state", async () => {
  const f = await reviewed();
  try {
    const failed = await preview(f, "failed", [
      [node, "-e", "process.exit(4)"],
    ]);
    assert.equal(failed.status, "failed");
    await assert.rejects(decide(f, failed.id, "approve"), /Only a passed/);

    const passed = await preview(f, "passed");
    assert.equal(passed.status, "passed");
    for (const role of ["lead", "worker"] as const)
      for (const decision of ["approve", "decline"] as const)
        await assert.rejects(
          decide(f, passed.id, decision, { role, sessionId: randomUUID() }),
          denied("POLICY_DENIED"),
        );
    f.store.updateRun({ id: f.run.id, mode: "chat_plan" }, "chat");
    await assert.rejects(
      decide(f, passed.id, "approve"),
      denied("POLICY_DENIED"),
    );
    f.store.updateRun({ id: f.run.id, mode: f.run.mode }, "restore");

    requestReview(
      f.engine,
      owner,
      { taskId: f.original.id, profileId: reviewer },
      "second-review",
    );
    await assert.rejects(decide(f, passed.id, "approve"), /still in progress/);
    await f.engine.idle();
    await assert.rejects(decide(f, passed.id, "approve"), /newer review/);

    const current = await preview(f, "current");
    assert.equal(current.status, "passed");
    const moved = await ownerCommit(f.repo, "main", {
      "CHANGELOG.md": "owner\n",
    });
    await assert.rejects(
      decide(f, current.id, "approve"),
      new RegExp(`moved to ${moved}`),
    );

    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    const candidate = getIntegrationCandidate(f.store, f.candidate.id);
    assert.deepEqual(
      [candidate.status, candidate.humanDecision],
      ["reviewed", null],
    );
    assert.ok(
      listIntegrations(f.store, f.original.id).every((p) => !p.decision),
    );
    assert.ok(
      !f.store
        .events({ limit: 500 })
        .some((e) => e.type === "integration.approved"),
    );
  } finally {
    await f.app.close();
  }
});

test("declining rejects the candidate but keeps the task open; a revision's new candidate is then approved across the lineage", async () => {
  const f = await reviewed();
  try {
    const first = await preview(f, "first");
    assert.equal(first.status, "passed");
    // Saying no never needs Chat/Plan to be lifted.
    f.store.updateRun({ id: f.run.id, mode: "chat_plan" }, "chat");
    const declined = await decide(f, first.id, "decline");
    f.store.updateRun({ id: f.run.id, mode: f.run.mode }, "restore");
    assert.equal(declined.decision?.outcome, "declined");
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.deepEqual(
      [
        getIntegrationCandidate(f.store, f.candidate.id).status,
        getIntegrationCandidate(f.store, f.candidate.id).humanDecision,
      ],
      ["rejected", "rejected"],
    );
    assert.throws(
      () =>
        f.engine.integrations.request(
          owner,
          { taskId: f.original.id },
          "again",
        ),
      /declined this candidate/,
    );
    await assert.rejects(
      decide(f, first.id, "approve"),
      /already has an owner decision/,
    );
    assert.ok(existsSync(first.worktreePath));
    assert.equal(await integrationBranches(f.repo), first.branch);

    const { revisionTaskId } = z
      .object({ revisionTaskId: z.string() })
      .parse(
        requestRevision(
          f.engine,
          owner,
          { taskId: f.original.id, feedback: "Rework after decline" },
          "revise",
        ),
      );
    await f.engine.idle();
    const [revised] = listIntegrationCandidates(f.store, revisionTaskId);
    assert.ok(revised);
    await assert.rejects(decide(f, first.id, "approve"), /earlier candidate/);
    requestReview(
      f.engine,
      owner,
      { taskId: f.original.id, profileId: reviewer },
      "review-revision",
    );
    await f.engine.idle();
    const history = reviewHistoryResponseSchema.parse(
      (await api(f, `reviews?taskId=${f.original.id}`)).value,
    );
    assert.equal(history.currentCandidateId, revised.id);
    assert.deepEqual(
      history.reviews.map((r) => r.review.candidateId),
      [f.candidate.id, revised.id],
    );

    const second = await preview(f, "second");
    assert.equal(second.status, "passed");
    assert.equal(second.candidateId, revised.id);
    await decide(f, second.id, "approve");
    assert.deepEqual(
      [f.original.id, revisionTaskId].map((id) => f.store.getTask(id).status),
      ["READY_TO_INTEGRATE", "READY_TO_INTEGRATE"],
    );
    assert.equal(
      getIntegrationCandidate(f.store, f.candidate.id).status,
      "rejected",
    );
    assert.equal(
      getIntegrationCandidate(f.store, revised.id).status,
      "approved",
    );

    f.engine.cancel(f.original.id, "cancel");
    assert.deepEqual(
      [f.original.id, revisionTaskId].map((id) => f.store.getTask(id).status),
      ["CANCELLED", "CANCELLED"],
    );
  } finally {
    await f.app.close();
  }
});
