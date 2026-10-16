import { Engine } from "../src/server/orchestration/engine.ts";
import { appLocations } from "../src/server/storage/database.ts";
import { Store } from "../src/server/storage/store.ts";
import { fakeTeamSnapshot } from "../src/shared/presets.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";

const locations = appLocations();
const store = new Store(locations.database);
store.recoverInterrupted();
const engine = new Engine(store, locations.data);
try {
  let run = store
    .listRuns()
    .find((run) => run.title === "M2 · fake orchestration");
  if (!run) {
    const fixture = await createGitFixture();
    const project = await engine.openProject(
      { name: "M2 · disposable fixture", repositoryPath: fixture.directory },
      "m2-demo:project",
    );
    run = await engine.startRun(
      {
        projectId: project.id,
        title: "M2 · fake orchestration",
        initialPrompt:
          "Inspect the disposable fixture and report evidence (scripted simulation).",
        leadProfileId: fakeTeamSnapshot.preset.leadProfileId,
      },
      "m2-demo:start",
    );
    await engine.idle();
    engine.message(
      {
        runId: run.id,
        text: "Demonstrate a failed worker without an automatic retry.",
        scenario: "failure",
      },
      "m2-demo:failure",
    );
    await engine.idle();
  }
  const project = store.getProject(run.projectId);
  console.log(`FAKE only. Saved run: ${run.id}`);
  console.log(`Disposable fixture retained: ${project.repositoryPath}`);
  console.log(`Database: ${locations.database}`);
  console.log(
    `Worker states: ${store
      .listTasks(run.id)
      .filter((task) => task.kind === "work")
      .map((task) => task.status)
      .join(", ")}`,
  );
  console.log(
    "Start the app with the same XDG_DATA_HOME. Existing or partially seeded runs are never replayed.",
  );
} finally {
  await engine.close();
  store.close();
}
