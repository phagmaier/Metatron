import { randomUUID } from "node:crypto";
import {
  type TeamPreset,
  teamPresetSchema,
  workflowTemplateSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { fakeTeamSnapshot } from "../../shared/presets.ts";
import {
  deleteTeamSchema,
  type TeamContent,
  teamContentSchema,
  teamReferenceSchema,
  updateTeamSchema,
} from "../../shared/teams.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
import { getProfile } from "./profiles.ts";
import { getRole } from "./roles.ts";
import type { Store } from "./store.ts";

export const demoTeamIds = [fakeTeamSnapshot.preset.id];
const demoProfileIds = fakeTeamSnapshot.profiles.map((profile) => profile.id);

export function listTeams(store: Store) {
  return store.db
    .prepare("SELECT data FROM team_presets ORDER BY rowid")
    .all()
    .map((row) => teamPresetSchema.parse(JSON.parse(String(row.data))));
}

export function getTeam(store: Store, input: unknown) {
  const { id } = teamReferenceSchema.parse(input);
  const row = store.db
    .prepare("SELECT data FROM team_presets WHERE id=?")
    .get(id);
  if (!row) throw new DomainError("NOT_FOUND", "Team preset not found");
  return teamPresetSchema.parse(JSON.parse(String(row.data)));
}

export function listWorkflows(store: Store) {
  return store.db
    .prepare("SELECT data FROM workflow_templates ORDER BY rowid")
    .all()
    .map((row) => workflowTemplateSchema.parse(JSON.parse(String(row.data))));
}

export function teamsUsingProfile(store: Store, profileId: string) {
  return listTeams(store).filter(
    (team) =>
      team.leadProfileId === profileId ||
      team.workerProfileIds.includes(profileId),
  );
}

// Reads the current library rows a run snapshot would own. FAKE playback and
// native profiles never mix, so simulated output cannot sit beside or pass for
// a live harness turn.
export function resolveTeam(store: Store, team: TeamContent) {
  const lead = getProfile(store, { id: team.leadProfileId });
  const workers = team.workerProfileIds.map((id) => getProfile(store, { id }));
  const profiles = [lead, ...workers];
  const fake = profiles.every((profile) => demoProfileIds.includes(profile.id));
  if (!fake && profiles.some((profile) => demoProfileIds.includes(profile.id)))
    throw new DomainError(
      "POLICY_DENIED",
      "A team cannot mix FAKE demo profiles with native profiles",
    );
  // A coordinator worker could gain Lead tools; this also keeps the Lead off the roster.
  if (
    lead.permission !== "coordinator" ||
    workers.some((profile) => profile.permission === "coordinator")
  )
    throw new DomainError(
      "POLICY_DENIED",
      "Choose a coordinator Lead and read-only or writer workers",
    );
  // Lead authority stays on Codex; file-worker tool policies exist on the
  // other native harnesses, and Codex workers only read in its sandbox.
  if (
    !fake &&
    (lead.harness !== "codex" ||
      workers.some((profile) =>
        profile.harness === "codex"
          ? profile.permission !== "read_only"
          : !["pi", "claude-code", "opencode"].includes(profile.harness),
      ))
  )
    throw new DomainError(
      "UNSUPPORTED",
      "Native teams need a Codex Lead, Pi, Claude Code or OpenCode file workers, and only read-only Codex workers",
    );
  const workflows = team.workflowTemplateIds.map((id) => {
    const row = store.db
      .prepare("SELECT data FROM workflow_templates WHERE id=?")
      .get(id);
    if (!row) throw new DomainError("NOT_FOUND", "Workflow template not found");
    return workflowTemplateSchema.parse(JSON.parse(String(row.data)));
  });
  if (
    workflows.some((workflow) =>
      workflow.stages.some(
        (stage) => !profiles.some((profile) => profile.id === stage.profileId),
      ),
    )
  )
    throw new DomainError(
      "INVALID_REFERENCE",
      "A selected workflow uses a profile outside this team",
    );
  const roles = [...new Set(profiles.map((profile) => profile.roleId))].map(
    (id) => getRole(store, { id }),
  );
  return {
    execution: fake ? ("fake" as const) : ("native" as const),
    profiles,
    roles,
    workflows,
  };
}

function assertEditable(id: string) {
  // The seeded demo team is fixed playback configuration and is never
  // recreated over an owner's edit or deletion.
  if (demoTeamIds.includes(id))
    throw new DomainError(
      "POLICY_DENIED",
      "The FAKE demo team is fixed playback configuration; create a team instead",
    );
}

function recordTeam(store: Store, team: TeamPreset, key: string, kind: string) {
  appendEvent(store.db, {
    type: `team.${kind}`,
    correlationId: key,
    payload: { teamId: team.id, version: team.version },
  });
  return team;
}

export function createTeam(store: Store, input: unknown, key: string) {
  const data = teamContentSchema.parse(input);
  return mutate(store.db, key, "createTeam", data, teamPresetSchema, () => {
    resolveTeam(store, data);
    const now = new Date().toISOString();
    const team = teamPresetSchema.parse({
      ...data,
      id: randomUUID(),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    store.db
      .prepare(
        "INSERT INTO team_presets(id,lead_profile_id,data) VALUES (?,?,?)",
      )
      .run(team.id, team.leadProfileId, JSON.stringify(team));
    return recordTeam(store, team, key, "created");
  });
}

export function updateTeam(store: Store, input: unknown, key: string) {
  const data = updateTeamSchema.parse(input);
  return mutate(store.db, key, "updateTeam", data, teamPresetSchema, () => {
    const previous = getTeam(store, { id: data.id });
    assertEditable(previous.id);
    if (previous.version !== data.version)
      throw new DomainError(
        "CONFLICT",
        "Team changed; reload it before saving",
      );
    resolveTeam(store, data);
    const team = teamPresetSchema.parse({
      ...previous,
      ...data,
      version: previous.version + 1,
      updatedAt: new Date().toISOString(),
    });
    // Runs own resolved snapshots; only the library row changes.
    store.db
      .prepare("UPDATE team_presets SET lead_profile_id=?,data=? WHERE id=?")
      .run(team.leadProfileId, JSON.stringify(team), team.id);
    return recordTeam(store, team, key, "updated");
  });
}

export function deleteTeam(store: Store, input: unknown, key: string) {
  const data = deleteTeamSchema.parse(input);
  return mutate(store.db, key, "deleteTeam", data, teamReferenceSchema, () => {
    const team = getTeam(store, { id: data.id });
    assertEditable(team.id);
    if (team.version !== data.version)
      throw new DomainError(
        "CONFLICT",
        "Team changed; reload it before deleting",
      );
    store.db.prepare("DELETE FROM team_presets WHERE id=?").run(team.id);
    recordTeam(store, team, key, "deleted");
    return { id: team.id };
  });
}
