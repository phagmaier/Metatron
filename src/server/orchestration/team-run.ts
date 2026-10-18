import { runSchema, teamSnapshotSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { startTeamRunSchema } from "../../shared/teams.ts";
import { inspectRepository, requireClean } from "../git/inspect.ts";
import { mutate } from "../storage/mutations.ts";
import { getTeam, resolveTeam } from "../storage/teams.ts";
import type { Engine } from "./engine.ts";
import { beginLeadRun } from "./lead-run.ts";

export async function createTeamRun(
  engine: Engine,
  input: unknown,
  key: string,
) {
  const data = startTeamRunSchema.parse(input);
  const { store } = engine;
  const project = store.getProject(data.projectId);
  const repository = await inspectRepository(project.repositoryPath);
  requireClean(repository);
  if (
    !project.repository ||
    project.repository.root !== repository.root ||
    project.repository.commonDirectory !== repository.commonDirectory
  )
    throw new DomainError("CONFLICT", "Project identity changed; reopen it");
  const { execution, profiles } = resolveTeam(
    store,
    getTeam(store, { id: data.teamId }),
  );
  if (execution === "native" && data.scenario !== "success")
    throw new DomainError(
      "POLICY_DENIED",
      "Simulated worker outcomes apply only to FAKE teams",
    );
  // FAKE playback never contacts a harness. Native discovery is fresh and runs
  // outside the transaction, so the snapshot is validated against it inside.
  const catalogs =
    execution === "native"
      ? {
          pi: await engine.profiles.discover({ harness: "pi" }),
          codex: await engine.profiles.discover({ harness: "codex" }),
          claude: profiles.some((profile) => profile.harness === "claude-code")
            ? await engine.profiles.discover({ harness: "claude-code" })
            : null,
          opencode: profiles.some((profile) => profile.harness === "opencode")
            ? await engine.profiles.discover({ harness: "opencode" })
            : null,
        }
      : null;
  return mutate(store.db, key, "startTeamRun", data, runSchema, () => {
    const team = getTeam(store, { id: data.teamId });
    if (team.version !== data.teamVersion)
      throw new DomainError(
        "CONFLICT",
        "Team changed; review the saved team before starting",
      );
    // Same version means the same profile IDs, so FAKE/native cannot change.
    const resolved = resolveTeam(store, team);
    if (catalogs) {
      if (catalogs.codex.authenticated !== true)
        throw new DomainError(
          "UNSUPPORTED",
          "The team's Codex Lead requires app-owned login; check Codex discovery",
        );
      for (const profile of resolved.profiles) {
        const catalog =
          profile.harness === "codex"
            ? catalogs.codex
            : profile.harness === "claude-code"
              ? catalogs.claude
              : profile.harness === "opencode"
                ? catalogs.opencode
                : catalogs.pi;
        if (!catalog)
          throw new DomainError(
            "UNSUPPORTED",
            "The worker harness was not discovered for this team",
          );
        engine.profiles.validate(profile, catalog);
      }
    }
    // The run owns this resolved copy; later library edits never reach it.
    const run = {
      projectId: project.id,
      title: data.title,
      initialPrompt: data.initialPrompt,
      mode: team.mode,
      limits: team.limits,
      teamSnapshot: teamSnapshotSchema.parse({
        preset: team,
        roles: resolved.roles,
        profiles: resolved.profiles,
        workflows: resolved.workflows,
      }),
      repository,
    };
    if (catalogs) return beginLeadRun(engine, run, key);
    const created = store.createRun(
      { ...run, execution: "fake" },
      `${key}:run`,
    );
    engine.message(
      { runId: created.id, text: data.initialPrompt, scenario: data.scenario },
      `${key}:initial`,
    );
    return created;
  });
}
