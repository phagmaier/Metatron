import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { git } from "../src/server/git/command.ts";
import { getIntegrationCandidate } from "../src/server/storage/candidates.ts";
import { listReviews } from "../src/server/storage/reviews.ts";
import { listWorkflows } from "../src/server/storage/teams.ts";
import {
  createReviewImplementationTemplate,
  createWorkflowTemplate,
  getWorkflowRun,
  listWorkflowRuns,
} from "../src/server/storage/workflows.ts";
import { workflowContentSchema } from "../src/shared/domain/workflow.ts";
import { reviewImplementationContent } from "../src/shared/workflow-presets.ts";
import {
  reviewerId,
  reviewWorkflowFixture,
  writerId,
} from "./helpers/review-workflow-fixture.ts";

// Protocol fixtures exercise the native engine and Git safety without model cost.
test("Review Implementation pins one independent reviewer to the candidate diff and full snapshot, retains findings across restart and reuses the saved recipe", async () => {
  const f = await reviewWorkflowFixture();
  try {
    const started = f.engine.workflows.start(f.input(), "review-workflow");
    const taskId = started.stages[0]?.taskIds[0];
    assert.ok(taskId);
    const task = f.store.getTask(taskId);
    assert.equal(task.reviewCandidateId, f.candidate.id);
    assert.equal(task.parentTaskId, f.original.id);
    // Even an owner override cannot turn an independent review into a writer.
    await f.engine.workflows.reconcile();
    assert.throws(
      () =>
        f.engine.scheduling.enqueue(
          { role: "owner" },
          { taskId, profileId: writerId },
          "unsafe-override",
        ),
      { code: "POLICY_DENIED" },
    );
    await f.engine.idle();
    const workflow = getWorkflowRun(f.store, started.id);
    assert.equal(workflow.status, "completed");
    const [review] = listReviews(f.store, f.original.id);
    assert.ok(review);
    assert.equal(review.candidateId, f.candidate.id);
    assert.equal(review.recommendation, "changes_requested");
    assert.equal(review.findings[0]?.file, "README.md");
    assert.equal(review.findings[0]?.line, 1);
    const attempt = f.store.getAttempt(review.reviewerAttemptId);
    const writer = f.store.getAttempt(f.candidate.attemptId);
    assert.equal(attempt.taskId, taskId);
    assert.equal(attempt.profileId, reviewerId);
    assert.notEqual(attempt.cwd, writer.cwd);
    assert.notEqual(attempt.id, writer.id);
    assert.equal(
      (await git(attempt.cwd, ["rev-parse", "HEAD"])).trim(),
      f.candidate.candidateSha,
    );
    assert.equal(
      await readFile(`${attempt.cwd}/README.md`, "utf8"),
      "Protocol fixture result\n",
    );
    const session = f.store
      .listSessions()
      .find((s) => s.attemptId === attempt.id);
    assert.equal(session?.context?.effective, "fresh");
    const packet = (await f.engine.reports(taskId)).find(
      ({ artifact }) =>
        artifact.kind === "reference" &&
        artifact.summary === "Review context packet",
    );
    assert.ok(packet);
    const text = await readFile(packet.artifact.path, "utf8");
    assert.ok(text.includes(f.candidate.baseSha));
    assert.ok(text.includes(f.candidate.candidateSha));
    assert.ok(text.includes("-# Disposable fixture"));
    assert.ok(text.includes("+Protocol fixture result"));
    assert.ok(
      text.includes(f.original.acceptanceCriteria[0] ?? "missing criteria"),
    );
    assert.ok(!text.includes("Protocol fixture structured summary"));
    assert.deepEqual(f.engine.workflows.results(started.id), [
      {
        name: "review",
        stageId: "review",
        status: "completed",
        taskIds: [taskId],
      },
    ]);
    const candidate = getIntegrationCandidate(f.store, f.candidate.id);
    assert.deepEqual(candidate.reviewIds, [review.id]);
    assert.equal(candidate.humanDecision, null);
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.listAttempts().length, 2);
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(listReviews(f.store, f.original.id), [review]);
    assert.deepEqual(getWorkflowRun(f.store, started.id), workflow);
    assert.deepEqual(
      f.engine.workflows.start(f.input(), "review-workflow"),
      started,
    );
    assert.equal(f.store.listAttempts().length, 2);
    const repeated = f.engine.workflows.start(
      f.input(),
      "second-review-workflow",
    );
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, repeated.id).status, "completed");
    assert.equal(listReviews(f.store, f.original.id).length, 2);
    assert.equal(f.store.listAttempts().length, 3);
  } finally {
    await f.close();
  }
});

for (const scenario of ["review-missing", "review-tamper"]) {
  test(`${scenario} cannot complete a review workflow or bless a candidate and never reruns automatically`, async () => {
    const f = await reviewWorkflowFixture(scenario);
    try {
      const started = f.engine.workflows.start(f.input(), "failed-review");
      await f.engine.idle();
      const taskId = started.stages[0]?.taskIds[0];
      assert.ok(taskId);
      assert.equal(f.store.getTask(taskId).status, "RETRY_DECISION");
      const outcome = f.engine.workflows.evidence(started.id).children[0]
        ?.outcome;
      assert.equal(
        outcome?.status,
        scenario === "review-tamper" ? "blocked" : "failed",
      );
      if (scenario === "review-tamper")
        assert.equal(getWorkflowRun(f.store, started.id).status, "blocked");
      else
        assert.equal(
          getWorkflowRun(f.store, started.id).stages[0]?.status,
          "failed",
        );
      assert.deepEqual(listReviews(f.store, f.original.id), []);
      assert.deepEqual(
        getIntegrationCandidate(f.store, f.candidate.id),
        f.candidate,
      );
      await f.restart();
      await f.engine.idle();
      assert.equal(f.store.listAttempts().length, 2);
      assert.deepEqual(listReviews(f.store, f.original.id), []);
      assert.equal(f.store.getTask(taskId).status, "RETRY_DECISION");
    } finally {
      await f.close();
    }
  });
}

