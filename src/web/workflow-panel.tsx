import { type ReactNode, useEffect, useState } from "react";
import { eventsResponseSchema } from "../shared/api.ts";
import type {
  Artifact,
  Event,
  Run,
  Session,
  Task,
} from "../shared/domain/entities.ts";
import { handoffReportSchema } from "../shared/orchestration.ts";
import {
  type WorkflowView,
  workflowsResponseSchema,
} from "../shared/workflows.ts";
import { readApi } from "./api.ts";
import { ArtifactText } from "./integration-panel.tsx";
import { WorkflowRunForm } from "./workflow-run-form.tsx";

type Child = WorkflowView["children"][number];
type Stage = WorkflowView["workflow"]["template"]["stages"][number];
const stageTypes = {
  single_agent: "single agent",
  parallel_agents: "parallel agents",
  synthesize: "synthesis",
  review: "independent review",
};

function eventText(payload: Record<string, unknown>) {
  for (const key of ["diagnostic", "reason", "message"])
    if (typeof payload[key] === "string") return payload[key];
  return JSON.stringify(payload);
}

function agentLabel(run: Run, profileId: string | null, adapter?: string) {
  const profile = run.teamSnapshot?.profiles.find((p) => p.id === profileId);
  const configured = profile
    ? `${profile.name} · ${profile.harness} · ${profile.model} · thinking ${profile.thinking ?? "native default"} · ${profile.permission}`
    : "Profile not in this run's snapshot";
  // FAKE playback must never read as a live harness run.
  return adapter === "fake" || (!adapter && run.execution === "fake")
    ? `FAKE playback · configured as ${configured}`
    : configured;
}

function ArtifactLink({
  artifact,
  onError,
}: {
  artifact: Artifact;
  onError: (error: string) => void;
}) {
  return (
    <ArtifactText
      artifactId={artifact.id}
      label={`View ${artifact.kind} · ${artifact.summary.slice(0, 100)}`}
      onError={onError}
    />
  );
}

