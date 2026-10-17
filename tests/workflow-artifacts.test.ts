import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { artifactSchema } from "../src/shared/domain/entities.ts";
import { workflowSchedulingFixture } from "./helpers/workflow-scheduling-fixture.ts";

test("workflow evidence retains task-owned integration artifacts without attributing them to a reader attempt", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workflowSchedulingFixture();
  try {
    const workflow = f.engine.workflows.start(f.input, "start");
    await f.engine.idle();
    const taskId = workflow.stages[0]?.taskIds[0] ?? "";
    const path = join(f.directory, "integration-test.log");
    const output = "Fixture integration test output; not a worker report\n";
    await writeFile(path, output);
    const now = new Date().toISOString();
    // Integration preview diff/test artifacts belong to the task, not its worker attempt.
    const artifact = artifactSchema.parse({
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      taskId,
      attemptId: null,
      kind: "log",
      path,
      mediaType: "text/plain",
      summary: "Fixture integration log",
    });
    f.store.db
      .prepare("INSERT INTO artifacts VALUES (?,?,?,?)")
      .run(artifact.id, taskId, null, JSON.stringify(artifact));
    const child = f.engine.workflows
      .evidence(workflow.id)
      .children.find((item) => item.task.id === taskId);
    assert.ok(child);
    assert.equal(child.taskArtifacts[0]?.id, artifact.id);
    assert.equal(
      child.attempts.some((attempt) =>
        attempt.artifacts.some((item) => item.id === artifact.id),
      ),
      false,
    );
    await f.restart();
    const reopened = f.engine.workflows
      .evidence(workflow.id)
      .children.find((item) => item.task.id === taskId);
    assert.ok(reopened);
    assert.equal(reopened.taskArtifacts[0]?.id, artifact.id);
    assert.equal(await readFile(path, "utf8"), output);
  } finally {
    await f.close();
  }
});
