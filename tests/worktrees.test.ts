import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkPiTool } from "../src/server/adapters/pi-guard.ts";
import { git } from "../src/server/git/command.ts";
import { inspectRepository } from "../src/server/git/inspect.ts";
import { Worktrees } from "../src/server/git/worktrees.ts";
import { worktreeFixture as fixture } from "./helpers/worktree-fixture.ts";

test("native attempts edit the same filename independently, retain ownership and capture all Git states", async () => {
  const f = await fixture();
  try {
    const a = f.queue("first"),
      b = f.queue("second");
    const trees = new Worktrees(f.store, f.data);
    const wa = await trees.prepare(a.id),
      wb = await trees.prepare(b.id);
    assert.notEqual(wa.path, wb.path);
    assert.notEqual(wa.branch, wb.branch);
    assert.equal((await trees.prepare(a.id)).path, wa.path);
    await writeFile(join(wa.path, "README.md"), "First writer\n");
    await writeFile(join(wb.path, "README.md"), "Second writer\n");
    await writeFile(join(wa.path, "new.txt"), "New file\n");
    await writeFile(join(wa.path, ".env"), "DO_NOT_READ=test\n");
    const capture = await trees.capture(a.id);
    assert.ok(
      capture.files.some((p) => p.path === "README.md" && p.status === " M"),
    );
    assert.ok(
      capture.files.some((p) => p.path === "new.txt" && p.status === "??"),
    );
    assert.ok(capture.files.some((p) => p.path === ".env" && p.sensitive));
    await git(wa.path, ["add", "--", "new.txt"]);
    await writeFile(join(wa.path, ".gitignore"), "ignored.txt\n");
    await writeFile(join(wa.path, "ignored.txt"), "Ignored artifact\n");
    const staged = await trees.capture(a.id);
    assert.ok(
      staged.files.some((p) => p.path === "new.txt" && p.status === "A "),
    );
    assert.ok(
      staged.files.some((p) => p.path === "ignored.txt" && p.status === "!!"),
    );
    assert.match(staged.stagedDiffStat, /new.txt/);
    await writeFile(join(wa.path, "README.md"), "Trailing whitespace \n");
    assert.equal((await trees.capture(a.id)).diffCheck, "failed");
    assert.equal(
      await readFile(join(wb.path, "README.md"), "utf8"),
      "Second writer\n",
    );
    assert.equal(
      await readFile(join(f.repo.directory, "README.md"), "utf8"),
      "# Disposable fixture\n",
    );
    assert.equal(await f.repo.git("status", "--porcelain"), "");
    f.reopen();
    const retained = new Worktrees(f.store, f.data);
    assert.equal(retained.list().length, 2);
    assert.ok(retained.list().every((tree) => tree.state === "retained"));
    assert.equal(f.store.getTask(a.task.id).status, "RETRY_DECISION");
    assert.equal(f.store.getAttempt(a.id).worktreePath, wa.path);
    assert.equal(
      await readFile(join(wa.path, "README.md"), "utf8"),
      "Trailing whitespace \n",
    );
    assert.equal(
      f.store.db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
      0,
    );
    await writeFile(
      join(
        f.data,
        "worktrees",
        wa.path.split("/").at(-2) ?? "",
        "ownership.json",
      ),
      "{}",
    );
    await assert.rejects(retained.verify(wa));
    assert.equal(
      await readFile(join(wa.path, "new.txt"), "utf8"),
      "New file\n",
    );
  } finally {
    f.close();
  }
});
test("worktree creation rejects base drift and redirected app-data paths", async () => {
  const f = await fixture();
  try {
    const queued = f.queue("drift");
    await f.repo.git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Owner advances HEAD",
    );
    await assert.rejects(
      new Worktrees(f.store, f.data).prepare(queued.id),
      /base changed/,
    );
    assert.equal(new Worktrees(f.store, f.data).list().length, 0);
  } finally {
    f.close();
  }
  const g = await fixture();
  try {
    const queued = g.queue("redirected");
    const alias = `${g.data}-alias`;
    await symlink(g.data, alias);
    await assert.rejects(
      new Worktrees(g.store, alias).prepare(queued.id),
      /canonical/,
    );
    assert.equal(new Worktrees(g.store, g.data).list().length, 0);
  } finally {
    g.close();
  }
});
test("worktree creation refuses a dirty/drifted root and never replays an ambiguous creation", async () => {
  const f = await fixture();
  try {
    const a = f.queue("dirty");
    const trees = new Worktrees(f.store, f.data);
    await writeFile(join(f.repo.directory, "owner.txt"), "Owner work\n");
    await assert.rejects(trees.prepare(a.id), /dirty/);
    assert.equal(
      await readFile(join(f.repo.directory, "owner.txt"), "utf8"),
      "Owner work\n",
    );
    assert.equal(trees.list().length, 0);
  } finally {
    f.close();
  }
  const g = await fixture();
  try {
    const a = g.queue("ambiguous");
    const trees = new Worktrees(g.store, g.data);
    const wa = await trees.prepare(a.id);
    g.store.db
      .prepare(
        "UPDATE worktrees SET data=json_set(data,'$.state','creating') WHERE attempt_id=?",
      )
      .run(a.id);
    await assert.rejects(trees.prepare(a.id), /never replay/);
    assert.equal(
      (await inspectRepository(wa.path)).baseSha,
      wa.repository.baseSha,
    );
  } finally {
    g.close();
  }
});
test("Pi file guard denies mutations to readers, path escapes, sensitive files, symlinks and shell/delegation tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lao-guard-"));
  await writeFile(join(dir, "safe.txt"), "Safe");
  assert.equal(
    await checkPiTool(dir, "read_only", {
      toolName: "read",
      input: { path: "safe.txt" },
    }),
    undefined,
  );
  for (const event of [
    { toolName: "write", input: { path: "safe.txt" } },
    { toolName: "read", input: { path: "../outside" } },
    { toolName: "read", input: { path: ".env" } },
    { toolName: "bash", input: { command: "pwd" } },
    { toolName: "assign_task", input: {} },
    { toolName: "mcp__lao__submit_result", input: {} },
  ])
    assert.equal((await checkPiTool(dir, "read_only", event))?.block, true);
  // With the gateway, only the worker's own report tools pass the guard.
  assert.equal(
    await checkPiTool(
      dir,
      "read_only",
      { toolName: "mcp__lao__submit_result", input: {} },
      true,
    ),
    undefined,
  );
  for (const toolName of ["mcp__lao__assign_task", "mcp__other__read_file"])
    assert.equal(
      (await checkPiTool(dir, "read_only", { toolName, input: {} }, true))
        ?.block,
      true,
    );
  assert.equal(
    await checkPiTool(dir, "workspace_write", {
      toolName: "write",
      input: { path: "new/sub/file.txt" },
    }),
    undefined,
  );
  await symlink("/tmp", join(dir, "escape"));
  assert.equal(
    (
      await checkPiTool(dir, "workspace_write", {
        toolName: "write",
        input: { path: "escape/other.txt" },
      })
    )?.block,
    true,
  );
  assert.equal(
    (
      await checkPiTool(dir, "read_only", {
        toolName: "grep",
        input: { path: "." },
      })
    )?.block,
    true,
  );
  await writeFile(join(dir, ".env"), "Secret fixture");
  await symlink(".env", join(dir, "alias"));
  assert.equal(
    (
      await checkPiTool(dir, "read_only", {
        toolName: "read",
        input: { path: "alias" },
      })
    )?.block,
    true,
  );
});
