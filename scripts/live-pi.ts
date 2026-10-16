import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { inspectRepository, requireClean } from "../src/server/git/inspect.ts";
import { Engine } from "../src/server/orchestration/engine.ts";
import { appLocations } from "../src/server/storage/database.ts";
import { Store } from "../src/server/storage/store.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";

const { values } = parseArgs({
  options: {
    "create-fixture": { type: "boolean" },
    "allow-live": { type: "boolean" },
    fixture: { type: "string" },
    model: { type: "string" },
    thinking: { type: "string" },
  },
});
if (values["create-fixture"]) {
  console.log((await createGitFixture()).directory);
  process.exit(0);
}
if (!values["allow-live"] || !values.fixture || !values.model)
  throw new Error(
    "Explicit opt-in required: pnpm test:live --allow-live --fixture /tmp/lao-git-fixture-.../'repo with spaces' --model provider/model [--thinking off]. Use --create-fixture first. Calls incur provider usage; stop any server using the same database.",
  );
const root = resolve(values.fixture);
assert.match(dirname(root), /^\/tmp\/lao-git-fixture-[A-Za-z0-9]+$/);
assert.match(
  await readFile(join(dirname(root), ".fixture-owner"), "utf8"),
  /^[a-f0-9-]{36}$/,
);
assert.equal(
  await readFile(join(root, "README.md"), "utf8"),
  "# Disposable fixture\n",
);
const before = await inspectRepository(root);
requireClean(before);
const globalPaths = [
  ".pi/agent/settings.json",
  ".pi/agent/auth.json",
  ".codex/config.toml",
  ".claude/settings.json",
].map((p) => join(homedir(), p));
const metadata = async () =>
  Promise.all(
    globalPaths.map(async (path) => {
      try {
        const s = await stat(path);
        return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return "absent";
        throw error;
      }
    }),
  );
const globalBefore = await metadata();
const locations = appLocations();
const store = new Store(locations.database);
store.recoverInterrupted();
const engine = new Engine(store, locations.data);
try {
  const project = await engine.openProject(
    { name: "M3 disposable live Pi smoke", repositoryPath: root },
    `live:${crypto.randomUUID()}:project`,
  );
  for (const permission of ["read_only", "workspace_write"] as const) {
    const objective =
      permission === "read_only"
        ? "Use the read tool to read README.md in this worktree. Quote its heading in one sentence. Do not change any files."
        : "Use read to inspect README.md, then use edit or write to append exactly this line: M3 native Pi smoke verified. Keep the existing heading. Change no other files. Report what changed and state that tests were not run; shell tools are disabled.";
    const run = await engine.startNativeRun(
      {
        projectId: project.id,
        title: `M3 live Pi ${permission}`,
        initialPrompt: objective,
        model: values.model,
        thinking: values.thinking ?? null,
        permission,
      },
      `live:${crypto.randomUUID()}:run`,
    );
    await engine.idle();
    const task = store.listTasks(run.id)[0];
    assert.ok(task);
    const attempt = store.listAttempts().find((a) => a.taskId === task.id);
    assert.ok(attempt);
    const session = store
      .listSessions()
      .find((s) => s.attemptId === attempt.id);
    assert.ok(session?.nativeSessionId);
    console.log(
      JSON.stringify({
        runId: run.id,
        taskStatus: store.getTask(task.id).status,
        adapter: session.adapter,
        nativeSessionId: session.nativeSessionId,
        processId: session.processId,
        exitCode: session.exitCode,
        worktree: attempt.worktreePath,
      }),
    );
    assert.equal(
      store.getTask(task.id).status,
      "AWAITING_REVIEW",
      "Native smoke failed; inspect persisted journal, no automatic retry",
    );
    assert.equal(session.adapter, "pi");
    assert.equal(session.state, "exited");
    assert.equal(session.exitCode, 0);
    assert.ok(attempt.worktreePath);
    const content = await readFile(
      join(attempt.worktreePath, "README.md"),
      "utf8",
    );
    if (permission === "read_only")
      assert.equal(content, "# Disposable fixture\n");
    else assert.ok(content.includes("M3 native Pi smoke verified."));
  }
  assert.deepEqual(await inspectRepository(root), before);
  assert.equal(
    await readFile(join(root, "README.md"), "utf8"),
    "# Disposable fixture\n",
  );
  assert.deepEqual(
    await metadata(),
    globalBefore,
    "Personal config metadata changed during smoke",
  );
  const evidence = {
    fixture: root,
    ownerCheckoutUnchanged: true,
    personalConfigMetadataUnchanged: true,
    attempts: store
      .listAttempts()
      .filter(
        (a) =>
          store.getRun(store.getTask(a.taskId).runId).projectId === project.id,
      ),
    events: store
      .events({ limit: 500 })
      .filter((e) => e.type === "worktree.captured"),
  };
  await writeFile(
    join(locations.data, "m3-live-evidence.json"),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
  console.log(
    `PASS: native reader/writer; owner checkout and personal configuration metadata unchanged. Evidence: ${join(locations.data, "m3-live-evidence.json")}`,
  );
} finally {
  await engine.close();
  store.close();
}
