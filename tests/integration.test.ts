import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { startApp } from "../src/server/app.ts";
import { requestIntegration } from "../src/server/orchestration/integration.ts";
import { getIntegrationCandidate } from "../src/server/storage/candidates.ts";
import {
  getIntegration,
  listIntegrations,
} from "../src/server/storage/integrations.ts";
import { Store } from "../src/server/storage/store.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { integrationPreviewSchema } from "../src/shared/integration.ts";
import {
  artifactText,
  checks,
  integrationBranches,
  node,
  owner,
  reviewed,
} from "./helpers/integration-fixture.ts";
import { reviewFixture } from "./helpers/review-fixture.ts";

const denied = (code: DomainError["code"]) => (error: unknown) =>
  error instanceof DomainError && error.code === code;

test("a passing review yields an isolated fast-forward preview with declared tests and a dirty owner checkout left untouched", async () => {
  const f = await reviewed();
  try {
    await writeFile(join(f.repo.directory, "README.md"), "# Owner WIP\n");
    await writeFile(join(f.repo.directory, "notes.txt"), "owner notes\n");
    const ownerStatus = await f.repo.git("status", "--porcelain");
    const { token } = z
      .object({ token: z.string() })
      .parse(await (await fetch(`${f.app.origin}/api/local-session`)).json());
    const post = async () =>
      integrationPreviewSchema.parse(
        await (
          await fetch(`${f.app.origin}/api/tasks/integration`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Local-Token": token,
              "Idempotency-Key": "integrate",
            },
            body: JSON.stringify({
              taskId: f.original.id,
              tests: [
                [
                  node,
                  "-e",
                  "if (!require('fs').readFileSync('README.md', 'utf8').includes('Protocol fixture result')) process.exit(3)",
                ],
              ],
            }),
          })
        ).json(),
      );
    const first = await post();
    assert.equal(first.status, "preparing");
    await f.engine.integrations.idle();
    const preview = getIntegration(f.store, first.id);
    assert.equal(preview.status, "passed");
    assert.deepEqual(checks(preview), [
      "destination:passed",
      "candidate:passed",
      "apply:passed",
      "overlap:passed",
      "diff:passed",
      "diff_check:passed",
      "tests:passed",
      "final_destination:passed",
    ]);
    assert.equal(preview.destinationBranch, "main");
    assert.equal(preview.destinationSha, f.candidate.baseSha);
    assert.equal(preview.resultSha, f.candidate.candidateSha);
    assert.deepEqual(preview.files, [{ status: "M", path: "README.md" }]);
    assert.deepEqual(
      preview.testResults.map((t) => [t.result, t.exitCode]),
      [["passed", 0]],
    );
    assert.match(
      await artifactText(f.store, preview.diffArtifactId),
      /^\+Protocol fixture result$/m,
    );
    assert.ok(
      !f.store
        .listAttempts()
        .some((a) => a.worktreePath === preview.worktreePath),
    );
    assert.notEqual(preview.worktreePath, f.repo.directory);
    assert.equal(
      await f.repo.git("-C", preview.worktreePath, "rev-parse", "HEAD"),
      f.candidate.candidateSha,
    );
    assert.equal(
      await f.repo.git(
        "-C",
        preview.worktreePath,
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ),
      preview.branch,
    );
    assert.equal(await f.repo.git("status", "--porcelain"), ownerStatus);
    assert.equal(
      await readFile(join(f.repo.directory, "README.md"), "utf8"),
      "# Owner WIP\n",
    );
    assert.equal(await f.repo.git("rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      f.candidate.baseSha,
    );
    assert.equal(
      await f.repo.git("rev-parse", `lao/candidate-${f.candidate.attemptId}`),
      f.candidate.candidateSha,
    );
    // A preview is evidence only: no approval, task transition or integration.
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    assert.equal(
      getIntegrationCandidate(f.store, f.candidate.id).status,
      "reviewed",
    );
    assert.equal((await post()).id, first.id);
    await f.engine.integrations.idle();
    assert.deepEqual(listIntegrations(f.store, f.original.id), [preview]);
    assert.equal(await integrationBranches(f.repo), preview.branch);
    await f.app.close();
    const reopened = new Store(join(f.data, "state.sqlite"));
    try {
      reopened.recoverInterrupted();
      assert.deepEqual(getIntegration(reopened, preview.id), preview);
    } finally {
      reopened.close();
    }
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});

