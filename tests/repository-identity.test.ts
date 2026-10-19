import assert from "node:assert/strict";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { FakeAdapter } from "../src/server/adapters/fake.ts";
import { startApp } from "../src/server/app.ts";
import { git } from "../src/server/git/command.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import {
  decideRecovery,
  recheckRecovery,
  reconcileRestart,
} from "../src/server/orchestration/recovery-decisions.ts";
import { getIntegration } from "../src/server/storage/integrations.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import {
  approvedPreview,
  integrationBranches,
  owner,
  reviewed,
} from "./helpers/integration-fixture.ts";
import { worktreeFixture } from "./helpers/worktree-fixture.ts";

type Replacement = "root" | "common_directory";

async function replaceDirectory(root: string, replacement: Replacement) {
  const common = join(root, ".git");
  const rootBefore = await lstat(root, { bigint: true });
  const commonBefore = await lstat(common, { bigint: true });
  if (replacement === "root") {
    const saved = `${root}-original`;
    await rename(root, saved);
    await mkdir(root);
    // Keep the original Git directory: this isolates checkout identity from
    // common-directory identity instead of only testing a clone that changes both.
    await rename(join(saved, ".git"), common);
    await cp(saved, root, { recursive: true });
  } else {
    const saved = join(dirname(root), "original-git");
    await rename(common, saved);
    await cp(saved, common, { recursive: true });
  }
  const rootAfter = await lstat(root, { bigint: true });
  const commonAfter = await lstat(common, { bigint: true });
  assert.equal(rootBefore.ino === rootAfter.ino, replacement !== "root");
  assert.equal(commonBefore.ino === commonAfter.ino, replacement === "root");
}

for (const replacement of ["root", "common_directory"] as const) {
  test(`${replacement} replacement cannot apply an approved result or prepare a new integration`, async () => {
    const f = await reviewed();
    try {
      const approved = await approvedPreview(f, "approved");
      const plan = await f.engine.integrations.plan(approved.id);
      const branches = await integrationBranches(f.repo);
      const ownerText = await readFile(
        join(f.repo.directory, "README.md"),
        "utf8",
      );
      await replaceDirectory(f.repo.directory, replacement);
      await assert.rejects(f.engine.integrations.plan(approved.id), {
        code: "CONFLICT",
      });
      await assert.rejects(
        f.engine.integrations.apply(
          owner,
          {
            integrationId: approved.id,
            confirm: {
              method: plan.method,
              checkoutPath: plan.checkoutPath,
              expectedSha: plan.expectedSha,
              resultSha: plan.resultSha,
            },
          },
          "stale-apply",
        ),
        { code: "CONFLICT" },
      );
      assert.deepEqual(getIntegration(f.store, approved.id).applications, []);
      assert.equal(f.store.getTask(f.original.id).status, "READY_TO_INTEGRATE");
      const preview = f.engine.integrations.request(
        owner,
        { taskId: f.original.id },
        "replacement-preview",
      );
      await f.engine.integrations.idle();
      assert.equal(getIntegration(f.store, preview.id).status, "failed");
      assert.equal(await integrationBranches(f.repo), branches);
      assert.equal(await f.repo.git("rev-parse", "main"), plan.expectedSha);
      assert.equal(await f.repo.git("status", "--porcelain"), "");
      assert.equal(
        await readFile(join(f.repo.directory, "README.md"), "utf8"),
        ownerText,
      );
      const originalGit =
        replacement === "root"
          ? join(f.repo.directory, ".git")
          : join(dirname(f.repo.directory), "original-git");
      assert.equal(
        (
          await git(f.repo.directory, [
            "--git-dir",
            originalGit,
            "rev-parse",
            "main",
          ])
        ).trim(),
        plan.expectedSha,
      );
    } finally {
      await f.app.close();
    }
  });

  test(`${replacement} replacement blocks candidate capture and restart retry even when uncertainty is accepted`, async (context) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const f = await worktreeFixture();
    let engine = new Engine(f.store, f.data, new FakeAdapter());
    try {
      const queued = f.queue("unfinished");
      const tree = await engine.worktrees.prepare(queued.id);
      const partial = join(tree.path, "unfinished.txt");
      await writeFile(partial, "Keep this unfinished work\n");
      await replaceDirectory(f.repo.directory, replacement);
      await assert.rejects(
        engine.worktrees.candidate(queued.id, ["unfinished.txt"]),
        {
          code: "POLICY_DENIED",
        },
      );
      await engine.close();
      f.reopen();
      engine = new Engine(f.store, f.data, new FakeAdapter());
      await reconcileRestart(engine);
      const check = await recheckRecovery(
        engine,
        { taskId: queued.task.id },
        "check",
      );
      assert.equal(check.repository.state, "changed");
      const oldRun = f.store.getRun(f.run.id);
      await engine.openProject(
        { name: "Reopened replacement", repositoryPath: f.repo.directory },
        "reopen-replacement",
      );
      assert.deepEqual(f.store.getRun(f.run.id), oldRun);
      const attempts = f.store.listAttempts();
      const dispatches = engine.scheduling.list();
      await assert.rejects(
        decideRecovery(
          engine,
          {
            taskId: queued.task.id,
            checkId: check.id,
            profileId: queued.dispatch.profileId,
            acceptUnverified: true,
          },
          "unsafe-retry",
        ),
        { code: "CONFLICT" },
      );
      await engine.pump();
      assert.equal(f.store.getTask(queued.task.id).status, "RETRY_DECISION");
      assert.deepEqual(f.store.listAttempts(), attempts);
      assert.deepEqual(engine.scheduling.list(), dispatches);
      assert.equal(
        await readFile(partial, "utf8"),
        "Keep this unfinished work\n",
      );
      assert.equal(
        await f.repo.git("rev-parse", "main"),
        f.run.repository?.baseSha,
      );
    } finally {
      await engine.close();
      f.close();
    }
  });

  test(`${replacement} replacement blocks new runs, worktree creation and queued dispatch`, async (context) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const f = await worktreeFixture();
    const engine = new Engine(f.store, f.data, new FakeAdapter());
    try {
      const reserved = f.queue("reserved-before-replacement");
      const task = engine.createTask(
        { runId: f.run.id, title: "Queued", objective: "Must not launch" },
        "queued-task",
      );
      engine.scheduling.enqueue(
        owner,
        { taskId: task.id, profileId: reserved.dispatch.profileId },
        "queue",
      );
      await replaceDirectory(f.repo.directory, replacement);
      await assert.rejects(engine.worktrees.prepare(reserved.id), {
        code: "CONFLICT",
      });
      const before = f.store.listAttempts();
      await engine.idle();
      assert.deepEqual(f.store.listAttempts(), before);
      assert.deepEqual(engine.worktrees.list(), []);
      await assert.rejects(
        engine.startRun(
          {
            projectId: f.run.projectId,
            title: "New run without reopening",
            initialPrompt: "Do not launch",
            mode: "supervised",
            leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
          },
          "unsafe-run",
        ),
        { code: "CONFLICT" },
      );
      assert.equal(await f.repo.git("status", "--porcelain"), "");
      assert.equal(
        await f.repo.git("rev-parse", "main"),
        f.run.repository?.baseSha,
      );
    } finally {
      await engine.close();
      f.close();
    }
  });
}

