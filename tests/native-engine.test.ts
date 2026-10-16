import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { git } from "../src/server/git/command.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import { requestReview } from "../src/server/orchestration/review.ts";
import { listIntegrationCandidates } from "../src/server/storage/candidates.ts";
import { Store } from "../src/server/storage/store.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

async function fixture(
  scenario = "success",
  prepare?: (
    repo: Awaited<ReturnType<typeof createGitFixture>>,
  ) => Promise<void>,
) {
  const repo = await createGitFixture();
  await prepare?.(repo);
  const data = await mkdtemp("/tmp/lao-native-engine-");
  const store = new Store(join(data, "state.sqlite"));
  const pi = new PiAdapter(data, (args, cwd, env) => {
    assert.ok(args.includes("--no-mcp"));
    assert.ok(args.includes("--no-context-files"));
    assert.ok(!args.includes("--continue"));
    assert.equal(env.PI_CODING_AGENT_DIR, join(data, "pi"));
    return new PiRpc(
      process.execPath,
      [fileURLToPath(new URL("./helpers/pi-rpc-fixture.ts", import.meta.url))],
      cwd,
      {
        ...env,
        LAO_FIXTURE_SCENARIO: scenario,
        ...(scenario === "no-guard" ? { LAO_FIXTURE_NO_GUARD: "1" } : {}),
      },
    );
  });
  const engine = new Engine(store, data, pi);
  const project = await engine.openProject(
    { name: "Protocol fixture", repositoryPath: repo.directory },
    "project",
  );
  const input = {
    projectId: project.id,
    title: "Protocol fixture run",
    initialPrompt: "Native boundary fixture",
    model: "fixture/model",
    thinking: "off",
    permission: "workspace_write",
  };
  return {
    repo,
    data,
    store,
    engine,
    input,
    async close() {
      await engine.close();
      store.close();
    },
  };
}
test("native text-only completion persists worktree, report and exit code, and blocks an undeclared new file for owner review", async () => {
  const f = await fixture();
  try {
    const run = await f.engine.startNativeRun(f.input, "run");
    assert.equal((await f.engine.startNativeRun(f.input, "run")).id, run.id);
    await f.engine.idle();
    const task = f.store.listTasks(run.id)[0];
    assert.ok(task);
    assert.equal(task.status, "RETRY_DECISION");
    const attempt = f.store.listAttempts()[0];
    assert.ok(attempt?.worktreePath);
    assert.equal(f.store.listAttempts().length, 1);
    assert.equal(f.store.listSessions()[0]?.exitCode, 0);
    assert.equal(
      (await f.engine.reports(task.id))[0]?.content,
      "UNVERIFIED: no structured report was submitted through the gateway.\n\nProtocol fixture report",
    );
    const events = f.store.events({ runId: run.id, limit: 500 });
    assert.ok(events.some((e) => e.type === "worktree.captured"));
    const candidate = events.find((e) => e.type === "candidate.captured");
    assert.equal(candidate?.payload.status, "blocked");
    assert.match(
      String(candidate?.payload.blockers),
      /fixture-result\.txt: undeclared new file/,
    );
    const request = f.store
      .listHumanRequests()
      .find((r) => r.affectedTaskIds.includes(task.id));
    assert.equal(request?.type, "manual_check");
    assert.equal(request?.status, "open");
    assert.equal(
      await readFile(join(attempt.worktreePath, "fixture-result.txt"), "utf8"),
      "Protocol fixture result\n",
    );
    assert.equal(
      await f.repo.git("for-each-ref", "refs/heads/lao/candidate-*"),
      "",
    );
    assert.deepEqual(listIntegrationCandidates(f.store, task.id), []);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
  } finally {
    await f.close();
  }
});
test("a writer with no structured report still yields a persisted candidate for tracked changes, flagged as unsubmitted, even without its report file", async () => {
  const f = await fixture("tracked");
  try {
    const run = await f.engine.startNativeRun(f.input, "run");
    await f.engine.idle();
    const task = f.store.listTasks(run.id)[0];
    const attempt = f.store.listAttempts()[0];
    assert.ok(task && attempt);
    assert.equal(f.store.getTask(task.id).status, "AWAITING_REVIEW");
    const records = listIntegrationCandidates(f.store, task.id);
    assert.equal(records.length, 1);
    const [record] = records;
    assert.ok(record);
    assert.equal(record.attemptId, attempt.id);
    assert.equal(record.baseSha, attempt.baseSha);
    assert.equal(record.reportSubmitted, false);
    assert.equal(
      await f.repo.git("rev-parse", `lao/candidate-${attempt.id}`),
      record.candidateSha,
    );
    assert.equal(
      await f.repo.git("show", `${record.candidateSha}:README.md`),
      "Protocol fixture result",
    );
    const [saved] = await f.engine.reports(task.id);
    assert.match(saved?.content ?? "", /^UNVERIFIED: no structured report/);
    assert.ok(saved);
    await rm(saved.artifact.path);
    const report = z
      .object({
        candidate: z.object({ candidateId: z.string() }),
        textExcerpt: z.null(),
        textUnavailable: z.literal(true),
      })
      .parse(
        f.engine.tool(
          { role: "owner" },
          run.id,
          { name: "read_report", taskId: task.id },
          "read-report",
        ),
      );
    assert.equal(report.candidate.candidateId, record.id);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    await f.engine.pump();
    assert.equal(f.store.listAttempts().length, 1);
  } finally {
    await f.close();
  }
});
for (const scenario of ["exit", "auth"]) {
  test(`native ${scenario} requires a retry decision and preserves worktree/history`, async () => {
    const f = await fixture(scenario);
    try {
      const run = await f.engine.startNativeRun(f.input, "run");
      await f.engine.idle();
      const task = f.store.listTasks(run.id)[0];
      assert.ok(task);
      assert.equal(task.status, "RETRY_DECISION");
      assert.equal(f.store.listAttempts().length, 1);
      assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
      assert.equal(
        f.store.db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
        0,
      );
      assert.equal(
        JSON.stringify(f.store.events({ runId: run.id, limit: 500 })).includes(
          "fixture-secret",
        ),
        false,
      );
      await f.engine.pump();
      assert.equal(f.store.listAttempts().length, 1);
    } finally {
      await f.close();
    }
  });
}
test("native owner cancellation interrupts a silent turn and releases reservations without waiting for text", async () => {
  const f = await fixture("hold");
  try {
    const run = await f.engine.startNativeRun(f.input, "run");
    const task = f.store.listTasks(run.id)[0];
    assert.ok(task);
    for (let i = 0; i < 200 && !f.engine.nativeStops.has(task.id); i++) {
      await f.engine.pump();
      await delay(10);
    }
    assert.ok(f.engine.nativeStops.has(task.id));
    f.engine.cancel(task.id, "cancel");
    await f.engine.idle();
    assert.equal(f.store.getTask(task.id).status, "CANCELLED");
    assert.equal(f.store.listAttempts()[0]?.status, "cancelled");
    assert.equal(f.store.listSessions()[0]?.state, "exited");
    assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
      0,
    );
  } finally {
    await f.close();
  }
});
test("native model/thinking validation refuses unsupported choices before creating a run", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.engine.startNativeRun(
        { ...f.input, model: "invented/model" },
        "bad-model",
      ),
      /unavailable/,
    );
    await assert.rejects(
      f.engine.startNativeRun(
        { ...f.input, thinking: "invented" },
        "bad-thinking",
      ),
      /unavailable/,
    );
    assert.equal(f.store.listRuns().length, 0);
    assert.equal(f.store.listAttempts().length, 0);
  } finally {
    await f.close();
  }
});
test("native startup fails closed when the policy extension is missing", async () => {
  const f = await fixture("no-guard");
  try {
    const run = await f.engine.startNativeRun(f.input, "run");
    await f.engine.idle();
    assert.equal(f.store.listTasks(run.id)[0]?.status, "RETRY_DECISION");
    assert.equal(
      f.store
        .events({ runId: run.id, limit: 500 })
        .some(
          (e) => e.type === "pi.text_delta" || e.type === "pi.turn_completed",
        ),
      false,
    );
    assert.equal(f.engine.worktrees.list()[0]?.state, "retained");
  } finally {
    await f.close();
  }
});
test("switching a queued native run to Chat/Plan prevents attempts and Git worktree creation", async () => {
  const f = await fixture();
  try {
    const run = await f.engine.startNativeRun(f.input, "run");
    f.engine.updateRun({ id: run.id, mode: "chat_plan" }, "plan");
    await f.engine.idle();
    assert.equal(f.store.listAttempts().length, 0);
    assert.equal(f.engine.worktrees.list().length, 0);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    await f.close();
  }
});

