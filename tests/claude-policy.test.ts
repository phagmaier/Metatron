import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { checkClaudeTool } from "../src/server/adapters/claude-policy.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

test("Claude policy permits explicit safe reads, searches and workspace mutations", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    await mkdir(join(f.directory, "src"));
    await writeFile(join(f.directory, "src", "safe.ts"), "export {};\n");
    for (const permission of ["read_only", "workspace_write"]) {
      for (const file_path of [
        "README.md",
        join(f.directory, "src", "safe.ts"),
      ])
        assert.equal(
          await checkClaudeTool(f.directory, permission, {
            toolName: "Read",
            input: { file_path },
          }),
          undefined,
        );
      for (const toolName of ["Grep", "Glob"])
        for (const path of [undefined, ".", "src", "src/safe.ts"])
          assert.equal(
            await checkClaudeTool(f.directory, permission, {
              toolName,
              input: {
                ...(path === undefined ? {} : { path }),
                pattern: "**/*.ts",
              },
            }),
            undefined,
          );
    }
    for (const toolName of ["Edit", "Write"])
      assert.equal(
        await checkClaudeTool(f.directory, "workspace_write", {
          toolName,
          input: { file_path: "README.md" },
        }),
        undefined,
      );
    for (const file_path of ["new.txt", "new/sub/file.txt"])
      assert.equal(
        await checkClaudeTool(f.directory, "workspace_write", {
          toolName: "Write",
          input: { file_path },
        }),
        undefined,
      );
    // An assigned-root alias must not silently replace the assigned checkout.
    const alias = join(f.directory, "root-alias");
    await symlink(f.directory, alias);
    assert.equal(
      (
        await checkClaudeTool(alias, "read_only", {
          toolName: "Read",
          input: { file_path: "README.md" },
        })
      )?.block,
      true,
    );
  });
});

test("Claude policy denies writer tools for readers and all tools for invalid profiles", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    for (const toolName of ["Edit", "Write"])
      assert.equal(
        (
          await checkClaudeTool(f.directory, "read_only", {
            toolName,
            input: { file_path: "README.md" },
          })
        )?.block,
        true,
      );
    for (const permission of ["coordinator", "", "invalid", "WORKSPACE_WRITE"])
      for (const toolName of [
        "Read",
        "Grep",
        "Glob",
        "Edit",
        "Write",
        "mcp__lao__submit_result",
      ])
        assert.equal(
          (
            await checkClaudeTool(
              f.directory,
              permission,
              { toolName, input: { file_path: "README.md" } },
              true,
            )
          )?.block,
          true,
        );
  });
});

test("Claude policy requires valid file paths and distinguishes absent new files", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    for (const toolName of ["Read", "Edit", "Write"])
      for (const input of [
        {},
        { path: "README.md" },
        { file_path: null },
        { file_path: false },
        { file_path: 1 },
        { file_path: {} },
        { file_path: [] },
        { file_path: "" },
        { file_path: "README.md\0" },
        { file_path: "." },
        { file_path: "README.md/child" },
      ])
        assert.equal(
          (
            await checkClaudeTool(f.directory, "workspace_write", {
              toolName,
              input,
            })
          )?.block,
          true,
        );
    for (const toolName of ["Read", "Edit"])
      assert.equal(
        (
          await checkClaudeTool(f.directory, "workspace_write", {
            toolName,
            input: { file_path: "missing/sub/file.txt" },
          })
        )?.block,
        true,
      );
    for (const toolName of ["Grep", "Glob"])
      for (const path of [null, false, 1, {}, [], "", "src\0", "missing"])
        assert.equal(
          (
            await checkClaudeTool(f.directory, "read_only", {
              toolName,
              input: { path },
            })
          )?.block,
          true,
        );
  });
});

test("Claude policy blocks traversal, absolute escapes and search scope overrides", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    for (const path of [
      "../README.md",
      "src/../../README.md",
      "src/../README.md",
      "/etc/passwd",
      join(`${f.directory}-outside`, "README.md"),
    ])
      for (const toolName of ["Read", "Edit", "Write", "Grep", "Glob"])
        assert.equal(
          (
            await checkClaudeTool(f.directory, "workspace_write", {
              toolName,
              input: { path, file_path: path },
            })
          )?.block,
          true,
        );
    for (const toolName of ["Grep", "Glob"])
      for (const selector of [
        "../*",
        "/etc/*",
        "**/../*",
        ".git/**",
        ".claude/**",
        ".env",
        "bad\0",
        "{../outside,safe}",
        "{/etc,src}/*",
        "@(../outside|src)",
        "[.][.]/*",
        "\\../*",
        null,
        1,
      ])
        assert.equal(
          (
            await checkClaudeTool(f.directory, "read_only", {
              toolName,
              input: { [toolName === "Glob" ? "pattern" : "glob"]: selector },
            })
          )?.block,
          true,
        );
  });
});

