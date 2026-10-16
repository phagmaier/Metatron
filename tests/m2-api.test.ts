import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { startApp } from "../src/server/app.ts";
import {
  attemptsResponseSchema,
  tasksResponseSchema,
} from "../src/shared/api.ts";
import {
  artifactSchema,
  projectSchema,
  runSchema,
} from "../src/shared/domain/entities.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

test("M2 HTTP commands produce fake success/failure, reports and durable sessions across server restart", async () => {
  const f = await domainFixture();
  const git = await createGitFixture();
  const databasePath = join(f.directory, "state.sqlite");
  let app = await startApp({ development: false, port: 0, databasePath });
  try {
    const read = async (path: string) =>
      (await fetch(`${app.origin}/api/${path}`)).json() as Promise<unknown>;
    const write = async (
      path: string,
      body: unknown,
      key: string = crypto.randomUUID(),
    ) => {
      const { token } = z
        .strictObject({ token: z.string() })
        .parse(await read("local-session"));
      const response = await fetch(`${app.origin}/api/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Local-Token": token,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json() as Promise<unknown>;
    };
    const project = projectSchema.parse(
      await write(
        "projects",
        { name: "HTTP fixture", repositoryPath: git.directory },
        "project-http",
      ),
    );
    const input = {
      projectId: project.id,
      title: "HTTP fake run",
      initialPrompt: "Read fixture",
      leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
    };
    const run = runSchema.parse(await write("runs", input, "run-http"));
    assert.deepEqual(
      runSchema.parse(await write("runs", input, "run-http")),
      run,
    );
    const waitForStatus = async (status: string) => {
      for (let i = 0; i < 120; i++) {
        const tasks = tasksResponseSchema.parse(
          await read(`tasks?runId=${run.id}`),
        ).tasks;
        const task = tasks.find(
          (task) => task.kind === "work" && task.status === status,
        );
        if (task) return task;
        await delay(25);
      }
      throw new Error(`Missing task status ${status}`);
    };
    const done = await waitForStatus("AWAITING_REVIEW");
    const reports = z
      .array(z.strictObject({ artifact: artifactSchema, content: z.string() }))
      .parse(await read(`reports?taskId=${done.id}`));
    assert.equal(reports.length, 1);
    assert.match(reports[0]?.content ?? "", /FAKE report/);
    await write("runs/messages", {
      runId: run.id,
      text: "Simulate a failed task",
      scenario: "failure",
    });
    await waitForStatus("RETRY_DECISION");
    const count = attemptsResponseSchema.parse(await read("attempts")).attempts
      .length;
    await app.close();
    app = await startApp({ development: false, port: 0, databasePath });
    assert.equal(
      attemptsResponseSchema.parse(await read("attempts")).attempts.length,
      count,
    );
    assert.deepEqual(
      z
        .array(
          z.strictObject({ artifact: artifactSchema, content: z.string() }),
        )
        .parse(await read(`reports?taskId=${done.id}`)),
      reports,
    );
    const tasks = tasksResponseSchema.parse(
      await read(`tasks?runId=${run.id}`),
    ).tasks;
    assert.ok(tasks.some((task) => task.status === "AWAITING_REVIEW"));
    assert.ok(tasks.some((task) => task.status === "RETRY_DECISION"));
  } finally {
    await app.close();
    await git.verify(async () =>
      assert.equal(await git.git("status", "--porcelain"), ""),
    );
    await f.close();
  }
});

test("a failed second listener does not mark a live instance's active attempt as recovered", async () => {
  const f = await domainFixture();
  const databasePath = join(f.directory, "state.sqlite");
  const app = await startApp({ development: false, port: 0, databasePath });
  try {
    const attempt = f.store.createAttempt(
      {
        taskId: f.task.id,
        adapter: "fake",
        cwd: f.directory,
        intendedOperation: "Live fake simulation",
      },
      "live-attempt",
    );
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(
      startApp({ development: false, port: address.port, databasePath }),
      { code: "EADDRINUSE" },
    );
    assert.equal(f.store.getAttempt(attempt.id).status, "created");
  } finally {
    await app.close();
    await f.close();
  }
});
