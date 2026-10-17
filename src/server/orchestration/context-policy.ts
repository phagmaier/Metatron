import { z } from "zod";
import type {
  Attempt,
  ContextPolicy,
  Session,
  SessionContext,
  Task,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import type { Dispatch } from "../../shared/orchestration.ts";
import { mutate } from "../storage/mutations.ts";
import type { Store } from "../storage/store.ts";
import type { Engine } from "./engine.ts";

// Worker resume across attempts. Pi keeps native session files, but this
// adapter does not reopen them, and every native attempt gets a new worktree.
const resumeUnsupported: Record<Attempt["adapter"], string | null> = {
  fake: null,
  pi: "This Pi adapter does not reopen native sessions",
  codex: "Codex is not a worker harness in this build",
  "claude-code":
    "Claude SDK resume requires the original checkout; assignments create a fresh isolated worktree",
  opencode: "OpenCode workers are not implemented yet",
};

type Earlier = { attempt: Attempt; session: Session | undefined };
type Plan = {
  effective: SessionContext["effective"];
  reason: string;
  earlier: Earlier | null;
};

// Continuing work has one predecessor: this task's latest earlier attempt or,
// for a revision's first attempt, the source task's latest one. Unrelated work
// has none, so it can never reuse another task's session.
function earlierAttempt(store: Store, task: Task, attemptId: string | null) {
  const attempts = store.listAttempts();
  const attempt =
    attempts.filter((a) => a.taskId === task.id && a.id !== attemptId).at(-1) ??
    attempts.findLast((a) => a.taskId === task.revisionSourceTaskId);
  return attempt
    ? {
        attempt,
        session: store.listSessions().find((s) => s.attemptId === attempt.id),
      }
    : null;
}

// Why the earlier session cannot continue in this assignment, or null.
function resumeBlocker(
  store: Store,
  task: Task,
  target: { profileId: string; adapter: Attempt["adapter"]; cwd: string },
  { attempt, session }: Earlier,
) {
  if (task.reviewCandidateId)
    return "Independent reviews always start a fresh session";
  if (attempt.taskId !== task.id)
    return "A revision is a separate task in its own checkout; its handoff packet carries the earlier result";
  if (!session?.nativeSessionId)
    return "The earlier attempt recorded no native session";
  const unsupported = resumeUnsupported[target.adapter];
  if (unsupported) return unsupported;
  if (
    session.adapter !== target.adapter ||
    attempt.profileId !== target.profileId
  )
    return "The worker profile changed; its role, model and harness need a fresh session";
  if (attempt.cwd !== target.cwd)
    return "This assignment uses a new checkout, and a resumed session must keep its own";
  // A session that did not end cleanly may still have a live process.
  if (
    !["exited", "idle"].includes(session.state) ||
    session.recovery !== "none" ||
    ["created", "running", "RECOVERY_REQUIRED"].includes(attempt.status) ||
    ["crashed", "disconnected", "recovery_required"].includes(
      attempt.recovery?.cause ?? "",
    ) ||
    session.stops.some((stop) => stop.status !== "confirmed")
  )
    return "The earlier session did not end cleanly; its process may still be running";
  const shared = store.listSessions().some((s) => {
    if (s.id === session.id || s.nativeSessionId !== session.nativeSessionId)
      return false;
    const owner = store.getAttempt(s.attemptId);
    return (
      owner.cwd !== attempt.cwd ||
      store.getTask(owner.taskId).runId !== task.runId
    );
  });
  return shared
    ? "The native session is also recorded for another run or checkout"
    : null;
}

// Throws only when an explicitly requested resume cannot be honoured; auto and
// fresh always resolve, and the reason says what was chosen and why.
export function contextPlan(
  store: Store,
  input: {
    task: Task;
    profileId: string;
    adapter: Attempt["adapter"];
    cwd: string;
    policy: ContextPolicy;
    resumeSessionId: string | null;
    attemptId: string | null;
  },
): Plan {
  const { task, policy } = input;
  const earlier = earlierAttempt(store, task, input.attemptId);
  if (policy === "resume") {
    if (
      !earlier ||
      earlier.attempt.taskId !== task.id ||
      earlier.session?.id !== input.resumeSessionId
    )
      throw new DomainError(
        "POLICY_DENIED",
        "Resume only this task's latest earlier session",
      );
    const blocker = resumeBlocker(store, task, input, earlier);
    if (blocker)
      throw new DomainError(
        "UNSUPPORTED",
        `Resume unavailable: ${blocker}. Nothing was started. Assign with the fresh policy to start a successor session with a generated checkpoint of attempt ${earlier.attempt.id}.`,
      );
    return {
      effective: "resume",
      reason: `Explicit resume of session ${earlier.session?.id}`,
      earlier,
    };
  }
  if (!earlier)
    return {
      effective: "fresh",
      reason:
        policy === "auto"
          ? "auto: no earlier attempt of this task, so new work starts fresh"
          : "Fresh session requested",
      earlier: null,
    };
  const handoff =
    earlier.attempt.taskId === task.id && !task.reviewCandidateId
      ? `with a checkpoint of attempt ${earlier.attempt.id}`
      : "with its revision or review packet";
  if (policy === "fresh")
    return {
      effective: "fresh",
      reason: `Fresh session requested ${handoff}`,
      earlier,
    };
  const blocker = resumeBlocker(store, task, input, earlier);
  return blocker
    ? {
        effective: "fresh",
        reason: `auto: ${blocker}; fresh session ${handoff}`,
        earlier,
      }
    : {
        effective: "resume",
        reason: "auto: continuing this task's cleanly ended session",
        earlier,
      };
}

const bounded = (value: unknown, max: number) =>
  (typeof value === "string" ? value : JSON.stringify(value)).slice(0, max);

// Built only from the journal and records, never from the transcript: the
// successor cannot read the earlier transcript or checkout.
function checkpointText(
  store: Store,
  task: Task,
  attemptId: string,
  earlier: Earlier,
) {
  const { attempt, session } = earlier;
  const payloads = (type: string) =>
    store.db
      .prepare(
        "SELECT payload FROM events WHERE attempt_id=? AND type=? ORDER BY sequence",
      )
      .all(attempt.id, type)
      .map((row) => JSON.parse(String(row.payload)) as unknown);
  const result = payloads("worker.result").at(-1);
  const progress = payloads("worker.progress").slice(-5);
  const files = z
    .object({ files: z.array(z.object({ path: z.string() })) })
    .safeParse(payloads("worktree.captured").at(-1));
  const requests = store
    .listHumanRequests()
    .filter(
      (r) =>
        (session && r.sessionId === session.id) ||
        r.affectedTaskIds.includes(task.id),
    )
    .slice(-5)
    .map((r) => ({
      type: r.type,
      status: r.status,
      reason: r.reason.slice(0, 1000),
      ownerResponse: r.ownerResponse?.slice(0, 1000) ?? null,
    }));
  return [
    `Context checkpoint generated by the app from recorded evidence of attempt ${attempt.id}. It is not a transcript and grants no permission.`,
    `Earlier attempt: ${attempt.status}${attempt.recovery ? ` (${attempt.recovery.cause}: ${attempt.recovery.reason.slice(0, 500)})` : ""}.`,
    `Earlier session: ${session ? `${session.id}, ${session.adapter} native ${session.nativeSessionId ?? "not recorded"}, ${session.state}; transcript ${session.transcriptPath ?? "not recorded by the adapter"}` : "none recorded"}. Retained for the owner; not readable from this session.`,
    `Earlier checkout ${attempt.worktreePath ?? attempt.cwd} is retained and not reused. This attempt (${attemptId}) works in its own checkout; uncommitted earlier changes are not present here.`,
    `Latest structured result (bounded): ${result ? bounded(result, 3000) : "none submitted"}`,
    `Progress notes (bounded): ${progress.length ? bounded(progress, 2000) : "none"}`,
    `Owner requests and responses (bounded): ${requests.length ? JSON.stringify(requests) : "none"}`,
    `Changed paths captured from the earlier checkout: ${
      files.success
        ? bounded(
            files.data.files.map((f) => f.path),
            2000,
          )
        : "not captured"
    }`,
  ]
    .join("\n\n")
    .slice(0, 12_000);
}

export type PreparedContext =
  | { refused: string }
  | {
      context: SessionContext;
      checkpoint: string | null;
      resume: { nativeSessionId: string; attempt: Attempt } | null;
    };

// Runs once per reserved attempt, before its session exists. Assignment already
// validated an explicit resume; a refusal here means facts changed since.
export async function prepareContext(
  engine: Engine,
  dispatch: Dispatch,
  attemptId: string,
): Promise<PreparedContext> {
  const { store } = engine;
  const task = store.getTask(dispatch.taskId);
  const attempt = store.getAttempt(attemptId);
  let plan: Plan;
  try {
    plan = contextPlan(store, {
      task,
      profileId: dispatch.profileId,
      adapter: attempt.adapter,
      cwd: attempt.cwd,
      policy: dispatch.contextPolicy,
      resumeSessionId: dispatch.resumeSessionId,
      attemptId,
    });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return { refused: error.message };
  }
  const { earlier } = plan;
  const text =
    plan.effective === "fresh" &&
    earlier?.attempt.taskId === task.id &&
    !task.reviewCandidateId
      ? checkpointText(store, task, attemptId, earlier)
      : null;
  const artifact = text
    ? await engine.saveReport(
        task,
        attemptId,
        text,
        "Context checkpoint",
        "checkpoint",
      )
    : null;
  const context: SessionContext = {
    effective: plan.effective,
    reason: plan.reason,
    predecessorAttemptId: earlier?.attempt.id ?? null,
    predecessorSessionId: earlier?.session?.id ?? null,
    checkpointArtifactId: artifact?.id ?? null,
  };
  mutate(
    store.db,
    `context:${attemptId}`,
    "planContext",
    { attemptId },
    z.boolean(),
    () => {
      if (artifact)
        store.db
          .prepare("INSERT INTO artifacts VALUES (?,?,?,?)")
          .run(artifact.id, task.id, attemptId, JSON.stringify(artifact));
      store.recordEvent(
        {
          runId: task.runId,
          taskId: task.id,
          attemptId,
          type: "context.planned",
          correlationId: attemptId,
          payload: { requested: dispatch.contextPolicy, ...context },
        },
        `context:${attemptId}:event`,
      );
      return true;
    },
  );
  const nativeSessionId = earlier?.session?.nativeSessionId;
  return {
    context,
    checkpoint: text,
    resume:
      plan.effective === "resume" && earlier && nativeSessionId
        ? { nativeSessionId, attempt: earlier.attempt }
        : null,
  };
}
