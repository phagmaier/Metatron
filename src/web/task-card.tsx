import { useEffect, useState } from "react";
import { z } from "zod";
import {
  type Attempt,
  artifactSchema,
  type Event,
  type Run,
  type Session,
  type Task,
} from "../shared/domain/entities.ts";
import type { Dispatch } from "../shared/orchestration.ts";
import { candidateSchema } from "../shared/worktrees.ts";
import { readApi, writeApi } from "./api.ts";
import { IntegrationPanel } from "./integration-panel.tsx";
import { ReviewPanel, useReviewHistory } from "./review-panel.tsx";

export function TaskCard({
  task,
  run,
  session,
  dispatch,
  attempt,
  evidence,
  candidate,
  revision,
  integrationEvent,
  reviewEvent,
  onError,
}: {
  task: Task;
  run: Run;
  session: Session | undefined;
  dispatch: Dispatch | undefined;
  attempt: Attempt | undefined;
  evidence: Event | undefined;
  candidate: Event | undefined;
  revision: Task | undefined;
  integrationEvent: number | undefined;
  reviewEvent: number | undefined;
  onError: (error: string) => void;
}) {
  const captured = candidate
    ? candidateSchema.safeParse(candidate.payload)
    : undefined;
  const profiles =
    run.teamSnapshot?.profiles.filter((profile) =>
      run.teamSnapshot?.preset.workerProfileIds.includes(profile.id),
    ) ?? [];
  const [profileId, setProfileId] = useState(
    task.assignedProfileId ?? task.proposedProfileId ?? profiles[0]?.id ?? "",
  );
  const defaultProfileId = profiles[0]?.id ?? "";
  useEffect(() => {
    setProfileId(
      task.assignedProfileId ?? task.proposedProfileId ?? defaultProfileId,
    );
  }, [task.assignedProfileId, task.proposedProfileId, defaultProfileId]);
  const reviewable =
    task.status === "AWAITING_REVIEW" &&
    !task.reviewCandidateId &&
    captured?.success === true &&
    captured.data.status === "captured";
  // Review history and integration live on the original task card only.
  const lineageRoot =
    run.execution === "native" &&
    task.kind === "work" &&
    !task.reviewCandidateId &&
    !task.revisionSourceTaskId;
  const history = useReviewHistory(
    lineageRoot ? task.id : null,
    `${reviewEvent}:${integrationEvent}`,
    onError,
  );
  const [scenario, setScenario] = useState("success");
  const [priority, setPriority] = useState(task.priority);
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    onError("");
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="task-card">
      <div className="section-title">
        <strong>{task.title}</strong>
        <code>{task.status}</code>
      </div>
      <p>{task.objective}</p>
      <p className="note">
        {task.origin} · priority {task.priority}
        {task.ownerPinned ? " · owner assignment pinned" : ""}
        {task.dependencyIds.length
          ? ` · ${task.dependencyIds.length} prerequisites`
          : ""}
      </p>
      {task.reviewCandidateId && (
        <p className="note">
          Read-only review of an immutable candidate commit. The reviewer does
          not see the implementer's report.
        </p>
      )}
      {task.latestRevisionTaskId && (
        <p className="note">
          Latest revision: {revision?.title ?? task.latestRevisionTaskId}
          {revision ? ` (${revision.status})` : ""}. Review and report actions
          use its current result; earlier history is retained.
        </p>
      )}
      {task.revisionSourceTaskId && (
        <p className="note">
          This revision continues from the saved candidate in a separate
          worktree.
        </p>
      )}
      {(task.status === "AWAITING_REVIEW" ||
        (task.status === "CHANGES_REQUESTED" &&
          revision?.status === "CANCELLED")) &&
        !task.reviewCandidateId &&
        !(task.revisionSourceTaskId && task.latestRevisionTaskId) && (
          <div>
            <label>
              Revision feedback
              <textarea
                value={feedback}
                maxLength={8000}
                onChange={(event) => setFeedback(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                busy ||
                !feedback.trim() ||
                run.status !== "active" ||
                run.mode === "chat_plan"
              }
              onClick={() =>
                void act(() =>
                  writeApi("tasks/revision", { taskId: task.id, feedback }),
                )
              }
            >
              Request revision
            </button>
          </div>
        )}
      {dispatch?.diagnostic && <p className="warning">{dispatch.diagnostic}</p>}
      {task.proposedProfileId && (
        <p className="warning">
          Lead proposes{" "}
          {profiles.find((p) => p.id === task.proposedProfileId)?.name ??
            "a worker"}
          . Nothing runs until you approve; choosing another worker is a pinned
          override the Lead sees.
        </p>
      )}
      {session && (
        <p className="worker-status">
          {session.adapter === "fake"
            ? "FAKE worker"
            : `Native ${session.adapter} worker`}{" "}
          ·{" "}
          {
            run.teamSnapshot?.profiles.find(
              (profile) => profile.id === task.assignedProfileId,
            )?.name
          }{" "}
          · {session.state}
          <br />
          <span className="path">{session.nativeSessionId}</span>
          {session.recovery !== "none" && (
            <span className="warning"> · {session.recovery}</span>
          )}
        </p>
      )}
      <div className="form-row">
        <label>
          Worker
          <select
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.permission}
              </option>
            ))}
          </select>
        </label>
        {run.execution === "fake" && (
          <label>
            Simulation
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
            >
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="disconnect">Disconnect</option>
            </select>
          </label>
        )}
      </div>
      <div className="actions">
        <button
          type="button"
          disabled={
            busy ||
            run.status !== "active" ||
            !["BACKLOG", "READY", "QUEUED"].includes(task.status) ||
            run.mode === "chat_plan" ||
            !profileId
          }
          onClick={() =>
            void act(() =>
              writeApi("tasks/assign", {
                taskId: task.id,
                profileId,
                scenario,
              }),
            )
          }
        >
          Assign / approve
        </button>
        {reviewable && (
          <button
            type="button"
            title="Choose a read-only worker such as the Reviewer"
            disabled={
              busy ||
              run.status !== "active" ||
              run.mode === "chat_plan" ||
              profiles.find((p) => p.id === profileId)?.permission !==
                "read_only"
            }
            onClick={() =>
              void act(() =>
                writeApi("tasks/review", { taskId: task.id, profileId }),
              )
            }
          >
            Request review
          </button>
        )}
        <button
          type="button"
          disabled={
            busy ||
            ![
              "BACKLOG",
              "READY",
              "QUEUED",
              "RUNNING",
              "AWAITING_REVIEW",
              "CHANGES_REQUESTED",
              "READY_TO_INTEGRATE",
              "BLOCKED_CONFLICT",
              "RETRY_DECISION",
            ].includes(task.status)
          }
          onClick={() =>
            void act(() => writeApi("tasks/cancel", { taskId: task.id }))
          }
        >
          Cancel task
        </button>
      </div>
      <div className="actions">
        <label>
          Priority
          <input
            type="number"
            min={-100}
            max={100}
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(() =>
              writeApi("tasks", { id: task.id, priority }, "PATCH"),
            )
          }
        >
          Save priority
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const reports = z
                .array(
                  z.strictObject({
                    artifact: artifactSchema,
                    content: z.string(),
                  }),
                )
                .parse(await readApi(`reports?taskId=${task.id}`));
              setReport(
                reports.map((item) => item.content).join("\n\n") ||
                  "No saved report yet.",
              );
            })
          }
        >
          View report
        </button>
      </div>
      {task.status === "RETRY_DECISION" && (
        <p className="warning">
          Work was not rerun. Recovery/resume controls arrive in M6; this task
          can be cancelled.
        </p>
      )}
      {lineageRoot && history && history.candidates.length > 0 && (
        <ReviewPanel history={history} run={run} onError={onError} />
      )}
      {lineageRoot && history && history.candidates.length > 0 && (
        <IntegrationPanel
          task={task}
          run={run}
          candidate={history?.candidates.find(
            (c) => c.id === history.currentCandidateId,
          )}
          refresh={integrationEvent}
          onError={onError}
        />
      )}
      {attempt?.adapter === "pi" && (
        <details>
          <summary>Worktree and Git evidence</summary>
          <p className="path">{attempt.worktreePath}</p>
          <p className="note">
            Base {attempt.baseSha} · retained for inspection; no integration
            performed.
          </p>
          <p>
            {
              run.teamSnapshot?.profiles.find((p) => p.id === attempt.profileId)
                ?.model
            }{" "}
            · thinking{" "}
            {run.teamSnapshot?.profiles.find((p) => p.id === attempt.profileId)
              ?.thinking ?? "native default"}
          </p>
          {captured?.success && (
            <div
              className={
                captured.data.status === "blocked" ? "warning" : "note"
              }
            >
              <p>
                Candidate {captured.data.status}
                {captured.data.candidateSha &&
                  ` · ${captured.data.branch} @ ${captured.data.candidateSha}`}
              </p>
              {captured.data.blockers.length > 0 && (
                <ul>
                  {captured.data.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {evidence ? (
            <pre className="report">
              {JSON.stringify(evidence.payload, null, 2)}
            </pre>
          ) : (
            <p className="note">
              Git capture is pending or outside the latest 200 events. Full
              evidence remains in the persisted journal.
            </p>
          )}
        </details>
      )}
      {report && <pre className="report">{report}</pre>}
    </li>
  );
}
