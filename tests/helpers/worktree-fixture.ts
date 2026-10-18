import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepository } from "../../src/server/git/inspect.ts";
import { Scheduling } from "../../src/server/storage/scheduling.ts";
import { Store } from "../../src/server/storage/store.ts";
import { nativeTeam } from "../../src/shared/native.ts";
import { createGitFixture } from "./git-fixture.ts";

// A disposable repository with a native run whose writer attempts can be
// reserved directly. `prepareBase` may commit extra baseline files first.
export async function worktreeFixture(
  prepareBase?: (
    repo: Awaited<ReturnType<typeof createGitFixture>>,
  ) => Promise<void>,
) {
  const repo = await createGitFixture();
  await prepareBase?.(repo);
  const data = await mkdtemp(join(tmpdir(), "lao-worktree-test-"));
  const db = join(data, "state.sqlite");
  let store = new Store(db);
  const repository = await inspectRepository(repo.directory);
  const project = store.createProject(
    {
      name: "Disposable native fixture",
      repositoryPath: repo.directory,
      repository,
    },
    "project",
  );
  const team = nativeTeam("fixture/model", null);
  const run = store.createRun(
    {
      projectId: project.id,
      title: "Fixture",
      initialPrompt: "Fixture",
      repository,
      execution: "native",
      teamSnapshot: team,
    },
    "run",
  );
  function queue(
    key: string,
    permission: "workspace_write" | "read_only" = "workspace_write",
  ) {
    const task = store.createTask(
      { runId: run.id, title: key, objective: "Modify disposable file" },
      key,
    );
    const profile = team.profiles.find((p) => p.permission === permission);
    assert.ok(profile);
    const scheduler = new Scheduling(store, data);
    const dispatch = scheduler.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId: profile.id },
      `${key}:assign`,
    );
    const id = scheduler.reserve(dispatch);
    assert.ok(id);
    return { task, id, dispatch, scheduler };
  }
  return {
    repo,
    data,
    run,
    queue,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Store(db);
      store.recoverInterrupted();
    },
    close() {
      store.close();
    },
  };
}
