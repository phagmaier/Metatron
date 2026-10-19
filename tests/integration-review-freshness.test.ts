import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import {
  decideRecovery,
  recheckRecovery,
} from "../src/server/orchestration/recovery-decisions.ts";
import { requestRevision } from "../src/server/orchestration/revision.ts";
import { getIntegrationCandidate } from "../src/server/storage/candidates.ts";
import { getIntegration } from "../src/server/storage/integrations.ts";
import { listReviews } from "../src/server/storage/reviews.ts";
import type { ApplyPlan } from "../src/shared/integration.ts";
import {
  approvedPreview,
  owner,
  reviewed,
} from "./helpers/integration-fixture.ts";
import { findingsReview } from "./helpers/review-result.ts";

type Fixture = Awaited<ReturnType<typeof reviewed>>;
const confirm = (plan: ApplyPlan) => ({
  integrationId: plan.integrationId,
  confirm: {
    method: plan.method,
    checkoutPath: plan.checkoutPath,
    expectedSha: plan.expectedSha,
    resultSha: plan.resultSha,
  },
});

async function deferredReview(f: Fixture) {
  const preview = f.engine.integrations.request(
    owner,
    { taskId: f.original.id },
    "preview",
  );
  await f.engine.integrations.idle();
  assert.equal(getIntegration(f.store, preview.id).status, "passed");
  f.store.db.exec(
    "CREATE TRIGGER fail_review BEFORE INSERT ON events WHEN NEW.type='review.saved' BEGIN SELECT RAISE(ABORT, 'review journal fixture failure'); END;",
  );
  const reviewer = f.request("second-review");
  await f.engine.idle();
  assert.equal(f.store.getTask(reviewer.id).status, "RETRY_DECISION");
  f.store.db.exec("DROP TRIGGER fail_review");
  const approved = await f.engine.integrations.decide(
    owner,
    { integrationId: preview.id, decision: "approve" },
    "approve",
  );
  const shown = await f.engine.integrations.plan(approved.id);
  assert.deepEqual(shown.blockers, []);
  const retry = async () => {
    const check = await recheckRecovery(
      f.engine,
      { taskId: reviewer.id },
      "recheck-review",
    );
    return decideRecovery(
      f.engine,
      {
        taskId: reviewer.id,
        checkId: check.id,
        profileId: reviewer.assignedProfileId,
        contextPolicy: "fresh",
        acceptUnverified: true,
      },
      "retry-review",
    );
  };
  return { approved, shown, reviewer, retry };
}

async function unchanged(f: Fixture, integrationId: string) {
  assert.deepEqual(getIntegration(f.store, integrationId).applications, []);
  assert.ok(
    !f.store
      .events({ limit: 500 })
      .some((event) => event.type === "integration.application_started"),
  );
  assert.equal(await f.repo.git("rev-parse", "HEAD"), f.candidate.baseSha);
  assert.equal(await f.repo.git("status", "--porcelain"), "");
}

