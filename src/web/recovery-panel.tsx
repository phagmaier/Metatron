import { useState } from "react";
import type {
  Attempt,
  RecoveryCause,
  RecoveryCheck,
  Run,
  Session,
  Task,
} from "../shared/domain/entities.ts";
import { unverifiedFacts } from "../shared/recovery.ts";
import { writeApi } from "./api.ts";

const causeLabel: Record<RecoveryCause, string> = {
  interrupted: "Interrupted",
  crashed: "Crashed",
  disconnected: "Disconnected",
  recovery_required: "Recovery required",
  failed: "Failed",
};

function Fact({
  label,
  state,
  reason,
}: {
  label: string;
  state: string;
  reason: string;
}) {
  return (
    <li>
      {label}: <code>{state}</code> · {reason}
    </li>
  );
}

export function RecoveryPanel({
  task,
  run,
  attempt,
  session,
  profileId,
  scenario,
  onError,
}: {
  task: Task;
  run: Run;
  attempt: Attempt | undefined;
  session: Session | undefined;
  profileId: string;
  scenario: string;
  onError: (error: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const recovery = attempt?.recovery;
  const latest: RecoveryCheck | undefined = recovery?.checks.at(-1);
  const unverified = latest ? unverifiedFacts(latest) : [];
  async function act(path: string, input: unknown) {
    setBusy(true);
    onError("");
    try {
      await writeApi(path, input);
      setAccepted(false);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Recovery action failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="recovery">
      <p className="warning">
        <strong>
          {recovery ? causeLabel[recovery.cause] : "Decision required"}
        </strong>
        {recovery ? `: ${recovery.reason}` : ""}
      </p>
      <p className="note">
        Nothing was rerun. Attempt {attempt?.id ?? "unavailable"} ·{" "}
        {attempt?.status ?? "no attempt"} · native session{" "}
        {session?.nativeSessionId ?? "none"} · {session?.state ?? "no session"}{" "}
        · PID {session?.processId ?? "unavailable"} · exit{" "}
        {session?.exitCode ?? "not recorded"}
      </p>
      <p className="path">
        {attempt?.worktreePath ?? "No isolated worktree for this attempt"}
      </p>
      {latest ? (
        <div>
          <p className="note">
            Observed {new Date(latest.observedAt).toLocaleString()}
          </p>
          <ul>
            <Fact label="Repository" {...latest.repository} />
            <Fact label="Worktree" {...latest.worktree} />
            <Fact label="Process" {...latest.process} />
          </ul>
        </div>
      ) : (
        <p className="note">
          Not rechecked yet. A retry needs a current observation.
        </p>
      )}
      {unverified.length > 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          Retry although the prior {unverified.join(" and ")} could not be
          verified. The prior checkout is kept and never reused.
        </label>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("recovery/recheck", { taskId: task.id })}
        >
          Recheck (observe only)
        </button>
        <button
          type="button"
          disabled={
            busy ||
            !latest ||
            !profileId ||
            latest.repository.state !== "verified" ||
            (unverified.length > 0 && !accepted) ||
            run.status !== "active"
          }
          onClick={() =>
            latest &&
            void act("recovery/decision", {
              taskId: task.id,
              checkId: latest.id,
              profileId,
              scenario,
              acceptUnverified: accepted,
            })
          }
        >
          Retry in a fresh worktree
        </button>
      </div>
      <p className="note">
        Recheck never resubmits, relinks or deletes anything. A retry uses the
        selected worker, starts a new session in a new worktree and counts
        against the run's launch budget. Cancel keeps every worktree and record.
      </p>
    </div>
  );
}
