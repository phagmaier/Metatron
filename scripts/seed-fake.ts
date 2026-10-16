import { seedFakeDemo } from "../src/server/fake-demo.ts";
import { appLocations } from "../src/server/storage/database.ts";
import { Store } from "../src/server/storage/store.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";

const locations = appLocations();
const store = new Store(locations.database);
try {
  const prior = store
    .listProjects()
    .find((project) => project.name === "FAKE · disposable fixture");
  const repositoryPath =
    prior?.repositoryPath ?? (await createGitFixture()).directory;
  const run = await seedFakeDemo(store, repositoryPath);
  console.log(`FAKE only; no model tokens. Saved run: ${run.id}`);
  console.log(`Database: ${locations.database}`);
  console.log(
    `Disposable Git fixture retained for this demo: ${repositoryPath}`,
  );
  console.log(
    "Start or restart the app with the same XDG_DATA_HOME; ambiguous work requires a retry decision.",
  );
} finally {
  store.close();
}
