import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { startApp } from "../src/server/app.ts";
import { git } from "../src/server/git/command.ts";
import type { applyIntegration } from "../src/server/orchestration/integration-apply.ts";
import { getIntegrationCandidate } from "../src/server/storage/candidates.ts";
import {
  getIntegration,
  startIntegrationApplication,
} from "../src/server/storage/integrations.ts";
import { mutate } from "../src/server/storage/mutations.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import {
  type ApplyPlan,
  applyPlanSchema,
  integrationPreviewSchema,
} from "../src/shared/integration.ts";
import {
  api,
  approvedPreview,
  owner,
  ownerCommit,
  reviewed,
} from "./helpers/integration-fixture.ts";
import { reviewFixture } from "./helpers/review-fixture.ts";

type Fixture = Awaited<ReturnType<typeof reviewed>>;
const denied = (code: DomainError["code"]) => (error: unknown) =>
  error instanceof DomainError && error.code === code;
const confirm = (plan: ApplyPlan) => ({
  integrationId: plan.integrationId,
  confirm: {
    method: plan.method,
    expectedSha: plan.expectedSha,
    resultSha: plan.resultSha,
    checkoutPath: plan.checkoutPath,
  },
});
const apply = (
  f: Fixture,
  plan: ApplyPlan,
  actor: Parameters<typeof applyIntegration>[1] = owner,
) => f.engine.integrations.apply(actor, confirm(plan), randomUUID());
const statuses = (preview: { applications: { status: string }[] }) =>
  preview.applications.map((a) => a.status);
const started = (f: Fixture) =>
  f.store
    .events({ limit: 500 })
    .filter((e) => e.type === "integration.application_started").length;

test("a confirmed apply fast-forwards the clean checked-out destination once; replays and restarts never rerun it", async () => {
  const f = await reviewed();
  try {
    const approved = await approvedPreview(f, "preview");
    const shown = applyPlanSchema.parse(
      (await api(f, `integrations/plan?integrationId=${approved.id}`)).value,
    );
    assert.deepEqual(
      [shown.method, shown.checkoutPath, shown.currentSha, shown.blockers],
      ["fast_forward_checkout", f.repo.directory, f.candidate.baseSha, []],
    );
    assert.deepEqual(
      shown.commands.map((c) => c.args),
      [
        [
          "-c",
          "submodule.recurse=false",
          "merge",
          "--ff-only",
          "--no-stat",
          "--no-autostash",
          "--no-overwrite-ignore",
          "--no-verify-signatures",
          f.candidate.candidateSha,
        ],
      ],
    );
    const body = { input: confirm(shown), key: "apply" };
    const first = await api(f, "integrations/apply", body);
    assert.equal(first.status, 200);
    const applied = integrationPreviewSchema.parse(first.value);
    assert.deepEqual(
      applied.applications.map((a) => [a.status, a.method, a.observedSha]),
      [["applied", "fast_forward_checkout", f.candidate.candidateSha]],
    );
    assert.deepEqual((await api(f, "integrations/apply", body)).value, {
      ...applied,
    });
    await assert.rejects(apply(f, shown), denied("CONFLICT"));
    assert.equal(started(f), 1);

    assert.equal(f.store.getTask(f.original.id).status, "DONE");
    assert.equal(
      getIntegrationCandidate(f.store, f.candidate.id).status,
      "integrated",
    );
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      f.candidate.candidateSha,
    );
    assert.equal(await f.repo.git("rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    assert.equal(
      await readFile(join(f.repo.directory, "README.md"), "utf8"),
      "Protocol fixture result\n",
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
      assert.deepEqual(getIntegration(app.engine.store, approved.id), applied);
      assert.equal(app.engine.store.getTask(f.original.id).status, "DONE");
      assert.equal(app.engine.store.listAttempts().length, attempts);
    } finally {
      await app.close();
    }
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});

test("a dirty or switched checkout and a moved destination refuse before any Git mutation; a new approved preview reconciles the move", async () => {
  const f = await reviewed();
  try {
    const approved = await approvedPreview(f, "preview");
    const clean = await f.engine.integrations.plan(approved.id);
    for (const role of ["lead", "worker"] as const)
      await assert.rejects(
        apply(f, clean, { role, sessionId: randomUUID() }),
        denied("POLICY_DENIED"),
      );
    f.store.updateRun({ id: f.run.id, mode: "chat_plan" }, "chat");
    await assert.rejects(apply(f, clean), denied("POLICY_DENIED"));
    f.store.updateRun({ id: f.run.id, mode: f.run.mode }, "restore");

    await writeFile(join(f.repo.directory, "README.md"), "# Owner WIP\n");
    await writeFile(join(f.repo.directory, "notes.txt"), "owner notes\n");
    const dirtyStatus = await f.repo.git("status", "--porcelain");
    assert.match(
      (await f.engine.integrations.plan(approved.id)).blockers.join("\n"),
      /uncommitted or untracked changes/,
    );
    await assert.rejects(apply(f, clean), /uncommitted or untracked/);
    assert.equal(await f.repo.git("status", "--porcelain"), dirtyStatus);
    assert.equal(
      await readFile(join(f.repo.directory, "README.md"), "utf8"),
      "# Owner WIP\n",
    );
    // The owner tidies their own checkout, then switches branch after viewing the plan.
    await f.repo.git("checkout", "--", "README.md");
    await rm(join(f.repo.directory, "notes.txt"));
    await f.repo.git("switch", "-q", "-c", "elsewhere");
    assert.equal(
      (await f.engine.integrations.plan(approved.id)).method,
      "update_ref",
    );
    await assert.rejects(apply(f, clean), /changed since you reviewed/);
    await f.repo.git("switch", "-q", "main");

    const moved = await ownerCommit(f.repo, "main", {
      "CHANGELOG.md": "owner\n",
    });
    const stale = await f.engine.integrations.plan(approved.id);
    assert.match(stale.blockers.join("\n"), new RegExp(`moved to ${moved}`));
    await assert.rejects(apply(f, stale), /moved to/);
    assert.equal(f.store.getTask(f.original.id).status, "READY_TO_INTEGRATE");
    assert.deepEqual(statuses(getIntegration(f.store, approved.id)), []);
    assert.equal(started(f), 0);
    assert.equal(await f.repo.git("rev-parse", "refs/heads/main"), moved);

    const merged = await approvedPreview(f, "reconcile");
    assert.equal(merged.destinationSha, moved);
    assert.match(
      (await f.engine.integrations.plan(approved.id)).blockers.join("\n"),
      /newer approved preview/,
    );
    const next = await f.engine.integrations.plan(merged.id);
    assert.deepEqual(next.blockers, []);
    assert.deepEqual(statuses(await apply(f, next)), ["applied"]);
    assert.equal(f.store.getTask(f.original.id).status, "DONE");
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      merged.resultSha,
    );
    await f.repo.git("merge-base", "--is-ancestor", moved, "main");
    assert.equal(
      await readFile(join(f.repo.directory, "CHANGELOG.md"), "utf8"),
      "owner\n",
    );
  } finally {
    await f.app.close();
  }
});

