import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import {
  attemptsResponseSchema,
  projectsResponseSchema,
  runsResponseSchema,
  sessionsResponseSchema,
  tasksResponseSchema,
} from "../shared/api.ts";
import {
  type Attempt,
  type Event,
  eventSchema,
  type Project,
  type Run,
  type Session,
  type Task,
} from "../shared/domain/entities.ts";
import { type Dispatch, dispatchSchema } from "../shared/orchestration.ts";
import { readApi } from "./api.ts";
import { ProjectForms } from "./project-forms.tsx";
import { RunControls } from "./run-controls.tsx";
import { TaskCard } from "./task-card.tsx";
import "./style.css";

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
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
          ].map((path) => readApi(path, controller.signal)),
        );
        if (controller.signal.aborted || current !== generation) return;
        setProjects(projectsResponseSchema.parse(data[0]).projects);
        setRuns(runsResponseSchema.parse(data[1]).runs);
        setTasks(tasksResponseSchema.parse(data[2]).tasks);
        setSessions(sessionsResponseSchema.parse(data[3]).sessions);
        setAttempts(attemptsResponseSchema.parse(data[4]).attempts);
        setDispatches(z.array(dispatchSchema).parse(data[5]));
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
            : [...previous, event]
                .sort((a, b) => a.sequence - b.sequence)
                .slice(-200),
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
  const runAttempts = attempts.filter((attempt) =>
    runTasks.some((task) => task.id === attempt.taskId),
  );
  const runSessions = sessions.filter((session) =>
    runAttempts.some((attempt) => attempt.id === session.attemptId),
  );
  const runEvents = events.filter((event) => event.runId === selectedRun?.id);
  return (
    <main>
      <p className="eyebrow">LOCAL WORKSPACE · M2</p>
      <h1>Local Agent Orchestrator</h1>
      <p className="intro">
        Coordinate a fake Lead and workers with durable state and bounded
        scheduling.
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
            M2 runs only explicit FakeAdapter simulations. No native harness is
            connected.
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
                      : "NATIVE CONFIGURATION"}
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
                <h3>Lead conversation</h3>
                <ol className="chat">
                  {runEvents
                    .filter((event) =>
                      ["owner.message", "lead.message"].includes(event.type),
                    )
                    .map((event) => (
                      <li key={event.id}>
                        <strong>
                          {event.type === "owner.message"
                            ? "Owner"
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
