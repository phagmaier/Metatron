import { z } from "zod";
import {
  idSchema,
  type Task,
  taskSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import type { Actor } from "../../shared/orchestration.ts";
import { git } from "../git/command.ts";
import {
  getIntegrationCandidate,
  listIntegrationCandidates,
} from "../storage/candidates.ts";
import { mutate } from "../storage/mutations.ts";
import type { Engine } from "./engine.ts";
import { authorize } from "./policy.ts";

const requestSchema = z.strictObject({ taskId: idSchema, profileId: idSchema });
const maxDiff = 48_000;

// A review is a child task bound to one immutable candidate. Only read-only
// profiles may run it (enforced again at enqueue), and the reviewer's context
// never includes the implementer's report, so its assessment is independent.
export function requestReview(
  engine: Engine,
  actor: Actor,
  input: unknown,
  key: string,
) {
  const data = requestSchema.parse(input);
  const { store } = engine;
  const task = store.getTask(data.taskId);
  const run = authorize(store, actor, task.runId, "request_review", task.id);
  if (task.kind !== "work" || task.reviewCandidateId)
    throw new DomainError(
      "POLICY_DENIED",
      "Only implementation tasks can be reviewed",
    );
  if (
    engine.scheduling.profile(run.id, data.profileId).permission !== "read_only"
  )
    throw new DomainError(
      "POLICY_DENIED",
      "Reviews run only on read-only profiles",
    );
  return mutate(
    store.db,
    key,
    "requestReview",
    { actor, ...data },
    z.unknown(),
    () => {
      const current = store.getTask(task.id);
      const candidate = listIntegrationCandidates(store, task.id).at(-1);
      if (current.status !== "AWAITING_REVIEW" || !candidate)
        throw new DomainError(
          "CONFLICT",
          "Only a task awaiting review with a captured candidate can be reviewed",
        );
      const created = store.createTask(
        {
          runId: run.id,
          title: `Review: ${task.title}`.slice(0, 200),
          objective: `Independently review the candidate for "${task.title}" without modifying any file. Your worktree is checked out at candidate commit ${candidate.candidateSha} (base ${candidate.baseSha}); the whole repository at that commit is available, not only the diff. Report findings with file:line locations, severity and evidence, then recommend pass or changes requested.`,
          acceptanceCriteria: task.acceptanceCriteria,
          priority: task.priority,
          parentTaskId: task.id,
          origin: actor.role === "owner" ? "owner" : "lead",
        },
        `${key}:task`,
      );
      const review = taskSchema.parse({
        ...created,
        reviewCandidateId: candidate.id,
        updatedAt: new Date().toISOString(),
      });
      store.db
        .prepare("UPDATE tasks SET data=? WHERE id=?")
        .run(JSON.stringify(review), review.id);
      store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          type: "review.requested",
          correlationId: key,
          payload: {
            reviewTaskId: review.id,
            candidateId: candidate.id,
            profileId: data.profileId,
          },
        },
        `${key}:event`,
      );
      return actor.role === "lead" && run.mode === "supervised"
        ? engine.scheduling.propose(
            review.id,
            data.profileId,
            `${key}:proposal`,
          )
        : {
            outcome: "queued",
            reviewTaskId: review.id,
            dispatch: engine.scheduling.enqueue(
              actor,
              { taskId: review.id, profileId: data.profileId },
              `${key}:assign`,
            ),
          };
    },
  );
}

// The reviewer's prompt: the original objective and criteria, immutable refs,
// changed files and a bounded diff. Its worktree holds the full candidate tree.
// The packet is kept as a reference artifact; the journal records only refs.
export async function reviewPacket(
  engine: Engine,
  task: Task,
  attemptId: string,
) {
  if (!task.reviewCandidateId) return null;
  const { store } = engine;
  const candidate = getIntegrationCandidate(store, task.reviewCandidateId);
  const original = store.getTask(candidate.taskId);
  const cwd = store.getAttempt(attemptId).cwd;
  const range = [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    candidate.baseSha,
    candidate.candidateSha,
  ];
  const files = (await git(cwd, [...range, "--name-status", "--"])).trim();
  const diff = await git(cwd, [...range, "--"]);
  const truncated = diff.length > maxDiff;
  const text = [
    task.objective,
    `Original task: ${original.title}\n${original.objective}`,
    `Acceptance criteria:\n${original.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "- none recorded"}`,
    `Changed files (base ${candidate.baseSha} -> candidate ${candidate.candidateSha}):\n${files}`,
    `Candidate diff${truncated ? ` (first ${maxDiff} characters; read the changed files for the rest)` : ""}:\n${diff.slice(0, maxDiff)}`,
  ].join("\n\n");
  const artifact = await engine.saveReport(
    task,
    attemptId,
    text,
    "Review context packet",
  );
  mutate(
    store.db,
    `review-packet:${attemptId}`,
    "reviewPacket",
    { attemptId },
    z.boolean(),
    () => {
      store.db
        .prepare("INSERT INTO artifacts VALUES (?,?,?,?)")
        .run(artifact.id, task.id, attemptId, JSON.stringify(artifact));
      store.recordEvent(
        {
          runId: task.runId,
          taskId: task.id,
          attemptId,
          type: "review.packet",
          correlationId: attemptId,
          payload: {
            artifactId: artifact.id,
            candidateId: candidate.id,
            baseSha: candidate.baseSha,
            candidateSha: candidate.candidateSha,
            changedFiles: files.split("\n").filter(Boolean),
            diffTruncated: truncated,
          },
        },
        `review-packet:${attemptId}:event`,
      );
      return true;
    },
  );
  return text;
}
