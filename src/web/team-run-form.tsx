import { useCallback, useEffect, useState } from "react";
import {
  type AgentProfile,
  type Project,
  runSchema,
  type TeamPreset,
} from "../shared/domain/entities.ts";
import { profilesResponseSchema } from "../shared/profiles.ts";
import { teamsResponseSchema } from "../shared/teams.ts";
import { readApi, writeApi } from "./api.ts";
import { modeLabels, profileLabel } from "./teams-panel.tsx";

export function TeamRunForm({
  project,
  onRun,
  onError,
}: {
  project: Project;
  onRun: (id: string) => void;
  onError: (error: string) => void;
}) {
  const [teams, setTeams] = useState<TeamPreset[]>([]);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [demoProfileIds, setDemoProfileIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState("");
  const [title, setTitle] = useState("Saved team run");
  const [prompt, setPrompt] = useState("");
  const [scenario, setScenario] = useState("success");
  const [busy, setBusy] = useState(false);
  const team = teams.find((item) => item.id === teamId);
  const fake = !!team && demoProfileIds.includes(team.leadProfileId);
  const named = (id: string) => {
    const profile = profiles.find((item) => item.id === id);
    return profile
      ? profileLabel(profile, demoProfileIds.includes(id))
      : "Profile missing; edit the team";
  };

  const load = useCallback(async (signal?: AbortSignal) => {
    const [teamData, profileData] = await Promise.all([
      readApi("team-presets", signal),
      readApi("agent-profiles", signal),
    ]);
    if (signal?.aborted) return;
    setTeams(teamsResponseSchema.parse(teamData).teams);
    const parsed = profilesResponseSchema.parse(profileData);
    setProfiles(parsed.profiles);
    setDemoProfileIds(parsed.demoProfileIds);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted)
        onError(error instanceof Error ? error.message : "Cannot load teams");
    });
    return () => controller.abort();
  }, [load, onError]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    onError("");
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Team run failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="new-run">
      <summary>Start a run from a saved team</summary>
      <p className="note">
        The run copies the reviewed team version with its profiles, roles,
        workflows, mode and limits. Native teams run a live Codex Lead and Pi
        workers on your providers and may incur costs; FAKE teams use scripted
        playback only.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!team) return;
          void act(async () => {
            const run = runSchema.parse(
              await writeApi("runs/team", {
                projectId: project.id,
                teamId: team.id,
                teamVersion: team.version,
                title,
                initialPrompt: prompt,
                ...(fake ? { scenario } : {}),
              }),
            );
            onRun(run.id);
          });
        }}
      >
        <div className="actions">
          <label>
            Saved team
            <select
              required
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
            >
              <option value="" disabled>
                Choose a team
              </option>
              {teams.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · v{item.version}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => load())}
          >
            Reload teams
          </button>
        </div>
        {team && (
          <ul className="records">
            <li>
              {fake ? "FAKE playback · no model tokens" : "Live native team"} ·{" "}
              {modeLabels[team.mode]} ·{" "}
              {team.limits.maxTotalWorkerLaunchesPerRun} worker launches ·{" "}
              {team.limits.maxConcurrentAgentsIncludingLead} active agents
            </li>
            <li>Lead: {named(team.leadProfileId)}</li>
            <li>Workers: {team.workerProfileIds.map(named).join("; ")}</li>
            <li>Workflows: {team.workflowTemplateIds.length || "none"}</li>
          </ul>
        )}
        <label>
          Run title
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Objective for the Lead
          <textarea
            required
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        {fake && (
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
        )}
        <button type="submit" disabled={busy || !team}>
          Start team run
        </button>
      </form>
    </details>
  );
}
