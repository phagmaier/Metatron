import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { inspectRepository } from "../src/server/git/inspect.ts";
import { runSchema } from "../src/shared/domain/entities.ts";
import { projectSwitchFixture } from "./helpers/project-switch-fixture.ts";

test("opening B while A runs, returning to A, and restarting never rebinds threads, worktrees or messages", async () => {
  const f = await projectSwitchFixture();
  let passed = false;
  try {
    const runs = [];
    for (const project of f.projects) {
      runs.push(
        runSchema.parse(
          await f.write("runs/lead", {
            projectId: project.id,
            title: `FIXTURE ${project.id}`,
            initialPrompt: `Only project ${project.id}`,
            mode: "autonomous_bounded",
            lead: { model: "fixture-model", thinking: "low" },
            worker: { model: "fixture/model", thinking: "off" },
          }),
        ),
      );
    }
    await f.engine.idle();
    const sessions = f.engine.store.listSessions();
    const worktrees = f.engine.worktrees.list();
    assert.equal(worktrees.length, 2);
    for (const [index, run] of runs.entries()) {
      const repo = f.repos[index];
      assert.ok(repo);
      const tasks = f.engine.store.listTasks(run.id);
      const writer = tasks.find((task) => task.kind === "work");
      assert.equal(writer?.status, "AWAITING_REVIEW");
      const leads = sessions.filter((s) =>
        tasks.some(
          (t) =>
            t.kind === "lead" &&
            t.id === f.engine.store.getAttempt(s.attemptId).taskId,
        ),
      );
      assert.equal(leads.length, 2);
      assert.equal(leads[0]?.nativeSessionId, leads[1]?.nativeSessionId);
      const manifest = worktrees.find(
        (w) => f.engine.store.getAttempt(w.attemptId).taskId === writer?.id,
      );
      assert.ok(manifest);
      await f.engine.worktrees.verify(manifest);
      assert.equal(
        (await inspectRepository(manifest.path)).commonDirectory,
        join(repo.directory, ".git"),
      );
      assert.equal(manifest.repository.baseSha, f.baselines[index]);
      assert.equal(
        await readFile(join(manifest.path, "README.md"), "utf8"),
        "Protocol fixture result\n",
      );
      assert.equal(
        await readFile(join(repo.directory, "README.md"), "utf8"),
        `# Project ${index === 0 ? "A" : "B"}\n`,
      );
    }
    const [a, b] = runs;
    assert.ok(a && b);
    const ownRun = (attemptId: string) =>
      f.engine.store.getTask(f.engine.store.getAttempt(attemptId).taskId).runId;
    const idsA = sessions
      .filter((s) => ownRun(s.attemptId) === a.id)
      .map((s) => s.nativeSessionId);
    assert.ok(
      sessions
        .filter((s) => ownRun(s.attemptId) === b.id)
        .every((s) => !idsA.includes(s.nativeSessionId)),
    );
    const firstA = sessions.find(
      (s) => ownRun(s.attemptId) === a.id && s.adapter === "codex",
    );
    assert.ok(firstA);
    const foreign = f.engine.createTask(
      { runId: b.id, title: "Foreign resume", objective: "Must never launch" },
      "foreign-task",
    );
    const reader = b.teamSnapshot?.profiles.find(
      (p) => p.permission === "read_only",
    );
    assert.ok(reader);
    assert.throws(
      () =>
        f.engine.scheduling.enqueue(
          { role: "owner" },
          {
            taskId: foreign.id,
            profileId: reader.id,
            contextPolicy: "resume",
            resumeSessionId: firstA.id,
          },
          "foreign-resume",
        ),
      { code: "POLICY_DENIED" },
    );
    const before = f.engine.store.listAttempts();
    const bSessions = sessions.filter((s) => ownRun(s.attemptId) === b.id);
    await f.restart();
    assert.deepEqual(f.engine.store.listSessions(), sessions);
    assert.deepEqual(f.engine.store.listAttempts(), before);
    await f.write("projects", {
      name: "FIXTURE Project A reopened",
      repositoryPath: f.projects[0]?.repositoryPath,
    });
    await f.write("runs/messages", {
      runId: a.id,
      text: "A_ONLY_AFTER_SWITCH",
    });
    await f.engine.idle();
    const after = f.engine.store.listSessions();
    assert.equal(after.length, sessions.length + 1);
    assert.equal(after.at(-1)?.nativeSessionId, firstA.nativeSessionId);
    assert.deepEqual(
      after.filter((s) => ownRun(s.attemptId) === b.id),
      bSessions,
    );
    assert.equal(
      f.engine.store
        .events({ runId: b.id, limit: 500 })
        .some((e) => e.payload.text === "A_ONLY_AFTER_SWITCH"),
      false,
    );
    assert.deepEqual(f.engine.worktrees.list(), worktrees);
    const log = await f.logs();
    assert.equal(log.filter((l) => l.method === "thread/start").length, 2);
    assert.equal(log.filter((l) => l.method === "thread/resume").length, 3);
    assert.equal(f.engine.store.listAttempts().length, before.length + 1);
    assert.equal(
      f.engine.store
        .listAttempts()
        .some((attempt) => attempt.taskId === foreign.id),
      false,
    );
    // Native session directories are allocated per attempt, never by UI selection.
    const dirs = f.launches
      .filter((l) => l.harness === "pi" && l.args.includes("--session-dir"))
      .map((l) => l.args[l.args.indexOf("--session-dir") + 1]);
    assert.equal(dirs.length, 2);
    assert.equal(new Set(dirs).size, 2);
    passed = true;
  } finally {
    await f.close(passed);
  }
});
