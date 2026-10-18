import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { HumanRequest, Run, Task } from "../src/shared/domain/entities.ts";
import type { IntegrationPreview } from "../src/shared/integration.ts";
import { Acceptance, acceptanceRepo, writeEvidence } from "./acceptance-kit.ts";

// Interactive browser QA fixture, never a native model call. All managed
// source, worktrees and metadata belong to fresh disposable directories.
const directory = await mkdtemp(join(tmpdir(), "lao-gui-status-"));
await writeFile(join(directory, "pi.queue"), "");
const repo = await acceptanceRepo();
const baseline = await repo.head();
const k = new Acceptance({
  mode: "fixtures",
  approve: false,
  port: 4319,
  database: join(directory, "state.sqlite"),
  queue: directory,
  log: join(directory, "app.log"),
});
await k.start();
const project = await k.write<{ id: string }>("projects", {
  name: "GUI FIXTURES · NO LIVE HARNESSES OR MODEL TOKENS",
  repositoryPath: repo.directory,
});
const runs: Record<string, Run> = {};
const tasks: Record<string, Task> = {};
const manual = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
const manualExit = once(manual, "exit");

async function start(name: string, scenario: string, write = false) {
  k.queuePi(scenario);
  const run = await k.write<Run>("runs/native", {
    projectId: project.id,
    title: `FIXTURE · ${name}`,
    initialPrompt: `Deterministic GUI fixture: ${name}. No native harness/model.`,
    model: "fixture/model",
    thinking: "off",
    permission: write ? "workspace_write" : "read_only",
  });
  runs[name] = run;
  const task = (await k.tasks(run.id))[0];
  assert.ok(task);
  tasks[name] = task;
  return { run, task };
}
async function requests() {
  return (await k.read<{ humanRequests: HumanRequest[] }>("human-requests"))
    .humanRequests;
}
async function save() {
  const states = await Promise.all(
    Object.entries(runs).map(async ([name, run]) => ({
      name,
      run: (await k.read<{ runs: Run[] }>("runs")).runs.find(
        (r) => r.id === run.id,
      ),
      tasks: await k.tasks(run.id),
      attempts: await k.attempts(run.id),
    })),
  );
  // Versioned evidence keeps earlier observations available during QA.
  const path = join(directory, `observation-${Date.now()}.json`);
  writeEvidence(path, {
    mode: "deterministic GUI fixtures; NOT live harness evidence",
    origin: k.origin,
    database: k.options.database,
    checks: k.checks,
    states,
    sessions: await k.sessions(),
    requests: await requests(),
    repository: {
      path: repo.directory,
      baseline,
      head: await repo.head(),
      status: await repo.status(),
    },
  });
  console.log(`EVIDENCE ${path}`);
}
async function command(name: string) {
  if (["failed", "uncertain", "pending"].includes(name)) {
    const run = await k.write<Run>("runs/native", {
      projectId: project.id,
      harness: "claude-code",
      title: `FIXTURE · ${name} stop`,
      initialPrompt: `STOP_${name.toUpperCase()} · SCRIPTED, no OS process or model`,
      model: "fixture/claude",
      thinking: "low",
      permission: "read_only",
    });
    runs[name] = run;
    const task = (await k.tasks(run.id))[0];
    assert.ok(task);
    await k.status(run.id, task.id, ["RUNNING"]);
    console.log("GUI ACTION: Stop run…; inspect durable stop outcome.");
  } else if (name === "stop") {
    const { run, task } = await start("emergency stop", "hold", true);
    await k.status(run.id, task.id, ["RUNNING"]);
    await k.until("worker PID", async () =>
      (await k.sessions()).some((s) => s.processId && s.state === "busy"),
    );
    console.log("GUI ACTION: Emergency stop… → confirm; inspect stop history.");
  } else if (name === "stop-check") {
    const run = runs["emergency stop"];
    const task = tasks["emergency stop"];
    assert.ok(run && task && manual.pid);
    await k.status(run.id, task.id, ["RETRY_DECISION"]);
    const sessions = await k.sessions();
    assert.ok(
      sessions.some((s) => s.stops.some((x) => x.status === "confirmed")),
    );
    assert.ok(process.kill(manual.pid, 0));
    k.check("emergency stop preserved unrelated manual process", true);
    await save();
  } else if (name === "approval") {
    const run = await k.write<Run>("runs/native", {
      projectId: project.id,
      harness: "claude-code",
      title: "FIXTURE · pending approval",
      initialPrompt: "SCRIPTED Claude: one isolated README write; no model.",
      model: "fixture/claude",
      thinking: "low",
      permission: "workspace_write",
    });
    runs.approval = run;
    await k.until("pending native approval", async () =>
      (await requests()).find((r) => r.runId === run.id && r.nativeApproval),
    );
    console.log("GUI ACTION: inspect Needs You; approve once or deny once.");
  } else if (name === "credit") {
    const { run, task } = await start("credit exhaustion", "credits", true);
    await k.status(run.id, task.id, ["WAITING_HUMAN"]);
    const request = (await requests()).find((r) => r.runId === run.id);
    assert.equal(request?.providerFailure?.kind, "credits_exhausted");
    const attempts = await k.attempts(run.id);
    assert.equal(attempts.length, 1);
    console.log(
      "GUI ACTION: resolve credit notice; no automatic continuation.",
    );
  } else if (name === "context") {
    const { run, task } = await start("context refresh", "hold", true);
    await k.status(run.id, task.id, ["RUNNING"]);
    await k.until("context worker initialized", async () =>
      (await k.attempts(run.id)).some((a) => a.worktreePath),
    );
    k.queuePi("tracked");
    console.log(
      "GUI ACTION: Pause worker → Recheck → Fresh + checkpoint → Retry → View report.",
    );
  } else if (name === "conflict") {
    const { run, task } = await start("conflict", "tracked", true);
    await k.status(run.id, task.id, ["AWAITING_REVIEW"]);
    k.queuePi("review-pass");
    await k.write("tasks/review", {
      taskId: task.id,
      profileId: "00000000-0000-4000-8000-000000000012",
    });
    await k.until(
      "passing review",
      async () => (await k.latestReview(task.id))?.recommendation === "pass",
    );
    // Simulates owner drift on this driver's own disposable repository only.
    await writeFile(
      join(repo.directory, "README.md"),
      "# Owner fixture heading\n",
    );
    await repo.git("add", "--", "README.md");
    await repo.git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "Disposable destination conflict",
    );
    await k.write("tasks/integration", { taskId: task.id });
    const preview = await k.until("conflicting preview", async () => {
      const all = await k.read<IntegrationPreview[]>(
        `integrations?taskId=${task.id}`,
      );
      return all.find((p) => p.status === "conflict");
    });
    assert.deepEqual(preview.conflicts, ["README.md"]);
    assert.equal(
      await readFile(join(repo.directory, "README.md"), "utf8"),
      "# Owner fixture heading\n",
    );
    k.check(
      "conflict preserved disposable destination",
      (await repo.status()) === "",
    );
  } else if (name === "restart") {
    const before = (
      await Promise.all(Object.values(runs).map((r) => k.attempts(r.id)))
    )
      .flat()
      .map((a) => a.id);
    await k.crash();
    await k.start();
    const after = (
      await Promise.all(Object.values(runs).map((r) => k.attempts(r.id)))
    )
      .flat()
      .map((a) => a.id);
    assert.deepEqual(after, before);
    k.check("abrupt app restart did not launch another attempt", true);
    console.log(
      "GUI ACTION: reload; inspect saved blockers, lineage, conflicts and stop history.",
    );
  } else if (name === "missing") {
    const { run, task } = await start("missing worktree", "hold", true);
    await k.status(run.id, task.id, ["RUNNING"]);
    const attempt = await k.until("worktree", async () =>
      (await k.attempts(run.id)).find((a) => a.worktreePath),
    );
    assert.ok(attempt.worktreePath);
    await writeFile(
      join(attempt.worktreePath, "unfinished.txt"),
      "Retained GUI fixture work\n",
    );
    await rename(attempt.worktreePath, `${attempt.worktreePath}.saved`);
    await command("restart");
    await k.status(run.id, task.id, ["RETRY_DECISION"]);
    console.log(
      "GUI ACTION: inspect missing path/reason, Recheck (observe only).",
    );
  } else if (["inaccessible", "replaced", "restore"].includes(name)) {
    const run = runs["missing worktree"];
    assert.ok(run);
    const attempt = (await k.attempts(run.id))[0];
    assert.ok(attempt?.worktreePath);
    const path = attempt.worktreePath;
    if (name === "inaccessible") {
      await rename(`${path}.saved`, path);
      await chmod(path, 0o000);
    } else if (name === "replaced") {
      await chmod(path, 0o700);
      await rename(path, `${path}.saved`);
      const other = await acceptanceRepo();
      await rename(other.directory, path);
    } else {
      await rename(path, `${path}.replacement`);
      await rename(`${path}.saved`, path);
    }
    console.log(
      `GUI ACTION: Recheck (observe only), inspect ${name} path/reason.`,
    );
  } else if (name === "save") await save();
  else throw new Error(`Unknown command: ${name}`);
  console.log(`READY ${k.origin} · ${name}`);
}

console.log(
  `GUI FIXTURE ${k.origin}\nDATA ${directory}\nREPO ${repo.directory}`,
);
console.log(
  "Commands: stop, stop-check, approval, credit, context, conflict, missing, inaccessible, replaced, restore, failed, uncertain, pending, restart, save, quit",
);
const input = createInterface({ input: process.stdin });
try {
  for await (const line of input) {
    if (line.trim() === "quit") break;
    try {
      await command(line.trim());
    } catch (error) {
      console.error("FIXTURE FAILED", error);
    }
  }
} finally {
  input.close();
  process.stdin.pause();
  await save();
  await k.stop();
  manual.kill();
  await manualExit;
  // Keep all QA artifacts/worktrees for inspection; never delete them here.
  console.log(`Retained GUI fixtures at ${directory} and ${repo.directory}`);
}
