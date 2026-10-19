import { runSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  harnessLabel,
  nativeRunSchema,
  nativeTeam,
} from "../../shared/native.ts";
import {
  inspectRepository,
  requireClean,
  sameRepository,
} from "../git/inspect.ts";
import { mutate } from "../storage/mutations.ts";
import type { Engine } from "./engine.ts";

export async function createNativeRun(
  engine: Engine,
  input: unknown,
  key: string,
) {
  const data = nativeRunSchema.parse(input);
  const project = engine.store.getProject(data.projectId);
  const repository = await inspectRepository(project.repositoryPath);
  requireClean(repository);
  if (!project.repository || !sameRepository(project.repository, repository))
    throw new DomainError(
      "CONFLICT",
      "Project identity changed or is unverified; reopen it before starting a new run",
    );
  const label = harnessLabel[data.harness];
  if (data.harness === "codex" && data.permission !== "read_only")
    throw new DomainError(
      "UNSUPPORTED",
      "Codex workers are read-only in this build; choose Reader",
    );
  const capabilities = await engine.adapters[data.harness].discover();
  const model = capabilities.models.find((m) => m.id === data.model);
  if (
    !capabilities.installed ||
    capabilities.authenticated === false ||
    !model ||
    (data.thinking !== null &&
      !model.thinking.some((t) => t.id === data.thinking))
  )
    throw new DomainError(
      "UNSUPPORTED",
      `${label} model/thinking or supported authentication is unavailable. ${capabilities.nextStep ?? "Refresh native capabilities."}`,
    );
  return mutate(engine.store.db, key, "startNativeRun", data, runSchema, () => {
    const snapshot = {
      ...nativeTeam(data.model, data.thinking, data.harness),
      roles: engine.presets().roles,
    };
    const run = engine.store.createRun(
      {
        projectId: project.id,
        title: data.title,
        initialPrompt: data.initialPrompt,
        mode: "supervised",
        limits: data.limits,
        teamSnapshot: snapshot,
        repository,
        execution: "native",
      },
      `${key}:run`,
    );
    const profile = snapshot.profiles.find(
      (p) => p.permission === data.permission,
    );
    if (!profile)
      throw new DomainError("INVALID_REFERENCE", "Native worker role missing");
    const task = engine.store.createTask(
      {
        runId: run.id,
        title: `${label} ${data.permission === "read_only" ? "reader" : "writer"}`,
        objective: data.initialPrompt,
      },
      `${key}:task`,
    );
    engine.scheduling.enqueue(
      { role: "owner" },
      { taskId: task.id, profileId: profile.id },
      `${key}:assign`,
    );
    return run;
  });
}
