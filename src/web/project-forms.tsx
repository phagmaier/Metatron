import { useState } from "react";
import {
  defaultLimits,
  type Project,
  projectSchema,
  type Run,
  repositorySchema,
  runSchema,
} from "../shared/domain/entities.ts";
import { fakeTeamSnapshot } from "../shared/presets.ts";
import { writeApi } from "./api.ts";
import { LeadRunForm } from "./lead-run-form.tsx";
import { NativeRunForm } from "./native-run-form.tsx";

export function ProjectForms({
  project,
  onProject,
  onRun,
  onError,
}: {
  project: Project | undefined;
  onProject: (id: string) => void;
  onRun: (id: string) => void;
  onError: (error: string) => void;
}) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("Fake orchestration run");
  const [prompt, setPrompt] = useState(
    "Inspect the fixture and return a report.",
  );
  const [mode, setMode] = useState<Run["mode"]>("autonomous_bounded");
  const [scenario, setScenario] = useState("success");
  const [limits, setLimits] = useState(defaultLimits);
  const [busy, setBusy] = useState(false);
  const [inspection, setInspection] = useState("");
  async function act(action: () => Promise<void>) {
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
    <section>
      <h2>Projects and new runs</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const result = projectSchema.parse(
              await writeApi("projects", { name, repositoryPath: path }),
            );
            onProject(result.id);
            setInspection(
              `Clean · ${result.repository?.branch} · ${result.repository?.baseSha.slice(0, 12)}`,
            );
          });
        }}
      >
        <div className="form-row">
          <label>
            Project name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Disposable fixture"
            />
          </label>
          <label>
            Absolute repository root
            <input
              required
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/tmp/your-disposable-repo"
            />
          </label>
        </div>
        <div className="actions">
          <button
            type="button"
            disabled={busy || !path}
            onClick={() =>
              void act(async () => {
                const result = repositorySchema.parse(
                  await writeApi("projects/inspect", { repositoryPath: path }),
                );
                setInspection(
                  `${result.clean ? "Clean" : "DIRTY — commit or clean manually"} · ${result.branch} · ${result.baseSha.slice(0, 12)} · ${result.commonDirectory}`,
                );
              })
            }
          >
            Check repository
          </button>
          <button type="submit" disabled={busy}>
            Open clean project
          </button>
        </div>
        {inspection && (
          <p className="path" role="status">
            {inspection}
          </p>
        )}
      </form>
      {project && (
        <form
          className="new-run"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const result = runSchema.parse(
                await writeApi("runs", {
                  projectId: project.id,
                  title,
                  initialPrompt: prompt,
                  leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
                  mode,
                  limits,
                  scenario,
                }),
              );
              onRun(result.id);
            });
          }}
        >
          <h3>Start a fake run in {project.name}</h3>
          <p className="note">
            Scripted Lead and workers only. No native model tokens, source
            edits, or real worktrees.
          </p>
          <label>
            Run title
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Owner objective
            <textarea
              required
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
            />
          </label>
          <div className="form-row">
            <label>
              Lead profile
              <select defaultValue={fakeTeamSnapshot.preset.leadProfileId}>
                <option value={fakeTeamSnapshot.preset.leadProfileId}>
                  Fake Lead · deterministic playback
                </option>
              </select>
            </label>
            <label>
              Mode
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as Run["mode"])}
              >
                <option value="chat_plan">Chat/Plan</option>
                <option value="supervised">Supervised</option>
                <option value="autonomous_bounded">Autonomous (bounded)</option>
              </select>
            </label>
            <label>
              Fake worker outcome
              <select
                value={scenario}
                onChange={(event) => setScenario(event.target.value)}
              >
                <option value="success">Success</option>
                <option value="failure">Failure</option>
                <option value="disconnect">Ambiguous disconnect</option>
              </select>
            </label>
          </div>
          <details>
            <summary>Resource limits</summary>
            <p className="note">
              Active Lead turns count toward the total. Idle sessions consume no
              slots. Every worker attempt consumes launch budget.
            </p>
            <div className="form-row">
              {(
                [
                  ["maxConcurrentWriters", "Active writers", 64],
                  [
                    "maxConcurrentReadersReviewers",
                    "Active readers/reviewers",
                    64,
                  ],
                  [
                    "maxConcurrentAgentsIncludingLead",
                    "Total active agents",
                    128,
                  ],
                  [
                    "maxTotalWorkerLaunchesPerRun",
                    "Worker launches per run",
                    10000,
                  ],
                ] as const
              ).map(([key, label, max]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min={1}
                    max={max}
                    required
                    value={limits[key]}
                    onChange={(event) =>
                      setLimits({
                        ...limits,
                        [key]: Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <button type="submit" disabled={busy}>
            Start fake run
          </button>
        </form>
      )}
      {project && (
        <>
          <LeadRunForm project={project} onRun={onRun} onError={onError} />
          <NativeRunForm project={project} onRun={onRun} onError={onError} />
        </>
      )}
    </section>
  );
}
