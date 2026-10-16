import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { startApp } from "../src/server/app.ts";
import {
  artifactContentResponseSchema,
  candidateDiffResponseSchema,
  reviewHistoryResponseSchema,
} from "../src/shared/api.ts";
import {
  type ApplyPlan,
  applyPlanSchema,
  integrationPreviewSchema,
} from "../src/shared/integration.ts";
import { api, node, ownerCommit } from "./helpers/integration-fixture.ts";
import { reviewFixture } from "./helpers/review-fixture.ts";

type Fixture = Awaited<ReturnType<typeof reviewFixture>>;
const historySchema = z.array(integrationPreviewSchema);
const confirmation = (plan: ApplyPlan) => ({
  integrationId: plan.integrationId,
  confirm: {
    method: plan.method,
    expectedSha: plan.expectedSha,
    resultSha: plan.resultSha,
    checkoutPath: plan.checkoutPath,
  },
});

// Only the native protocol is simulated: Git, SQLite, processes and the owner
// HTTP boundary are real. Failed verification retains its disposable repo.
async function workflow(check: (f: Fixture) => Promise<void>) {
  const f = await reviewFixture();
  await f.repo.verify(async () => {
    try {
      await check(f);
    } finally {
      if (f.store.db.isOpen) await f.app.close();
    }
  });
}

async function review(f: Fixture) {
  assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
  assert.equal(f.candidate.reportSubmitted, true);
  const premature = await api(f, "tasks/integration", {
    input: { taskId: f.original.id },
    key: "before-review",
  });
  assert.equal(premature.status, 409);
  assert.equal(
    historySchema.parse(
      (await api(f, `integrations?taskId=${f.original.id}`)).value,
    ).length,
    0,
  );

  assert.equal(
    (
      await api(f, "tasks/review", {
        input: {
          taskId: f.original.id,
          profileId: "00000000-0000-4000-8000-000000000012",
        },
        key: "review",
      })
    ).status,
    200,
  );
  await f.engine.idle();
  const history = reviewHistoryResponseSchema.parse(
    (await api(f, `reviews?taskId=${f.original.id}`)).value,
  );
  assert.equal(history.currentCandidateId, f.candidate.id);
  assert.equal(history.reviews.length, 1);
  const result = history.reviews[0]?.review;
  assert.ok(result);
  assert.equal(result.recommendation, "pass");
  assert.equal(result.candidateId, f.candidate.id);
  assert.notEqual(result.reviewerAttemptId, f.candidate.attemptId);
  const attempts = f.store.listAttempts();
  const writer = attempts.find((a) => a.id === f.candidate.attemptId);
  const reviewer = attempts.find((a) => a.id === result.reviewerAttemptId);
  assert.ok(writer?.worktreePath);
  assert.ok(reviewer?.worktreePath);
  assert.notEqual(reviewer.taskId, writer.taskId);
  assert.notEqual(reviewer.worktreePath, writer.worktreePath);
  assert.equal(
    await f.repo.git("-C", reviewer.worktreePath, "rev-parse", "HEAD"),
    f.candidate.candidateSha,
  );
  assert.equal(await f.repo.git("rev-parse", "main"), f.candidate.baseSha);
  assert.equal(await f.repo.git("status", "--porcelain"), "");
  return result;
}

async function preview(f: Fixture, tests: string[][]) {
  const requested = await api(f, "tasks/integration", {
    input: { taskId: f.original.id, destinationBranch: "main", tests },
    key: "preview",
  });
  assert.equal(requested.status, 200);
  const pending = integrationPreviewSchema.parse(requested.value);
  await f.engine.integrations.idle();
  const saved = historySchema
    .parse((await api(f, `integrations?taskId=${f.original.id}`)).value)
    .find((p) => p.id === pending.id);
  assert.ok(saved);
  return saved;
}