test("a destination that is not checked out moves by compare-and-swap only; the owner's dirty checkout on another branch is untouched", async () => {
  const f = await reviewed();
  try {
    const approved = await approvedPreview(f, "preview");
    await f.repo.git("switch", "-q", "-c", "wip");
    await writeFile(join(f.repo.directory, "README.md"), "# Owner WIP\n");
    const ownerStatus = await f.repo.git("status", "--porcelain");
    const shown = await f.engine.integrations.plan(approved.id);
    assert.deepEqual(
      [shown.method, shown.checkoutPath, shown.blockers],
      ["update_ref", null, []],
    );
    assert.deepEqual(shown.commands[0]?.args.slice(-3), [
      "refs/heads/main",
      f.candidate.candidateSha,
      f.candidate.baseSha,
    ]);
    assert.deepEqual(statuses(await apply(f, shown)), ["applied"]);
    assert.equal(f.store.getTask(f.original.id).status, "DONE");
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      f.candidate.candidateSha,
    );
    assert.equal(await f.repo.git("rev-parse", "--abbrev-ref", "HEAD"), "wip");
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/wip"),
      f.candidate.baseSha,
    );
    assert.equal(await f.repo.git("status", "--porcelain"), ownerStatus);
    assert.equal(
      await readFile(join(f.repo.directory, "README.md"), "utf8"),
      "# Owner WIP\n",
    );
  } finally {
    await f.app.close();
  }
});

test("a rebase in progress or another worktree holding the destination blocks the apply", async () => {
  const f = await reviewed();
  try {
    const approved = await approvedPreview(f, "preview");
    await f.repo
      .git(
        "-c",
        "user.name=Owner",
        "-c",
        "user.email=owner@example.invalid",
        "rebase",
        "--root",
        "--exec",
        "false",
      )
      .catch(() => undefined);
    const rebasing = await f.engine.integrations.plan(approved.id);
    // Detached by the rebase, so only a ref update would apply, and it would move main underneath it.
    assert.equal(rebasing.method, "update_ref");
    assert.match(rebasing.blockers.join("\n"), /being rebased or bisected/);
    await assert.rejects(apply(f, rebasing), /being rebased/);
    await f.repo.git("rebase", "--abort");

    await f.repo.git("switch", "-q", "-c", "wip");
    const elsewhere = join(
      await mkdtemp(join(tmpdir(), "lao-owner-worktree-")),
      "main",
    );
    await f.repo.git("worktree", "add", "-q", elsewhere, "main");
    const held = await f.engine.integrations.plan(approved.id);
    assert.match(held.blockers.join("\n"), /checked out in another worktree/);
    await assert.rejects(apply(f, held), /another worktree/);

    assert.equal(f.store.getTask(f.original.id).status, "READY_TO_INTEGRATE");
    assert.deepEqual(statuses(getIntegration(f.store, approved.id)), []);
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      f.candidate.baseSha,
    );
  } finally {
    await f.app.close();
  }
});

