import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { git } from "../src/server/git/command.ts";
import { verifyIntegrationDiff } from "../src/server/git/integration.ts";
import { getIntegration } from "../src/server/storage/integrations.ts";
import { Store } from "../src/server/storage/store.ts";
import {
  checks,
  integrationBranches,
  node,
  owner,
  ownerCommit,
  reviewed,
} from "./helpers/integration-fixture.ts";

test("a moved destination gets a merge preview; separate edits merge cleanly and files changed on both sides are flagged", async () => {
  const f = await reviewed();
  try {
    const base = f.candidate.baseSha;
    const docs = await ownerCommit(
      f.repo,
      "docs",
      { "CHANGELOG.md": "owner change\n" },
      { from: base },
    );
    const mode = await ownerCommit(
      f.repo,
      "mode",
      {},
      {
        from: base,
        executable: "README.md",
      },
    );
    const preview = async (destinationBranch: string) => {
      const { id } = f.engine.integrations.request(
        owner,
        {
          taskId: f.original.id,
          destinationBranch,
          tests: [
            [
              node,
              "-e",
              "const fs = require('fs'); if (!fs.readFileSync('README.md', 'utf8').includes('Protocol fixture result')) process.exit(3)",
            ],
          ],
        },
        destinationBranch,
      );
      await f.engine.integrations.idle();
      return getIntegration(f.store, id);
    };
    const merged = await preview("docs");
    assert.equal(merged.status, "passed");
    assert.deepEqual(checks(merged), [
      "destination:warning",
      "candidate:passed",
      "apply:passed",
      "overlap:passed",
      "diff:passed",
      "diff_check:passed",
      "tests:passed",
      "final_destination:passed",
    ]);
    assert.equal(merged.destinationSha, docs);
    assert.deepEqual(
      [merged.drift?.commits, merged.drift?.files, merged.drift?.overlapping],
      [1, [{ status: "A", path: "CHANGELOG.md" }], []],
    );
    assert.equal(merged.drift?.baseIsAncestor, true);
    assert.deepEqual(merged.files, [{ status: "M", path: "README.md" }]);
    assert.equal(
      await f.repo.git(
        "rev-list",
        "--parents",
        "-n",
        "1",
        merged.resultSha ?? "",
      ),
      `${merged.resultSha} ${docs} ${f.candidate.candidateSha}`,
    );
    assert.equal(
      await f.repo.git("show", `${merged.resultSha}:CHANGELOG.md`),
      "owner change",
    );
    const overlapping = await preview("mode");
    assert.equal(overlapping.status, "passed");
    assert.ok(checks(overlapping).includes("overlap:warning"));
    assert.deepEqual(overlapping.drift?.overlapping, ["README.md"]);
    assert.match(
      await f.repo.git("ls-tree", overlapping.resultSha ?? "", "README.md"),
      /^100755 blob /,
    );
    assert.equal(await f.repo.git("rev-parse", "docs"), docs);
    assert.equal(await f.repo.git("rev-parse", "mode"), mode);
    assert.equal(await f.repo.git("rev-parse", "main"), base);
    assert.equal(await f.repo.git("rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    assert.equal(
      await f.repo.git("rev-parse", `lao/candidate-${f.candidate.attemptId}`),
      f.candidate.candidateSha,
    );
  } finally {
    await f.app.close();
  }
});

test("overlapping edits conflict: nothing is applied, the conflict stays for inspection and the owner is asked to resolve it", async () => {
  const f = await reviewed();
  try {
    const moved = await ownerCommit(f.repo, "main", {
      "README.md": "# Owner heading\n",
    });
    const marker = join(f.data, "tests-ran");
    const { id } = f.engine.integrations.request(
      owner,
      {
        taskId: f.original.id,
        tests: [
          [
            node,
            "-e",
            `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
          ],
        ],
      },
      "conflict",
    );
    await f.engine.integrations.idle();
    const preview = getIntegration(f.store, id);
    assert.equal(preview.status, "conflict");
    assert.deepEqual(checks(preview), [
      "destination:warning",
      "candidate:passed",
      "apply:failed",
      "tests:skipped",
    ]);
    assert.deepEqual(preview.conflicts, ["README.md"]);
    assert.deepEqual(preview.drift?.overlapping, ["README.md"]);
    assert.equal(preview.resultSha, null);
    assert.equal(preview.diffArtifactId, null);
    assert.deepEqual(preview.testResults, []);
    assert.ok(!existsSync(marker));
    assert.equal(
      await f.repo.git(
        "-C",
        preview.worktreePath,
        "diff",
        "--name-only",
        "--diff-filter=U",
      ),
      "README.md",
    );
    assert.equal(
      await f.repo.git("-C", preview.worktreePath, "rev-parse", "HEAD"),
      moved,
    );
    assert.equal(await f.repo.git("rev-parse", "main"), moved);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    assert.equal(
      await readFile(join(f.repo.directory, "README.md"), "utf8"),
      "# Owner heading\n",
    );
    assert.equal(
      await f.repo.git("rev-parse", `lao/candidate-${f.candidate.attemptId}`),
      f.candidate.candidateSha,
    );
    const requests = f.store.listHumanRequests();
    assert.equal(requests.length, 1);
    assert.deepEqual(
      requests.map((r) => [
        r.type,
        r.urgency,
        r.blocking,
        r.status,
        r.affectedTaskIds,
      ]),
      [["manual_check", "high", false, "open", [f.original.id]]],
    );
    assert.match(requests[0]?.reason ?? "", /README\.md/);
    assert.equal(f.store.getTask(f.original.id).status, "AWAITING_REVIEW");
    await f.app.close();
    const reopened = new Store(join(f.data, "state.sqlite"));
    try {
      reopened.recoverInterrupted();
      assert.deepEqual(getIntegration(reopened, id), preview);
      assert.deepEqual(reopened.listHumanRequests(), requests);
    } finally {
      reopened.close();
    }
  } finally {
    if (f.store.db.isOpen) await f.app.close();
  }
});

test("merges Git could settle silently, or cannot relate to the candidate base, fail for owner review", async () => {
  const f = await reviewed();
  try {
    await ownerCommit(
      f.repo,
      "union",
      {
        ".gitattributes": "README.md merge=union\n",
        "README.md": "# Owner heading\n",
      },
      { from: f.candidate.baseSha },
    );
    const emptyTree = await f.repo.git(
      "hash-object",
      "-t",
      "tree",
      "/dev/null",
    );
    const unrelated = await f.repo.git(
      "-c",
      "user.name=Owner",
      "-c",
      "user.email=owner@example.invalid",
      "commit-tree",
      emptyTree,
      "-m",
      "Unrelated history",
    );
    await f.repo.git("branch", "unrelated", unrelated);
    const union = f.engine.integrations.request(
      owner,
      { taskId: f.original.id, destinationBranch: "union" },
      "union",
    );
    await f.engine.integrations.idle();
    const silent = getIntegration(f.store, union.id);
    assert.equal(silent.status, "failed");
    assert.deepEqual(silent.conflicts, []);
    assert.ok(checks(silent).includes("overlap:failed"));
    assert.ok(checks(silent).includes("tests:skipped"));
    assert.match(
      silent.checks.find((c) => c.name === "overlap")?.detail ?? "",
      /README\.md/,
    );
    const foreign = f.engine.integrations.request(
      owner,
      { taskId: f.original.id, destinationBranch: "unrelated" },
      "unrelated",
    );
    await f.engine.integrations.idle();
    const refused = getIntegration(f.store, foreign.id);
    assert.equal(refused.status, "failed");
    assert.deepEqual(checks(refused), ["destination:failed"]);
    assert.equal(refused.destinationSha, unrelated);
    assert.ok(!existsSync(dirname(refused.worktreePath)));
    assert.equal(
      (await integrationBranches(f.repo)).split("\n").length,
      1,
      "only the union preview created an integration branch",
    );
    assert.equal(await f.repo.git("rev-parse", "unrelated"), unrelated);
  } finally {
    await f.app.close();
  }
});

test("diff verification rejects results that add unreviewed paths or alter candidate content outside overlapping files", async () => {
  const f = await reviewed();
  try {
    const { baseSha, candidateSha } = f.candidate;
    const root = f.repo.directory;
    // Hand-built merge results: a real merge cannot produce these, a faulty or
    // tampered integration step could.
    const result = async (path: string, content: string) => {
      const file = join(f.data, "blob.txt");
      await writeFile(file, content);
      const env = { GIT_INDEX_FILE: join(f.data, "crafted.index") };
      await git(root, ["read-tree", candidateSha], env);
      const blob = (await git(root, ["hash-object", "-w", file])).trim();
      await git(
        root,
        ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`],
        env,
      );
      const tree = (await git(root, ["write-tree"], env)).trim();
      return (
        await git(
          root,
          ["commit-tree", tree, "-p", baseSha, "-p", candidateSha, "-m", "x"],
          {
            GIT_AUTHOR_NAME: "Fixture",
            GIT_AUTHOR_EMAIL: "fixture@example.invalid",
            GIT_COMMITTER_NAME: "Fixture",
            GIT_COMMITTER_EMAIL: "fixture@example.invalid",
          },
        )
      ).trim();
    };
    const refs = {
      baseSha,
      candidateSha,
      destinationSha: baseSha,
      mergeBase: baseSha,
    };
    const extra = await verifyIntegrationDiff(root, {
      ...refs,
      resultSha: await result("extra.txt", "not reviewed\n"),
    });
    assert.deepEqual(
      [extra.unreviewed, extra.altered],
      [["extra.txt"], ["extra.txt"]],
    );
    const altered = await verifyIntegrationDiff(root, {
      ...refs,
      resultSha: await result("README.md", "tampered\n"),
    });
    assert.deepEqual(
      [altered.unreviewed, altered.altered],
      [[], ["README.md"]],
    );
    const faithful = await verifyIntegrationDiff(root, {
      ...refs,
      resultSha: candidateSha,
    });
    assert.deepEqual([faithful.unreviewed, faithful.altered], [[], []]);
  } finally {
    await f.app.close();
  }
});