async function approve(f: Fixture, integrationId: string) {
  const response = await api(f, "integrations/decision", {
    input: { integrationId, decision: "approve" },
    key: "approve",
  });
  assert.equal(response.status, 200);
  const approved = integrationPreviewSchema.parse(response.value);
  assert.equal(approved.decision?.outcome, "approved");
  assert.deepEqual(approved.applications, []);
  assert.equal(f.store.getTask(f.original.id).status, "READY_TO_INTEGRATE");
  return approved;
}

for (const merge of [false, true]) {
  test(`M5 Git fixture: ${merge ? "clean three-way merge preserves the owner's commit" : "successful approved integration fast-forwards main"} through review, preview and explicit confirmation`, async () => {
    await workflow(async (f) => {
      const independent = await review(f);
      const destination = merge
        ? await ownerCommit(f.repo, "main", {
            "OWNER.md": "Owner change after dispatch\n",
          })
        : f.candidate.baseSha;
      const testScript = [
        "const a = require('node:assert/strict'); const fs = require('node:fs');",
        "a.equal(fs.readFileSync('README.md', 'utf8'), 'Protocol fixture result\\n');",
        ...(merge
          ? [
              "a.equal(fs.readFileSync('OWNER.md', 'utf8'), 'Owner change after dispatch\\n');",
            ]
          : []),
      ].join("\n");
      const prepared = await preview(f, [[node, "-e", testScript]]);
      assert.equal(prepared.status, "passed");
      assert.equal(prepared.reviewId, independent.id);
      assert.equal(prepared.candidateId, f.candidate.id);
      assert.equal(prepared.destinationSha, destination);
      assert.ok(prepared.resultSha);
      assert.notEqual(prepared.worktreePath, f.repo.directory);
      assert.deepEqual(
        prepared.testResults.map((r) => [r.result, r.exitCode]),
        [["passed", 0]],
      );
      assert.ok(
        prepared.checks.some(
          (c) => c.name === "diff_check" && c.status === "passed",
        ),
      );
      assert.equal(
        await f.repo.git("-C", prepared.worktreePath, "status", "--porcelain"),
        "",
      );
      if (merge) {
        assert.equal(prepared.drift?.commits, 1);
        assert.deepEqual(prepared.drift?.overlapping, []);
        assert.equal(
          await f.repo.git(
            "rev-list",
            "--parents",
            "-n",
            "1",
            prepared.resultSha,
          ),
          `${prepared.resultSha} ${destination} ${f.candidate.candidateSha}`,
        );
      } else {
        assert.equal(prepared.drift, null);
        assert.equal(prepared.resultSha, f.candidate.candidateSha);
      }
      assert.ok(prepared.diffArtifactId);
      const diff = artifactContentResponseSchema.parse(
        (await api(f, `artifacts?id=${prepared.diffArtifactId}`)).value,
      );
      assert.equal(diff.truncated, false);
      assert.match(diff.content, /^\+Protocol fixture result$/m);
      const candidateDiff = candidateDiffResponseSchema.parse(
        (await api(f, `candidates/diff?candidateId=${f.candidate.id}`)).value,
      );
      assert.equal(candidateDiff.candidateSha, prepared.candidateSha);

      const unapproved = applyPlanSchema.parse(
        (await api(f, `integrations/plan?integrationId=${prepared.id}`)).value,
      );
      assert.ok(unapproved.blockers.length > 0);
      assert.equal(
        (
          await api(f, "integrations/apply", {
            input: confirmation(unapproved),
            key: "before-approval",
          })
        ).status,
        409,
      );
      assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
      await approve(f, prepared.id);
      assert.equal(await f.repo.git("rev-parse", "main"), destination);
      assert.equal(await f.repo.git("status", "--porcelain"), "");
      const shown = applyPlanSchema.parse(
        (await api(f, `integrations/plan?integrationId=${prepared.id}`)).value,
      );
      assert.deepEqual(
        [shown.method, shown.expectedSha, shown.resultSha, shown.blockers],
        ["fast_forward_checkout", destination, prepared.resultSha, []],
      );
      assert.equal(shown.checkoutPath, f.repo.directory);
      assert.equal(shown.commands.length, 1);
      assert.ok(shown.commands[0]?.args.includes("--ff-only"));
      assert.equal(
        (
          await api(f, "integrations/apply", {
            input: { integrationId: prepared.id },
            key: "missing-confirmation",
          })
        ).status,
        400,
      );
      assert.equal(await f.repo.git("rev-parse", "main"), destination);

      const confirmed = confirmation(shown);
      assert.equal(
        (
          await api(f, "integrations/apply", {
            input: {
              ...confirmed,
              confirm: { ...confirmed.confirm, resultSha: destination },
            },
            key: "mismatched-confirmation",
          })
        ).status,
        409,
      );
      assert.equal(await f.repo.git("rev-parse", "main"), destination);

      const request = { input: confirmed, key: "confirm-apply" };
      const response = await api(f, "integrations/apply", request);
      assert.equal(response.status, 200);
      const applied = integrationPreviewSchema.parse(response.value);
      assert.deepEqual(
        applied.applications.map((a) => [a.status, a.observedSha, a.commands]),
        [["applied", prepared.resultSha, shown.commands]],
      );
      assert.deepEqual(
        (await api(f, "integrations/apply", request)).value,
        applied,
      );
      assert.equal(f.store.getTask(f.original.id).status, "DONE");
      assert.equal(await f.repo.git("rev-parse", "main"), prepared.resultSha);
      assert.equal(await f.repo.git("branch", "--show-current"), "main");
      assert.equal(await f.repo.git("status", "--porcelain"), "");
      assert.equal(
        await readFile(join(f.repo.directory, "README.md"), "utf8"),
        "Protocol fixture result\n",
      );
      if (merge)
        assert.equal(
          await readFile(join(f.repo.directory, "OWNER.md"), "utf8"),
          "Owner change after dispatch\n",
        );
      const history = reviewHistoryResponseSchema.parse(
        (await api(f, `reviews?taskId=${f.original.id}`)).value,
      );
      assert.equal(history.candidates[0]?.status, "integrated");
      assert.deepEqual(history.reviews[0]?.review, independent);
      assert.equal(
        await f.repo.git("rev-parse", `lao/candidate-${f.candidate.attemptId}`),
        f.candidate.candidateSha,
      );

      const attempts = f.store.listAttempts();
      const events = f.store.events({ limit: 500 });
      assert.equal(
        events.filter((e) => e.type === "integration.application_started")
          .length,
        1,
      );
      await f.app.close();
      const restarted = await startApp({
        development: false,
        port: 0,
        databasePath: join(f.data, "state.sqlite"),
      });
      try {
        const restored = historySchema.parse(
          (
            await api(
              { ...f, app: restarted },
              `integrations?taskId=${f.original.id}`,
            )
          ).value,
        );
        assert.deepEqual(restored, [applied]);
        assert.ok(restarted.engine);
        assert.equal(
          restarted.engine.store.getTask(f.original.id).status,
          "DONE",
        );
        assert.deepEqual(restarted.engine.store.listAttempts(), attempts);
        assert.deepEqual(restarted.engine.store.events({ limit: 500 }), events);
        assert.equal(await f.repo.git("rev-parse", "main"), prepared.resultSha);
      } finally {
        await restarted.close();
      }
    });
  });
}

