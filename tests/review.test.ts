import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { getIntegrationCandidate } from "../src/server/storage/candidates.ts";
import { createReview, listReviews } from "../src/server/storage/reviews.ts";
import { Store } from "../src/server/storage/store.ts";
import { reviewResultSchema } from "../src/shared/domain/entities.ts";
import { reviewFixture } from "./helpers/review-fixture.ts";
import { findingsReview, passReview } from "./helpers/review-result.ts";

for (const scenario of ["review-pass", "review-findings"]) {
  test(`${scenario} is saved against the assigned candidate only after a clean independent completion and survives restart`, async () => {
    const f = await reviewFixture(scenario);
    try {
      const task = f.request();
      await f.engine.idle();
      assert.equal(f.store.getTask(task.id).status, "AWAITING_REVIEW");
      const [review] = listReviews(f.store, f.original.id);
      assert.ok(review);
      assert.deepEqual(
        reviewResultSchema.parse({
          summary: review.summary,
          recommendation: review.recommendation,
          findings: review.findings,
          tests: review.tests,
        }),
        reviewResultSchema.parse(
          scenario === "review-pass" ? passReview : findingsReview,
        ),
      );
      const attempt = f.store.listAttempts().find((a) => a.taskId === task.id);
      assert.equal(review.reviewerAttemptId, attempt?.id);
      assert.equal(review.taskId, f.original.id);
      assert.equal(review.candidateId, f.candidate.id);
      assert.deepEqual(listReviews(f.store, task.id), [review]);
      const candidate = getIntegrationCandidate(f.store, f.candidate.id);
      assert.deepEqual(candidate.reviewIds, [review.id]);
      assert.equal(candidate.status, "reviewed");
      assert.equal(candidate.humanDecision, null);
      assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
      const events = f.store.events({ runId: f.run.id, limit: 500 });
      const submitted = events.find(
        (e) => e.attemptId === attempt?.id && e.type === "worker.result",
      );
      const saved = events.find(
        (e) => e.attemptId === attempt?.id && e.type === "review.saved",
      );
      const captured = events.find(
        (e) => e.attemptId === attempt?.id && e.type === "worktree.captured",
      );
      assert.ok(submitted && saved && captured);
      assert.ok(
        saved.sequence > submitted.sequence &&
          saved.sequence > captured.sequence,
      );
      const report = f.engine.tool(
        { role: "owner" },
        f.run.id,
        { name: "read_report", taskId: f.original.id },
        "read",
      );
      assert.deepEqual(
        z.object({ reviews: z.array(z.unknown()) }).parse(report).reviews,
        [review],
      );
      await f.app.close();
      const reopened = new Store(join(f.data, "state.sqlite"));
      try {
        reopened.recoverInterrupted();
        assert.deepEqual(listReviews(reopened, f.original.id), [review]);
        assert.deepEqual(
          getIntegrationCandidate(reopened, f.candidate.id),
          candidate,
        );
        assert.deepEqual(
          reopened.events({ runId: f.run.id, limit: 500 }),
          events,
        );
        assert.equal(reopened.listAttempts().length, 2);
      } finally {
        reopened.close();
      }
    } finally {
      if (f.store.db.isOpen) await f.app.close();
    }
  });
}

for (const scenario of [
  "review-missing",
  "review-invalid",
  "review-tamper",
  "review-exit",
]) {
  test(`${scenario} requires a retry decision without accepting a recommendation or altering the candidate`, async () => {
    const f = await reviewFixture(scenario);
    try {
      const task = f.request();
      await f.engine.idle();
      assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
      assert.deepEqual(listReviews(f.store, f.original.id), []);
      assert.deepEqual(
        getIntegrationCandidate(f.store, f.candidate.id),
        f.candidate,
      );
      assert.equal(
        await f.repo.git("rev-parse", `lao/candidate-${f.candidate.attemptId}`),
        f.candidate.candidateSha,
      );
      assert.equal(await f.repo.git("status", "--porcelain"), "");
      const events = f.store.events({ runId: f.run.id, limit: 500 });
      assert.ok(!events.some((e) => e.type === "review.saved"));
      if (scenario === "review-tamper" || scenario === "review-exit")
        assert.ok(
          events.some(
            (e) => e.taskId === task.id && e.type === "worker.result",
          ),
        );
      if (scenario === "review-invalid")
        assert.ok(
          events.some(
            (e) =>
              e.type === "gateway.denied" && e.payload.code === "INVALID_INPUT",
          ),
        );
      await f.engine.pump();
      assert.equal(f.store.listAttempts().length, 2);
    } finally {
      await f.app.close();
    }
  });
}

test("a result submitted before disconnect/restart remains provisional and is never adopted or replayed", async () => {
  const f = await reviewFixture("review-hold");
  try {
    const task = f.request();
    for (let i = 0; i < 200; i++) {
      if (
        f.store
          .events({ limit: 500 })
          .some((e) => e.taskId === task.id && e.type === "worker.result")
      )
        break;
      await delay(10);
    }
    assert.ok(
      f.store
        .events({ limit: 500 })
        .some((e) => e.taskId === task.id && e.type === "worker.result"),
    );
    assert.deepEqual(listReviews(f.store, task.id), []);
    const attempt = f.store.listAttempts().find((a) => a.taskId === task.id);
    assert.ok(attempt);
    assert.throws(
      () =>
        createReview(
          f.store,
          { reviewerAttemptId: attempt.id, result: passReview },
          "before-git-evidence",
        ),
      { code: "CONFLICT" },
    );
    f.store.recoverInterrupted();
    assert.equal(f.store.getAttempt(attempt.id).status, "RECOVERY_REQUIRED");
    assert.throws(
      () =>
        createReview(
          f.store,
          { reviewerAttemptId: attempt.id, result: passReview },
          "adopt",
        ),
      { code: "CONFLICT" },
    );
    assert.deepEqual(listReviews(f.store, task.id), []);
    assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
    assert.equal(f.store.listAttempts().length, 2);
  } finally {
    await f.app.close();
  }
});

