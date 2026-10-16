import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { startApp } from "../src/server/app.ts";
import { requestRevision } from "../src/server/orchestration/revision.ts";
import { getIntegration } from "../src/server/storage/integrations.ts";
import {
  artifactContentResponseSchema,
  candidateDiffResponseSchema,
} from "../src/shared/api.ts";
import type { IntegrationPreview } from "../src/shared/integration.ts";
import { api, node, owner, reviewed } from "./helpers/integration-fixture.ts";
import { reviewFixture } from "./helpers/review-fixture.ts";

type Fixture = Awaited<ReturnType<typeof reviewed>>;

async function preview(f: Fixture, key: string, script: string) {
  const { id } = f.engine.integrations.request(
    owner,
    { taskId: f.original.id, tests: [[node, "-e", script]] },
    key,
  );
  await f.engine.integrations.idle();
  return getIntegration(f.store, id);
}

// Compare bytes and Git state, not just the continued existence of DB rows.
async function evidence(f: Fixture, saved: IntegrationPreview) {
  const artifactIds = [
    saved.diffArtifactId,
    ...saved.testResults.map((result) => result.artifactId),
  ].filter((id): id is string => id !== null);
  const artifacts = [];
  for (const id of artifactIds) {
    const response = await api(f, `artifacts?id=${id}`);
    assert.equal(response.status, 200);
    artifacts.push(artifactContentResponseSchema.parse(response.value));
  }
  const diff = await api(f, `candidates/diff?candidateId=${saved.candidateId}`);
  assert.equal(diff.status, 200);
  const worktrees = f.engine.worktrees.list();
  const copies = [];
  for (const path of [
    ...worktrees.map((worktree) => worktree.path),
    saved.worktreePath,
  ])
    copies.push({
      path,
      head: await f.repo.git("-C", path, "rev-parse", "HEAD"),
      status: await f.repo.git("-C", path, "status", "--porcelain"),
      readme: await readFile(join(path, "README.md"), "utf8"),
    });
  const diagnostics = [];
  for (const attempt of f.store.listAttempts())
    diagnostics.push(
      await readFile(
        join(f.data, "pi-sessions", attempt.id, "rpc-diagnostics.json"),
        "utf8",
      ),
    );
  return {
    artifacts,
    diff: candidateDiffResponseSchema.parse(diff.value),
    reports: await f.engine.reports(f.original.id),
    attempts: f.store.listAttempts(),
    sessions: f.store.listSessions(),
    worktrees,
    copies,
    diagnostics,
    refs: await f.repo.git("show-ref", "--heads"),
    ownerStatus: await f.repo.git("status", "--porcelain"),
    ownerReadme: await readFile(join(f.repo.directory, "README.md"), "utf8"),
  };
}

async function history(f: Fixture) {
  const paths = [
    `tasks?runId=${f.run.id}`,
    `reviews?taskId=${f.original.id}`,
    `integrations?taskId=${f.original.id}`,
    `events?runId=${f.run.id}&limit=500`,
  ];
  return Promise.all(
    paths.map(async (path) => {
      const response = await api(f, path);
      assert.equal(response.status, 200);
      return response.value;
    }),
  );
}

async function restart(f: Fixture) {
  await f.app.close();
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(f.data, "state.sqlite"),
    adapters: { pi: f.engine.pi },
  });
  assert.ok(app.engine);
  return { ...f, app, engine: app.engine, store: app.engine.store };
}

