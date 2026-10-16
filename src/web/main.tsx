import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import {
  attemptsResponseSchema,
  eventsResponseSchema,
  humanRequestsResponseSchema,
  projectsResponseSchema,
  runsResponseSchema,
  sessionsResponseSchema,
  tasksResponseSchema,
} from "../shared/api.ts";
import {
  type Attempt,
  type Event,
  eventSchema,
  type HumanRequest,
  type Project,
  type Run,
  type Session,
  type Task,
} from "../shared/domain/entities.ts";
import { hasNativeLead } from "../shared/native.ts";
import { type Dispatch, dispatchSchema } from "../shared/orchestration.ts";
import { readApi } from "./api.ts";
import { LeadPanel } from "./lead-panel.tsx";
import { ProjectForms } from "./project-forms.tsx";
import { RunControls } from "./run-controls.tsx";
import { TaskCard } from "./task-card.tsx";
import "./style.css";

// Conversation events are few but must never be evicted by token traffic.
const conversation = (event: Event) =>
  event.type === "owner.message" || event.type === "lead.message";
// Candidate records are review state; token traffic must not evict them.
const retain = (events: Event[]) =>
  events.filter(
    (e, i) =>
      conversation(e) ||
      e.type === "candidate.captured" ||
      i >= events.length - 200,
  );
