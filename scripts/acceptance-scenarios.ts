import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { ReviewHistory } from "../src/shared/api.ts";
import {
  type AgentProfile,
  defaultLimits,
  type HumanRequest,
  type Run,
  type Task,
} from "../src/shared/domain/entities.ts";
import type { WorkflowRun } from "../src/shared/workflows.ts";
import {
  type Acceptance,
  type AcceptanceRepo,
  roleIds,
  type Selection,
  treeDigest,
} from "./acceptance-kit.ts";

export type Context = {
  k: Acceptance;
  repo: AcceptanceRepo;
  projectId: string;
  cap: number;
  runs: string[];
  sel: { lead: Selection; writer: Selection; reader: Selection };
};
const only =
  "Do not propose, assign, review or run anything else, and end your turn when done.";

function member(run: Run, roleId: string) {
  const profile = run.teamSnapshot?.profiles.find((p) => p.roleId === roleId);
  if (!profile) throw new Error(`Run roster lacks role ${roleId}`);
  return profile;
}
async function reviewTasks(c: Context, runId: string) {
  return (await c.k.tasks(runId)).filter((t) => t.reviewCandidateId);
}
async function review(
  c: Context,
  runId: string,
  taskId: string,
  reviewerId: string,
  fixture: string,
) {
  const { k } = c;
  const seen = new Set((await reviewTasks(c, runId)).map((t) => t.id));
  const before = (await k.read<ReviewHistory>(`reviews?taskId=${taskId}`))
    .reviews.length;
  k.queuePi(fixture);
  await k.write("tasks/review", { taskId, profileId: reviewerId });
  return k.until("structured review", async () => {
    const failed = (await reviewTasks(c, runId)).find(
      (t) =>
        !seen.has(t.id) &&
        ["FAILED", "RETRY_DECISION", "CANCELLED"].includes(t.status),
    );
    if (failed)
      throw new Error(`Review "${failed.title}" reached ${failed.status}`);
    const history = await k.read<ReviewHistory>(`reviews?taskId=${taskId}`);
    return history.reviews.length > before && history.reviews.at(-1)?.review;
  });
}
// One independent review; at most one revision and re-review on findings.
async function reviewed(
  c: Context,
  runId: string,
  task: Task,
  reviewerId: string,
  fixtures: [string, string],
) {
  const { k } = c;
  let verdict = await review(c, runId, task.id, reviewerId, fixtures[0]);
  k.note(
    `Review of "${task.title}": ${verdict.recommendation} — ${verdict.summary}`,
  );
  const found = verdict.recommendation === "changes_requested";
  if (found) {
    k.queuePi("tracked");
    await k.write("tasks/revision", {
      taskId: task.id,
      feedback: [
        `Address the independent reviewer's findings: ${verdict.summary}`,
        ...verdict.findings.map(
          (f) => `- ${f.severity} ${f.file}:${f.line}: ${f.justification}`,
        ),
      ]
        .join("\n")
        .slice(0, 8000),
    });
    // A revision that stalls (a new human wait, a failure) fails fast.
    await k.until("revision back in review", async () => {
      const tasks = await k.tasks(runId);
      const stuck = tasks.find(
        (t) =>
          t.revisionSourceTaskId === task.id &&
          ["WAITING_HUMAN", "RETRY_DECISION", "FAILED", "CANCELLED"].includes(
            t.status,
          ),
      );
      if (stuck) throw new Error(`"${stuck.title}" reached ${stuck.status}`);
      return tasks.find((t) => t.id === task.id)?.status === "AWAITING_REVIEW";
    });
    verdict = await review(c, runId, task.id, reviewerId, fixtures[1]);
    k.note(`Re-review: ${verdict.recommendation} — ${verdict.summary}`);
  }
  return { verdict, found };
}
async function busy(c: Context, runId: string, taskId: string) {
  const { k } = c;
  await k.status(runId, taskId, ["RUNNING"]);
  return k.until("busy native session", async () => {
    const attempt = (await k.attempts(runId)).findLast(
      (a) => a.taskId === taskId,
    );
    const session = (await k.sessions()).find(
      (s) => s.attemptId === attempt?.id,
    );
    if ((await k.task(runId, taskId)).status !== "RUNNING")
      throw new Error("Worker left RUNNING before it could be interrupted");
    return session?.state === "busy" && attempt && { attempt, session };
  });
}
async function ownerClean(c: Context, expectedHead: string) {
  const [head, status] = await Promise.all([c.repo.head(), c.repo.status()]);
  return head === expectedHead && status === "";
}
async function withTeam(
  c: Context,
  name: string,
  workers: AgentProfile[],
  options: {
    mode: "chat_plan" | "supervised" | "autonomous_bounded";
    leadTurns: number;
    workflowTemplateIds?: string[];
    limits?: Partial<typeof defaultLimits>;
  },
) {
  const lead = await c.k.profile(
    `${name} Lead`,
    roleIds.lead,
    c.sel.lead,
    "coordinator",
  );
  return c.k.team({
    name,
    leadProfileId: lead.id,
    workerProfileIds: workers.map((w) => w.id),
    workflowTemplateIds: options.workflowTemplateIds ?? [],
    mode: options.mode,
    limits: {
      ...defaultLimits,
      // Engine-enforced caps; no automatic Lead turn beyond the owner's prompt.
      maxTotalWorkerLaunchesPerRun: Math.max(1, c.cap - options.leadTurns),
      maxAutomaticLeadWakeupsPerRun: 0,
      maxRevisionCyclesPerTask: 1,
      ...options.limits,
    },
  });
}
// Launch commitments include assigned-but-queued work; the driver separately
// caps attempts actually started.
async function nativeRun(
  c: Context,
  title: string,
  prompt: string,
  launches = c.cap,
) {
  const run = await c.k.write<Run>("runs/native", {
    projectId: c.projectId,
    harness: c.sel.writer.harness,
    title,
    initialPrompt: prompt,
    model: c.sel.writer.model,
    thinking: c.sel.writer.thinking,
    permission: "workspace_write",
    limits: {
      ...defaultLimits,
      maxTotalWorkerLaunchesPerRun: launches,
      maxRevisionCyclesPerTask: 1,
    },
  });
  c.runs.push(run.id);
  return run;
}
async function addTask(
  c: Context,
  runId: string,
  profileId: string,
  title: string,
  objective: string,
  dependencyIds: string[] = [],
) {
  const task = await c.k.write<Task>("tasks", {
    runId,
    title,
    objective,
    dependencyIds,
  });
  await c.k.write("tasks/assign", { taskId: task.id, profileId });
  return task;
}

