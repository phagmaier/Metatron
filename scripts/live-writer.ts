import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { startApp } from "../src/server/app.ts";
import { requestReview } from "../src/server/orchestration/review.ts";
import { listIntegrationCandidates } from "../src/server/storage/candidates.ts";
import { appLocations } from "../src/server/storage/database.ts";
import { listReviews } from "../src/server/storage/reviews.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { handoffReportSchema } from "../src/shared/orchestration.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";
import {
  settleSmoke,
  smokeEvents,
  streamEvidence,
} from "./native-smoke-evidence.ts";

const { values } = parseArgs({
  options: {
    "allow-live": { type: "boolean" },
    "allow-disposable-write": { type: "boolean" },
    model: { type: "string" },
    thinking: { type: "string" },
    output: { type: "string" },
  },
});
assert.ok(
  values.model && values.output,
  "Usage: mise x -- env XDG_DATA_HOME=/tmp/<fresh-home> pnpm test:live:writer --model <Pi provider/model> [--thinking <level>] --output <new evidence.json> [--allow-live --allow-disposable-write]. Both gates permit at most two paid Pi turns: one isolated README writer and one independent read-only reviewer. Never approves or applies integration. Existing databases are refused; no automatic retry.",
);
const model = values.model;
const thinking = values.thinking ?? null;
const output = resolve(values.output);
const live =
  values["allow-live"] === true && values["allow-disposable-write"] === true;
const partialAuthorization =
  !live && (!!values["allow-live"] || !!values["allow-disposable-write"]);
const locations = appLocations();
assert.match(
  locations.data,
  /^\/tmp\/[^/]+\/local-agent-orchestrator$/,
  "Choose a fresh disposable XDG_DATA_HOME directly under /tmp, after mise x --",
);
try {
  await access(output);
  throw new Error("Refusing to overwrite evidence; choose a new --output");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}
