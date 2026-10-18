import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { CodexEvents } from "../src/server/adapters/codex-events.ts";
import { checkFileTool } from "../src/server/adapters/file-policy.ts";
import { checkPiTool } from "../src/server/adapters/pi-guard.ts";
import { git } from "../src/server/git/command.ts";
import { inspectRepository } from "../src/server/git/inspect.ts";
import { worktreeState } from "../src/server/git/integration.ts";
import { sensitivePath } from "../src/server/git/paths.ts";
import { Worktrees } from "../src/server/git/worktrees.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";
import { worktreeFixture } from "./helpers/worktree-fixture.ts";

test("Pi refuses writes through dangling file and parent symlinks before native execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lao-pi-path-audit-"));
  try {
    const root = join(directory, "checkout");
    await mkdir(root);
    await symlink(join(directory, "outside-file"), join(root, "file-link"));
    await symlink(join(directory, "outside-dir"), join(root, "parent-link"));
    for (const path of ["file-link", "parent-link/new.txt"])
      assert.equal(
        (
          await checkPiTool(root, "workspace_write", {
            toolName: "write",
            input: { path },
          })
        )?.block,
        true,
        path,
      );
    await assert.rejects(access(join(directory, "outside-file")));
    await assert.rejects(access(join(directory, "outside-dir")));
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("native file policies and candidate capture refuse credential-store paths", async () => {
  const f = await worktreeFixture();
  try {
    const { id } = f.queue("credential-path-audit");
    const trees = new Worktrees(f.store, f.data);
    const tree = await trees.prepare(id);
    const paths = [
      ".git-credentials",
      ".gitconfig",
      ".config/git/credentials",
      ".claude/.credentials.json",
      ".codex/auth.json",
      ".opencode/auth.json",
      ".config/gcloud/application_default_credentials.json",
      ".azure/accessTokens.json",
      "keys/id_ecdsa",
      "keys/id_dsa",
    ];
    for (const path of paths) {
      await mkdir(dirname(join(tree.path, path)), { recursive: true });
      await writeFile(join(tree.path, path), "inert-credential-canary\n");
    }
    const candidate = await trees.candidate(id, paths);
    assert.equal(candidate.status, "blocked");
    for (const path of paths) {
      assert.equal(sensitivePath(path), true, path);
      assert.equal(
        candidate.files.find((file) => file.path === path)?.disposition,
        "blocked",
        path,
      );
      assert.equal(
        (
          await checkPiTool(tree.path, "read_only", {
            toolName: "read",
            input: { path },
          })
        )?.block,
        true,
        path,
      );
      assert.equal(
        (
          await checkFileTool(tree.path, "read_only", {
            toolName: "Read",
            input: { file_path: path },
          })
        )?.block,
        true,
        path,
      );
    }
    assert.equal(candidate.candidateSha, null);
    assert.equal(await f.repo.git("status", "--porcelain"), "");
  } finally {
    f.close();
  }
});

test("Codex tool lifecycle metadata never copies shell commands into the journal", () => {
  const mapper = new CodexEvents("thread", {
    model: "fixture",
    thinking: null,
  });
  mapper.start("turn");
  for (const method of ["item/started", "item/completed"]) {
    const events = mapper.consume({
      method,
      params: {
        threadId: "thread",
        turnId: "turn",
        item: {
          id: "tool",
          type: "commandExecution",
          status: "completed",
          command: "printf '%s' 'inert-credential-canary'",
        },
      },
    });
    assert.equal(events.length, 1);
    assert.equal(
      JSON.stringify(events).includes("inert-credential-canary"),
      false,
    );
    assert.equal(
      events[0]?.type,
      method === "item/started" ? "tool_started" : "tool_finished",
    );
  }
});

for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
  test(`Git inspection refuses ${flag} instead of treating hidden owner edits as clean`, async () => {
    const f = await createGitFixture();
    await f.verify(async () => {
      const before = await f.git("rev-parse", "HEAD");
      await f.git("update-index", flag, "--", "README.md");
      await writeFile(
        join(f.directory, "README.md"),
        "Owner edits hidden from status\n",
      );
      assert.equal(await f.git("status", "--porcelain"), "");
      await assert.rejects(
        inspectRepository(f.directory),
        /index|hidden|sparse/i,
      );
      await assert.rejects(worktreeState(f.directory), /index|hidden|sparse/i);
      assert.equal(await f.git("rev-parse", "HEAD"), before);
      assert.equal(
        await f.git("show", "HEAD:README.md"),
        "# Disposable fixture",
      );
      assert.equal(
        await readFile(join(f.directory, "README.md"), "utf8"),
        "Owner edits hidden from status\n",
      );
      assert.match(
        await f.git("ls-files", "-v", "--", "README.md"),
        flag === "--assume-unchanged" ? /^h / : /^S /,
      );
    });
  });
}

for (const driver of [
  "filter.audit.clean",
  "filter.audit.smudge",
  "filter.audit.process",
  "merge.audit.driver",
]) {
  test(`app Git refuses executable ${driver} before a repository operation`, async () => {
    const f = await createGitFixture();
    await f.verify(async () => {
      const probe = join(dirname(f.directory), "filter-probe");
      await writeFile(probe, '#!/bin/sh\n: > "$0.ran"\ncat\n');
      await chmod(probe, 0o700);
      await writeFile(
        join(f.directory, ".gitattributes"),
        "README.md filter=audit\n",
      );
      await f.git("add", "--", ".gitattributes");
      await f.git(
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-m",
        "Filter fixture",
      );
      // Git interprets filter configuration as shell code; quote this inert fixture path.
      await f.git("config", driver, `'${probe.replaceAll("'", "'\\''")}'`);
      await writeFile(join(f.directory, "README.md"), "Changed\n");
      await assert.rejects(
        git(f.directory, ["status", "--porcelain"]),
        (error: Error) => {
          assert.match(error.message, /filter|driver/i);
          assert.equal(error.message.includes(probe), false);
          return true;
        },
      );
      await assert.rejects(access(`${probe}.ran`));
    });
  });
}
