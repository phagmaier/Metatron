import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CodexAdapter } from "../../src/server/adapters/codex.ts";
import { CodexRpc } from "../../src/server/adapters/codex-rpc.ts";
import { PiAdapter } from "../../src/server/adapters/pi.ts";
import { PiRpc } from "../../src/server/adapters/pi-rpc.ts";
import { startApp } from "../../src/server/app.ts";
import { createGitFixture } from "./git-fixture.ts";

export async function projectSwitchFixture() {
  const repos = await Promise.all([createGitFixture(), createGitFixture()]);
  const directory = await mkdtemp(join(tmpdir(), "lao-project-switch-"));
  const log = join(directory, "codex.log");
  const launches: { harness: string; cwd: string; args: string[] }[] = [];
  for (const [index, repo] of repos.entries()) {
    await writeFile(
      join(repo.directory, "README.md"),
      `# Project ${index === 0 ? "A" : "B"}\n`,
    );
    await repo.git("add", "--", "README.md");
    await repo.git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Distinct project identity",
    );
  }
  const baselines = await Promise.all(
    repos.map((repo) => repo.git("rev-parse", "HEAD")),
  );
  const helper = (name: string) =>
    fileURLToPath(new URL(name, import.meta.url));
  const start = () =>
    startApp({
      development: false,
      port: 0,
      databasePath: join(directory, "state.sqlite"),
      adapters: {
        codex: new CodexAdapter(directory, (args, cwd, env) => {
          launches.push({ harness: "codex", cwd, args });
          return new CodexRpc(
            process.execPath,
            [helper("codex-fixture.ts"), ...args],
            cwd,
            {
              ...env,
              LAO_CODEX_FIXTURE_SCENARIO: "slow",
              LAO_CODEX_FIXTURE_ROLE: "Backend Engineer",
              LAO_CODEX_FIXTURE_LOG: log,
            },
          );
        }),
        pi: new PiAdapter(directory, (args, cwd, env) => {
          launches.push({ harness: "pi", cwd, args });
          return new PiRpc(
            process.execPath,
            [helper("pi-rpc-fixture.ts")],
            cwd,
            { ...env, LAO_FIXTURE_SCENARIO: "tracked" },
          );
        }),
      },
    });
  let app = await start();
  async function write(path: string, body: unknown) {
    const { token } = z
      .object({ token: z.string() })
      .parse(await (await fetch(`${app.origin}/api/local-session`)).json());
    const response = await fetch(`${app.origin}/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Local-Token": token,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(body),
    });
    assert.equal(
      response.status,
      200,
      JSON.stringify(await response.clone().json()),
    );
    return response.json();
  }
  const projects = [];
  for (const [index, repo] of repos.entries())
    projects.push(
      z.object({ id: z.uuid(), repositoryPath: z.string() }).parse(
        await write("projects", {
          name: `FIXTURE Project ${index === 0 ? "A" : "B"} · NO MODEL TOKENS`,
          repositoryPath: repo.directory,
        }),
      ),
    );
  return {
    directory,
    repos,
    baselines,
    projects,
    launches,
    write,
    get app() {
      return app;
    },
    get engine() {
      return app.engine;
    },
    async logs() {
      return (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    async restart() {
      await app.close();
      app = await start();
    },
    async close(cleanup = true) {
      await app.close();
      for (const [index, repo] of repos.entries()) {
        assert.equal(await repo.git("rev-parse", "HEAD"), baselines[index]);
        assert.equal(await repo.git("status", "--porcelain"), "");
        if (cleanup) await repo.verify(async () => {});
      }
      if (cleanup) await rm(directory, { recursive: true });
    },
  };
}
