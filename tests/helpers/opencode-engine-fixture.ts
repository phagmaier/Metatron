import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { OpenCodeAdapter } from "../../src/server/adapters/opencode.ts";
import { startApp } from "../../src/server/app.ts";
import { createGitFixture } from "./git-fixture.ts";
import { opencodeFixtureOptions } from "./opencode-fixture.ts";

export async function opencodeEngineFixture(development = false) {
  const repo = await createGitFixture();
  const directory = await mkdtemp(join(tmpdir(), "lao-opencode-engine-"));
  const baseline = await repo.git("rev-parse", "HEAD");
  const options = {
    development,
    port: 0,
    databasePath: join(directory, "state.sqlite"),
    adapters: {
      opencode: new OpenCodeAdapter(
        directory,
        opencodeFixtureOptions("engine"),
      ),
    },
  };
  let app = await startApp(options);
  const project = await app.engine.openProject(
    {
      name: "INERT OpenCode HTTP fixture, no native model",
      repositoryPath: repo.directory,
    },
    "project",
  );
  return {
    repo,
    directory,
    project,
    get app() {
      return app;
    },
    get engine() {
      return app.engine;
    },
    get store() {
      return app.engine.store;
    },
    async run(permission: "read_only" | "workspace_write") {
      return app.engine.startNativeRun(
        {
          projectId: project.id,
          harness: "opencode",
          title: `INERT OpenCode ${permission}`,
          initialPrompt:
            "Disposable HTTP/SSE fixture; no provider or native model contacted",
          model: "fixture/model",
          thinking: "low",
          permission,
        },
        randomUUID(),
      );
    },
    async request(runId: string) {
      for (let count = 0; count < 1000; count++) {
        await app.engine.pump();
        const request = app.engine.store
          .listHumanRequests()
          .find(
            (request) =>
              request.runId === runId &&
              request.nativeApproval?.state === "pending",
          );
        if (request) return request;
        const failure = app.engine.store
          .events()
          .find(
            (event) =>
              event.runId === runId && event.type === "opencode.session_error",
          );
        if (failure)
          throw new Error(
            `Inert OpenCode boundary failed: ${JSON.stringify(failure.payload)}`,
          );
        await delay(10);
      }
      throw new Error(
        "Inert OpenCode fixture did not reach its native permission pause",
      );
    },
    async send(
      path: string,
      input: unknown,
      key: string = randomUUID(),
      extraHeaders: Record<string, string> = {},
    ) {
      const { token } = z
        .object({ token: z.string() })
        .parse(await (await fetch(`${app.origin}/api/local-session`)).json());
      return fetch(`${app.origin}/api/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Local-Token": token,
          "Idempotency-Key": key,
          ...extraHeaders,
        },
        body: JSON.stringify(input),
      });
    },
    async restart() {
      await app.close();
      app = await startApp(options);
    },
    async close() {
      await app.close();
      await repo.verify(async () => {
        assert.equal(await repo.git("status", "--porcelain"), "");
        assert.equal(await repo.git("rev-parse", "HEAD"), baseline);
        assert.equal(
          await readFile(join(repo.directory, "README.md"), "utf8"),
          "# Disposable fixture\n",
        );
      });
      await rm(directory, { recursive: true });
    },
  };
}
