import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { inspectRepository, requireClean } from "../src/server/git/inspect.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

test("Git inspection captures canonical identity, branch and base without changing a checkout", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    const before = await f.git("rev-parse", "HEAD");
    const repository = await inspectRepository(f.directory);
    assert.equal(repository.baseSha, before);
    assert.equal(repository.branch, "main");
    assert.equal(repository.root, f.directory);
    assert.equal(repository.clean, true);
    await symlink(f.directory, join(f.directory, "../alias"));
    assert.deepEqual(
      await inspectRepository(join(f.directory, "../alias")),
      repository,
    );
    assert.equal(await f.git("status", "--porcelain"), "");
    await mkdir(join(f.directory, "nested"));
    await assert.rejects(
      inspectRepository(join(f.directory, "nested")),
      /repository root/,
    );
  });
});
test("dirty tracked, staged and untracked files are refused and preserved", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    await writeFile(join(f.directory, "README.md"), "owner changes\n");
    await writeFile(join(f.directory, "untracked $(touch nope).txt"), "keep\n");
    const before = await f.git("diff");
    const repository = await inspectRepository(f.directory);
    assert.equal(repository.clean, false);
    assert.throws(() => requireClean(repository), /dirty/);
    assert.equal(await f.git("diff"), before);
    await f.git("add", "--", "README.md");
    assert.equal((await inspectRepository(f.directory)).clean, false);
  });
});
test("missing directories, relative paths and non-repositories fail explicitly", async () => {
  await assert.rejects(inspectRepository("relative"));
  await assert.rejects(inspectRepository("/tmp/lao-no-such-repo-for-test"), {
    code: "GIT",
  });
  const f = await createGitFixture();
  await f.verify(async () => {
    await assert.rejects(inspectRepository(join(f.directory, "..")), {
      code: "GIT",
    });
  });
});
