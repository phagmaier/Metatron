import { useCallback, useEffect, useState } from "react";
import {
  type AgentProfile,
  defaultLimits,
  modeSchema,
  type TeamPreset,
  teamPresetSchema,
  type WorkflowTemplate,
} from "../shared/domain/entities.ts";
import { profilesResponseSchema } from "../shared/profiles.ts";
import { type TeamContent, teamsResponseSchema } from "../shared/teams.ts";
import { readApi, writeApi } from "./api.ts";
import { WorkflowTemplateForm } from "./workflow-template-form.tsx";

const limitFields = [
  ["maxConcurrentWriters", "Active writers", 1, 64],
  ["maxConcurrentReadersReviewers", "Active readers/reviewers", 1, 64],
  [
    "maxConcurrentAgentsIncludingLead",
    "Total active agents (with Lead)",
    1,
    128,
  ],
  ["maxTotalWorkerLaunchesPerRun", "Worker launches per run", 1, 10_000],
  ["maxParallelReadersPerWorkflow", "Parallel readers per workflow", 1, 64],
  ["maxRevisionCyclesPerTask", "Revision cycles per task", 0, 100],
  ["maxAutomaticLeadWakeupsPerRun", "Automatic Lead wake-ups", 0, 10_000],
] as const;
export const modeLabels = {
  chat_plan: "Chat/Plan",
  supervised: "Supervised",
  autonomous_bounded: "Autonomous (bounded)",
} as const;
export const profileLabel = (profile: AgentProfile, demo: boolean) =>
  `${profile.name} · ${demo ? "FAKE" : `${profile.harness} ${profile.model}`} · ${profile.permission}`;