await mkdir(dirname(locations.data), { recursive: true, mode: 0o700 });
assert.equal(
  await realpath(dirname(locations.data)),
  dirname(locations.data),
  "Disposable app root must not be redirected",
);
await mkdir(locations.data, { recursive: true, mode: 0o700 });
assert.equal(
  await realpath(locations.data),
  locations.data,
  "Disposable app data must not be redirected",
);
// Claim a fresh default database atomically. A retained live candidate can then
// be inspected with pnpm dev, but this runner can never reopen/replay it.
await writeFile(locations.database, "", { flag: "wx", mode: 0o600 });
const personal = [
  ".codex/config.toml",
  ".claude/settings.json",
  ".pi/agent/settings.json",
  ".pi/agent/auth.json",
  ".config/opencode/opencode.json",
  ".config/opencode/opencode.jsonc",
  ".local/share/opencode/auth.json",
];
const metadata = () =>
  Promise.all(
    personal.map(async (path) => {
      try {
        const info = await stat(join(homedir(), path));
        return `${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return `${path}:absent`;
        throw error;
      }
    }),
  );
const beforeMetadata = await metadata();
const fixture = await createGitFixture();
const baseline = await fixture.git("rev-parse", "HEAD");
const original = await readFile(join(fixture.directory, "README.md"), "utf8");
const marker = `M8 disposable writer proof ${randomUUID()}`;
const expected = `${original}\n${marker}\n`;
const app = await startApp({
  development: false,
  port: 0,
  databasePath: locations.database,
});
const { engine } = app;
const { store } = engine;
let passed = false;
let requestedTurns = 0;
let stage = "discovery";
let implementationTaskId: string | null = null;
let integrationApprovalGranted = false;
let integrationApplied = false;
let receipt: Record<string, unknown> = {
  harness: "pi",
  selected: { model, thinking },
  liveGate: !!values["allow-live"],
  disposableWriteGate: !!values["allow-disposable-write"],
  maximumRequestedTurns: live ? 2 : 0,
  integrationAuthority: "none; separate owner review/approval/apply required",
};
async function ownerUnchanged() {
  return (
    (await fixture.git("status", "--porcelain")) === "" &&
    (await fixture.git("rev-parse", "HEAD")) === baseline &&
    (await readFile(join(fixture.directory, "README.md"), "utf8")) === original
  );
}
function turnEvidence(taskId: string) {
  const task = store.getTask(taskId);
  const attempt = store.listAttempts().find((a) => a.taskId === taskId);
  const session = store.listSessions().find((s) => s.attemptId === attempt?.id);
  const events = smokeEvents(engine, task.runId, taskId);
  const stream = streamEvidence(events, "pi");
  const payloads = (type: string) =>
    events.filter((e) => e.type === type).map((e) => e.payload);
  const settings = payloads("pi.settings_verified");
  return {
    taskId,
    attemptId: attempt?.id ?? null,
    profileId: attempt?.profileId ?? null,
    worktreePath: attempt?.worktreePath ?? null,
    nativeSessionId: session?.nativeSessionId ?? null,
    contextPolicy: session?.contextPolicy ?? null,
    effectiveContext: session?.context?.effective ?? null,
    checks: {
      completed:
        task.status === "AWAITING_REVIEW" &&
        attempt?.status === "completed" &&
        session?.state === "exited" &&
        session.exitCode === 0 &&
        stream.streamedBeforeTerminal &&
        stream.terminals[0]?.nativeStatus === "completed",
      settingsMatch:
        settings.length === 1 &&
        settings[0]?.model === model &&
        (thinking === null || settings[0]?.thinking === thinking),
      noSessionError: payloads("pi.session_error").length === 0,
    },
    stream,
    settingsVerified: settings,
    processExit: payloads("pi.process_exit"),
    report: payloads("worker.result").at(-1)?.report ?? null,
    captured: payloads("worktree.captured").at(-1) ?? null,
  };
}
try {
  const discovery = await engine.profiles.discover({ harness: "pi" });
  const selected = discovery.models.find((m) => m.id === model);
  const available =
    discovery.state === "available" &&
    ["workspace_write", "read_only"].every((p) =>
      discovery.permissions.some((permission) => permission === p),
    ) &&
    !!selected &&
    (thinking === null || selected.thinking.some((t) => t.id === thinking));
  receipt.discovery = {
    state: discovery.state,
    version: discovery.version,
    authenticated: discovery.authenticated,
    nextStep: discovery.nextStep,
    selectionAvailable: available,
    thinkingChoices: selected?.thinking.map((t) => t.id) ?? [],
  };
  if (!live || !available) {
    passed = !live && !partialAuthorization;
    receipt.blocked = partialAuthorization
      ? "Both native spending and disposable Write gates are required; zero turns requested"
      : available
        ? null
        : (discovery.nextStep ?? "Requested Pi model/thinking is unavailable");
  } else {
    const project = await engine.openProject(
      {
        name: "M8 disposable writer/reviewer; integration held",
        repositoryPath: fixture.directory,
      },
      randomUUID(),
    );
    stage = "writer";
    const run = await engine.startNativeRun(
      {
        projectId: project.id,
        harness: "pi",
        title:
          "M8 native writer/reviewer; awaiting separate owner integration approval",
        initialPrompt: `Read README.md. Append exactly one blank line followed by this exact line:\n${marker}\n\nPreserve the original heading and final newline. Change only README.md, create no files, and do not commit or use shell. Submit a completed structured result listing README.md as changed and tests as not_run. This authorizes no integration.`,
        model,
        thinking,
        permission: "workspace_write",
      },
      randomUUID(),
    );
    requestedTurns = 1;
    receipt.runId = run.id;
    await settleSmoke(engine);
    const [task] = store.listTasks(run.id);
    assert.ok(task);
    implementationTaskId = task.id;
    const writer = turnEvidence(task.id);
    receipt.writer = writer;
    assert.ok(
      Object.values(writer.checks).every(Boolean),
      "Writer did not safely complete",
    );
    assert.ok(
      writer.worktreePath && writer.attemptId && writer.nativeSessionId,
    );
    const writerReport = handoffReportSchema.parse(writer.report);
    assert.equal(writerReport.outcome, "completed");
    assert.deepEqual(writerReport.changedFiles, ["README.md"]);
    const candidates = listIntegrationCandidates(store, task.id);
    assert.equal(candidates.length, 1);
    const candidate = candidates[0];
    assert.ok(candidate);
    receipt.candidate = candidate;
    assert.equal(candidate.attemptId, writer.attemptId);
    assert.equal(candidate.baseSha, baseline);
    assert.equal(candidate.reportSubmitted, true);
    assert.equal(candidate.humanDecision, null);
    assert.notEqual(candidate.candidateSha, baseline);
    assert.equal(
      await fixture.git(
        "diff",
        "--name-only",
        baseline,
        candidate.candidateSha,
        "--",
      ),
      "README.md",
    );
    assert.equal(
      await readFile(join(writer.worktreePath, "README.md"), "utf8"),
      expected,
    );
    assert.equal(
      await fixture.git("rev-parse", `${candidate.candidateSha}:README.md`),
      await fixture.git(
        "-C",
        writer.worktreePath,
        "hash-object",
        "--",
        "README.md",
      ),
    );
    assert.ok(await ownerUnchanged());
    assert.deepEqual(await metadata(), beforeMetadata);
    stage = "review";
    const reviewerProfile = run.teamSnapshot?.profiles.find(
      (p) =>
        p.permission === "read_only" &&
        run.teamSnapshot?.roles.some(
          (r) => r.id === p.roleId && r.name === "Reviewer",
        ),
    );
    assert.ok(reviewerProfile);
    requestReview(
      engine,
      { role: "owner" },
      { taskId: task.id, profileId: reviewerProfile.id },
      randomUUID(),
    );
    requestedTurns = 2;
    await settleSmoke(engine);
    const reviewTask = store
      .listTasks(run.id)
      .find((t) => t.reviewCandidateId === candidate.id);
    assert.ok(reviewTask);
    const reviewer = turnEvidence(reviewTask.id);
    const reviews = listReviews(store, task.id);
    const [review] = reviews;
    receipt.reviewer = reviewer;
    receipt.reviews = reviews;
    assert.ok(
      Object.values(reviewer.checks).every(Boolean),
      "Reviewer did not safely complete",
    );
    assert.equal(reviews.length, 1);
    assert.ok(
      review &&
        reviewer.worktreePath &&
        reviewer.attemptId &&
        reviewer.nativeSessionId,
    );
    const packet = smokeEvents(engine, run.id, reviewTask.id).find(
      (e) => e.type === "review.packet",
    );
    const independence = {
      differentTask: reviewer.taskId !== writer.taskId,
      differentAttempt: reviewer.attemptId !== writer.attemptId,
      differentProfile:
        reviewer.profileId !== writer.profileId &&
        reviewer.profileId === reviewerProfile.id,
      freshNativeSession:
        reviewer.effectiveContext === "fresh" &&
        reviewer.nativeSessionId !== writer.nativeSessionId,
      separateCandidateCheckout:
        reviewer.worktreePath !== writer.worktreePath &&
        (await fixture.git(
          "-C",
          reviewer.worktreePath,
          "rev-parse",
          "HEAD",
        )) === candidate.candidateSha,
      unchangedReviewerCheckout:
        (await fixture.git(
          "-C",
          reviewer.worktreePath,
          "status",
          "--porcelain",
        )) === "",
      exactCandidatePacket:
        packet?.payload.candidateId === candidate.id &&
        packet.payload.candidateSha === candidate.candidateSha,
      boundReview:
        review.candidateId === candidate.id &&
        review.reviewerAttemptId === reviewer.attemptId,
    };
    receipt.independence = independence;
    assert.ok(Object.values(independence).every(Boolean));
    assert.ok(await ownerUnchanged());
    assert.equal(store.listAttempts().length, 2);
    assert.equal(
      review.recommendation,
      "pass",
      "A changes-requested review never proceeds to preview",
    );
    stage = "preview";
    const checkReadme = `require('node:assert/strict').equal(require('node:fs').readFileSync('README.md','utf8'),${JSON.stringify(expected)});`;
    const pending = engine.integrations.request(
      { role: "owner" },
      {
        taskId: task.id,
        destinationBranch: "main",
        tests: [[process.execPath, "-e", checkReadme]],
        timeoutSeconds: 30,
      },
      randomUUID(),
    );
    await engine.integrations.idle();
    const preview = engine.integrations
      .list(task.id)
      .find((p) => p.id === pending.id);
    assert.ok(preview);
    receipt.preview = preview;
    assert.equal(preview.status, "passed");
    assert.equal(preview.candidateId, candidate.id);
    assert.equal(preview.reviewId, review.id);
    assert.equal(preview.destinationSha, baseline);
    assert.equal(preview.resultSha, candidate.candidateSha);
    assert.equal(
      preview.worktreePath === fixture.directory ||
        preview.worktreePath === writer.worktreePath ||
        preview.worktreePath === reviewer.worktreePath,
      false,
    );
    assert.equal(preview.testResults.length, 1);
    assert.equal(preview.testResults[0]?.result, "passed");
    assert.equal(preview.testResults[0]?.exitCode, 0);
    assert.ok(
      preview.checks.some(
        (check) => check.name === "diff_check" && check.status === "passed",
      ),
    );
    const plan = await engine.integrations.plan(preview.id);
    receipt.applyPlan = plan;
    const current = listIntegrationCandidates(store, task.id)[0];
    const held = {
      previewUnapproved:
        preview.decision === null && preview.applications.length === 0,
      candidateUnapproved:
        current?.humanDecision === null && current.status === "reviewed",
      taskStillAwaitingReview:
        store.getTask(task.id).status === "AWAITING_REVIEW",
      planBlocked:
        plan.blockers.length > 0 &&
        plan.expectedSha === baseline &&
        plan.resultSha === candidate.candidateSha,
      ownerCheckoutUnchanged: await ownerUnchanged(),
    };
    receipt.candidate = current;
    receipt.integrationHold = held;
    assert.ok(Object.values(held).every(Boolean));
    stage = "awaiting_owner_integration_review";
    passed = true;
  }
} catch (error) {
  passed = false;
  receipt.failure = {
    code: error instanceof DomainError ? error.code : "SMOKE_FAILED",
    message:
      "Writer/review probe failed; inspect retained app-owned state. Never retry automatically.",
  };
} finally {
  if (implementationTaskId) {
    const previews = engine.integrations.list(implementationTaskId);
    const candidate = listIntegrationCandidates(store, implementationTaskId)[0];
    integrationApprovalGranted =
      previews.some((p) => p.decision?.outcome === "approved") ||
      candidate?.humanDecision === "approved";
    integrationApplied =
      previews.some((p) =>
        p.applications.some((a) => a.status === "applied"),
      ) || store.getTask(implementationTaskId).status === "DONE";
    passed = passed && !integrationApprovalGranted && !integrationApplied;
  }
  receipt.persisted = {
    attempts: store.listAttempts().length,
    sessions: store.listSessions().length,
  };
  receipt.worktrees = store
    .listAttempts()
    .map((a) => a.worktreePath)
    .filter((path) => path !== null);
  await app.close();
}
const unchanged = await ownerUnchanged();
const personalUnchanged =
  JSON.stringify(await metadata()) === JSON.stringify(beforeMetadata);
passed = passed && unchanged && personalUnchanged;
const retain = requestedTurns > 0 || receipt.failure !== undefined;
receipt = {
  ...receipt,
  stage,
  requestedTurns,
  passed,
  ownerCheckoutUnchanged: unchanged,
  personalConfigMetadataUnchanged: personalUnchanged,
  integrationApprovalGranted,
  integrationApplied,
  retained: retain
    ? {
        database: locations.database,
        fixture: fixture.directory,
        inspectCommand: `mise x -- env XDG_DATA_HOME=${dirname(locations.data)} pnpm dev`,
      }
    : null,
  limitations: [
    "Pi only: one scoped file writer and an independent read-only reviewer, at most two paid turns only with BOTH explicit gates and fresh owner authorization",
    "A passing independent review/isolated preview is not owner integration approval; this runner has no approve/apply operation",
    "Successful native review/preview and all failed native work remain retained for owner inspection; existing databases cannot be replayed",
    "Metadata checks cover seven named personal files, not all filesystem/session access or an OS sandbox",
  ],
};
const text = `${JSON.stringify(receipt, null, 2)}\n`;
for (const [key, value] of Object.entries(process.env))
  if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && value && value.length >= 8)
    assert.equal(text.includes(value), false, `${key} value reached evidence`);
await writeFile(output, text, { flag: "wx", mode: 0o600 });
if (!retain) {
  await fixture.verify(async () => assert.ok(unchanged));
  for (const suffix of ["", "-wal", "-shm"])
    await rm(`${locations.database}${suffix}`, { force: true });
}
console.log(
  `${passed ? (live ? "PASS: REVIEW/PREVIEW ONLY; INTEGRATION HELD" : "DISCOVERY ONLY (zero turns)") : requestedTurns ? "FAIL; RETAINED WITHOUT RETRY" : "BLOCKED (zero turns)"}: Pi writer smoke; evidence ${output}`,
);
process.exitCode = passed ? 0 : requestedTurns ? 1 : 2;
