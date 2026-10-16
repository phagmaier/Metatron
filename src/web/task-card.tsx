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
import { readApi, writeApi } from "./api.ts";

export function TaskCard({
  task,
  run,
  session,
  dispatch,
  attempt,
  evidence,
  onError,
}: {
  task: Task;
  run: Run;
  session: Session | undefined;
  dispatch: Dispatch | undefined;
  attempt: Attempt | undefined;
  evidence: Event | undefined;
  onError: (error: string) => void;
}) {
  const profiles =
    run.teamSnapshot?.profiles.filter((profile) =>
      run.teamSnapshot?.preset.workerProfileIds.includes(profile.id),
    ) ?? [];
  const [profileId, setProfileId] = useState(
    task.assignedProfileId ?? profiles[0]?.id ?? "",
  );
  const defaultProfileId = profiles[0]?.id ?? "";
  useEffect(() => {
    setProfileId(task.assignedProfileId ?? defaultProfileId);
  }, [task.assignedProfileId, defaultProfileId]);
  const [scenario, setScenario] = useState("success");
  const [priority, setPriority] = useState(task.priority);
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
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
      {dispatch?.diagnostic && <p className="warning">{dispatch.diagnostic}</p>}
      {session && (
        <p className="worker-status">
          {session.adapter === "fake" ? "FAKE worker" : "Native Pi worker"} ·{" "}
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