function TeamEditor({
  team,
  profiles,
  demoProfileIds,
  workflows,
  demo,
  busy,
  act,
  save,
  remove,
}: {
  team: TeamPreset | undefined;
  profiles: AgentProfile[];
  demoProfileIds: string[];
  workflows: WorkflowTemplate[];
  demo: boolean;
  busy: boolean;
  act: (action: () => Promise<void>) => void;
  save: (content: TeamContent) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [leadId, setLeadId] = useState(team?.leadProfileId ?? "");
  const [workerIds, setWorkerIds] = useState(team?.workerProfileIds ?? []);
  const [workflowIds, setWorkflowIds] = useState(
    team?.workflowTemplateIds ?? [],
  );
  const [mode, setMode] = useState(team?.mode ?? "autonomous_bounded");
  const [limits, setLimits] = useState(team?.limits ?? defaultLimits);
  // FAKE playback and native profiles never share a team (enforced server-side).
  const fakeLead = demoProfileIds.includes(leadId);
  const workers = profiles.filter(
    (profile) =>
      profile.permission !== "coordinator" &&
      demoProfileIds.includes(profile.id) === fakeLead,
  );
  const toggle = (ids: string[], id: string, on: boolean) =>
    on ? [...ids, id] : ids.filter((item) => item !== id);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        act(() =>
          save({
            name,
            leadProfileId: leadId,
            workerProfileIds: workerIds,
            workflowTemplateIds: workflowIds,
            mode,
            limits,
          }),
        );
      }}
    >
      <fieldset disabled={busy || demo} className="role-fields">
        <legend>
          {team ? `Edit team · version ${team.version}` : "New team"}
        </legend>
        <div className="form-row">
          <label>
            Team name
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Team Lead
            <select
              required
              value={leadId}
              onChange={(event) => {
                const next = event.target.value;
                setLeadId(next);
                if (demoProfileIds.includes(next) !== fakeLead)
                  setWorkerIds([]);
              }}
            >
              <option value="" disabled>
                Choose a coordinator profile
              </option>
              {profiles
                .filter((profile) => profile.permission === "coordinator")
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profileLabel(profile, demoProfileIds.includes(profile.id))}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Default mode
            <select
              value={mode}
              onChange={(event) =>
                setMode(modeSchema.parse(event.target.value))
              }
            >
              {modeSchema.options.map((item) => (
                <option key={item} value={item}>
                  {modeLabels[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="role-fields">
          <legend>Worker pool</legend>
          {!leadId ? (
            <p className="note">Choose a Lead first.</p>
          ) : workers.length === 0 ? (
            <p className="note">
              No compatible worker profiles. Create a read-only or writer
              profile under Agent profiles.
            </p>
          ) : (
            workers.map((profile) => (
              <label key={profile.id} className="check">
                <input
                  type="checkbox"
                  checked={workerIds.includes(profile.id)}
                  onChange={(event) =>
                    setWorkerIds(
                      toggle(workerIds, profile.id, event.target.checked),
                    )
                  }
                />
                {profileLabel(profile, demoProfileIds.includes(profile.id))}
              </label>
            ))
          )}
        </fieldset>
        <fieldset className="role-fields">
          <legend>Available workflows</legend>
          {workflows.length === 0 ? (
            <p className="note">No saved workflow templates yet.</p>
          ) : (
            workflows.map((workflow) => (
              <label key={workflow.id} className="check">
                <input
                  type="checkbox"
                  checked={workflowIds.includes(workflow.id)}
                  onChange={(event) =>
                    setWorkflowIds(
                      toggle(workflowIds, workflow.id, event.target.checked),
                    )
                  }
                />
                {workflow.name} · v{workflow.version}
              </label>
            ))
          )}
        </fieldset>
        <details>
          <summary>Resource limits</summary>
          <p className="note">
            Hard caps for each run of this team. An active Lead turn counts
            toward total agents; idle sessions use no slot. Every worker attempt
            uses launch budget, and workflow children get no exemption.
          </p>
          <div className="form-row">
            {limitFields.map(([key, label, min, max]) => (
              <label key={key}>
                {label} ({min}–{max})
                <input
                  type="number"
                  min={min}
                  max={max}
                  required
                  value={limits[key]}
                  onChange={(event) =>
                    setLimits({ ...limits, [key]: Number(event.target.value) })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        {leadId && !demo && (
          <p className="note">
            {fakeLead
              ? "FAKE playback team: runs use scripted output and no model tokens."
              : "Native team: starting a run checks Codex and Pi discovery again."}
          </p>
        )}
        <div className="actions">
          <button type="submit" disabled={!leadId || workerIds.length === 0}>
            {team ? "Save team" : "Create team"}
          </button>
          {team && (
            <button
              type="button"
              className="danger"
              onClick={() => act(remove)}
            >
              Delete team
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export function TeamsPanel() {
  const [teams, setTeams] = useState<TeamPreset[]>([]);
  const [demoTeamIds, setDemoTeamIds] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [demoProfileIds, setDemoProfileIds] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const team = teams.find((item) => item.id === selected);
  const demo = !!team && demoTeamIds.includes(team.id);

  const accept = useCallback((teamsValue: unknown, profilesValue: unknown) => {
    const teamData = teamsResponseSchema.parse(teamsValue);
    const profileData = profilesResponseSchema.parse(profilesValue);
    setTeams(teamData.teams);
    setDemoTeamIds(teamData.demoTeamIds);
    setWorkflows(teamData.workflows);
    setProfiles(profileData.profiles);
    setDemoProfileIds(profileData.demoProfileIds);
    setLoaded(true);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      readApi("team-presets", controller.signal),
      readApi("agent-profiles", controller.signal),
    ])
      .then(([teamData, profileData]) => {
        if (!controller.signal.aborted) accept(teamData, profileData);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "Cannot load teams",
          );
      });
    return () => controller.abort();
  }, [accept]);
  async function reload() {
    const [teamData, profileData] = await Promise.all([
      readApi("team-presets"),
      readApi("agent-profiles"),
    ]);
    accept(teamData, profileData);
  }
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Team action failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Team presets">
      <details>
        <summary>Team presets</summary>
        <p className="note">
          Save a Lead profile, worker pool, default mode, resource limits and
          available workflows. Each run keeps an immutable copy of the team, its
          profiles and roles; editing the library later never changes it. Saving
          a team dispatches no work.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="actions">
          <label>
            Saved team
            <select
              disabled={busy || !loaded}
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                setNotice("");
                setError("");
              }}
            >
              <option value="">New team</option>
              {teams.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · v{item.version}
                  {demoTeamIds.includes(item.id) ? " · FAKE demo (fixed)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(reload)}
          >
            Reload teams and profiles
          </button>
        </div>
        {demo && (
          <p className="note">
            The FAKE demo team is fixed playback configuration. Choose New team
            to save your own roster.
          </p>
        )}
        {loaded && (
          <WorkflowTemplateForm
            profiles={profiles}
            demoProfileIds={demoProfileIds}
            busy={busy}
            act={(action) => void act(action)}
            saved={async (name) => {
              await reload();
              setNotice(
                `${name} saved. Select it under Available workflows to offer it to a team.`,
              );
            }}
          />
        )}
        {loaded && (
          <TeamEditor
            key={`${team?.id ?? "new"}:${team?.version ?? 0}`}
            team={team}
            profiles={profiles}
            demoProfileIds={demoProfileIds}
            workflows={workflows}
            demo={demo}
            busy={busy}
            act={(action) => void act(action)}
            save={async (content) => {
              const saved = teamPresetSchema.parse(
                await writeApi(
                  "team-presets",
                  team
                    ? { ...content, id: team.id, version: team.version }
                    : content,
                  team ? "PATCH" : "POST",
                ),
              );
              await reload();
              setSelected(saved.id);
              setNotice("Team saved. Existing runs keep their original team.");
            }}
            remove={async () => {
              if (!team) return;
              await writeApi(
                "team-presets",
                { id: team.id, version: team.version },
                "DELETE",
              );
              await reload();
              setSelected("");
              setNotice("Team deleted. Runs that used it keep their copy.");
            }}
          />
        )}
      </details>
    </section>
  );
}