function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [requests, setRequests] = useState<HumanRequest[]>([]);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [projectId, setProjectId] = useState("");
  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState("Connecting to local journal…");
  useEffect(() => {
    const controller = new AbortController();
    let generation = 0;
    async function load() {
      const current = ++generation;
      try {
        const data = await Promise.all(
          [
            "projects",
            "runs",
            "tasks",
            "sessions",
            "attempts",
            "dispatches",
            "human-requests",
          ].map((path) => readApi(path, controller.signal)),
        );
        if (controller.signal.aborted || current !== generation) return;
        setProjects(projectsResponseSchema.parse(data[0]).projects);
        setRuns(runsResponseSchema.parse(data[1]).runs);
        setTasks(tasksResponseSchema.parse(data[2]).tasks);
        setSessions(sessionsResponseSchema.parse(data[3]).sessions);
        setAttempts(attemptsResponseSchema.parse(data[4]).attempts);
        setDispatches(z.array(dispatchSchema).parse(data[5]));
        setRequests(humanRequestsResponseSchema.parse(data[6]).humanRequests);
      } catch {
        if (!controller.signal.aborted)
          setStatus("Cannot load saved data. Reload to retry.");
      }
    }
    void load();
    const stream = new EventSource("/api/events/stream");
    let refresh: ReturnType<typeof setTimeout> | undefined;
    stream.onopen = () =>
      setStatus("Local journal connected · reconnects automatically");
    stream.onerror = () =>
      setStatus("Journal disconnected · reconnecting from last event");
    stream.addEventListener("journal", (message: MessageEvent<string>) => {
      try {
        const event = eventSchema.parse(JSON.parse(message.data));
        setEvents((previous) =>
          previous.some((item) => item.sequence === event.sequence)
            ? previous
            : retain(
                [...previous, event].sort((a, b) => a.sequence - b.sequence),
              ),
        );
        clearTimeout(refresh);
        refresh = setTimeout(() => void load(), 50);
      } catch {
        setStatus("Invalid journal event received. Reload to retry.");
      }
    });
    return () => {
      controller.abort();
      stream.close();
      clearTimeout(refresh);
    };
  }, []);

  const selectedProject =
    projects.find((project) => project.id === projectId) ?? projects[0];
  const projectRuns = runs.filter(
    (run) => run.projectId === selectedProject?.id,
  );
  const selectedRun =
    projectRuns.find((run) => run.id === runId) ?? projectRuns[0];
  const runTasks = tasks.filter((task) => task.runId === selectedRun?.id);
  const nativeLead = selectedRun ? hasNativeLead(selectedRun) : false;
  const runAttempts = attempts.filter((attempt) =>
    runTasks.some((task) => task.id === attempt.taskId),
  );
  const runSessions = sessions.filter((session) =>
    runAttempts.some((attempt) => attempt.id === session.attemptId),
  );
  const [savedRunEvents, setSavedRunEvents] = useState<Event[]>([]);
  const selectedRunId = selectedRun?.id;
  useEffect(() => {
    const controller = new AbortController();
    setSavedRunEvents([]);
    if (selectedRunId)
      void (async () => {
        let after = 0;
        let saved: Event[] = [];
        // Other runs' token streams must not evict this run's persisted history.
        for (;;) {
          const page = eventsResponseSchema.parse(
            await readApi(
              `events?runId=${selectedRunId}&after=${after}&limit=500`,
              controller.signal,
            ),
          ).events;
          saved = retain([...saved, ...page]);
          if (page.length < 500) break;
          after = page.at(-1)?.sequence ?? after;
        }
        if (!controller.signal.aborted) setSavedRunEvents(saved);
      })().catch(() => {
        if (!controller.signal.aborted)
          setStatus("Cannot load saved run events. Reload to retry.");
      });
    return () => controller.abort();
  }, [selectedRunId]);
  const merged = [
    ...new Map(
      [...savedRunEvents, ...events]
        .filter((event) => event.runId === selectedRunId)
        .map((event) => [event.sequence, event]),
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  const runEvents = merged.slice(-200);
  return (
    <main>
      <p className="eyebrow">LOCAL WORKSPACE · M4</p>
      <h1>Local Agent Orchestrator</h1>
      <p className="intro">
        Coordinate saved tasks, simulated teams, a native Codex Lead and native
        Pi workers in isolated worktrees.
      </p>
      <p className="status" role="status">
        {status}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ProjectForms
        project={selectedProject}
        onProject={(id) => {
          setProjectId(id);
          setRunId("");
        }}
        onRun={setRunId}
        onError={setError}
      />
      {projects.length === 0 ? (
        <section>
          <h2>No saved projects yet</h2>
          <p>
            Open a clean disposable Git repository above, or use the README fake
            demo command.
          </p>
          <p className="note">
            Choose a fake team demonstration or explicitly start a real Pi
            worker after discovering its models.
          </p>
        </section>
      ) : (
        <>
          <section className="selectors" aria-label="Saved projects and runs">
            <label>
              Project
              <select
                value={selectedProject?.id ?? ""}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setRunId("");
                }}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Run
              <select
                value={selectedRun?.id ?? ""}
                onChange={(event) => setRunId(event.target.value)}
              >
                {projectRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.title}
                  </option>
                ))}
              </select>
            </label>
            <p className="path">{selectedProject?.repositoryPath}</p>
          </section>
          {selectedRun ? (
            <>
              <section>
                <div className="section-title">
                  <h2>{selectedRun.title}</h2>
                  <span className="badge">
                    {selectedRun.execution === "fake"
                      ? "FAKE · NO MODEL TOKENS"
                      : nativeLead
                        ? "LIVE CODEX LEAD · PI WORKERS"
                        : "LIVE PI · OWNER-DIRECTED"}
                  </span>
                </div>
                <p>{selectedRun.initialPrompt}</p>
                <p className="note">
                  {selectedRun.mode} · {selectedRun.status} · saved{" "}
                  {new Date(selectedRun.createdAt).toLocaleString()}
                </p>
                <RunControls
                  key={selectedRun.id}
                  run={selectedRun}
                  onError={setError}
                />
                <p className="budget">
                  {
                    dispatches.filter(
                      (d) => d.runId === selectedRun.id && d.state === "active",
                    ).length
                  }{" "}
                  / {selectedRun.limits.maxConcurrentAgentsIncludingLead} active
                  agents ·{" "}
                  {
                    runAttempts.filter(
                      (a) =>
                        runTasks.find((t) => t.id === a.taskId)?.kind ===
                        "work",
                    ).length
                  }{" "}
                  / {selectedRun.limits.maxTotalWorkerLaunchesPerRun} worker
                  launches
                </p>
                <LeadPanel
                  run={selectedRun}
                  tasks={runTasks}
                  events={merged.filter(conversation)}
                  requests={requests.filter((r) => r.runId === selectedRun.id)}
                  onError={setError}
                />
                <h3>Task board</h3>
                <div className="board">
                  {[
                    { label: "Backlog", statuses: ["BACKLOG"] },
                    {
                      label: "Ready / queued",
                      statuses: ["READY", "QUEUED", "WAITING_DEPENDENCY"],
                    },
                    {
                      label: "Active / needs attention",
                      statuses: [
                        "RUNNING",
                        "WAITING_HUMAN",
                        "RETRY_DECISION",
                        "FAILED",
                        "INTERRUPTED",
                        "BLOCKED_CONFLICT",
                      ],
                    },
                    {
                      label: "Review / integration",
                      statuses: [
                        "AWAITING_REVIEW",
                        "CHANGES_REQUESTED",
                        "READY_TO_INTEGRATE",
                        "INTEGRATING",
                      ],
                    },
                    {
                      label: "Done / cancelled",
                      statuses: ["DONE", "CANCELLED"],
                    },
                  ].map((column) => (
                    <div className="board-column" key={column.label}>
                      <h4>{column.label}</h4>
                      <ul className="task-list">
                        {runTasks
                          .filter(
                            (task) =>
                              task.kind === "work" &&
                              column.statuses.includes(task.status),
                          )
                          .map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              revision={tasks.find(
                                (item) => item.id === task.latestRevisionTaskId,
                              )}
                              run={selectedRun}
                              session={runSessions.find(
                                (session) =>
                                  runAttempts.find(
                                    (attempt) =>
                                      attempt.id === session.attemptId,
                                  )?.taskId === task.id,
                              )}
                              dispatch={dispatches.find(
                                (d) => d.taskId === task.id,
                              )}
                              attempt={runAttempts.find(
                                (a) => a.taskId === task.id,
                              )}
                              evidence={runEvents.find(
                                (e) =>
                                  e.taskId === task.id &&
                                  e.type === "worktree.captured",
                              )}
                              candidate={merged.findLast(
                                (e) =>
                                  e.taskId ===
                                    (task.latestRevisionTaskId ?? task.id) &&
                                  e.type === "candidate.captured",
                              )}
                              onError={setError}
                            />
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <h3>Sessions</h3>
                {runSessions.length === 0 ? (
                  <p>No saved sessions.</p>
                ) : (
                  <ul className="records">
                    {runSessions.map((session) => (
                      <li key={session.id}>
                        <div>
                          <strong>
                            {session.adapter === "fake"
                              ? "FAKE playback"
                              : session.adapter}
                          </strong>
                          <p className="path">
                            {session.nativeSessionId ??
                              "Native identity pending"}
                          </p>
                        </div>
                        <div>
                          <code>{session.state}</code>
                          <p className="note">
                            PID {session.processId ?? "unavailable"} · exit{" "}
                            {session.exitCode ?? "not recorded"}
                          </p>
                          {session.recovery !== "none" && (
                            <p className="warning">{session.recovery}</p>
                          )}
                          <details>
                            <summary>Session event detail</summary>
                            <ol className="journal">
                              {runEvents
                                .filter(
                                  (event) => event.sessionId === session.id,
                                )
                                .map((event) => (
                                  <li key={event.id}>
                                    <code>
                                      #{event.sequence} {event.type}
                                    </code>
                                    <pre>
                                      {JSON.stringify(event.payload, null, 2)}
                                    </pre>
                                  </li>
                                ))}
                            </ol>
                          </details>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="note">
                  Process state is separate from task status. Restarting never
                  reruns ambiguous attempts.
                </p>
              </section>
              <section aria-labelledby="journal-title">
                <h2 id="journal-title">Persisted event journal</h2>
                <p className="note">
                  Latest 200 received events. Replayed in sequence after
                  reconnect.
                </p>
                {runEvents.length === 0 ? (
                  <p>No run events received yet.</p>
                ) : (
                  <ol className="journal">
                    {runEvents.map((event) => (
                      <li key={event.id}>
                        <div className="event-meta">
                          <code>
                            #{event.sequence} {event.type}
                          </code>
                          <time dateTime={event.createdAt}>
                            {new Date(event.createdAt).toLocaleTimeString()}
                          </time>
                        </div>
                        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          ) : (
            <section>
              <h2>No saved runs for this project</h2>
            </section>
          )}
        </>
      )}
    </main>
  );
}
const container = document.getElementById("root");
if (!container) throw new Error("Missing application root");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