async function scenarioA(c: Context) {
  const { k } = c;
  const writer = await k.profile(
    "A Backend Engineer",
    roleIds.writer,
    c.sel.writer,
    "workspace_write",
  );
  const reviewer = await k.profile(
    "A Reviewer",
    roleIds.reviewer,
    c.sel.writer,
    "read_only",
  );
  const team = await withTeam(c, "A team", [writer, reviewer], {
    mode: "autonomous_bounded",
    leadTurns: 1,
  });
  const base = await c.repo.head();
  k.queuePi("tracked");
  const run = await k.teamRun(
    c.projectId,
    team,
    `Coordinate this disposable repository. Call get_run_status, then call propose_task exactly once and assign_task exactly once, assigning to the roster profile whose role is Backend Engineer. Title: "Add totalInStock". Objective: "In src/inventory.js export totalInStock(items), returning the sum of quantity over items whose quantity is greater than zero (ignore zero and negative quantities). Add node:test cases in tests/inventory.test.js, Shell is unavailable, so do not run tests; finish by calling submit_result with tests marked not_run." ${only}`,
  );
  c.runs.push(run.id);
  const work = await k.until("Lead-assigned implementation task", async () =>
    (await k.tasks(run.id)).find(
      (t) => t.kind === "work" && t.assignedProfileId === writer.id,
    ),
  );
  k.check("Lead assigned a coding task to the writer", true, work.title);
  await k.status(run.id, work.id, ["AWAITING_REVIEW"]);
  const history = await k.read<ReviewHistory>(`reviews?taskId=${work.id}`);
  const candidate = history.candidates.find(
    (x) => x.id === history.currentCandidateId,
  );
  const changed = candidate
    ? (
        await c.repo.git(
          "diff",
          "--name-only",
          candidate.baseSha,
          candidate.candidateSha,
        )
      )
        .split("\n")
        .filter(Boolean)
    : [];
  k.check(
    "worker edited an isolated branch and submitted a report",
    !!candidate?.reportSubmitted && changed.length > 0,
    `candidate ${candidate?.candidateSha.slice(0, 12)} changed ${changed.join(", ")}`,
  );
  k.check("owner checkout untouched while work ran", await ownerClean(c, base));
  const { verdict, found } = await reviewed(c, run.id, work, reviewer.id, [
    "review-findings",
    "review-ok",
  ]);
  k.check(
    "independent reviewer found or cleared issues",
    verdict.recommendation === "pass",
    found ? "findings fixed by one revision" : "passed first review",
  );
  if (verdict.recommendation !== "pass") return;
  const preview = await k.integrate(run.id, work.id);
  k.check(
    "owner inspected the diff and approved integration",
    preview.decision?.outcome === "approved" &&
      preview.applications.some((a) => a.status === "applied"),
    `tests ${preview.testResults.map((t) => t.result).join(", ")}`,
  );
  k.check(
    "root checkout fast-forwarded cleanly to the approved result",
    !!preview.resultSha && (await ownerClean(c, preview.resultSha)),
  );
}

