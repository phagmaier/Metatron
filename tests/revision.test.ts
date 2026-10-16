import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { startApp } from "../src/server/app.ts";
import { requestReview } from "../src/server/orchestration/review.ts";
import { listIntegrationCandidates } from "../src/server/storage/candidates.ts";
import { listReviews } from "../src/server/storage/reviews.ts";
import { reconcileRevision } from "../src/server/storage/revisions.ts";
import { Store } from "../src/server/storage/store.ts";
import { reviewFixture } from "./helpers/review-fixture.ts";

function revise(f: Awaited<ReturnType<typeof reviewFixture>>, key: string) {
  return z.object({ revisionTaskId: z.string() }).parse(
    f.engine.tool(
      { role: "owner" },
      f.run.id,
      {
        name: "request_revision",
        taskId: f.original.id,
        feedback: `Preserve earlier work and apply ${key}`,
      },
      key,
    ),
  ).revisionTaskId;
}

test("a revision starts at its candidate and returns the original task to review without losing history", async () => {
  const f = await reviewFixture("review-findings");
  try {
    f.request();
    await f.engine.idle();
    const reviews = listReviews(f.store, f.original.id);
    const originalCandidate = listIntegrationCandidates(
      f.store,
      f.original.id,
    )[0];
    assert.equal(reviews.length, 1);
    const input = {
      name: "request_revision",
      taskId: f.original.id,
      feedback:
        "Restore the heading while retaining the previous implementation.",
    };
    const result = f.engine.tool(
      { role: "owner" },
      f.run.id,
      input,
      "revision",
    );
    assert.deepEqual(
      f.engine.tool({ role: "owner" }, f.run.id, input, "revision"),
      result,
    );
    const { revisionTaskId } = z
      .object({ revisionTaskId: z.string() })
      .parse(result);
    assert.equal(f.store.getTask(f.original.id).status, "CHANGES_REQUESTED");
    await f.engine.idle();
    assert.equal(f.store.getTask(revisionTaskId).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    const attempt = f.store
      .listAttempts()
      .find((a) => a.taskId === revisionTaskId);
    assert.ok(attempt?.worktreePath);
    const created = f.store
      .events({ runId: f.run.id, limit: 500 })
      .find((e) => e.attemptId === attempt.id && e.type === "worktree.created");
    assert.equal(created?.payload.startSha, f.candidate.candidateSha);
    assert.deepEqual(listReviews(f.store, f.original.id), reviews);
    assert.equal(
      listIntegrationCandidates(f.store, f.original.id)[0]?.id,
      f.candidate.id,
    );
    const [revised] = listIntegrationCandidates(f.store, revisionTaskId);
    assert.ok(revised);
    const handoff = (await f.engine.reports(revisionTaskId)).find(
      (item) => item.artifact.kind === "reference",
    );
    assert.ok(handoff);
    assert.match(handoff.content, /Protocol fixture structured summary/);
    assert.match(handoff.content, /README loses the project heading/);
    assert.doesNotMatch(
      f.store.getTask(revisionTaskId).objective,
      /Protocol fixture structured summary/,
    );
    assert.match(
      await f.repo.git("show", `${revised.candidateSha}:README.md`),
      /# Revised heading\n\nProtocol fixture result/,
    );
    requestReview(
      f.engine,
      { role: "owner" },
      {
        taskId: f.original.id,
        profileId: "00000000-0000-4000-8000-000000000012",
      },
      "review-revision",
    );
    const reviewer = f.store
      .listTasks(f.run.id)
      .find((t) => t.reviewCandidateId === revised.id);
    assert.ok(reviewer);
    await f.engine.idle();
    assert.equal(f.store.getTask(reviewer.id).status, "AWAITING_REVIEW");
    const packet = (await f.engine.reports(reviewer.id)).find(
      (report) => report.artifact.kind === "reference",
    );
    assert.ok(packet);
    assert.doesNotMatch(
      packet.content,
      /Protocol fixture structured summary|Previous result \(bounded\)/,
    );
    assert.deepEqual(
      listIntegrationCandidates(f.store, f.original.id)[0],
      originalCandidate,
    );
    const history = z
      .object({ reviews: z.array(z.unknown()) })
      .parse(
        f.engine.tool(
          { role: "owner" },
          f.run.id,
          { name: "read_report", taskId: f.original.id },
          "history",
        ),
      );
    assert.equal(history.reviews.length, 2);
    assert.equal(
      await readFile(join(f.repo.directory, "README.md"), "utf8"),
      "# Disposable fixture\n",
    );
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    await f.app.close();
  }
});

test("repeated revisions reconcile every ancestor, preserve history across restart and exhaust the root budget", async () => {
  const f = await reviewFixture();
  try {
    const firstId = revise(f, "first");
    await f.engine.idle();
    const [first] = listIntegrationCandidates(f.store, firstId);
    assert.ok(first);
    const secondId = revise(f, "second");
    assert.equal(f.store.getTask(firstId).status, "CHANGES_REQUESTED");
    assert.equal(f.store.getTask(f.original.id).status, "CHANGES_REQUESTED");
    await f.engine.idle();
    const [second] = listIntegrationCandidates(f.store, secondId);
    assert.ok(second);
    assert.equal(f.store.getTask(firstId).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(f.original.id).latestRevisionTaskId, secondId);
    assert.equal(f.store.getTask(secondId).revisionCandidateId, first.id);
    assert.match(
      await f.repo.git("show", `${second.candidateSha}:README.md`),
      /# Revised heading\n\n# Revised heading\n\nProtocol fixture result/,
    );
    assert.throws(() => revise(f, "third"), { code: "BUDGET_EXCEEDED" });
    const report = z
      .object({
        implementationTaskId: z.string(),
        candidate: z.object({ candidateId: z.string() }),
      })
      .parse(
        f.engine.tool(
          { role: "owner" },
          f.run.id,
          { name: "read_report", taskId: f.original.id },
          "latest-report",
        ),
      );
    assert.equal(report.implementationTaskId, secondId);
    assert.equal(report.candidate.candidateId, second.id);
    const reports = await f.engine.reports(f.original.id);
    assert.equal(reports.filter((r) => r.artifact.kind === "report").length, 3);
    const count = f.store.listAttempts().length;
    const events = f.store.events({ limit: 500 });
    await f.app.close();
    const reopened = new Store(join(f.data, "state.sqlite"));
    try {
      reopened.recoverInterrupted();
      assert.equal(reopened.getTask(f.original.id).status, "AWAITING_REVIEW");
      assert.equal(
        reopened.getTask(f.original.id).latestRevisionTaskId,
        secondId,
      );
      assert.deepEqual(listIntegrationCandidates(reopened, firstId), [first]);
      assert.deepEqual(listIntegrationCandidates(reopened, secondId), [second]);
      assert.deepEqual(reopened.events({ limit: 500 }), events);
      assert.equal(reopened.listAttempts().length, count);
    } finally {
      reopened.close();
    }
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});

test("a failed revision keeps its parent waiting until an explicit child retry succeeds", async () => {
  const f = await reviewFixture();
  try {
    f.setWriterScenario("exit");
    const id = revise(f, "failed");
    await f.engine.idle();
    assert.equal(f.store.getTask(id).status, "RETRY_DECISION");
    assert.equal(f.store.getTask(f.original.id).status, "CHANGES_REQUESTED");
    assert.throws(() => revise(f, "bypass"), { code: "CONFLICT" });
    assert.throws(
      () =>
        requestReview(
          f.engine,
          { role: "owner" },
          {
            taskId: f.original.id,
            profileId: "00000000-0000-4000-8000-000000000012",
          },
          "premature-review",
        ),
      { code: "CONFLICT" },
    );
    const attempts = f.store.listAttempts().length;
    await f.engine.pump();
    assert.equal(f.store.listAttempts().length, attempts);
    f.store.transitionTask(
      {
        id,
        expectedStatus: "RETRY_DECISION",
        status: "READY",
        reason: "Owner chose a fresh attempt",
      },
      "retry-decision",
    );
    f.setWriterScenario("tracked");
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: id, profileId: f.original.assignedProfileId },
      "retry",
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.equal(
      f.store.listAttempts().filter((a) => a.taskId === id).length,
      2,
    );
  } finally {
    await f.app.close();
  }
});

test("owner cancellation of an implementation stops its active revision and cannot be undone by completion", async () => {
  const f = await reviewFixture();
  try {
    f.setWriterScenario("hold");
    const id = revise(f, "held");
    for (let n = 0; n < 250 && !f.engine.nativeStops.has(id); n++) {
      await f.engine.pump();
      await delay(20);
    }
    assert.ok(f.engine.nativeStops.has(id));
    f.engine.cancel(f.original.id, "cancel-original");
    await f.engine.idle();
    assert.equal(f.store.getTask(id).status, "CANCELLED");
    assert.equal(f.store.getTask(f.original.id).status, "CANCELLED");
    assert.throws(() => revise(f, "revive"), { code: "CONFLICT" });
    assert.equal(
      listIntegrationCandidates(f.store, f.original.id)[0]?.candidateSha,
      f.candidate.candidateSha,
    );
    assert.equal(
      f.store.db.prepare("SELECT count(*) n FROM reservations").get()?.n,
      0,
    );
  } finally {
    await f.app.close();
  }
});

test("a reconciliation journal failure rolls back the parent transition and can be retried idempotently", async () => {
  const f = await reviewFixture();
  try {
    f.store.db.exec(
      "CREATE TRIGGER fail_revision_ready BEFORE INSERT ON events WHEN NEW.type='task.revision_ready' BEGIN SELECT RAISE(ABORT,'injected revision journal failure'); END;",
    );
    const id = revise(f, "atomic");
    await f.engine.idle();
    assert.equal(f.store.getTask(f.original.id).status, "CHANGES_REQUESTED");
    assert.equal(f.store.getTask(id).status, "RETRY_DECISION");
    assert.deepEqual(listIntegrationCandidates(f.store, id), []);
    assert.equal(
      f.store
        .events({ limit: 500 })
        .filter((e) => e.type === "task.revision_ready").length,
      0,
    );
    f.store.db.exec("DROP TRIGGER fail_revision_ready");
    f.store.transitionTask(
      {
        id,
        expectedStatus: "RETRY_DECISION",
        status: "READY",
        reason: "Owner chose a fresh attempt after storage failure",
      },
      "retry-decision",
    );
    f.engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: id, profileId: f.original.assignedProfileId },
      "retry",
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    const attempt = f.store.listAttempts().findLast((a) => a.taskId === id);
    assert.ok(attempt);
    const events = f.store.events({ limit: 500 });
    reconcileRevision(f.store, id, attempt.id);
    assert.deepEqual(f.store.events({ limit: 500 }), events);
  } finally {
    await f.app.close();
  }
});