test("review validation requires actionable locations, categories, evidence, confidence and an honest recommendation", () => {
  const finding = findingsReview.findings[0];
  for (const patch of [
    { line: null },
    { line: 0 },
    { file: "/tmp/source.ts" },
    { file: "../source.ts" },
    { severity: "high" },
    { confidence: 1.1 },
    { confidence: -0.1 },
    { evidence: "" },
    { justification: "" },
  ])
    assert.equal(
      reviewResultSchema.safeParse({
        ...findingsReview,
        findings: [{ ...finding, ...patch }],
      }).success,
      false,
    );
  assert.equal(
    reviewResultSchema.safeParse({ ...findingsReview, recommendation: "pass" })
      .success,
    false,
  );
  assert.equal(
    reviewResultSchema.safeParse({ ...findingsReview, findings: [] }).success,
    false,
  );
  assert.equal(
    reviewResultSchema.safeParse({
      ...passReview,
      tests: [{ command: "pnpm test", result: "passed" }],
    }).success,
    false,
  );
  assert.equal(
    reviewResultSchema.safeParse({ ...passReview, candidateId: randomUUID() })
      .success,
    false,
  );
});

test("repeat review requests preserve immutable history, and completion retries cannot create another review", async () => {
  const f = await reviewFixture();
  try {
    f.request();
    await f.engine.idle();
    const [first] = listReviews(f.store, f.original.id);
    assert.ok(first);
    const input = {
      reviewerAttemptId: first.reviewerAttemptId,
      result: passReview,
    };
    assert.deepEqual(
      createReview(f.store, input, `review:${first.reviewerAttemptId}`),
      first,
    );
    assert.throws(() => createReview(f.store, input, "different-completion"), {
      code: "CONFLICT",
    });
    assert.throws(
      () =>
        createReview(
          f.store,
          { ...input, result: findingsReview },
          `review:${first.reviewerAttemptId}`,
        ),
      { code: "CONFLICT" },
    );
    assert.throws(
      () =>
        f.store.db
          .prepare("UPDATE reviews SET data=data WHERE id=?")
          .run(first.id),
      /append-only/,
    );
    assert.throws(
      () => f.store.db.prepare("DELETE FROM reviews WHERE id=?").run(first.id),
      /append-only/,
    );
    assert.throws(
      () =>
        f.store.db
          .prepare("INSERT INTO reviews VALUES (?,?,?,?,?)")
          .run(
            randomUUID(),
            first.taskId,
            first.reviewerAttemptId,
            first.candidateId,
            JSON.stringify(first),
          ),
      /UNIQUE/,
    );
    f.request("another-review");
    await f.engine.idle();
    const reviews = listReviews(f.store, f.original.id);
    assert.equal(reviews.length, 2);
    assert.deepEqual(reviews[0], first);
    assert.notEqual(reviews[1]?.reviewerAttemptId, first.reviewerAttemptId);
    assert.deepEqual(
      getIntegrationCandidate(f.store, f.candidate.id).reviewIds,
      reviews.map((r) => r.id),
    );
  } finally {
    await f.app.close();
  }
});

test("a failed review journal write rolls back the review, candidate link and attempt completion together", async () => {
  const f = await reviewFixture();
  try {
    f.store.db.exec(
      "CREATE TRIGGER fail_review BEFORE INSERT ON events WHEN NEW.type='review.saved' BEGIN SELECT RAISE(ABORT, 'review journal fixture failure'); END;",
    );
    const task = f.request();
    await f.engine.idle();
    assert.deepEqual(listReviews(f.store, task.id), []);
    assert.deepEqual(
      getIntegrationCandidate(f.store, f.candidate.id),
      f.candidate,
    );
    assert.equal(f.store.getTask(task.id).status, "RETRY_DECISION");
    assert.equal(
      f.store.listAttempts().find((a) => a.taskId === task.id)?.status,
      "failed",
    );
    assert.ok(
      !f.store
        .events({ limit: 500 })
        .some(
          (e) =>
            e.taskId === task.id &&
            ["report.saved", "review.saved"].includes(e.type),
        ),
    );
  } finally {
    await f.app.close();
  }
});

test("migration v5 preserves candidates and events from a v4 database while adding review constraints", async () => {
  const f = await reviewFixture();
  try {
    const events = f.store.events({ limit: 500 });
    f.store.db.exec(
      "DROP INDEX one_review_per_attempt; DROP TRIGGER reviews_no_update; DROP TRIGGER reviews_no_delete; PRAGMA user_version=4;",
    );
    await f.app.close();
    const reopened = new Store(join(f.data, "state.sqlite"));
    try {
      assert.equal(
        reopened.db.prepare("PRAGMA user_version").get()?.user_version,
        5,
      );
      assert.deepEqual(
        getIntegrationCandidate(reopened, f.candidate.id),
        f.candidate,
      );
      assert.deepEqual(reopened.events({ limit: 500 }), events);
      assert.deepEqual(
        reopened.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('one_review_per_attempt','reviews_no_update','reviews_no_delete') ORDER BY name",
          )
          .all()
          .map((row) => row.name),
        ["one_review_per_attempt", "reviews_no_delete", "reviews_no_update"],
      );
    } finally {
      reopened.close();
    }
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});