async function scenarioB(c: Context) {
  const { k } = c;
  k.queuePi("help-blocking");
  const run = await nativeRun(
    c,
    "Acceptance B · human blocker",
    "Add a shipping surcharge to src/pricing.js. The surcharge amount in cents is not in this repository and must not be guessed. If this assignment does not already contain the owner's value for SHIPPING_SURCHARGE_CENTS, call request_human_action with type environment, blocking true, a reason asking for SHIPPING_SURCHARGE_CENTS and a suggested action, then stop without editing any file. Once the owner's value is present, export const SHIPPING_SURCHARGE_CENTS with that value and a function withSurcharge(subtotalCents) returning subtotalCents + SHIPPING_SURCHARGE_CENTS, add a node:test case in tests/pricing.test.js, Shell is unavailable, so do not run tests; finish by calling submit_result with tests marked not_run.",
  );
  const writer = member(run, roleIds.writer);
  const reader = member(run, roleIds.reader);
  const reviewer = member(run, roleIds.reviewer);
  const [x] = await k.tasks(run.id);
  if (!x) throw new Error("Native run has no task");
  await k.status(run.id, x.id, ["WAITING_HUMAN"]);
  const request = await k.until("open blocking request", async () =>
    (
      await k.read<{ humanRequests: HumanRequest[] }>("human-requests")
    ).humanRequests.find(
      (r) => r.affectedTaskIds.includes(x.id) && r.status === "open",
    ),
  );
  k.check(
    "worker requested the missing dependency through Needs You",
    request.blocking,
    `${request.type}: ${request.reason.slice(0, 200)}`,
  );
  k.queuePi("success");
  const y = await addTask(
    c,
    run.id,
    reader.id,
    "Describe the inventory module",
    `Read src/inventory.js and tests/inventory.test.js and report each export with file:line references. Do not edit files. Submit with submit_result.`,
  );
  const z = await addTask(
    c,
    run.id,
    reader.id,
    "Verify the shipping surcharge",
    "Read src/pricing.js and report the value of SHIPPING_SURCHARGE_CENTS and how withSurcharge uses it, with file:line references. Do not edit files. Submit with submit_result.",
    [x.id],
  );
  await k.status(run.id, y.id, ["AWAITING_REVIEW"]);
  const zAttempts = async () =>
    (await k.attempts(run.id)).filter((a) => a.taskId === z.id);
  k.check(
    "independent worker finished while the blocked worker waited",
    (await k.task(run.id, x.id)).status === "WAITING_HUMAN",
  );
  k.check(
    "downstream task waits without launching",
    (await zAttempts()).length === 0,
    (await k.task(run.id, z.id)).status,
  );
  await k.write(
    "human-requests",
    {
      id: request.id,
      expectedStatus: "open",
      status: "answered",
      ownerResponse: "SHIPPING_SURCHARGE_CENTS is 250.",
    },
    "PATCH",
  );
  k.queuePi("tracked");
  // The owner's assignment is the explicit continuation after a human wait.
  await k.write("tasks/assign", { taskId: x.id, profileId: writer.id });
  await k.status(
    run.id,
    x.id,
    ["AWAITING_REVIEW"],
    ["FAILED", "RETRY_DECISION", "CANCELLED", "WAITING_HUMAN"],
  );
  k.check("blocked worker resumed after the owner's answer", true);
  const { verdict } = await reviewed(c, run.id, x, reviewer.id, [
    "review-ok",
    "review-ok",
  ]);
  k.check(
    "resumed work verified by independent review",
    verdict.recommendation === "pass",
    verdict.summary.slice(0, 200),
  );
  if (verdict.recommendation !== "pass") return;
  k.queuePi("success");
  const preview = await k.integrate(run.id, x.id);
  const done = (await k.events(run.id)).find(
    (e) =>
      e.taskId === x.id &&
      e.type === "task.transitioned" &&
      e.payload.to === "DONE",
  );
  k.check(
    "prerequisite integrated after owner approval",
    preview.applications.some((a) => a.status === "applied") && !!done,
  );
  await k.status(run.id, z.id, ["AWAITING_REVIEW"]);
  const [launch] = await zAttempts();
  k.check(
    "downstream task launched only after its prerequisite was DONE",
    !!done && !!launch && launch.createdAt > done.createdAt,
  );
}