test("a revised candidate includes previously added files without redeclaration", async () => {
  const f = await reviewFixture("review-pass", "success");
  try {
    f.setWriterScenario("tracked");
    const id = revise(f, "keep-added-file");
    await f.engine.idle();
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    const [candidate] = listIntegrationCandidates(f.store, id);
    assert.ok(candidate);
    assert.equal(
      await f.repo.git("show", `${candidate.candidateSha}:fixture-result.txt`),
      "Protocol fixture result",
    );
    assert.match(
      await f.repo.git("show", `${candidate.candidateSha}:README.md`),
      /# Revised heading\n\n# Disposable fixture/,
    );
    assert.equal(candidate.baseSha, f.candidate.baseSha);
    assert.equal(
      await f.repo.git("rev-parse", `lao/candidate-${f.candidate.attemptId}`),
      f.candidate.candidateSha,
    );
  } finally {
    await f.app.close();
  }
});

test("restart preserves the pending revision and requires an explicit child retry before parent reconciliation", async () => {
  const f = await reviewFixture();
  let resumed: Awaited<ReturnType<typeof startApp>> | undefined;
  try {
    const id = revise(f, "reserved-before-crash");
    const dispatch = f.engine.scheduling.list().find((d) => d.taskId === id);
    assert.ok(dispatch);
    const attempt = f.engine.scheduling.reserve(dispatch);
    assert.ok(attempt);
    await f.app.close();
    resumed = await startApp({
      development: false,
      port: 0,
      databasePath: join(f.data, "state.sqlite"),
      adapters: { pi: f.engine.pi },
    });
    const engine = resumed.engine;
    assert.ok(engine);
    const store = engine.store;
    await engine.idle();
    assert.equal(store.getTask(f.original.id).status, "CHANGES_REQUESTED");
    assert.equal(store.getTask(id).status, "RETRY_DECISION");
    assert.equal(store.getAttempt(attempt).status, "RECOVERY_REQUIRED");
    assert.equal(store.listAttempts().filter((a) => a.taskId === id).length, 1);
    store.transitionTask(
      {
        id,
        expectedStatus: "RETRY_DECISION",
        status: "READY",
        reason: "Owner explicitly retries recovered revision",
      },
      "retry-decision",
    );
    engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: id, profileId: f.original.assignedProfileId },
      "retry",
    );
    await engine.idle();
    assert.equal(store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.equal(store.getTask(id).status, "AWAITING_REVIEW");
    assert.equal(store.getTask(id).revisionCandidateId, f.candidate.id);
  } finally {
    await resumed?.close();
    if (f.store.db.isOpen) await f.app.close();
  }
});