test("M5 Git fixture: overlapping edits retain a conflict and refuse owner approval/application without changing main", async () => {
  await workflow(async (f) => {
    await review(f);
    const destination = await ownerCommit(f.repo, "main", {
      "README.md": "# Owner heading\n",
    });
    const marker = join(f.data, "conflict-tests-ran");
    const conflicted = await preview(f, [
      [
        node,
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
      ],
    ]);
    assert.equal(conflicted.status, "conflict");
    assert.deepEqual(conflicted.conflicts, ["README.md"]);
    assert.deepEqual(conflicted.drift?.overlapping, ["README.md"]);
    assert.deepEqual(conflicted.testResults, []);
    assert.equal(existsSync(marker), false);
    assert.equal(
      await f.repo.git(
        "-C",
        conflicted.worktreePath,
        "diff",
        "--name-only",
        "--diff-filter=U",
      ),
      "README.md",
    );
    assert.equal(
      (
        await api(f, "integrations/decision", {
          input: { integrationId: conflicted.id, decision: "approve" },
          key: "approve-conflict",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await api(f, "integrations/apply", {
          input: confirmation({
            integrationId: conflicted.id,
            destinationBranch: "main",
            method: "fast_forward_checkout",
            checkoutPath: f.repo.directory,
            expectedSha: destination,
            currentSha: destination,
            resultSha: f.candidate.candidateSha,
            commands: [],
            blockers: [],
          }),
          key: "apply-conflict",
        })
      ).status,
      409,
    );
    assert.equal(await f.repo.git("rev-parse", "main"), destination);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    assert.equal(
      await readFile(join(f.repo.directory, "README.md"), "utf8"),
      "# Owner heading\n",
    );
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.deepEqual(
      historySchema.parse(
        (await api(f, `integrations?taskId=${f.original.id}`)).value,
      ),
      [conflicted],
    );
    assert.ok(
      f.store
        .listHumanRequests()
        .some((r) => r.affectedTaskIds.includes(f.original.id)),
    );
  });
});

test("M5 Git fixture: dirty main after a clean apply plan preserves staged, unstaged and untracked owner work", async () => {
  await workflow(async (f) => {
    await review(f);
    const prepared = await preview(f, []);
    const approved = await approve(f, prepared.id);
    const shown = applyPlanSchema.parse(
      (await api(f, `integrations/plan?integrationId=${prepared.id}`)).value,
    );
    assert.deepEqual(shown.blockers, []);
    await writeFile(join(f.repo.directory, "README.md"), "# Owner staged\n");
    await f.repo.git("add", "--", "README.md");
    await writeFile(join(f.repo.directory, "README.md"), "# Owner unstaged\n");
    await writeFile(
      join(f.repo.directory, "notes.txt"),
      "Untracked owner notes\n",
    );
    const snapshot = async () => ({
      head: await f.repo.git("rev-parse", "HEAD"),
      branch: await f.repo.git("branch", "--show-current"),
      status: await f.repo.git("status", "--porcelain"),
      staged: await f.repo.git("diff", "--cached", "--binary"),
      unstaged: await f.repo.git("diff", "--binary"),
      stash: await f.repo.git("for-each-ref", "refs/stash"),
      notes: await readFile(join(f.repo.directory, "notes.txt"), "utf8"),
    });
    const dirty = await snapshot();
    assert.match(dirty.status, /MM README.md/);
    assert.match(dirty.status, /\?\? notes.txt/);
    const blocked = applyPlanSchema.parse(
      (await api(f, `integrations/plan?integrationId=${prepared.id}`)).value,
    );
    assert.ok(blocked.blockers.length > 0);
    assert.equal(
      (
        await api(f, "integrations/apply", {
          input: confirmation(shown),
          key: "confirm-stale-clean-plan",
        })
      ).status,
      409,
    );
    assert.deepEqual(await snapshot(), dirty);
    assert.equal(await f.repo.git("rev-parse", "main"), f.candidate.baseSha);
    assert.equal(f.store.getTask(f.original.id).status, "READY_TO_INTEGRATE");
    assert.deepEqual(
      historySchema.parse(
        (await api(f, `integrations?taskId=${f.original.id}`)).value,
      ),
      [approved],
    );
    assert.equal(
      f.store
        .events({ limit: 500 })
        .filter((e) => e.type === "integration.application_started").length,
      0,
    );
  });
});