async function scenarioC(c: Context) {
  const { k } = c;
  const reader = await k.profile(
    "C Reader",
    roleIds.reader,
    c.sel.reader,
    "read_only",
  );
  const synthesizer = await k.profile(
    "C Synthesizer",
    roleIds.synthesizer,
    c.sel.reader,
    "read_only",
  );
  const template = await k.write<{ id: string }>("workflow-templates/explore", {
    readerProfileId: reader.id,
    synthesizerProfileId: synthesizer.id,
    readerCount: 4,
  });
  const team = await withTeam(c, "C team", [reader, synthesizer], {
    mode: "autonomous_bounded",
    leadTurns: 1,
    workflowTemplateIds: [template.id],
    limits: {
      maxParallelReadersPerWorkflow: 4,
      maxConcurrentReadersReviewers: 4,
    },
  });
  k.queuePi("success", "success", "success", "success", "success");
  const run = await k.teamRun(
    c.projectId,
    team,
    `Call get_run_status, find the saved Explore Subsystem workflow in workflows.available and call run_workflow exactly once with that templateId and parameters {"target": "the inventory and pricing modules in src/ and their tests"}. ${only}`,
  );
  c.runs.push(run.id);
  type Listed = {
    workflow: WorkflowRun;
    children: { taskId: string; stageId: string }[];
  };
  const listed = await k.until("workflow settled", async () => {
    const [entry] = (
      await k.read<{ workflows: Listed[] }>(`workflows?runId=${run.id}`)
    ).workflows;
    return entry && entry.workflow.status !== "running" && entry;
  });
  const { workflow } = listed;
  k.check(
    "Lead invoked the saved workflow",
    workflow.template.id === template.id,
    `status ${workflow.status}`,
  );
  const tasks = (await k.tasks(run.id)).filter(
    (t) => t.workflowId === workflow.id,
  );
  const stage = (id: string) =>
    workflow.stages.find((s) => s.stageId === id)?.taskIds ?? [];
  const synthesis = stage("synthesis");
  k.check(
    "four readers and one synthesizer grouped under one workflow",
    tasks.length === 5 && synthesis.length === 1,
    workflow.stages.map((s) => `${s.stageId}:${s.taskIds.length}`).join(", "),
  );
  const attempts = (await k.attempts(run.id)).filter((a) =>
    tasks.some((t) => t.id === a.taskId),
  );
  const peak = Math.max(
    ...attempts.map(
      (a) =>
        attempts.filter(
          (b) => b.createdAt <= a.createdAt && b.updatedAt > a.createdAt,
        ).length,
    ),
  );
  k.check(
    "scheduler honored the parallel reader cap",
    peak <= 4,
    `peak ${peak} concurrent children, ${attempts.length} launches`,
  );
  const [synthesisTask] = synthesis;
  const reports = synthesisTask
    ? await k.read<{ content: string }[]>(`reports?taskId=${synthesisTask}`)
    : [];
  const text = reports.map((r) => r.content).join("\n");
  const citations = text.match(/[\w./-]+\.(?:js|json|md):\d+/g) ?? [];
  k.check(
    "final report cites source locations",
    citations.length > 0 || !k.live,
    k.live
      ? `${citations.length} citations, e.g. ${citations.slice(0, 3).join(", ")}`
      : "scripted synthesis cites no files (rehearsal)",
  );
  const failed = tasks.filter((t) =>
    ["FAILED", "RETRY_DECISION", "CANCELLED"].includes(t.status),
  );
  k.check(
    "partial failures are explicit, never silently dropped",
    workflow.status === "completed" ? failed.length === 0 : failed.length > 0,
    `${failed.length} failed children`,
  );
}