test("the owner revision API validates its handoff, preserves pinning and permits a fresh revision after child cancellation", async () => {
  const f = await reviewFixture();
  try {
    const { token } = z
      .object({ token: z.string() })
      .parse(await (await fetch(`${f.app.origin}/api/local-session`)).json());
    const response = await fetch(`${f.app.origin}/api/tasks/revision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Local-Token": token,
        "Idempotency-Key": "owner-revision",
      },
      body: JSON.stringify({
        taskId: f.original.id,
        feedback: "Restore a project heading",
      }),
    });
    assert.equal(response.status, 200);
    const { revisionTaskId } = z
      .object({ revisionTaskId: z.string() })
      .parse(await response.json());
    assert.equal(f.store.getTask(revisionTaskId).ownerPinned, true);
    f.engine.cancel(revisionTaskId, "cancel-child");
    await f.engine.idle();
    assert.equal(f.store.getTask(f.original.id).status, "CHANGES_REQUESTED");
    const replacement = revise(f, "owner-replacement");
    await f.engine.idle();
    assert.equal(f.store.getTask(replacement).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.equal(
      f.store.getTask(replacement).revisionCandidateId,
      f.candidate.id,
    );
    assert.throws(
      () =>
        f.engine.createTask(
          {
            runId: f.run.id,
            title: "Forged",
            objective: "Forbidden linkage",
            revisionCandidateId: f.candidate.id,
          },
          "forged-handoff",
        ),
      z.ZodError,
    );
  } finally {
    await f.app.close();
  }
});

test("a moved source candidate refuses revision worktree creation and leaves the parent waiting", async () => {
  const f = await reviewFixture();
  try {
    const id = revise(f, "moved-source");
    f.store.updateRun({ id: f.run.id, status: "paused" }, "pause");
    await f.repo.git(
      "update-ref",
      `refs/heads/lao/candidate-${f.candidate.attemptId}`,
      f.candidate.baseSha,
    );
    f.store.updateRun({ id: f.run.id, status: "active" }, "resume");
    await f.engine.idle();
    assert.equal(f.store.getTask(id).status, "RETRY_DECISION");
    assert.equal(f.store.getTask(f.original.id).status, "CHANGES_REQUESTED");
    const attempt = f.store.listAttempts().find((item) => item.taskId === id);
    assert.ok(attempt);
    assert.equal(
      f.engine.worktrees.list().some((tree) => tree.attemptId === attempt.id),
      false,
    );
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    await f.app.close();
  }
});