test("recovered important findings block stale approval before claim or Git, with a usable revision path", async (context) => {
  const f = await reviewed();
  try {
    const { approved, shown, reviewer, retry } = await deferredReview(f);
    const firstReview = listReviews(f.store, f.original.id)[0];
    const tool = f.engine.tool.bind(f.engine);
    const result = context.mock.method(
      f.engine,
      "tool",
      (...args: Parameters<typeof tool>) => {
        const [actor, runId, input, key] = args;
        const submission = z
          .object({ name: z.string(), taskId: z.string().optional() })
          .parse(input);
        return tool(
          actor,
          runId,
          submission.name === "submit_result" &&
            submission.taskId === reviewer.id
            ? { ...submission, report: findingsReview }
            : input,
          key,
        );
      },
    );
    await retry();
    await f.engine.idle();
    result.mock.restore();
    const reviews = listReviews(f.store, f.original.id);
    assert.deepEqual(
      reviews.map((review) => review.recommendation),
      ["pass", "changes_requested"],
    );
    assert.deepEqual(reviews[0], firstReview);
    assert.notEqual(reviews[1]?.id, approved.reviewId);
    // Both the freshly fetched plan and a previously displayed confirmation
    // must refuse; checking storage alone would miss the original defect.
    const current = await f.engine.integrations.plan(approved.id);
    const application = f.engine.integrations.apply(
      owner,
      confirm(shown),
      "stale-apply",
    );
    await assert.rejects(application, { code: "CONFLICT" });
    assert.match(current.blockers.join("; "), /review/i);
    await unchanged(f, approved.id);
    assert.deepEqual(getIntegration(f.store, approved.id), approved);
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.throws(
      () =>
        f.engine.integrations.request(
          owner,
          { taskId: f.original.id },
          "findings-preview",
        ),
      { code: "CONFLICT" },
    );

    const revision = z.object({ revisionTaskId: z.string() }).parse(
      requestRevision(
        f.engine,
        owner,
        {
          taskId: f.original.id,
          feedback: "Restore the heading identified by the independent review",
        },
        "revision",
      ),
    );
    await f.engine.idle();
    f.request("review-revision");
    await f.engine.idle();
    const fresh = await approvedPreview(f, "revised-preview");
    assert.notEqual(fresh.candidateId, approved.candidateId);
    f.request("re-review-revision");
    await f.engine.idle();
    assert.deepEqual(
      [f.original.id, revision.revisionTaskId].map(
        (id) => f.store.getTask(id).status,
      ),
      ["AWAITING_REVIEW", "AWAITING_REVIEW"],
    );
    assert.deepEqual(getIntegration(f.store, fresh.id), fresh);
    const currentPreview = await approvedPreview(f, "current-revised-preview");
    const plan = await f.engine.integrations.plan(currentPreview.id);
    assert.deepEqual(plan.blockers, []);
    await f.engine.integrations.apply(owner, confirm(plan), "revised-apply");
    assert.equal(f.store.getTask(f.original.id).status, "DONE");
    assert.equal(f.store.getTask(revision.revisionTaskId).status, "DONE");
    assert.deepEqual(listReviews(f.store, f.original.id), reviews);
    assert.deepEqual(getIntegration(f.store, approved.id), approved);
    assert.ok(existsSync(approved.worktreePath));
  } finally {
    await f.app.close();
  }
});

test("a newer passing review needs its own preview and owner decision; previous decisions and replay survive", async () => {
  const f = await reviewed();
  try {
    const approved = await approvedPreview(f, "preview");
    const shown = await f.engine.integrations.plan(approved.id);
    f.request("owner-re-review");
    await f.engine.idle();
    const latest = listReviews(f.store, f.original.id).at(-1);
    assert.ok(latest && latest.id !== approved.reviewId);
    assert.equal(latest.recommendation, "pass");
    await assert.rejects(
      f.engine.integrations.apply(owner, confirm(shown), "old-apply"),
      { code: "CONFLICT" },
    );
    await unchanged(f, approved.id);
    const fresh = f.engine.integrations.request(
      owner,
      { taskId: f.original.id },
      "fresh-preview",
    );
    await f.engine.integrations.idle();
    assert.equal(fresh.reviewId, latest.id);
    const unapproved = await f.engine.integrations.plan(fresh.id);
    assert.match(unapproved.blockers.join("; "), /approved/i);
    await assert.rejects(
      f.engine.integrations.apply(
        owner,
        confirm(unapproved),
        "unapproved-apply",
      ),
      { code: "CONFLICT" },
    );
    const decision = { integrationId: fresh.id, decision: "approve" };
    await f.engine.integrations.decide(owner, decision, "fresh-approve");
    assert.deepEqual(getIntegration(f.store, approved.id), approved);
    const plan = await f.engine.integrations.plan(fresh.id);
    assert.deepEqual(plan.blockers, []);
    const applied = await f.engine.integrations.apply(
      owner,
      confirm(plan),
      "fresh-apply",
    );
    assert.equal(f.store.getTask(f.original.id).status, "DONE");
    assert.equal(
      getIntegrationCandidate(f.store, f.candidate.id).status,
      "integrated",
    );
    assert.deepEqual(
      await f.engine.integrations.apply(owner, confirm(plan), "fresh-apply"),
      applied,
    );
    assert.equal(
      (
        await f.engine.integrations.decide(
          owner,
          { integrationId: approved.id, decision: "approve" },
          "preview:approve",
        )
      ).id,
      approved.id,
    );
    assert.deepEqual(getIntegration(f.store, approved.id), approved);
  } finally {
    await f.app.close();
  }
});