async function scenarioD(c: Context) {
  const { k } = c;
  const first = await k.profile(
    "D Writer A",
    roleIds.writer,
    c.sel.writer,
    "workspace_write",
  );
  const second = await k.profile(
    "D Writer B",
    roleIds.writer,
    c.sel.writer,
    "workspace_write",
  );
  const team = await withTeam(c, "D team", [first, second], {
    mode: "autonomous_bounded",
    leadTurns: 1,
  });
  k.queuePi("hold", "tracked");
  const run = await k.teamRun(
    c.projectId,
    team,
    `Call get_run_status, then call propose_task exactly once and assign_task exactly once, assigning to the roster profile named "D Writer A". Title: "Document the pricing module". Objective: "Create docs/pricing.md documenting every export of src/pricing.js and src/inventory.js with file:line references and a usage example for each, then Shell is unavailable, so do not run tests; finish by calling submit_result with tests marked not_run." ${only}`,
  );
  c.runs.push(run.id);
  const work = await k.until("Lead-assigned task", async () =>
    (await k.tasks(run.id)).find((t) => t.kind === "work"),
  );
  const { attempt } = await busy(c, run.id, work.id);
  await k.write("tasks/pause", { taskId: work.id });
  await k.status(run.id, work.id, ["RETRY_DECISION"]);
  const paused = (await k.attempts(run.id)).find((a) => a.id === attempt.id);
  k.check(
    "owner paused the running worker",
    paused?.status === "interrupted" &&
      /^Owner paused/.test(paused.recovery?.reason ?? ""),
    paused?.recovery?.reason,
  );
  const digest = await treeDigest(attempt.cwd);
  await k.write("tasks", { id: work.id, priority: 10 }, "PATCH");
  const replacement = work.assignedProfileId === first.id ? second : first;
  const check = await k.write<{ id: string }>("recovery/recheck", {
    taskId: work.id,
  });
  await k.write("recovery/decision", {
    taskId: work.id,
    checkId: check.id,
    profileId: replacement.id,
  });
  const current = await k.status(run.id, work.id, ["AWAITING_REVIEW"]);
  const attempts = (await k.attempts(run.id)).filter(
    (a) => a.taskId === work.id,
  );
  k.check("owner changed task priority", current.priority === 10);
  k.check(
    "task reassigned to a new profile in a new worktree",
    current.assignedProfileId === replacement.id &&
      attempts.length === 2 &&
      attempts[1]?.cwd !== attempt.cwd,
    replacement.name,
  );
  const retained = await access(attempt.cwd).then(
    () => true,
    () => false,
  );
  k.check("old worktree retained", retained, attempt.cwd);
  const notices = (await k.events(run.id)).filter(
    (e) => e.type === "lead.notification" && e.taskId === work.id,
  );
  k.check(
    "Lead notified of the owner's takeover",
    notices.some((e) => e.payload.kind === "paused"),
    notices.map((e) => e.payload.kind).join(", "),
  );
  const session = (await k.sessions()).find((s) => s.attemptId === attempt.id);
  k.check(
    "old worker stopped writing",
    session?.state === "exited" &&
      (await treeDigest(attempt.cwd)) === digest &&
      session.stops.some(
        (s) => s.scope === "pause" && s.status === "confirmed",
      ),
    `session ${session?.state}`,
  );
}

