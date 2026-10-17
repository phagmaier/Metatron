import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "../src/server/orchestration/engine.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

test("FAKE dependency demo: independent execution finishes during a human wait; descendants launch only after DONE and never replay on restart", async () => {
  const f = await domainFixture();
  const git = await createGitFixture();
  let engine = new Engine(f.store, f.directory);
  try {
    const project = await engine.openProject(
      { name: "FAKE dependency demo", repositoryPath: git.directory },
      "demo-project",
    );
    const run = f.store.createRun(
      {
        projectId: project.id,
        title: "FAKE dependency demo",
        initialPrompt: "Disposable fixture only",
        repository: project.repository,
        teamSnapshot: fakeTeamSnapshot,
      },
      "demo-run",
    );
    const create = (title: string, dependencyIds: string[] = []) =>
      engine.createTask(
        { runId: run.id, title, objective: title, dependencyIds },
        title,
      );
    const root = create("Prerequisite");
    const child = create("Downstream", [root.id]);
    const grandchild = create("Descendant", [child.id]);
    const other = create("Independent");
    const profileId = fakeTeamSnapshot.profiles.find(
      (p) => p.permission === "read_only",
    )?.id;
    assert.ok(profileId);
    const assign = (id: string) =>
      engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: id, profileId },
        `assign:${id}`,
      );
    assign(child.id);
    assign(grandchild.id);
    assign(other.id);
    await engine.pump();
    assert.equal(f.store.getTask(other.id).status, "RUNNING");
    const request = f.store.createHumanRequest(
      {
        runId: run.id,
        affectedTaskIds: [root.id],
        type: "environment",
        reason: "FAKE setup needed",
        suggestedAction: "Check fixture",
        blocking: true,
      },
      "demo-wait",
    );
    await engine.idle();
    assert.equal(f.store.getTask(other.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(child.id).status, "WAITING_DEPENDENCY");
    assert.equal(f.store.getTask(grandchild.id).status, "WAITING_DEPENDENCY");
    assert.equal(f.store.listAttempts().length, 1);
    f.store.updateHumanRequest(
      { id: request.id, expectedStatus: "open", status: "completed" },
      "demo-response",
    );
    await engine.idle();
    assert.equal(f.store.getTask(root.id).status, "WAITING_HUMAN");
    assert.equal(f.store.listAttempts().length, 1);
    f.store.transitionTask(
      {
        id: root.id,
        expectedStatus: "WAITING_HUMAN",
        status: "READY",
        reason: "Explicit fixture decision",
      },
      "demo-ready",
    );
    assign(root.id);
    await engine.idle();
    assert.equal(f.store.getTask(root.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(child.id).status, "WAITING_DEPENDENCY");
    // Fake workers do not produce live candidates. Only the fixture advances
    // review/integration states to exercise the dependency completion boundary.
    for (const status of ["READY_TO_INTEGRATE", "INTEGRATING", "DONE"] as const)
      f.store.transitionTask(
        {
          id: root.id,
          expectedStatus: f.store.getTask(root.id).status,
          status,
          reason: "FAKE fixture completion",
        },
        `demo:${status}`,
      );
    await engine.idle();
    assert.equal(f.store.getTask(child.id).status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(grandchild.id).status, "WAITING_DEPENDENCY");
    assert.equal(f.store.listAttempts().length, 3);
    assert.equal(
      f.store.db.prepare("SELECT count(*) n FROM reservations").get()?.n,
      0,
    );
    const tasks = f.store.listTasks();
    const attempts = f.store.listAttempts();
    await engine.close();
    f.reopen().recoverInterrupted();
    engine = new Engine(f.store, f.directory);
    await engine.idle();
    assert.deepEqual(f.store.listTasks(), tasks);
    assert.deepEqual(f.store.listAttempts(), attempts);
    assert.equal(await git.git("status", "--porcelain"), "");
  } finally {
    await engine.close();
    await f.close();
    await git.verify(async () =>
      assert.equal(await git.git("status", "--porcelain"), ""),
    );
  }
});