test("a queued and then running recovered reviewer blocks an already displayed application", async (context) => {
  const f = await reviewed();
  const release = Promise.withResolvers<void>();
  try {
    const { approved, shown, reviewer, retry } = await deferredReview(f);
    const pump = context.mock.method(f.engine, "pump", async () => {});
    await retry();
    assert.match(
      (await f.engine.integrations.plan(approved.id)).blockers.join("; "),
      /review.*progress/i,
    );
    assert.equal(f.store.getTask(reviewer.id).status, "QUEUED");
    await assert.rejects(
      f.engine.integrations.apply(owner, confirm(shown), "queued-apply"),
      { code: "CONFLICT" },
    );
    await unchanged(f, approved.id);
    const entered = Promise.withResolvers<void>();
    const start = f.engine.pi.startSession.bind(f.engine.pi);
    context.mock.method(
      f.engine.pi,
      "startSession",
      async (input: Parameters<typeof start>[0]) => {
        entered.resolve();
        await release.promise;
        return start(input);
      },
    );
    pump.mock.restore();
    await f.engine.pump();
    await entered.promise;
    assert.equal(f.store.getTask(reviewer.id).status, "RUNNING");
    assert.match(
      (await f.engine.integrations.plan(approved.id)).blockers.join("; "),
      /review.*progress/i,
    );
    await assert.rejects(
      f.engine.integrations.apply(owner, confirm(shown), "running-apply"),
      { code: "CONFLICT" },
    );
    await unchanged(f, approved.id);
    release.resolve();
    await f.engine.idle();
  } finally {
    release.resolve();
    await f.app.close();
  }
});

test("a retry queued after application planning starts is refused before the claim", async (context) => {
  const f = await reviewed();
  try {
    const { approved, shown, reviewer, retry } = await deferredReview(f);
    context.mock.method(f.engine, "pump", async () => {});
    const enqueue = f.engine.scheduling.enqueue.bind(f.engine.scheduling);
    let applying: Promise<unknown> | undefined;
    context.mock.method(
      f.engine.scheduling,
      "enqueue",
      (...args: Parameters<typeof enqueue>) => {
        const [actor, input, key] = args;
        // Recovery has finished observing Git. Begin apply while the reviewer
        // is still deferred/READY, then commit its real enqueue during Git awaits.
        applying = f.engine.integrations.apply(
          owner,
          confirm(shown),
          "interleaved-apply",
        );
        return enqueue(actor, input, key);
      },
    );
    await retry();
    assert.equal(f.store.getTask(reviewer.id).status, "QUEUED");
    assert.ok(applying);
    await assert.rejects(applying, { code: "CONFLICT" });
    await unchanged(f, approved.id);
  } finally {
    await f.app.close();
  }
});

test("a deferred review cannot retry once its candidate has been integrated", async () => {
  const f = await reviewed();
  try {
    const { shown, reviewer, retry } = await deferredReview(f);
    await f.engine.integrations.apply(owner, confirm(shown), "apply");
    const attempts = f.store.listAttempts();
    const launches = f.engine.scheduling.committedLaunches(f.run.id);
    await assert.rejects(retry(), { code: "CONFLICT" });
    assert.equal(f.store.getTask(reviewer.id).status, "RETRY_DECISION");
    assert.equal(f.store.getTask(f.original.id).status, "DONE");
    assert.equal(f.engine.scheduling.committedLaunches(f.run.id), launches);
    assert.deepEqual(
      f.store.listAttempts().map((attempt) => attempt.id),
      attempts.map((attempt) => attempt.id),
    );
    assert.equal(
      await f.repo.git("rev-parse", "HEAD"),
      f.candidate.candidateSha,
    );
  } finally {
    await f.app.close();
  }
});

test("a reviewer queued after the plan snapshot is revalidated inside the final claim", async (context) => {
  const f = await reviewed();
  try {
    const approved = await approvedPreview(f, "preview");
    const shown = await f.engine.integrations.plan(approved.id);
    context.mock.method(f.engine, "pump", async () => {});
    const listTasks = f.store.listTasks.bind(f.store);
    let reviewerId: string | undefined;
    const snapshot = context.mock.method(
      f.store,
      "listTasks",
      (...args: Parameters<typeof listTasks>) => {
        const tasks = listTasks(...args);
        snapshot.mock.restore();
        // The plan sees a valid snapshot. A real owner review queues in the
        // microtask before apply resumes from awaiting that completed plan.
        queueMicrotask(() => {
          reviewerId = f.request("claim-boundary-review").id;
        });
        return tasks;
      },
    );
    await assert.rejects(
      f.engine.integrations.apply(
        owner,
        confirm(shown),
        "claim-boundary-apply",
      ),
      { code: "CONFLICT" },
    );
    assert.ok(reviewerId);
    assert.equal(f.store.getTask(reviewerId).status, "QUEUED");
    await unchanged(f, approved.id);
  } finally {
    await f.app.close();
  }
});