test("Claude policy denies symlinked files and parents, including safe and dangling targets", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    await mkdir(join(f.directory, "safe"));
    await writeFile(join(f.directory, "safe", "file.txt"), "fixture\n");
    await symlink("safe/file.txt", join(f.directory, "file-link"));
    await symlink("safe", join(f.directory, "parent-link"));
    await symlink("..", join(f.directory, "outside-link"));
    await symlink("absent", join(f.directory, "dangling-link"));
    await symlink("loop", join(f.directory, "loop"));
    for (const path of [
      "file-link",
      "parent-link/file.txt",
      "parent-link/new.txt",
      "outside-link/escaped.txt",
      "dangling-link",
      "dangling-link/new/sub.txt",
      "loop",
      "loop/new.txt",
    ])
      for (const toolName of ["Read", "Edit", "Write", "Grep", "Glob"])
        assert.equal(
          (
            await checkClaudeTool(f.directory, "workspace_write", {
              toolName,
              input: { path, file_path: path },
            })
          )?.block,
          true,
        );
    for (const toolName of ["Grep", "Glob"])
      assert.equal(
        (
          await checkClaudeTool(f.directory, "read_only", {
            toolName,
            input: {},
          })
        )?.block,
        true,
      );
  });
});

test("Claude policy blocks sensitive files, config trees and recursive secret descendants", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    for (const name of [
      ".env",
      ".env.local",
      ".pi",
      ".aws",
      ".ssh",
      ".npmrc",
      ".netrc",
      ".pypirc",
      ".pgpass",
      "id_rsa",
      "id_ed25519.pub",
      "secrets.json",
      "credentials.json",
      "auth.json",
      "private.pem",
      "private.key",
      "private.p12",
      "private.pfx",
      ".claude",
      ".CLAUDE",
      ".git",
    ]) {
      const scope = `scope-${name.replaceAll(".", "-")}`;
      await mkdir(join(f.directory, scope, "nested"), { recursive: true });
      // Real Git metadata stays in the root; nested fixtures exercise the skip.
      if (name !== ".git")
        await writeFile(
          join(f.directory, scope, "nested", name),
          "fixture secret\n",
        );
      for (const toolName of ["Read", "Edit", "Write", "Grep", "Glob"])
        assert.equal(
          (
            await checkClaudeTool(f.directory, "workspace_write", {
              toolName,
              input: {
                path: `${scope}/nested/${name}`,
                file_path: `${scope}/nested/${name}`,
              },
            })
          )?.block,
          true,
        );
      if (name !== ".git")
        for (const toolName of ["Grep", "Glob"])
          assert.equal(
            (
              await checkClaudeTool(f.directory, "read_only", {
                toolName,
                input: { path: scope },
              })
            )?.block,
            true,
          );
    }
    await mkdir(join(f.directory, "config", ".claude"), { recursive: true });
    await writeFile(
      join(f.directory, "config", ".claude", "settings.json"),
      "{}\n",
    );
    await mkdir(join(f.directory, "isolated"));
    for (const toolName of ["Read", "Edit", "Write", "Grep", "Glob"])
      for (const path of [
        ".git/config",
        "config/.claude/settings.json",
        "new/.claude/settings.json",
      ])
        assert.equal(
          (
            await checkClaudeTool(f.directory, "workspace_write", {
              toolName,
              input: { path, file_path: path },
            })
          )?.block,
          true,
        );
    for (const toolName of ["Grep", "Glob"]) {
      assert.equal(
        (
          await checkClaudeTool(f.directory, "read_only", {
            toolName,
            input: {},
          })
        )?.block,
        true,
      );
      assert.equal(
        await checkClaudeTool(f.directory, "read_only", {
          toolName,
          input: { path: "isolated" },
        }),
        undefined,
      );
    }
  });
});

