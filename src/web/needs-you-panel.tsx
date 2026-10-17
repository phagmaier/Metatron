import { type Dispatch, type SetStateAction, useState } from "react";
import { humanRequestsResponseSchema } from "../shared/api.ts";
import {
  type Attempt,
  type HumanRequest,
  humanRequestSchema,
  type Run,
  type Session,
  type Task,
} from "../shared/domain/entities.ts";
import { readApi, writeApi } from "./api.ts";
import { humanRequestActions } from "./human-request-actions.ts";

type RequestContext = {
  run: Run;
  tasks: Task[];
  sessions: Session[];
  attempts: Attempt[];
};

function RequestCard({
  request,
  run,
  tasks,
  sessions,
  attempts,
  onSaved,
  onError,
}: RequestContext & {
  request: HumanRequest;
  onSaved: (request: HumanRequest) => void;
  onError: (error: string) => void;
}) {
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const actions = humanRequestActions(request.status);
  const session = sessions.find((item) => item.id === request.sessionId);
  const attempt = attempts.find((item) => item.id === session?.attemptId);
  const profile = run.teamSnapshot?.profiles.find(
    (item) => item.id === attempt?.profileId,
  );
  async function decide(status: HumanRequest["status"]) {
    setBusy(true);
    onError("");
    try {
      const saved = humanRequestSchema.parse(
        await writeApi(
          "human-requests",
          {
            id: request.id,
            expectedStatus: request.status,
            status,
            ownerResponse: response.trim() || undefined,
          },
          "PATCH",
        ),
      );
      onSaved(saved);
      setResponse("");
    } catch (error) {
      // A stale expectedStatus requires a visible owner decision; never retry it
      // with a newer status or interpret a saved decision as native delivery.
      onError(
        `${request.reason}: ${error instanceof Error ? error.message : "Decision failed"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="request-card" data-request-id={request.id}>
      <div className="section-title">
        <h4>{request.type.replaceAll("_", " ")}</h4>
        <span className="badge">{request.status}</span>
      </div>
      <p className={request.urgency === "urgent" ? "warning" : "note"}>
        {request.urgency} urgency ·{" "}
        {request.blocking
          ? actions.length > 0
            ? "Blocking"
            : "Was blocking"
          : "Nonblocking"}
        {request.status === "deferred" && request.blocking
          ? " · deferring keeps this blocker active"
          : ""}
      </p>
      <p className="request-text">
        <strong>Reason:</strong> {request.reason}
      </p>
      <p className="request-text">
        <strong>Suggested action:</strong> {request.suggestedAction}
      </p>
      <details>
        <summary>Evidence and source</summary>
        <p className="path">Request {request.id}</p>
        <p>
          <strong>Affected tasks:</strong>
        </p>
        {request.affectedTaskIds.length === 0 ? (
          <p className="note">Run-level request · no affected tasks recorded</p>
        ) : (
          <ul>
            {request.affectedTaskIds.map((id) => {
              const task = tasks.find((item) => item.id === id);
              return (
                <li key={id}>
                  {task?.title ?? "Task unavailable"}
                  {task ? ` · ${task.status}` : ""}
                  <p className="path">{id}</p>
                </li>
              );
            })}
          </ul>
        )}
        <p>
          <strong>Source worker:</strong>{" "}
          {profile?.name ??
            (attempt ? "Profile unavailable" : "No worker recorded")}
          {session ? ` · ${session.adapter} · ${session.state}` : ""}
        </p>
        <p className="path">
          Session: {request.sessionId ?? "none recorded"}
          {request.sessionId && !session ? " · details unavailable" : ""}
        </p>
        {session?.nativeSessionId && (
          <p className="path">Native session: {session.nativeSessionId}</p>
        )}
        {attempt && <p className="path">Attempt: {attempt.id}</p>}
        <p>
          Created{" "}
          <time dateTime={request.createdAt}>
            {new Date(request.createdAt).toLocaleString()}
          </time>
          {" · "}Resolved{" "}
          {request.resolvedAt ? (
            <time dateTime={request.resolvedAt}>
              {new Date(request.resolvedAt).toLocaleString()}
            </time>
          ) : (
            "not resolved"
          )}
        </p>
      </details>
      <p className="request-text">
        <strong>Saved owner response:</strong>{" "}
        {request.ownerResponse ?? "None recorded"}
      </p>
      {actions.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && response.trim()) void decide("answered");
          }}
        >
          <label>
            Owner response (required to respond; optional for other actions)
            <textarea
              value={response}
              disabled={busy}
              maxLength={32_768}
              rows={3}
              onChange={(event) => setResponse(event.target.value)}
            />
          </label>
          <div className="actions">
            {actions.map((action) => (
              <button
                key={action.status}
                type={action.status === "answered" ? "submit" : "button"}
                disabled={
                  busy || (action.status === "answered" && !response.trim())
                }
                onClick={
                  action.status === "answered"
                    ? undefined
                    : () => void decide(action.status)
                }
              >
                {action.label}
              </button>
            ))}
          </div>
        </form>
      )}
    </li>
  );
}

export function NeedsYouPanel({
  requests,
  onRequestsChange,
  ...context
}: RequestContext & {
  requests: HumanRequest[];
  onRequestsChange: Dispatch<SetStateAction<HumanRequest[]>>;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const runRequests = requests.filter((item) => item.runId === context.run.id);
  const pending = runRequests.filter(
    (item) => humanRequestActions(item.status).length > 0,
  );
  const resolved = runRequests
    .filter((item) => humanRequestActions(item.status).length === 0)
    .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));
  async function refresh() {
    setRefreshing(true);
    setError("");
    setNotice("");
    try {
      onRequestsChange(
        humanRequestsResponseSchema.parse(await readApi("human-requests"))
          .humanRequests,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }
  function saved(request: HumanRequest) {
    onRequestsChange((items) =>
      items.map((item) => (item.id === request.id ? request : item)),
    );
    setNotice(`Owner decision recorded: ${request.status}.`);
  }
  function card(request: HumanRequest) {
    return (
      <RequestCard
        key={request.id}
        {...context}
        request={request}
        onSaved={saved}
        onError={(error) => {
          setError(error);
          setNotice("");
        }}
      />
    );
  }
  return (
    <section className="needs-you" aria-labelledby="needs-you-title">
      <div className="section-title">
        <h3 id="needs-you-title">Needs You · {pending.length} unresolved</h3>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          Refresh inbox
        </button>
      </div>
      <p className="note">
        Decisions are saved here. Reply delivery, native permission replies and
        safe continuation are not implemented yet; these controls do not resume
        workers or grant native permissions. Marking completed records your
        action; it does not verify that it worked.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending.length === 0 ? (
        <p>No unresolved requests for this run.</p>
      ) : (
        <ul className="request-list">{pending.map(card)}</ul>
      )}
      <details className="request-history">
        <summary>Resolved history · {resolved.length}</summary>
        <p className="note">Saved decisions remain available after restart.</p>
        {resolved.length === 0 ? (
          <p>No resolved requests for this run.</p>
        ) : (
          <ul className="request-list">{resolved.map(card)}</ul>
        )}
      </details>
    </section>
  );
}
