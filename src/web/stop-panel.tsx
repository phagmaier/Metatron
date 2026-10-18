import { useState } from "react";
import { z } from "zod";
import type {
  Attempt,
  Session,
  StopRecord,
  Task,
} from "../shared/domain/entities.ts";
import { writeApi } from "./api.ts";

const scopeLabel: Record<StopRecord["scope"], string> = {
  task: "Task cancel",
  run: "Stop run",
  emergency: "Emergency stop",
};
const statusLabel: Record<StopRecord["status"], string> = {
  pending: "Pending: no termination evidence yet; the process may still run",
  confirmed: "Confirmed by process/session evidence",
  failed: "Failed: stop signal not acknowledged and no exit observed",
  uncertain: "Uncertain: termination not confirmed",
};

export function EmergencyStop({ onError }: { onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  async function stop() {
    if (
      !window.confirm(
        "Emergency stop pauses scheduling in every run and ends sessions this app started. Descendant processes and filesystem changes already made may remain. Continue?",
      )
    )
      return;
    setBusy(true);
    onError("");
    try {
      const saved = z
        .object({
          pausedRunIds: z.array(z.string()),
          sessionIds: z.array(z.string()),
        })
        .parse(await writeApi("emergency-stop", {}));
      setResult(
        `Paused ${saved.pausedRunIds.length} run(s); stop requested for ${saved.sessionIds.length} app-owned session(s). Each run's stop history shows the outcome.`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Emergency stop failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="emergency" aria-labelledby="emergency-title">
      <div className="section-title">
        <h2 id="emergency-title">Emergency stop</h2>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => void stop()}
        >
          Emergency stop…
        </button>
      </div>
      <p className="warning">
        Best effort: pauses scheduling in every run and closes only native
        processes this app started; manual harness sessions are never targeted.
        External descendant processes and filesystem changes already made may
        remain. Interrupted work waits for an explicit retry decision.
      </p>
      {result && <p role="status">{result}</p>}
    </section>
  );
}

export function StopHistory({
  sessions,
  attempts,
  tasks,
}: {
  sessions: Session[];
  attempts: Attempt[];
  tasks: Task[];
}) {
  const records = sessions
    .flatMap((session) => {
      const attempt = attempts.find((a) => a.id === session.attemptId);
      const task = tasks.find((t) => t.id === attempt?.taskId);
      return session.stops.map((stop) => ({ stop, session, task }));
    })
    .sort((a, b) => b.stop.requestedAt.localeCompare(a.stop.requestedAt));
  return (
    <>
      <h3>Stop history</h3>
      <p className="note">
        Saved by the server. Inspecting, closing a view, navigating away or
        reloading never stops or resumes work; only supported process/session
        evidence confirms a stop.
      </p>
      {records.length === 0 ? (
        <p>No stops requested in this run.</p>
      ) : (
        <ul className="records">
          {records.map(({ stop, session, task }) => (
            <li key={`${stop.id}:${session.id}`}>
              <div>
                <strong>
                  {scopeLabel[stop.scope]} · {task?.title ?? "Unknown task"}
                </strong>
                <p className="note">
                  {session.adapter === "fake"
                    ? "FAKE playback"
                    : `${session.adapter} session`}{" "}
                  · PID {stop.processId ?? "unavailable"} · requested{" "}
                  {new Date(stop.requestedAt).toLocaleString()}
                  {stop.resolvedAt &&
                    ` · settled ${new Date(stop.resolvedAt).toLocaleString()}`}
                </p>
                {stop.evidence && <p>{stop.evidence}</p>}
                {stop.diagnostic && (
                  <p className="warning">{stop.diagnostic}</p>
                )}
              </div>
              <div>
                <code>{stop.status}</code>
                <p className={stop.status === "confirmed" ? "note" : "warning"}>
                  {statusLabel[stop.status]}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
