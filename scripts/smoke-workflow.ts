import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startApp } from "../src/server/app.ts";
import { inspectRepository } from "../src/server/git/inspect.ts";
import { createTeamRun } from "../src/server/orchestration/team-run.ts";
import { createTeam } from "../src/server/storage/teams.ts";
import {
  createExploreSubsystemTemplate,
  getWorkflowRun,
} from "../src/server/storage/workflows.ts";
import { defaultLimits, type Event } from "../src/shared/domain/entities.ts";
import { nativeTeam } from "../src/shared/native.ts";
import { handoffReportSchema } from "../src/shared/orchestration.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";

const { values } = parseArgs({
  options: {
    fake: { type: "boolean" },
    "allow-live": { type: "boolean" },
    model: { type: "string" },
    thinking: { type: "string" },
    output: { type: "string" },
  },
});
const live = values["allow-live"] === true;
assert.ok(
  (values.fake === true) !== live && values.output && (!live || values.model),
  "Choose --fake OR --allow-live --model provider/model [--thinking off], plus --output <new evidence.json>. Live mode incurs provider usage: at most three Pi read-only launches, no model Lead. Both modes create their own disposable Git fixture and database; no existing checkout or database is accepted.",
);
assert.ok(
  live || (!values.model && !values.thinking),
  "Model/thinking selections apply only to explicit live mode",
);
const output = resolve(values.output);
try {
  await access(output);
  throw new Error(
    "Evidence file already exists; choose a new --output before incurring any model cost",
  );
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}

const fixture = await createGitFixture();
const directory = await mkdtemp("/tmp/lao-workflow-smoke-");
const databasePath = join(directory, "state.sqlite");
const files: Record<string, string> = {
  "README.md":
    "# Disposable inventory\n\n`src/inventory.ts` exports inStock; quantities come from data/stock.json.\nTests in tests/inventory.test.ts are examples to inspect, not evidence of execution.\n",
  "src/inventory.ts":
    "export function inStock(items: { name: string; quantity: number }[]) {\n  return items.filter((item) => item.quantity > 0).map((item) => item.name);\n}\n",
  "data/stock.json":
    '[{"name":"bolt","quantity":2},{"name":"nut","quantity":0}]\n',
  "tests/inventory.test.ts":
    "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { inStock } from '../src/inventory.ts';\ntest('only positive quantities are in stock', () => {\n  assert.deepEqual(inStock([{name:'bolt',quantity:2},{name:'nut',quantity:0},{name:'washer',quantity:-1}]), ['bolt']);\n});\n",
};
for (const folder of ["src", "data", "tests"])
  await mkdir(join(fixture.directory, folder));
for (const [path, content] of Object.entries(files))
  await writeFile(join(fixture.directory, path), content);