function ChildLog({ run, taskId }: { run: Run; taskId: string }) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  async function load(after: number) {
    setError("");
    try {
      const page = eventsResponseSchema.parse(
        await readApi(
          `events?runId=${run.id}&taskId=${taskId}&after=${after}&limit=500`,
        ),
      ).events;
      setEvents((previous) => [...(previous ?? []), ...page]);
      setMore(page.length === 500);
    } catch {
      setError("Cannot load this child's journal. Try again.");
    }
  }
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open && events === null) void load(0);
      }}
    >
      <summary>Log (persisted journal events)</summary>
      {error && <p className="warning">{error}</p>}
      {events?.length === 0 && <p className="note">No events recorded.</p>}
      {events && events.length > 0 && (
        <ol className="journal">
          {events.map((event) => (
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
      {events && (
        <button
          type="button"
          onClick={() => void load(events.at(-1)?.sequence ?? 0)}
        >
          {more ? "Load more events" : "Check for newer events"}
        </button>
      )}
    </details>
  );
}

function WorkflowChild({
  child,
  index,
  stage,
  view,
  run,
  task,
  session,
  renderTask,
  onError,
}: {
  child: Child;
  index: number;
  stage: Stage;
  view: WorkflowView;
  run: Run;
  task: Task;
  session: Session | undefined;
  renderTask: (task: Task) => ReactNode;
  onError: (error: string) => void;
}) {
  const latest = child.attempts.at(-1)?.attempt;
  const titles = new Map(view.children.map((c) => [c.task.id, c.task.title]));
  const state = view.workflow.stages.find((s) => s.stageId === stage.id);
  const diagnostic = child.attempts.at(-1)?.diagnostics.at(-1);
  const failure =
    child.outcome.status !== "failed"
      ? null
      : task.status === "CANCELLED"
        ? "Cancelled; earlier attempts, reports and logs are retained"
        : diagnostic
          ? `Failed: ${eventText(diagnostic.payload)}`
          : "Failed; inspect this child's log";
  return (
    <li className="task-card">
      <div className="section-title">
        <strong>
          {stage.id}
          {stage.count > 1 ? ` ${index + 1}/${stage.count}` : ""}
        </strong>
        <span>
          <code>{task.status}</code> · result{" "}
          <code>{child.outcome.status}</code>
        </span>
      </div>
      <p className="note">
        {agentLabel(
          run,
          latest?.profileId ?? task.assignedProfileId ?? stage.profileId,
          latest?.adapter,
        )}
      </p>
      {session && (
        <p className="worker-status">
          Session {session.state}
          {session.recovery !== "none" && (
            <span className="warning"> · {session.recovery}</span>
          )}
          <br />
          <span className="path">
            {session.nativeSessionId ?? "Native identity pending"}
          </span>
        </p>
      )}
      {(failure ?? child.outcome.diagnostic) && (
        <p className="warning">{failure ?? child.outcome.diagnostic}</p>
      )}
      <details>
        <summary>Attempts and reports ({child.attempts.length})</summary>
        {child.attempts.length === 0 && (
          <p className="note">
            Not launched. Nothing has run for this child yet.
          </p>
        )}
        <ol className="stages">
          {child.attempts.map(
            ({ attempt, artifacts, resultEvent, diagnostics }, number) => {
              const result = handoffReportSchema.safeParse(
                resultEvent?.payload.report,
              );
              return (
                <li key={attempt.id}>
                  <p>
                    Attempt {number + 1} · <code>{attempt.status}</code> ·{" "}
                    {attempt.adapter === "fake"
                      ? "FAKE playback"
                      : attempt.adapter}{" "}
                    · {new Date(attempt.createdAt).toLocaleString()}
                  </p>
                  {attempt.profileId !== stage.profileId && (
                    <p className="note">
                      Owner override: {agentLabel(run, attempt.profileId)}
                    </p>
                  )}
                  {result.success && (
                    <p className="note">
                      Submitted result (model-reported, unverified):{" "}
                      {result.data.outcome} · {result.data.summary}
                    </p>
                  )}
                  {diagnostics.map((event) => (
                    <p className="warning" key={event.eventId}>
                      {event.type}: {eventText(event.payload)}
                    </p>
                  ))}
                  {artifacts.map((artifact) => (
                    <ArtifactLink
                      key={artifact.id}
                      artifact={artifact}
                      onError={onError}
                    />
                  ))}
                </li>
              );
            },
          )}
        </ol>
        {child.taskArtifacts.map((artifact) => (
          <ArtifactLink
            key={artifact.id}
            artifact={artifact}
            onError={onError}
          />
        ))}
      </details>
      <details>
        <summary>Inputs and provenance</summary>
        {stage.type === "parallel_agents" && (
          <pre className="report">{stage.partitions[index]}</pre>
        )}
        {child.handoff ? (
          <>
            <p className="note">
              Prepared {new Date(child.handoff.createdAt).toLocaleString()} ·
              parameters{" "}
              {Object.entries(child.handoff.parameters)
                .map(([name, value]) => `${name}=${value}`)
                .join(", ") || "none"}
            </p>
            {child.handoff.sources.length > 0 && (
              <ul>
                {child.handoff.sources.map((source) => (
                  <li key={source.taskId}>
                    {titles.get(source.taskId) ?? source.taskId} ·{" "}
                    <code>{source.status}</code>
                    {source.failure && (
                      <span className="warning">
                        {" "}
                        · {source.failure}: {source.diagnostic}
                      </span>
                    )}
                    {source.artifactId
                      ? ` · report ${source.artifactId}`
                      : " · no report (failure retained, nothing invented)"}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="note">
            {state?.status === "pending"
              ? "Inputs are prepared when upstream stages settle."
              : "No input bindings were recorded (prepared before provenance tracking)."}
          </p>
        )}
      </details>
      <ChildLog run={run} taskId={task.id} />
      <details>
        <summary>Task controls (continue, steer, recover, cancel)</summary>
        <ul className="task-list">{renderTask(task)}</ul>
      </details>
    </li>
  );
}

function WorkflowItem({
  view,
  run,
  tasks,
  sessions,
  renderTask,
  onError,
}: {
  view: WorkflowView;
  run: Run;
  tasks: Task[];
  sessions: (taskId: string) => Session | undefined;
  renderTask: (task: Task) => ReactNode;
  onError: (error: string) => void;
}) {
  const { workflow, children } = view;
  const live = (child: Child) =>
    tasks.find((task) => task.id === child.task.id) ?? child.task;
  const count = (status: Child["outcome"]["status"]) =>
    children.filter((child) => child.outcome.status === status).length;
  const running = children.filter(
    (child) => live(child).status === "RUNNING",
  ).length;
  const reports = (stageId: string) =>
    children
      .filter((child) => child.stageId === stageId)
      .flatMap(
        (child) =>
          child.attempts
            .at(-1)
            ?.artifacts.filter((artifact) => artifact.kind === "report") ?? [],
      );
  return (
    <li className="workflow">
      <details>
        <summary>
          {workflow.template.name} · v{workflow.template.version}{" "}
          <code>{workflow.status}</code>
          <span className="note">
            {" "}
            · {children.length} agents · {count("completed")} reported ·{" "}
            {count("failed")} failed · {running} running
          </span>
        </summary>
        <p className="note">
          Started {new Date(workflow.createdAt).toLocaleString()} · parameters{" "}
          {Object.entries(workflow.parameters)
            .map(([name, value]) => `${name}=${value}`)
            .join(", ") || "none"}
          {run.execution === "fake" && " · FAKE playback, no model tokens"}
        </p>
        <ul>
          {workflow.template.results.map((result) => {
            const state = workflow.stages.find(
              (s) => s.stageId === result.stageId,
            );
            const artifacts: Artifact[] =
              state?.status === "completed" || state?.status === "partial"
                ? reports(result.stageId)
                : [];
            return (
              <li key={result.name}>
                Result <strong>{result.name}</strong> from {result.stageId} ·{" "}
                <code>{state?.status ?? "missing"}</code>
                {state?.status === "partial" &&
                  " · partial evidence; failed children are listed below"}
                {artifacts.map((artifact) => (
                  <ArtifactLink
                    key={artifact.id}
                    artifact={artifact}
                    onError={onError}
                  />
                ))}
              </li>
            );
          })}
        </ul>
        <ol className="stages">
          {workflow.template.stages.map((stage) => {
            const state = workflow.stages.find((s) => s.stageId === stage.id);
            return (
              <li key={stage.id}>
                <div className="section-title">
                  <strong>
                    {stage.id} · {stageTypes[stage.type]}
                    {stage.count > 1 ? ` ×${stage.count}` : ""}
                  </strong>
                  <code>{state?.status ?? "missing"}</code>
                </div>
                <p className="note">
                  {stage.dependsOn.length
                    ? `After ${stage.dependsOn.join(", ")} · upstream failures ${
                        stage.partialFailure === "stop"
                          ? "stop this stage"
                          : "are passed on as explicit partial evidence"
                      }`
                    : "First stage"}
                </p>
                {state?.diagnostic && (
                  <p className="warning">{state.diagnostic}</p>
                )}
                <ul className="task-list">
                  {(state?.taskIds ?? []).map((taskId, index) => {
                    const child = children.find((c) => c.task.id === taskId);
                    return (
                      child && (
                        <WorkflowChild
                          key={taskId}
                          child={child}
                          index={index}
                          stage={stage}
                          view={view}
                          run={run}
                          task={live(child)}
                          session={sessions(taskId)}
                          renderTask={renderTask}
                          onError={onError}
                        />
                      )
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </details>
    </li>
  );
}

export function WorkflowPanel({
  run,
  tasks,
  sessions,
  refresh,
  renderTask,
  onError,
}: {
  run: Run;
  tasks: Task[];
  sessions: (taskId: string) => Session | undefined;
  refresh: number | undefined;
  renderTask: (task: Task) => ReactNode;
  onError: (error: string) => void;
}) {
  const [views, setViews] = useState<WorkflowView[]>([]);
  const [error, setError] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new non-token journal event triggers the refetch.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      readApi(`workflows?runId=${run.id}`, controller.signal)
        .then((value) => {
          setViews(workflowsResponseSchema.parse(value).workflows);
          setError("");
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError("Cannot load saved workflows. Reload to retry.");
        });
    }, 50);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [run.id, refresh]);
  if (
    views.length === 0 &&
    !error &&
    !run.teamSnapshot?.preset.workflowTemplateIds.length
  )
    return null;
  return (
    <>
      <h3>Workflows</h3>
      <p className="note">
        Each workflow is one item; its child agents appear only here, not as
        separate board cards. Every child still uses normal scheduling slots and
        launch budget. Cancelling a child keeps the workflow's history.
      </p>
      <WorkflowRunForm run={run} onError={onError} />
      {error && <p className="warning">{error}</p>}
      <ul className="workflows">
        {views.map((view) => (
          <WorkflowItem
            key={view.workflow.id}
            view={view}
            run={run}
            tasks={tasks}
            sessions={sessions}
            renderTask={renderTask}
            onError={onError}
          />
        ))}
      </ul>
    </>
  );
}
