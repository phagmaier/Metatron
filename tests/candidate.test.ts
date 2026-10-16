import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { git } from "../src/server/git/command.ts";
import { Worktrees } from "../src/server/git/worktrees.ts";
import {
  createIntegrationCandidate,
  listIntegrationCandidates,
} from "../src/server/storage/candidates.ts";
import type { createGitFixture } from "./helpers/git-fixture.ts";
import { worktreeFixture } from "./helpers/worktree-fixture.ts";

async function baseline(repo: Awaited<ReturnType<typeof createGitFixture>>) {
  await writeFile(join(repo.directory, "gone.txt"), "Removed by the worker\n");
  await writeFile(join(repo.directory, ".gitignore"), "build/\n");
  await repo.git("add", "--", "gone.txt", ".gitignore");
  await repo.git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Candidate baseline",
  );
}
async function writer(name: string) {
  const f = await worktreeFixture(baseline);
  const queued = f.queue(name.replaceAll(" ", "-"));
  const trees = new Worktrees(f.store, f.data);
  return {
    f,
    id: queued.id,
    taskId: queued.task.id,
    trees,
    tree: await trees.prepare(queued.id),
  };
}
async function capturedWriter(name: string) {
  const w = await writer(name);
  await writeFile(join(w.tree.path, "README.md"), "# Changed by worker\n");
  const captured = await w.trees.candidate(w.id, []);
  assert.equal(captured.status, "captured");
  return {
    ...w,
    captured,
    input: {
      attemptId: w.id,
      baseSha: captured.baseSha,
      candidateSha: captured.candidateSha,
      reportSubmitted: false,
    },
  };
}

test("candidate commits tracked changes and declared new files deterministically without touching the worktree index or owner checkout", async () => {
  const { f, id, trees, tree } = await writer("captured");
  try {
    await writeFile(join(tree.path, "README.md"), "# Changed by worker\n");
    await rm(join(tree.path, "gone.txt"));
    await writeFile(join(tree.path, "new file.txt"), "Declared\n");
    await mkdir(join(tree.path, "build"));
    await writeFile(join(tree.path, "build", "out.js"), "Ignored output\n");
    // Worker staging is irrelevant: the candidate is built from a private index.
    await git(tree.path, ["add", "--", "new file.txt"]);
    const worktreeStatus = await git(tree.path, ["status", "--porcelain=v1"]);
    const declared = [
      "./new file.txt",
      "README.md",
      join(tree.path, "gone.txt"),
      "missing.txt",
    ];
    const candidate = await trees.candidate(id, declared);
    assert.equal(candidate.status, "captured");
    assert.equal(candidate.branch, `lao/candidate-${id}`);
    assert.deepEqual(candidate.declaredUnchanged, ["missing.txt"]);
    assert.equal(
      candidate.files.find((file) => file.path === "build/out.js")?.disposition,
      "excluded",
    );
    const sha = candidate.candidateSha ?? "";
    assert.equal(
      await f.repo.git("rev-parse", `${sha}^`),
      tree.repository.baseSha,
    );
    assert.equal(await f.repo.git("rev-parse", `lao/candidate-${id}`), sha);
    assert.deepEqual(
      (await f.repo.git("ls-tree", "-r", "--name-only", sha)).split("\n"),
      [".gitignore", "README.md", "new file.txt"],
    );
    assert.equal(
      await f.repo.git("show", `${sha}:README.md`),
      "# Changed by worker",
    );
    assert.equal(
      await git(tree.path, ["status", "--porcelain=v1"]),
      worktreeStatus,
    );
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    assert.equal(
      await f.repo.git("rev-parse", "HEAD"),
      tree.repository.baseSha,
    );
    assert.deepEqual(
      (await readdir(dirname(tree.path))).filter((n) => n.endsWith(".index")),
      [],
    );
    assert.equal((await trees.candidate(id, declared)).candidateSha, sha);
    await writeFile(join(tree.path, "README.md"), "# Changed again\n");
    const changed = await trees.candidate(id, declared);
    assert.equal(changed.status, "blocked");
    assert.match(changed.blockers.join("\n"), /never overwritten/);
    assert.equal(await f.repo.git("rev-parse", `lao/candidate-${id}`), sha);
  } finally {
    f.close();
  }
});

const unsafe: [string, (path: string) => Promise<unknown>, string[], RegExp][] =
  [
    [
      "undeclared new file",
      (path) => writeFile(join(path, "extra.txt"), "Unknown\n"),
      [],
      /extra\.txt: undeclared new file/,
    ],
    [
      "declared secret",
      (path) => writeFile(join(path, ".env"), "TOKEN=fixture\n"),
      [".env"],
      /\.env: secret-sensitive path/,
    ],
    [
      "ignored secret",
      async (path) => {
        await mkdir(join(path, "build"));
        await writeFile(join(path, "build", "credentials.json"), "{}\n");
      },
      [],
      /build\/credentials\.json: secret-sensitive path/,
    ],
    [
      "declared ignored file",
      async (path) => {
        await mkdir(join(path, "build"));
        await writeFile(join(path, "build", "out.js"), "Output\n");
      },
      ["build/out.js"],
      /build\/out\.js: declared file is ignored by Git/,
    ],
    [
      "symbolic link",
      (path) => symlink("README.md", join(path, "link")),
      ["link"],
      /link: symbolic link/,
    ],
    [
      "embedded repository",
      async (path) => {
        await git(path, ["init", "--quiet", "nested"]);
        await writeFile(join(path, "nested", "file.txt"), "Nested\n");
      },
      ["nested"],
      /nested\/: embedded repository/,
    ],
    [
      "worker commit",
      (path) =>
        git(path, [
          "-c",
          "user.name=Worker",
          "-c",
          "user.email=worker@example.invalid",
          "commit",
          "--allow-empty",
          "-m",
          "Worker commit",
        ]),
      [],
      /HEAD moved/,
    ],
    [
      "whitespace error",
      (path) => writeFile(join(path, "README.md"), "Trailing \n"),
      ["README.md"],
      /diff --check/,
    ],
  ];