async function scenarioE(c: Context) {
  const { k } = c;
  const base = await c.repo.head();
  k.queuePi("hold", "hold");
  const run = await nativeRun(
    c,
    "Acceptance E · crash and restart",
    "Add JSDoc comments to every exported function in src/inventory.js, add node:test cases for empty arrays and zero or negative quantities in tests/inventory.test.js, Shell is unavailable, so do not run tests; finish by calling submit_result with tests marked not_run.",
    c.cap + 1,
  );
  const writer = member(run, roleIds.writer);
  const [w1] = await k.tasks(run.id);
  if (!w1) throw new Error("Native run has no task");
  const crashed = await busy(c, run.id, w1.id);
  const w2 = await addTask(
    c,
    run.id,
    writer.id,
    "Document pricing",
    "Add JSDoc comments to subtotalCents in src/pricing.js, add a node:test case for an empty order in tests/pricing.test.js, Shell is unavailable, so do not run tests; finish by calling submit_result with tests marked not_run.",
  );
  const interrupted = await busy(c, run.id, w2.id);
  const w3 = await addTask(
    c,
    run.id,
    writer.id,
    "Pending writer",
    "Add a README section describing how to run the tests, then submit_result.",
  );
  // Pause scheduling so the pending writer stays queued and spends nothing.
  await k.write("runs", { id: run.id, status: "paused" }, "PATCH");
  const pid = crashed.session.processId;
  if (!pid) throw new Error("Worker process id was not recorded");
  process.kill(pid, "SIGKILL");
  await k.status(run.id, w1.id, ["RETRY_DECISION"]);
  await k.crash();
  await k.start();
  await k.status(run.id, w2.id, ["RETRY_DECISION"]);
  await delay(5000);
  const attempts = await k.attempts(run.id);
  const count = (id: string) => attempts.filter((a) => a.taskId === id).length;
  const recovered = attempts.filter((a) => a.recovery);
  k.check(
    "crash and app restart recorded explicit recovery causes",
    recovered.length === 2,
    recovered.map((a) => a.recovery?.cause).join(", "),
  );
  k.check(
    "no ambiguous mutating work was rerun",
    count(w1.id) === 1 && count(w2.id) === 1,
    `${attempts.length} attempts`,
  );
  const pending = await k.task(run.id, w3.id);
  k.check(
    "pending task survived the restart without launching",
    count(w3.id) === 0 && ["QUEUED", "READY"].includes(pending.status),
    pending.status,
  );
  const kept = await Promise.all(
    [crashed.attempt.cwd, interrupted.attempt.cwd].map((path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    ),
  );
  k.check("unresolved worktrees were not deleted", kept.every(Boolean));
  k.check("owner checkout unchanged", await ownerClean(c, base));
  await k.write("tasks/cancel", { taskId: w3.id });
}

async function scenarioF(c: Context) {
  const { k } = c;
  k.queuePi("conflict", "conflict");
  const run = await nativeRun(
    c,
    "Acceptance F · conflicting implementations",
    "In src/inventory.js change inStock so it returns the in-stock item names sorted alphabetically. Update tests/inventory.test.js to match, Shell is unavailable, so do not run tests; finish by calling submit_result with tests marked not_run.",
  );
  const writer = member(run, roleIds.writer);
  const reviewer = member(run, roleIds.reviewer);
  const [f1] = await k.tasks(run.id);
  if (!f1) throw new Error("Native run has no task");
  await k.status(run.id, f1.id, ["RUNNING", "AWAITING_REVIEW"]);
  const f2 = await addTask(
    c,
    run.id,
    writer.id,
    "Return stock records",
    "In src/inventory.js change inStock so it returns { name, quantity } objects for in-stock items instead of names. Update tests/inventory.test.js to match, Shell is unavailable, so do not run tests; finish by calling submit_result with tests marked not_run.",
  );
  await k.status(run.id, f1.id, ["AWAITING_REVIEW"]);
  await k.status(run.id, f2.id, ["AWAITING_REVIEW"]);
  const files = async (task: Task) => {
    const history = await k.read<ReviewHistory>(`reviews?taskId=${task.id}`);
    const candidate = history.candidates.at(-1);
    if (!candidate) return [];
    return (
      await c.repo.git(
        "diff",
        "--name-only",
        candidate.baseSha,
        candidate.candidateSha,
      )
    )
      .split("\n")
      .filter(Boolean);
  };
  const [one, two] = [await files(f1), await files(f2)];
  const shared = one.filter((path) => two.includes(path));
  k.check(
    "two workers changed the same area in separate worktrees",
    shared.length > 0,
    shared.join(", "),
  );
  for (const task of [f1, f2]) {
    const { verdict } = await reviewed(c, run.id, task, reviewer.id, [
      "review-ok",
      "review-ok",
    ]);
    if (verdict.recommendation !== "pass") {
      k.check(`"${task.title}" passed review`, false, verdict.summary);
      return;
    }
  }
  const applied = await k.integrate(run.id, f1.id);
  k.check(
    "first implementation integrated after owner approval",
    applied.applications.some((a) => a.status === "applied"),
  );
  const head = await c.repo.head();
  const conflict = await k.integrate(run.id, f2.id);
  k.check(
    "integration detected the real conflict instead of overwriting",
    conflict.status === "conflict" && conflict.conflicts.length > 0,
    `${conflict.status}: ${conflict.conflicts.join(", ")}`,
  );
  const blocked = await k.task(run.id, f2.id);
  const asked = (
    await k.read<{ humanRequests: HumanRequest[] }>("human-requests")
  ).humanRequests.some(
    (r) => r.affectedTaskIds.includes(f2.id) && r.status === "open",
  );
  k.check(
    "owner asked to resolve the conflict",
    blocked.status === "BLOCKED_CONFLICT" || asked,
    `${blocked.status}${asked ? ", Needs You request open" : ""}`,
  );
  k.check(
    "nothing from the conflicting candidate was applied",
    await ownerClean(c, head),
  );
}

async function scenarioG(c: Context) {
  const { k } = c;
  const reader = await k.profile(
    "G Reader",
    roleIds.reader,
    c.sel.reader,
    "read_only",
  );
  const team = await withTeam(c, "G team", [reader], {
    mode: "chat_plan",
    leadTurns: 1,
  });
  const base = await c.repo.head();
  const digest = await treeDigest(c.repo.directory);
  const run = await k.teamRun(
    c.projectId,
    team,
    "Chat/Plan only: give a short step-by-step plan to add a percentage discount to src/pricing.js (function signature, edge cases, tests to add) and cite the files you would change. Do not delegate or edit anything.",
  );
  c.runs.push(run.id);
  const lead = await k.until("Lead turn", async () =>
    (await k.tasks(run.id)).find((t) => t.kind === "lead"),
  );
  await k.status(run.id, lead.id, ["AWAITING_REVIEW"]);
  const events = await k.events(run.id);
  const plan = events
    .filter((e) => e.type === "lead.message")
    .map((e) => String(e.payload.text ?? ""))
    .join("\n");
  k.check("owner received a plan", plan.length > 0, plan.slice(0, 300));
  const work = (await k.tasks(run.id)).filter((t) => t.kind === "work");
  const workerAttempts = (await k.attempts(run.id)).filter((a) =>
    work.some((t) => t.id === a.taskId),
  );
  k.check(
    "no worker was spawned",
    workerAttempts.length === 0,
    `${work.length} proposed tasks, ${workerAttempts.length} attempts`,
  );
  k.check(
    "project not mutated",
    (await ownerClean(c, base)) &&
      (await treeDigest(c.repo.directory)) === digest,
  );
}

export const scenarios = {
  A: {
    title: "Initial autonomous run",
    cap: 5,
    run: scenarioA,
    codexRole: "Backend Engineer",
  },
  B: { title: "Human blocker", cap: 7, run: scenarioB },
  C: {
    title: "Independent investigation workflow",
    cap: 6,
    run: scenarioC,
    codexScenario: "workflow",
  },
  D: {
    title: "Owner takes over",
    cap: 3,
    run: scenarioD,
    codexRole: "Backend Engineer",
  },
  E: { title: "Failure/restart", cap: 2, run: scenarioE },
  F: { title: "Conflicting implementations", cap: 4, run: scenarioF },
  G: { title: "Planning-only", cap: 1, run: scenarioG },
} as const;