function diagnostic(f: Awaited<ReturnType<typeof fixture>>, taskId: string) {
  return String(
    f.store
      .events({ limit: 500 })
      .findLast((e) => e.taskId === taskId && e.type === "attempt.diagnostic")
      ?.payload.diagnostic,
  );
}
const writerProfile = "00000000-0000-4000-8000-000000000011";
const reviewerProfile = "00000000-0000-4000-8000-000000000012";
// The writer edits README.md; src/context.ts stays untouched surrounding code.
async function reviewed(scenario: string) {
  const f = await fixture(scenario, async (repo) => {
    await mkdir(join(repo.directory, "src"));
    await writeFile(join(repo.directory, "src", "context.ts"), "export {};\n");
    await repo.git("add", "--", "src/context.ts");
    await repo.git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Surrounding code",
    );
  });
  const run = await f.engine.startNativeRun(f.input, "run");
  await f.engine.idle();
  const task = f.store.listTasks(run.id)[0];
  assert.ok(task);
  const [candidate] = listIntegrationCandidates(f.store, task.id);
  assert.ok(candidate);
  const review = () => {
    requestReview(
      f.engine,
      { role: "owner" },
      { taskId: task.id, profileId: reviewerProfile },
      "review",
    );
    const reviewTask = f.store
      .listTasks(run.id)
      .find((t) => t.reviewCandidateId === candidate.id);
    assert.ok(reviewTask);
    return reviewTask;
  };
  return { f, run, task, candidate, review };
}
test("a text-only Reviewer inspects the independent candidate snapshot but needs a retry decision without a structured review", async () => {
  const { f, task, candidate, review } = await reviewed("tracked");
  try {
    assert.throws(
      () =>
        requestReview(
          f.engine,
          { role: "owner" },
          { taskId: task.id, profileId: writerProfile },
          "writer-review",
        ),
      { code: "POLICY_DENIED" },
    );
    const reviewTask = review();
    assert.equal(reviewTask.parentTaskId, task.id);
    await f.engine.idle();
    assert.equal(f.store.getTask(reviewTask.id).status, "RETRY_DECISION");
    assert.match(
      diagnostic(f, reviewTask.id),
      /valid structured recommendation/,
    );
    assert.equal(f.store.getTask(task.id).status, "AWAITING_REVIEW");
    const attempts = f.store.listAttempts();
    const writer = attempts.find((a) => a.taskId === task.id);
    const reviewer = attempts.find((a) => a.taskId === reviewTask.id);
    assert.ok(writer?.worktreePath && reviewer?.worktreePath);
    assert.notEqual(reviewer.worktreePath, writer.worktreePath);
    assert.equal(
      (await git(reviewer.worktreePath, ["rev-parse", "HEAD"])).trim(),
      candidate.candidateSha,
    );
    assert.equal(
      await readFile(join(reviewer.worktreePath, "src", "context.ts"), "utf8"),
      "export {};\n",
    );
    const artifacts = await f.engine.reports(reviewTask.id);
    const packet = artifacts.find((a) => a.artifact.kind === "reference");
    const report = artifacts.find((a) => a.artifact.kind === "report");
    assert.ok(packet && report);
    assert.match(packet.content, new RegExp(candidate.candidateSha));
    assert.match(packet.content, /M\tREADME\.md/);
    assert.match(packet.content, /\+Protocol fixture result/);
    // The implementer's own report text is never part of the review context.
    assert.match(
      (await f.engine.reports(task.id))[0]?.content ?? "",
      /Protocol fixture report/,
    );
    assert.doesNotMatch(packet.content, /Protocol fixture report/);
    assert.match(report.content, /Reviewed README: Protocol fixture result/);
    assert.equal(
      await f.repo.git("rev-parse", `lao/candidate-${candidate.attemptId}`),
      candidate.candidateSha,
    );
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    await f.close();
  }
});
test("a reviewer that modifies its snapshot fails for a retry decision and leaves the candidate intact", async () => {
  const { f, candidate, review } = await reviewed("tamper");
  try {
    const reviewTask = review();
    await f.engine.idle();
    assert.equal(f.store.getTask(reviewTask.id).status, "RETRY_DECISION");
    assert.match(diagnostic(f, reviewTask.id), /Git evidence requires owner/);
    assert.equal(
      await f.repo.git("show", `${candidate.candidateSha}:README.md`),
      "Protocol fixture result",
    );
    assert.equal(
      await f.repo.git("rev-parse", `lao/candidate-${candidate.attemptId}`),
      candidate.candidateSha,
    );
  } finally {
    await f.close();
  }
});
test("a candidate branch that no longer matches its record is refused before any review worktree exists", async () => {
  const { f, candidate, review } = await reviewed("tracked");
  try {
    await f.repo.git(
      "update-ref",
      `refs/heads/lao/candidate-${candidate.attemptId}`,
      candidate.baseSha,
    );
    const reviewTask = review();
    await f.engine.idle();
    assert.equal(f.store.getTask(reviewTask.id).status, "RETRY_DECISION");
    assert.match(diagnostic(f, reviewTask.id), /no longer matches its record/);
    const attempt = f.store
      .listAttempts()
      .find((a) => a.taskId === reviewTask.id);
    assert.equal(
      f.engine.worktrees.list().find((w) => w.attemptId === attempt?.id)?.state,
      undefined,
    );
  } finally {
    await f.close();
  }
});
test("Pi disposal releases its session even when diagnostics cannot be saved", async () => {
  const data = await mkdtemp("/tmp/lao-pi-dispose-");
  try {
    const pi = new PiAdapter(
      data,
      (_args, cwd, env) =>
        new PiRpc(
          process.execPath,
          [
            fileURLToPath(
              new URL("./helpers/pi-rpc-fixture.ts", import.meta.url),
            ),
          ],
          cwd,
          env,
        ),
    );
    const attemptId = randomUUID();
    const session = await pi.startSession({
      runId: randomUUID(),
      taskId: randomUUID(),
      attemptId,
      cwd: data,
      roleInstructions: "Fixture reader",
      model: "fixture/model",
      thinking: "off",
      permission: "read_only",
      contextPolicy: "fresh",
      contextPacket: "Fixture",
      toolEndpoint: null,
      environment: {},
    });
    await rm(join(data, "pi-sessions", attemptId), { recursive: true });
    await assert.rejects(pi.dispose(session), { code: "ENOENT" });
    await assert.rejects(pi.exit(session), { code: "CONFLICT" });
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