for (const [name, change, declared, reason] of unsafe)
  test(`unsafe candidate state blocks without a commit: ${name}`, async () => {
    const { f, id, trees, tree } = await writer(name);
    try {
      await change(tree.path);
      const candidate = await trees.candidate(id, declared);
      assert.equal(candidate.status, "blocked");
      assert.equal(candidate.candidateSha, null);
      assert.match(candidate.blockers.join("\n"), reason);
      assert.equal(
        await f.repo.git("for-each-ref", `refs/heads/lao/candidate-${id}`),
        "",
      );
      assert.equal(await f.repo.git("status", "--porcelain"), "");
    } finally {
      f.close();
    }
  });

test("a writer without changes yields an empty candidate and no branch", async () => {
  const { f, id, trees } = await writer("empty");
  try {
    const candidate = await trees.candidate(id, ["README.md"]);
    assert.equal(candidate.status, "empty");
    assert.deepEqual(candidate.declaredUnchanged, ["README.md"]);
    assert.equal(
      await f.repo.git("for-each-ref", `refs/heads/lao/candidate-${id}`),
      "",
    );
  } finally {
    f.close();
  }
});

test("a candidate record links one writer attempt to its task and recorded base, and retries never duplicate it", async () => {
  const { f, id, taskId, trees, captured, input } =
    await capturedWriter("record");
  try {
    const record = createIntegrationCandidate(
      f.store,
      input,
      "candidate:first",
    );
    assert.equal(record.taskId, taskId);
    assert.equal(record.attemptId, id);
    assert.equal(record.baseSha, f.store.getAttempt(id).baseSha);
    assert.equal(record.candidateSha, captured.candidateSha);
    assert.equal(record.status, "proposed");
    // Re-capturing unchanged content yields the same commit, so the replayed
    // request maps onto the existing record.
    const again = await trees.candidate(id, []);
    assert.equal(again.candidateSha, captured.candidateSha);
    assert.deepEqual(
      createIntegrationCandidate(
        f.store,
        { ...input, candidateSha: again.candidateSha },
        "candidate:first",
      ),
      record,
    );
    assert.throws(
      () => createIntegrationCandidate(f.store, input, "candidate:second"),
      { code: "CONFLICT" },
    );
    assert.throws(
      () =>
        createIntegrationCandidate(
          f.store,
          { ...input, reportSubmitted: true },
          "candidate:first",
        ),
      { code: "CONFLICT" },
    );
    assert.throws(
      () =>
        f.store.db
          .prepare("INSERT INTO integration_candidates VALUES (?, ?, ?, ?)")
          .run(randomUUID(), taskId, id, JSON.stringify(record)),
      /UNIQUE/,
    );
    assert.deepEqual(listIntegrationCandidates(f.store, taskId), [record]);
  } finally {
    f.close();
  }
});

test("a candidate record is refused for a different base or a reader attempt", async () => {
  const { f, taskId, captured, input } = await capturedWriter("refused");
  try {
    assert.throws(
      () =>
        createIntegrationCandidate(
          f.store,
          { ...input, baseSha: captured.candidateSha },
          "candidate:wrong-base",
        ),
      { code: "INVALID_REFERENCE" },
    );
    const reader = f.queue("reader", "read_only");
    assert.throws(
      () =>
        createIntegrationCandidate(
          f.store,
          { ...input, attemptId: reader.id },
          "candidate:reader",
        ),
      { code: "POLICY_DENIED" },
    );
    assert.deepEqual(listIntegrationCandidates(f.store, taskId), []);
    assert.deepEqual(listIntegrationCandidates(f.store, reader.task.id), []);
  } finally {
    f.close();
  }
});

test("a restart between the candidate commit and its record keeps the branch for an explicit decision and never adopts it", async () => {
  const { f, id, taskId, captured, input } = await capturedWriter("restart");
  try {
    f.reopen();
    assert.equal(f.store.getAttempt(id).status, "RECOVERY_REQUIRED");
    assert.equal(f.store.getTask(taskId).status, "RETRY_DECISION");
    assert.throws(
      () =>
        createIntegrationCandidate(f.store, input, "candidate:after-restart"),
      { code: "CONFLICT" },
    );
    assert.deepEqual(listIntegrationCandidates(f.store, taskId), []);
    assert.equal(
      await f.repo.git("rev-parse", `lao/candidate-${id}`),
      captured.candidateSha,
    );
    // Capture stays deterministic, so a later recovery finds the same commit.
    const retained = new Worktrees(f.store, f.data);
    assert.equal(
      (await retained.candidate(id, [])).candidateSha,
      captured.candidateSha,
    );
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    f.close();
  }
});