test("failing, timed-out and unlaunchable test commands fail the preview without leaving test processes behind", async () => {
  const f = await reviewed();
  try {
    const pidFile = join(f.data, "helper.pid");
    const { id } = f.engine.integrations.request(
      owner,
      {
        taskId: f.original.id,
        timeoutSeconds: 1,
        tests: [
          [node, "-e", "console.log('fixture failure'); process.exit(4)"],
          [
            node,
            "-e",
            `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000);`,
          ],
          ["lao-fixture-missing-command"],
        ],
      },
      "integrate",
    );
    await f.engine.integrations.idle();
    const preview = getIntegration(f.store, id);
    assert.equal(preview.status, "failed");
    assert.deepEqual(
      preview.testResults.map((t) => t.result),
      ["failed", "timed_out", "error"],
    );
    assert.equal(preview.testResults[0]?.exitCode, 4);
    assert.match(
      await artifactText(f.store, preview.testResults[0]?.artifactId),
      /fixture failure/,
    );
    assert.ok(checks(preview).includes("tests:failed"));
    const helper = Number(await readFile(pidFile, "utf8"));
    let alive = true;
    for (let i = 0; i < 60 && alive; i++) {
      try {
        process.kill(helper, 0);
        await delay(50);
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, "test helper outlived its command");
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      f.candidate.baseSha,
    );
  } finally {
    await f.app.close();
  }
});

test("a moved candidate branch fails before any integration worktree or branch exists", async () => {
  const f = await reviewed();
  try {
    const moved = await f.repo.git("rev-parse", "main");
    await f.repo.git(
      "update-ref",
      `refs/heads/lao/candidate-${f.candidate.attemptId}`,
      moved,
      f.candidate.candidateSha,
    );
    const tampered = f.engine.integrations.request(
      owner,
      { taskId: f.original.id },
      "moved-candidate",
    );
    await f.engine.integrations.idle();
    const refused = getIntegration(f.store, tampered.id);
    assert.equal(refused.status, "failed");
    assert.deepEqual(checks(refused), [
      "destination:passed",
      "candidate:failed",
    ]);
    assert.ok(!existsSync(dirname(refused.worktreePath)));
    assert.equal(await integrationBranches(f.repo), "");
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    await f.app.close();
  }
});

test("previews are owner-only, outside Chat/Plan, and need a passing review of the current candidate", async () => {
  const f = await reviewFixture("review-findings");
  try {
    const input = { taskId: f.original.id };
    const request = (actor: Parameters<typeof requestIntegration>[1]) => () =>
      f.engine.integrations.request(actor, input, randomUUID());
    assert.throws(request(owner), denied("CONFLICT"));
    const review = f.request();
    await f.engine.idle();
    assert.throws(request(owner), /passing independent review/);
    for (const role of ["lead", "worker"] as const)
      assert.throws(
        request({ role, sessionId: randomUUID() }),
        denied("POLICY_DENIED"),
      );
    assert.throws(
      () =>
        f.engine.integrations.request(owner, { taskId: review.id }, "review"),
      denied("POLICY_DENIED"),
    );
    f.store.updateRun({ id: f.run.id, mode: "chat_plan" }, "chat");
    assert.throws(request(owner), denied("POLICY_DENIED"));
    assert.deepEqual(listIntegrations(f.store, f.original.id), []);
    assert.equal(await integrationBranches(f.repo), "");
  } finally {
    await f.app.close();
  }
});

test("one preview prepares at a time and app shutdown stops its tests as interrupted", async () => {
  const f = await reviewed();
  try {
    const held = f.engine.integrations.request(
      owner,
      {
        taskId: f.original.id,
        tests: [[node, "-e", "setInterval(() => {}, 1000)"]],
      },
      "held",
    );
    assert.throws(
      () =>
        f.engine.integrations.request(
          owner,
          { taskId: f.original.id },
          "second",
        ),
      /already being prepared/,
    );
    while (
      !f.store
        .events({ limit: 500 })
        .some((e) => e.type === "integration.applied")
    )
      await delay(25);
    await f.app.close();
    const reopened = new Store(join(f.data, "state.sqlite"));
    try {
      reopened.recoverInterrupted();
      const stopped = getIntegration(reopened, held.id);
      assert.equal(stopped.status, "interrupted");
      assert.deepEqual(
        stopped.testResults.map((t) => t.result),
        ["interrupted"],
      );
    } finally {
      reopened.close();
    }
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});

test("a preview left preparing by a crash is marked interrupted at restart and never rerun", async () => {
  const f = await reviewed();
  // Records the request without starting its job, as a crash right after commit would.
  const crashed = requestIntegration(
    f.engine,
    owner,
    { taskId: f.original.id },
    "crashed",
  );
  await f.app.close();
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(f.data, "state.sqlite"),
  });
  try {
    assert.ok(app.engine);
    const stopped = getIntegration(app.engine.store, crashed.id);
    assert.equal(stopped.status, "interrupted");
    assert.match(stopped.diagnostic ?? "", /not rerun/);
    assert.ok(!existsSync(dirname(crashed.worktreePath)));
    assert.equal(await integrationBranches(f.repo), "");
    const next = app.engine.integrations.request(
      owner,
      { taskId: f.original.id },
      "after-restart",
    );
    await app.engine.integrations.idle();
    assert.equal(getIntegration(app.engine.store, next.id).status, "passed");
    assert.equal(
      getIntegration(app.engine.store, crashed.id).status,
      "interrupted",
    );
  } finally {
    await app.close();
  }
});