await fixture.git("add", "--", ...Object.keys(files));
await fixture.git(
  "-c",
  "user.name=Fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "commit",
  "-m",
  "Inventory workflow fixture",
);
const before = await inspectRepository(fixture.directory);
const personalPaths = [
  ".pi/agent/settings.json",
  ".pi/agent/auth.json",
  ".codex/config.toml",
  ".claude/settings.json",
];
async function personalMetadata() {
  return Promise.all(
    personalPaths.map(async (path) => {
      try {
        const info = await stat(join(homedir(), path));
        return {
          path,
          size: info.size,
          mtime: info.mtimeMs,
          ctime: info.ctimeMs,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return { path, absent: true };
        throw error;
      }
    }),
  );
}
const personalBefore = await personalMetadata();
let app = await startApp({ development: false, port: 0, databasePath });
const scenarios = [];
const replays = [];
try {
  let engine = app.engine;
  assert.ok(engine);
  if (live) {
    const capabilities = await engine.pi.discover();
    const model = capabilities.models.find(
      (model) => model.id === values.model,
    );
    assert.ok(
      capabilities.installed &&
        model &&
        (values.thinking === undefined ||
          model.thinking.some((level) => level.id === values.thinking)),
      "BLOCKED: Pi/model/thinking unavailable; refresh discovery. No native prompt was submitted",
    );
  }
  const project = await engine.openProject(
    { name: "M7 disposable workflow smoke", repositoryPath: fixture.directory },
    "project",
  );
  const readerId = "00000000-0000-4000-8000-000000000013";
  const synthId = "00000000-0000-4000-8000-000000000014";
  const template = createExploreSubsystemTemplate(
    engine.store,
    {
      readerProfileId: readerId,
      synthesizerProfileId: synthId,
      readerCount: 3,
    },
    "template",
  );
  const overCap = createExploreSubsystemTemplate(
    engine.store,
    {
      readerProfileId: readerId,
      synthesizerProfileId: synthId,
      readerCount: 4,
    },
    "over-cap-template",
  );
  const limits = {
    ...defaultLimits,
    maxConcurrentReadersReviewers: 1,
    maxConcurrentAgentsIncludingLead: 1,
    maxParallelReadersPerWorkflow: 3,
    maxTotalWorkerLaunchesPerRun: live ? 3 : 4,
  };
  const team = live
    ? null
    : createTeam(
        engine.store,
        {
          name: "Saved FAKE exploration smoke team",
          leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
          workerProfileIds: [readerId, synthId],
          workflowTemplateIds: [template.id, overCap.id],
          mode: "supervised",
          limits,
        },
        "team",
      );
  for (const partial of live ? [true] : [false, true]) {
    const key = partial ? "partial" : "complete";
    const native = nativeTeam(
      values.model ?? "unused-in-fake-mode",
      values.thinking ?? null,
    );
    const run = team
      ? await createTeamRun(
          engine,
          {
            projectId: project.id,
            teamId: team.id,
            teamVersion: team.version,
            title: `FAKE workflow ${key}`,
            initialPrompt: "Wait for the owner's saved workflow",
          },
          `run:${key}`,
        )
      : engine.store.createRun(
          {
            projectId: project.id,
            title: "Live Pi read-only workflow (owner-directed, no model Lead)",
            initialPrompt: "Explore the inventory fixture only",
            execution: "native",
            mode: "supervised",
            limits,
            repository: project.repository,
            teamSnapshot: {
              ...native,
              preset: {
                ...native.preset,
                workerProfileIds: [readerId, synthId],
                workflowTemplateIds: [template.id, overCap.id],
                limits,
              },
              workflows: [template, overCap],
            },
          },
          `run:${key}`,
        );
    await engine.idle();
    const tasksBefore = engine.store.listTasks(run.id);
    const dispatchesBefore = engine.scheduling.list();
    assert.throws(
      () =>
        engine.workflows.start(
          {
            runId: run.id,
            templateId: overCap.id,
            parameters: { target: "src/inventory.ts" },
          },
          `reject:${key}`,
        ),
      { code: "BUDGET_EXCEEDED" },
    );
    assert.deepEqual(engine.store.listTasks(run.id), tasksBefore);
    assert.deepEqual(engine.scheduling.list(), dispatchesBefore);
    const input = {
      runId: run.id,
      templateId: template.id,
      parameters: {
        target:
          "Inventory: src/inventory.ts, data/stock.json, tests/inventory.test.ts and README.md. Cite exact file:line evidence. Keep each report under 1200 characters. No test execution or writes.",
      },
    };
    const workflow = engine.workflows.start(input, `workflow:${key}`);
    replays.push({ input, key: `workflow:${key}`, started: workflow });
    await engine.workflows.reconcile();
    const readers = workflow.stages[0]?.taskIds;
    const synthesisId = workflow.stages[1]?.taskIds[0];
    assert.ok(readers?.length === 3 && synthesisId);
    const failedId = readers[1];
    assert.ok(failedId);
    if (partial && !live)
      engine.scheduling.enqueue(
        { role: "owner" },
        { taskId: failedId, profileId: readerId, scenario: "failure" },
        "deliberate-reader-failure",
      );
    await engine.pump();
    const queue = readers.map((taskId) => ({
      taskId,
      status: engine.store.getTask(taskId).status,
    }));
    assert.equal(queue.filter((task) => task.status === "RUNNING").length, 1);
    assert.equal(queue.filter((task) => task.status === "QUEUED").length, 2);
    if (partial && live)
      engine.cancel(failedId, "owner-cancels-unlaunched-reader");
    console.log(
      `${live ? "LIVE PI" : "FAKE"} ${key}: three declared readers, one active/two queued; ${partial ? (live ? "owner cancelled one queued reader (not a native crash)" : "one reader has deterministic FakeAdapter failure") : "all readers scheduled"}`,
    );
    // Waiting observes one submitted workflow; it never resubmits a prompt.
    await engine.idle();
    const finished = getWorkflowRun(engine.store, workflow.id);
    assert.equal(
      finished.status,
      partial ? "partial" : "completed",
      `Workflow did not settle as expected; inspect retained ${databasePath}`,
    );
    const evidence = engine.workflows.evidence(workflow.id);
    const synthesis = evidence.children.find(
      (child) => child.task.id === synthesisId,
    );
    assert.ok(synthesis?.handoff);
    assert.deepEqual(
      synthesis.handoff.sources.map((source) => source.status),
      partial
        ? ["completed", "failed", "completed"]
        : ["completed", "completed", "completed"],
    );
    if (partial) {
      const failed = synthesis.handoff.sources.find(
        (source) => source.taskId === failedId,
      );
      assert.equal(failed?.artifactId, null);
      assert.equal(failed?.failure, live ? "cancelled" : "failed");
      assert.ok(failed?.failureEventId && failed.diagnostic);
      assert.equal(
        engine.store.getTask(failedId).status,
        live ? "CANCELLED" : "RETRY_DECISION",
      );
    }
    const journal: Event[] = [];
    for (let after = 0; ; ) {
      const page = engine.store.events({ runId: run.id, after, limit: 500 });
      journal.push(...page);
      if (page.length < 500) break;
      after = page.at(-1)?.sequence ?? after;
    }
    const active = new Set<string>();
    let peak = 0;
    for (const event of journal) {
      if (event.type !== "attempt.updated" || !event.attemptId) continue;
      if (event.payload.status === "running") active.add(event.attemptId);
      else active.delete(event.attemptId);
      peak = Math.max(peak, active.size);
      assert.ok(
        active.size <= 1,
        "Child attempts exceeded the normal global slot cap",
      );
    }
    assert.equal(peak, 1);
    assert.equal(active.size, 0);
    const reports = [];
    for (const child of evidence.children) {
      const report = (await engine.reports(child.task.id)).find(
        ({ artifact }) => artifact.kind === "report",
      );
      if (child.outcome.status !== "completed") {
        assert.equal(report, undefined);
        continue;
      }
      assert.ok(report);
      const attempt = child.attempts.at(-1)?.attempt;
      assert.ok(attempt);
      const reportEvent = journal.find(
        (event) =>
          event.type === "report.saved" && event.taskId === child.task.id,
      );
      const synthesisStart: Event | undefined = journal.find(
        (event) =>
          event.type === "attempt.created" && event.taskId === synthesisId,
      );
      assert.ok(synthesisStart);
      if (child.task.id !== synthesisId) {
        assert.ok(
          reportEvent && reportEvent.sequence < synthesisStart.sequence,
          "Synthesis started before a reader's durable report",
        );
        assert.equal(
          synthesis.handoff.sources.find(
            (source) => source.taskId === child.task.id,
          )?.artifactId,
          report.artifact.id,
        );
      }
      const session = engine.store
        .listSessions()
        .find((session) => session.attemptId === attempt.id);
      assert.ok(session?.nativeSessionId);
      assert.equal(session.adapter, live ? "pi" : "fake");
      assert.equal(session.state, live ? "exited" : "idle");
      if (live) {
        assert.equal(session.exitCode, 0);
        assert.equal(
          engine.scheduling.profile(run.id, attempt.profileId ?? "").permission,
          "read_only",
        );
        const capture = journal.find(
          (event) =>
            event.type === "worktree.captured" &&
            event.attemptId === attempt.id,
        );
        assert.deepEqual(capture?.payload.files, []);
        assert.equal(capture?.payload.headSha, before.baseSha);
        assert.equal(capture?.payload.diffCheck, "passed");
        const submitted = journal.find(
          (event) =>
            event.type === "worker.result" && event.attemptId === attempt.id,
        );
        const structured = handoffReportSchema.parse(submitted?.payload.report);
        assert.deepEqual(structured.changedFiles, []);
        assert.ok(structured.tests.every((test) => test.result === "not_run"));
        if (child.stageId === "readers")
          assert.ok(
            journal.some(
              (event) =>
                event.type === "pi.tool_started" &&
                event.attemptId === attempt.id &&
                event.payload.summary === "read",
            ),
            "Live reader evidence must include actual native file reads",
          );
      }
      reports.push({
        taskId: child.task.id,
        stageId: child.stageId,
        artifactId: report.artifact.id,
        sha256: createHash("sha256").update(report.content).digest("hex"),
        content: report.content,
        session: {
          nativeSessionId: session.nativeSessionId,
          adapter: session.adapter,
          state: session.state,
          exitCode: session.exitCode,
        },
      });
    }
    const attempts = engine.store
      .listAttempts()
      .filter(
        (attempt) =>
          engine.store.getTask(attempt.taskId).workflowId === workflow.id,
      );
    assert.equal(attempts.length, live ? 3 : 4);
    const launches = engine.scheduling.committedLaunches(run.id);
    assert.equal(launches, attempts.length);
    assert.ok(launches <= limits.maxTotalWorkerLaunchesPerRun);
    scenarios.push({
      case: key,
      runId: run.id,
      workflowId: workflow.id,
      status: finished.status,
      templateId: template.id,
      teamId: team?.id ?? null,
      ownerDirectedWithoutModelLead: live,
      fanOut: {
        declared: 3,
        allowed: 3,
        rejected: 4,
        activeCap: 1,
        peakActiveAttempts: peak,
        initialReaderQueue: queue,
      },
      launches,
      launchBudget: limits.maxTotalWorkerLaunchesPerRun,
      sources: synthesis.handoff.sources,
      reports,
      tools: journal
        .filter((event) => event.type === "pi.tool_started")
        .map((event) => ({
          taskId: event.taskId,
          tool: event.payload.summary,
        })),
      usage: journal
        .filter((event) => event.type === "pi.usage")
        .map((event) => event.payload),
    });
    console.log(
      `PASS ${live ? "LIVE PI" : "FAKE"} ${key}: ${reports.length} original reports; ${launches} charged child launches; peak active ${peak}`,
    );
  }
  const attemptsBeforeRestart = engine.store
    .listAttempts()
    .map(({ id, taskId, dispatchId, status, recovery }) => ({
      id,
      taskId,
      dispatchId,
      status,
      decision: recovery?.decision ?? null,
    }));
  await app.close();
  app = await startApp({ development: false, port: 0, databasePath });
  engine = app.engine;
  assert.ok(engine);
  await engine.idle();
  for (const replay of replays)
    assert.deepEqual(
      engine.workflows.start(replay.input, replay.key),
      replay.started,
    );
  // Startup may append recovery observations; it must not replace attempts,
  // change their outcomes/decisions, or replay any of their work.
  assert.deepEqual(
    engine.store
      .listAttempts()
      .map(({ id, taskId, dispatchId, status, recovery }) => ({
        id,
        taskId,
        dispatchId,
        status,
        decision: recovery?.decision ?? null,
      })),
    attemptsBeforeRestart,
  );
  for (const scenario of scenarios) {
    assert.equal(
      getWorkflowRun(engine.store, scenario.workflowId).status,
      scenario.status,
    );
    for (const original of scenario.reports) {
      const stored = (await engine.reports(original.taskId)).find(
        ({ artifact }) => artifact.id === original.artifactId,
      );
      assert.ok(stored);
      assert.equal(
        createHash("sha256").update(stored.content).digest("hex"),
        original.sha256,
      );
    }
  }
  assert.deepEqual(await inspectRepository(fixture.directory), before);
  for (const [path, content] of Object.entries(files))
    assert.equal(
      await readFile(join(fixture.directory, path), "utf8"),
      content,
    );
  assert.deepEqual(
    await personalMetadata(),
    personalBefore,
    "Personal harness configuration metadata changed",
  );
  await app.close();
  await fixture.verify(async () =>
    assert.deepEqual(await inspectRepository(fixture.directory), before),
  );
  await rm(directory, { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ execution: live ? "Real installed Pi native harness, read-only; provider usage incurred" : "FakeAdapter deterministic playback; no native harness or provider", model: live ? values.model : "fake-deterministic", thinking: live ? (values.thinking ?? null) : null, fixture: files, scenarios, checks: { savedTeamReusedInNewRun: !live, readerReportsRetained: true, partialFailureProvenance: true, fanOutAndConcurrencyCaps: true, restartAndIdempotencyWithoutReplay: true, ownerCheckoutUnchanged: true, personalConfigMetadataUnchanged: true, disposableFixtureAndDatabaseRemoved: true }, limits: { noNativeLead: true, realHarnessCrashNotInduced: true, noOsSandboxClaim: true, usageIsPartialNativeSamplesNotAccountBalance: true } }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    `PASS: workflow smoke; fixture cleaned only after successful checks. Evidence: ${output}`,
  );
} catch (error) {
  if (app.server.listening) await app.close();
  console.error(
    `Workflow smoke failed. Fixture: ${fixture.directory}; database: ${databasePath} (retained on execution failure; successful cleanup may already have removed them). No automatic retry. Native setup, if needed: PI_CODING_AGENT_DIR='${join(directory, "pi")}' mise x -- pi (use its native /login flow; do not copy credentials).`,
  );
  throw error;
}