test("a fast-forward Git refuses keeps the owner's ignored file and blocks the task; a later confirmed retry applies", async () => {
  // This writer adds fixture-result.txt rather than editing README.md.
  const f = await reviewFixture("review-pass", "success");
  try {
    f.request();
    await f.engine.idle();
    const approved = await approvedPreview(f, "preview");
    assert.deepEqual(approved.files, [
      { status: "A", path: "fixture-result.txt" },
    ]);
    const ignored = join(f.repo.directory, "fixture-result.txt");
    await mkdir(join(f.repo.directory, ".git", "info"), { recursive: true });
    await appendFile(
      join(f.repo.directory, ".git", "info", "exclude"),
      "fixture-result.txt\n",
    );
    await writeFile(ignored, "owner ignored data\n");
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    const shown = await f.engine.integrations.plan(approved.id);
    assert.deepEqual(shown.blockers, []);
    const blocked = await apply(f, shown);
    assert.deepEqual(statuses(blocked), ["blocked"]);
    assert.match(
      blocked.applications[0]?.diagnostic ?? "",
      /Nothing was applied/,
    );
    assert.equal(f.store.getTask(f.original.id).status, "BLOCKED_CONFLICT");
    assert.equal(await readFile(ignored, "utf8"), "owner ignored data\n");
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      f.candidate.baseSha,
    );

    await rm(ignored);
    const retry = await f.engine.integrations.plan(approved.id);
    assert.deepEqual(retry.blockers, []);
    assert.deepEqual(statuses(await apply(f, retry)), ["blocked", "applied"]);
    assert.equal(f.store.getTask(f.original.id).status, "DONE");
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      f.candidate.candidateSha,
    );
  } finally {
    await f.app.close();
  }
});

test("an apply cut off by a crash is interrupted at restart, raised in Needs you and never rerun; applying again records what Git reached", async () => {
  const f = await reviewed();
  const approved = await approvedPreview(f, "preview");
  const shown = await f.engine.integrations.plan(approved.id);
  // The claim commits and Git runs, but the app dies before recording the outcome.
  mutate(f.store.db, "crash", "crashFixture", {}, z.boolean(), () => {
    startIntegrationApplication(
      f.store,
      approved,
      {
        id: randomUUID(),
        status: "applying",
        method: shown.method,
        checkoutPath: shown.checkoutPath,
        expectedSha: shown.expectedSha,
        resultSha: shown.resultSha,
        commands: shown.commands,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        observedSha: null,
        diagnostic: null,
      },
      "crash",
    );
    return true;
  });
  for (const command of shown.commands) await git(command.cwd, command.args);
  await f.app.close();
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(f.data, "state.sqlite"),
  });
  try {
    assert.ok(app.engine);
    const { store } = app.engine;
    const recovered = getIntegration(store, approved.id);
    assert.deepEqual(statuses(recovered), ["interrupted"]);
    assert.equal(recovered.applications[0]?.observedSha, null);
    assert.equal(store.getTask(f.original.id).status, "BLOCKED_CONFLICT");
    assert.equal(
      store
        .listHumanRequests()
        .filter(
          (r) => r.status === "open" && /did not finish cleanly/.test(r.reason),
        ).length,
      1,
    );
    assert.equal(
      store
        .events({ limit: 500 })
        .filter((e) => e.type === "integration.application_started").length,
      1,
    );
    assert.equal(
      await f.repo.git("rev-parse", "refs/heads/main"),
      f.candidate.candidateSha,
    );

    const reached = await app.engine.integrations.plan(approved.id);
    assert.deepEqual(
      [reached.method, reached.commands, reached.blockers],
      ["record_existing", [], []],
    );
    const recorded = await app.engine.integrations.apply(
      owner,
      confirm(reached),
      "record",
    );
    assert.deepEqual(statuses(recorded), ["interrupted", "applied"]);
    assert.equal(store.getTask(f.original.id).status, "DONE");
    assert.ok(existsSync(approved.worktreePath));
  } finally {
    await app.close();
  }
});
