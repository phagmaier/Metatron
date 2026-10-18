import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runSchema } from "../src/shared/domain/entities.ts";
import { projectSwitchFixture } from "../tests/helpers/project-switch-fixture.ts";

// Interactive GUI reproduction on two disposable repos, real engine/SQLite/Git,
// deterministic Codex/Pi protocol subprocesses. Never native model evidence.
const f = await projectSwitchFixture();
for (const [index, project] of f.projects.entries())
  runSchema.parse(
    await f.write("runs/lead", {
      projectId: project.id,
      title: `FIXTURE Run ${index === 0 ? "A" : "B"} · NO MODEL TOKENS`,
      initialPrompt: `Project ${index === 0 ? "A" : "B"} only. Deterministic protocol fixtures; no native harness/model.`,
      mode: "autonomous_bounded",
      lead: { model: "fixture-model", thinking: "low" },
      worker: { model: "fixture/model", thinking: "off" },
    }),
  );
await f.engine.idle();
async function save() {
  await f.engine.idle();
  const receipt = {
    mode: "deterministic protocol fixtures; NOT live harness evidence",
    origin: f.app.origin,
    directory: f.directory,
    projects: f.projects,
    runs: f.engine.store.listRuns(),
    tasks: f.engine.store.listTasks(),
    attempts: f.engine.store.listAttempts(),
    sessions: f.engine.store.listSessions(),
    worktrees: f.engine.worktrees.list(),
    launches: f.launches,
    roots: await Promise.all(
      f.repos.map(async (repo, index) => {
        const head = await repo.git("rev-parse", "HEAD");
        const status = await repo.git("status", "--porcelain");
        assert.equal(head, f.baselines[index]);
        assert.equal(status, "");
        return {
          path: repo.directory,
          baseline: f.baselines[index],
          head,
          status,
        };
      }),
    ),
  };
  const path = join(f.directory, "snapshot.json");
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(`READY ${f.app.origin}\nEVIDENCE ${path}`);
}
await save();
console.log(
  "Commands: status (observe/save), restart (same database), quit (stop, retain fixtures).",
);
const input = createInterface({ input: process.stdin });
try {
  for await (const line of input) {
    const command = line.trim();
    if (command === "quit") break;
    if (command === "restart") await f.restart();
    if (["restart", "status"].includes(command)) await save();
  }
} finally {
  input.close();
  process.stdin.pause();
  await f.close(false);
}
