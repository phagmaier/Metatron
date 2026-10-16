import type {
  Event,
  HumanRequest,
  Run,
  Task,
} from "../shared/domain/entities.ts";
import { hasNativeLead } from "../shared/native.ts";
import { writeApi } from "./api.ts";

export function LeadPanel({
  run,
  tasks,
  events,
  requests,
  onError,
}: {
  run: Run;
  tasks: Task[];
  events: Event[];
  requests: HumanRequest[];
  onError: (error: string) => void;
}) {
  const nativeLead = hasNativeLead(run);
  const leadTurn = tasks
    .filter((task) => task.kind === "lead")
    .find((task) => ["QUEUED", "RUNNING"].includes(task.status));
  return (
    <>
      <h3>
        {run.execution === "fake" || nativeLead
          ? "Lead conversation"
          : "Owner-directed native work"}
      </h3>
      {nativeLead && (
        <div className="actions">
          <p className="note">
            {leadTurn
              ? `Lead turn ${leadTurn.status.toLowerCase()} · one turn at a time; new events wait for the next turn`
              : "Lead idle · woken by worker completion, failure, urgent issues or your messages"}
          </p>
          {leadTurn?.status === "RUNNING" && (
            <button
              type="button"
              onClick={() =>
                void writeApi("tasks/cancel", {
                  taskId: leadTurn.id,
                }).catch((e: unknown) =>
                  onError(e instanceof Error ? e.message : "Stop failed"),
                )
              }
            >
              Stop Lead turn
            </button>
          )}
        </div>
      )}
      <ol className="chat">
        {events
          .filter((event) =>
            ["owner.message", "lead.message"].includes(event.type),
          )
          .map((event) => (
            <li key={event.id}>
              <strong>
                {event.type === "owner.message"
                  ? "Owner"
                  : nativeLead
                    ? "Codex Lead"
                    : "Fake Lead"}
              </strong>
              <p>
                {typeof event.payload.text === "string"
                  ? event.payload.text
                  : ""}
              </p>
            </li>
          ))}
      </ol>
      {requests.length > 0 && (
        <>
          <h3>Needs you</h3>
          <ul className="records">
            {requests.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>
                    {r.type === "clarification"
                      ? "Lead question"
                      : "Lead escalation"}
                  </strong>
                  <p>{r.reason}</p>
                </div>
                <div>
                  <code>{r.status}</code>
                  <p className="note">
                    {r.urgency} · {r.suggestedAction}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="note">
            Reply with a Lead message. Answer/decline controls and blocking
            suspension arrive in M6.
          </p>
        </>
      )}
    </>
  );
}