test("legacy repository snapshots require reopening and a new run; old approvals never inherit that authority", async () => {
  const f = await reviewed();
  const approved = await approvedPreview(f, "approved");
  f.store.db.exec(`
    UPDATE projects SET data=json_remove(data,'$.repository.identity');
    UPDATE runs SET data=json_remove(data,'$.repository.identity');
  `);
  await f.app.close();
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(f.data, "state.sqlite"),
    adapters: { pi: new FakeAdapter(), codex: new FakeAdapter() },
  });
  try {
    const engine = app.engine;
    assert.ok(engine);
    const input = {
      projectId: f.run.projectId,
      title: "Fresh verified run",
      initialPrompt: "Plan without mutation",
      mode: "chat_plan",
      leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
    };
    await assert.rejects(engine.startRun(input, "legacy-run"), {
      code: "CONFLICT",
    });
    const oldRun = engine.store.getRun(f.run.id);
    const oldPreview = getIntegration(engine.store, approved.id);
    await engine.openProject(
      { name: "Explicitly reopened", repositoryPath: f.repo.directory },
      "reopen",
    );
    const fresh = await engine.startRun(input, "fresh-run");
    await engine.idle();
    assert.notEqual(fresh.id, oldRun.id);
    await assert.rejects(engine.integrations.plan(approved.id), {
      code: "CONFLICT",
    });
    assert.deepEqual(engine.store.getRun(f.run.id), oldRun);
    assert.deepEqual(getIntegration(engine.store, approved.id), oldPreview);
    assert.equal(await f.repo.git("rev-parse", "main"), f.candidate.baseSha);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    await app.close();
  }
});

test("a legacy unfinished run remains unverified after restart and project reopening", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await worktreeFixture();
  let engine = new Engine(f.store, f.data, new FakeAdapter());
  try {
    const queued = f.queue("legacy-unfinished");
    const tree = await engine.worktrees.prepare(queued.id);
    const partial = join(tree.path, "unfinished.txt");
    await writeFile(partial, "Retain legacy work\n");
    f.store.db.exec(`
      UPDATE projects SET data=json_remove(data,'$.repository.identity');
      UPDATE runs SET data=json_remove(data,'$.repository.identity');
      UPDATE worktrees SET data=json_remove(data,'$.repository.identity');
    `);
    await engine.close();
    f.reopen();
    engine = new Engine(f.store, f.data, new FakeAdapter());
    await reconcileRestart(engine);
    await engine.openProject(
      { name: "Explicitly reopened", repositoryPath: f.repo.directory },
      "reopen-legacy",
    );
    const check = await recheckRecovery(
      engine,
      { taskId: queued.task.id },
      "check-legacy",
    );
    assert.equal(check.repository.state, "unavailable");
    assert.equal(check.worktree.state, "unverified");
    await assert.rejects(
      decideRecovery(
        engine,
        {
          taskId: queued.task.id,
          checkId: check.id,
          profileId: queued.dispatch.profileId,
          acceptUnverified: true,
        },
        "retry-legacy",
      ),
      { code: "CONFLICT" },
    );
    assert.equal(f.store.getTask(queued.task.id).status, "RETRY_DECISION");
    assert.equal(f.store.listAttempts().length, 1);
    assert.equal(await readFile(partial, "utf8"), "Retain legacy work\n");
  } finally {
    await engine.close();
    f.close();
  }
});
