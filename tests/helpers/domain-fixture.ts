import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StartSessionInput } from "../../src/server/adapters/contract.ts";
import { Store } from "../../src/server/storage/store.ts";

export async function domainFixture() {
  const directory = await mkdtemp(join(tmpdir(), "lao-domain-"));
  let store = new Store(join(directory, "state.sqlite"));
  const project = store.createProject(
    { name: "FAKE fixture", repositoryPath: directory },
    "project",
  );
  const run = store.createRun(
    {
      projectId: project.id,
      title: "FAKE run",
      initialPrompt: "Inspect fixture",
    },
    "run",
  );
  const task = store.createTask(
    { runId: run.id, title: "Inspect", objective: "Read fixture" },
    "task",
  );
  return {
    directory,
    project,
    run,
    task,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new Store(join(directory, "state.sqlite"));
      return store;
    },
    async close() {
      store.close();
      await rm(directory, { recursive: true });
    },
  };
}

export function fakeSessionInput(): StartSessionInput {
  return {
    runId: randomUUID(),
    taskId: randomUUID(),
    attemptId: randomUUID(),
    cwd: "/tmp/fake-only",
    roleInstructions: "Read only simulation",
    model: "fake-deterministic",
    thinking: null,
    permission: "read_only",
    contextPolicy: "fresh",
    contextPacket: "A deterministic fixture",
    toolEndpoint: null,
    environment: {},
  };
}