test("review invocation rejects malformed, foreign and no-longer-reviewable candidates before creating any workflow children or dispatches", async () => {
  const f = await reviewWorkflowFixture();
  try {
    const foreign = f.newRun();
    const playback = f.store.createRun(
      {
        projectId: f.run.projectId,
        title: "FAKE playback cannot approve a candidate",
        initialPrompt: "No Git-backed review",
        execution: "fake",
        teamSnapshot: f.run.teamSnapshot,
      },
      "fake-review-run",
    );
    const before = {
      tasks: f.store.listTasks(),
      workflows: listWorkflowRuns(f.store),
      dispatches: f.engine.scheduling.list(),
      events: f.store.events({ limit: 500 }),
    };
    for (const input of [
      { ...f.input(), parameters: {} },
      { ...f.input(), parameters: { candidate_id: "README.md" } },
      { ...f.input(), parameters: { candidate_id: randomUUID() } },
      {
        ...f.input(),
        parameters: { candidate_id: f.candidate.id, diff: "untrusted diff" },
      },
      f.input(foreign.id),
      f.input(playback.id),
    ]) {
      assert.throws(() => f.engine.workflows.start(input, randomUUID()));
      assert.deepEqual(f.store.listTasks(), before.tasks);
      assert.deepEqual(listWorkflowRuns(f.store), before.workflows);
      assert.deepEqual(f.engine.scheduling.list(), before.dispatches);
      assert.deepEqual(f.store.events({ limit: 500 }), before.events);
    }
    f.store.transitionTask(
      {
        id: f.original.id,
        expectedStatus: "AWAITING_REVIEW",
        status: "CHANGES_REQUESTED",
        reason:
          "Owner requests revision instead of reviewing the old candidate",
      },
      "request-changes",
    );
    assert.throws(
      () => f.engine.workflows.start(f.input(), "stale-candidate"),
      { code: "CONFLICT" },
    );
    assert.deepEqual(listWorkflowRuns(f.store), before.workflows);
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});

test("saving the preset or a raw review recipe refuses missing, writable and coordinator reviewers without creating templates or events", async () => {
  const f = await reviewWorkflowFixture();
  try {
    const templates = listWorkflows(f.store);
    const events = f.store.events({ limit: 500 });
    for (const reviewerProfileId of [
      randomUUID(),
      writerId,
      f.run.teamSnapshot?.preset.leadProfileId,
    ]) {
      assert.throws(() =>
        createReviewImplementationTemplate(
          f.store,
          { reviewerProfileId },
          randomUUID(),
        ),
      );
      if (reviewerProfileId)
        assert.throws(() =>
          createWorkflowTemplate(
            f.store,
            reviewImplementationContent({ reviewerProfileId }),
            randomUUID(),
          ),
        );
      assert.deepEqual(listWorkflows(f.store), templates);
      assert.deepEqual(f.store.events({ limit: 500 }), events);
    }
    assert.throws(() =>
      createReviewImplementationTemplate(
        f.store,
        { reviewerProfileId: reviewerId, reviewerCount: 4 },
        randomUUID(),
      ),
    );
    assert.deepEqual(listWorkflows(f.store), templates);
  } finally {
    await f.close();
  }
});

test("a failed workflow journal write rolls back the candidate-bound review child and its request event", async () => {
  const f = await reviewWorkflowFixture();
  try {
    const tasks = f.store.listTasks();
    const events = f.store.events({ limit: 500 });
    f.store.db.exec(
      "CREATE TRIGGER fail_review_workflow BEFORE INSERT ON events WHEN NEW.type='workflow.started' BEGIN SELECT RAISE(ABORT, 'workflow journal fixture failure'); END;",
    );
    assert.throws(
      () => f.engine.workflows.start(f.input(), "rolled-back-review"),
      /workflow journal fixture failure/,
    );
    assert.deepEqual(f.store.listTasks(), tasks);
    assert.deepEqual(listWorkflowRuns(f.store), []);
    assert.deepEqual(f.store.events({ limit: 500 }), events);
    assert.deepEqual(
      getIntegrationCandidate(f.store, f.candidate.id),
      f.candidate,
    );
    f.store.db.exec("DROP TRIGGER fail_review_workflow");
    const retry = f.engine.workflows.start(f.input(), "rolled-back-review");
    await f.engine.idle();
    assert.equal(getWorkflowRun(f.store, retry.id).status, "completed");
    assert.equal(listReviews(f.store, f.original.id).length, 1);
  } finally {
    await f.close();
  }
});

test("review recipes cannot fan out or consume an implementer report in place of candidate-bound independent context", () => {
  const content = reviewImplementationContent({
    reviewerProfileId: reviewerId,
  });
  const stage = content.stages[0];
  assert.ok(stage);
  for (const patch of [
    { inputs: [] },
    { inputs: [{ name: "report", source: "parameter", ref: "candidate_id" }] },
    {
      inputs: [
        { name: "candidate_id", source: "stage", ref: "implementation" },
      ],
    },
    { count: 2, partitions: ["correctness", "safety"] },
  ]) {
    assert.equal(
      workflowContentSchema.safeParse({
        ...content,
        stages: [{ ...stage, ...patch }],
      }).success,
      false,
    );
  }
});