test("decline preserves task evidence through restart, a replacement candidate and cancellation", async () => {
  let f = await reviewed();
  try {
    const saved = await preview(f, "preview", "console.log('retained log')");
    assert.equal(saved.status, "passed");
    await writeFile(join(f.repo.directory, "README.md"), "owner WIP\n");
    const before = await evidence(f, saved);
    assert.ok(before.artifacts.some((a) => a.content.includes("retained log")));
    assert.match(before.diff.patch, /Protocol fixture result/);
    const declined = await api(f, "integrations/decision", {
      input: {
        integrationId: saved.id,
        decision: "decline",
        rationale: "Keep for a later revision",
      },
      key: "decline",
    });
    assert.equal(declined.status, 200);
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.deepEqual(await evidence(f, saved), before);
    const after = await history(f);
    f = await restart(f);
    assert.deepEqual(await history(f), after);
    assert.deepEqual(await evidence(f, saved), before);

    requestRevision(
      f.engine,
      owner,
      {
        taskId: f.original.id,
        feedback: "Revise while keeping the declined work",
      },
      "revision",
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(f.original.id).status, "CHANGES_REQUESTED");
    assert.deepEqual(getIntegration(f.store, saved.id), declined.value);
    const retained = await evidence(f, saved);
    assert.deepEqual(retained.artifacts, before.artifacts);
    assert.deepEqual(retained.diff, before.diff);
    assert.deepEqual(
      retained.copies.filter((copy) =>
        before.copies.some((previous) => previous.path === copy.path),
      ),
      before.copies,
    );
    f.engine.cancel(f.original.id, "cancel");
    const cancelled = await history(f);
    const evidenceAtCancel = await evidence(f, saved);
    f = await restart(f);
    assert.equal(f.store.getTask(f.original.id).status, "CANCELLED");
    assert.deepEqual(await history(f), cancelled);
    assert.deepEqual(await evidence(f, saved), evidenceAtCancel);
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});

test("failed preview keeps test output, diff and scratch files when a newer preview is prepared and after restart", async () => {
  let f = await reviewed();
  try {
    const failed = await preview(
      f,
      "failed",
      "require('fs').writeFileSync('debug.txt', 'failure evidence'); console.error('retained failure'); process.exit(7)",
    );
    assert.equal(failed.status, "failed");
    assert.equal(failed.testResults[0]?.exitCode, 7);
    const before = await evidence(f, failed);
    assert.ok(
      before.artifacts.some((a) => a.content.includes("retained failure")),
    );
    const newer = await preview(f, "newer", "console.log('new preview')");
    assert.equal(newer.status, "passed");
    assert.notEqual(newer.worktreePath, failed.worktreePath);
    assert.deepEqual(getIntegration(f.store, failed.id), failed);
    const afterNew = await evidence(f, failed);
    assert.deepEqual(afterNew.artifacts, before.artifacts);
    assert.deepEqual(afterNew.copies, before.copies);
    assert.deepEqual(afterNew.diff, before.diff);
    const saved = await history(f);
    f = await restart(f);
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.deepEqual(await history(f), saved);
    assert.deepEqual(await evidence(f, failed), afterNew);
    assert.equal(
      await readFile(join(failed.worktreePath, "debug.txt"), "utf8"),
      "failure evidence",
    );
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});

test("blocked application keeps the approved task, logs, diff and all worktrees after restart without retrying Git", async () => {
  let f = await reviewFixture("review-pass", "success");
  try {
    f.request();
    await f.engine.idle();
    const saved = await preview(f, "preview", "console.log('approved tests')");
    await f.engine.integrations.decide(
      owner,
      { integrationId: saved.id, decision: "approve" },
      "approve",
    );
    await mkdir(join(f.repo.directory, ".git", "info"), { recursive: true });
    await appendFile(
      join(f.repo.directory, ".git", "info", "exclude"),
      "fixture-result.txt\n",
    );
    await writeFile(
      join(f.repo.directory, "fixture-result.txt"),
      "owner data\n",
    );
    const before = await evidence(f, saved);
    const plan = await f.engine.integrations.plan(saved.id);
    assert.deepEqual(plan.blockers, []);
    const blocked = await api(f, "integrations/apply", {
      input: {
        integrationId: saved.id,
        confirm: {
          method: plan.method,
          expectedSha: plan.expectedSha,
          resultSha: plan.resultSha,
          checkoutPath: plan.checkoutPath,
        },
      },
      key: "blocked",
    });
    assert.equal(blocked.status, 200);
    assert.equal(f.store.getTask(f.original.id).status, "BLOCKED_CONFLICT");
    assert.equal(
      getIntegration(f.store, saved.id).applications[0]?.status,
      "blocked",
    );
    assert.deepEqual(await evidence(f, saved), before);
    const after = await history(f);
    f = await restart(f);
    assert.deepEqual(await history(f), after);
    assert.deepEqual(await evidence(f, saved), before);
    assert.equal(
      await readFile(join(f.repo.directory, "fixture-result.txt"), "utf8"),
      "owner data\n",
    );
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});
