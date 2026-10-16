import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createGitFixture } from "./helpers/git-fixture.ts";

test("fixture starts with a committed clean main branch and cleans up after verification", async () => {
  const fixture = await createGitFixture();
  await fixture.verify(async () => {
    assert.equal(await fixture.git("branch", "--show-current"), "main");
    assert.equal(await fixture.git("status", "--porcelain"), "");
    assert.match(await fixture.git("rev-parse", "HEAD"), /^[a-f0-9]{40}$/);
  });
  await assert.rejects(access(dirname(fixture.directory)), { code: "ENOENT" });
});

test("failed verification preserves the repository and uncommitted evidence", async () => {
  const fixture = await createGitFixture();
  await writeFile(join(fixture.directory, "evidence.txt"), "preserve me");
  await assert.rejects(
    fixture.verify(async () => {
      throw new Error("Deliberate fixture failure");
    }),
    /Deliberate fixture failure/,
  );
  await fixture.verify(async () => {
    assert.equal(
      await readFile(join(fixture.directory, "evidence.txt"), "utf8"),
      "preserve me",
    );
    assert.equal(await fixture.git("status", "--porcelain"), "?? evidence.txt");
  });
});

test("cleanup refuses a changed ownership marker", async () => {
  const fixture = await createGitFixture();
  const marker = join(dirname(fixture.directory), ".fixture-owner");
  const original = await readFile(marker, "utf8");
  await writeFile(marker, "replaced");
  await assert.rejects(
    fixture.verify(async () => {}),
    /ownership changed/,
  );
  await fixture.verify(async () => {
    await access(fixture.directory);
    await writeFile(marker, original);
  });
});