test("Claude policy permits only the five gateway worker tools, never lead or other tools", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    for (const name of [
      "read_assignment",
      "report_progress",
      "submit_result",
      "report_issue",
      "request_human_action",
    ])
      for (const permission of ["read_only", "workspace_write"]) {
        const event = { toolName: `mcp__lao__${name}`, input: {} };
        assert.equal(
          (await checkClaudeTool(f.directory, permission, event))?.block,
          true,
        );
        assert.equal(
          await checkClaudeTool(f.directory, permission, event, true),
          undefined,
        );
      }
    for (const toolName of [
      "Bash",
      "Agent",
      "Task",
      "TaskCreate",
      "TaskOutput",
      "TaskStop",
      "WebFetch",
      "WebSearch",
      "Skill",
      "NotebookEdit",
      "AskUserQuestion",
      "EnterPlanMode",
      "ExitPlanMode",
      "Config",
      "ToolSearch",
      "read",
      "Unknown",
      "mcp__lao__assign_task",
      "mcp__lao__create_task",
      "mcp__lao__approve_candidate",
      "mcp__other__read_assignment",
      "mcp__lao__submit_result_extra",
    ])
      for (const gateway of [false, true])
        assert.equal(
          (
            await checkClaudeTool(
              f.directory,
              "workspace_write",
              { toolName, input: { file_path: "README.md" } },
              gateway,
            )
          )?.block,
          true,
        );
  });
});

test("Claude policy fails closed for missing, non-directory and unverifiable assigned roots", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    await symlink("root-loop", join(f.directory, "root-loop"));
    for (const root of [
      "",
      ".",
      "bad\0root",
      join(f.directory, "absent"),
      join(f.directory, "README.md"),
      join(f.directory, "root-loop"),
    ])
      for (const toolName of ["Read", "Grep", "Glob", "Edit", "Write"])
        assert.equal(
          (
            await checkClaudeTool(root, "workspace_write", {
              toolName,
              input: { file_path: "README.md" },
            })
          )?.block,
          true,
        );
  });
});

test("Claude policy rejects an assigned checkout replaced by a symlink to another checkout", async () => {
  const assigned = await createGitFixture();
  const other = await createGitFixture();
  await assigned.verify(async () => {
    await other.verify(async () => {
      const relocated = join(assigned.directory, "..", "relocated-checkout");
      await rename(assigned.directory, relocated);
      try {
        await symlink(other.directory, assigned.directory);
        try {
          for (const toolName of ["Read", "Write", "Glob"])
            assert.equal(
              (
                await checkClaudeTool(assigned.directory, "workspace_write", {
                  toolName,
                  input: {
                    file_path: "README.md",
                    path: ".",
                    pattern: "**/*",
                  },
                })
              )?.block,
              true,
            );
        } finally {
          await unlink(assigned.directory);
        }
      } finally {
        await rename(relocated, assigned.directory);
      }
    });
  });
});

test("Claude policy fails closed on inaccessible roots, files and recursive descendants", {
  skip: process.getuid?.() === 0,
}, async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    const locked = join(f.directory, "locked");
    const unreadable = join(f.directory, "unreadable.txt");
    await mkdir(locked);
    await writeFile(unreadable, "fixture\n");
    await chmod(locked, 0);
    await chmod(unreadable, 0);
    try {
      assert.equal(
        (
          await checkClaudeTool(locked, "read_only", {
            toolName: "Read",
            input: { file_path: "file.txt" },
          })
        )?.block,
        true,
      );
      for (const toolName of ["Read", "Edit", "Write"])
        assert.equal(
          (
            await checkClaudeTool(f.directory, "workspace_write", {
              toolName,
              input: { file_path: "unreadable.txt" },
            })
          )?.block,
          true,
        );
      for (const toolName of ["Grep", "Glob"])
        assert.equal(
          (
            await checkClaudeTool(f.directory, "read_only", {
              toolName,
              input: {},
            })
          )?.block,
          true,
        );
      assert.equal(
        (
          await checkClaudeTool(f.directory, "workspace_write", {
            toolName: "Write",
            input: { file_path: "locked/new/file.txt" },
          })
        )?.block,
        true,
      );
    } finally {
      await chmod(locked, 0o700);
      await chmod(unreadable, 0o600);
    }
  });
});

test("Claude policy reasons never echo raw paths, payloads or filesystem errors", async () => {
  const f = await createGitFixture();
  await f.verify(async () => {
    const marker = "DO_NOT_ECHO_POLICY_PAYLOAD";
    for (const event of [
      {
        toolName: "Read",
        input: { file_path: `../${marker}`, secret: marker },
      },
      {
        toolName: "Write",
        input: { file_path: `${marker}.key`, content: marker },
      },
      { toolName: marker, input: { command: marker } },
      { toolName: "Glob", input: { pattern: `../${marker}` } },
      { toolName: "Read", input: { file_path: marker } },
    ]) {
      const result = await checkClaudeTool(
        f.directory,
        "workspace_write",
        event,
      );
      assert.equal(result?.block, true);
      assert.ok(result);
      assert.equal(result.reason.includes(marker), false);
      assert.equal(result.reason.includes(f.directory), false);
      assert.equal(result.reason.includes("ENOENT"), false);
      assert.equal(result.reason.includes("EACCES"), false);
    }
  });
});
