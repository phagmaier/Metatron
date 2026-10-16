import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "../../src/server/storage/store.ts";
import { artifactSchema } from "../../src/shared/domain/entities.ts";
import { reviewFixture } from "./review-fixture.ts";

export const node = process.execPath;
export const owner = { role: "owner" } as const;
type Repo = Awaited<ReturnType<typeof reviewFixture>>["repo"];

// A writer candidate with a recorded passing review, ready for integration.
export async function reviewed() {
  const f = await reviewFixture("review-pass");
  f.request();
  await f.engine.idle();
  return f;
}
export function artifactText(store: Store, id: string | null | undefined) {
  const row = store.db
    .prepare("SELECT data FROM artifacts WHERE id=?")
    .get(id ?? "");
  assert.ok(row);
  return readFile(
    artifactSchema.parse(JSON.parse(String(row.data))).path,
    "utf8",
  );
}
export const integrationBranches = (repo: Repo) =>
  repo.git(
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/lao/integration-*",
  );
export const checks = (preview: {
  checks: { name: string; status: string }[];
}) => preview.checks.map((c) => `${c.name}:${c.status}`);

// Simulates the owner committing to a destination branch after the run began;
// a new branch starts at `from`. The fixture checkout ends back on main.
export async function ownerCommit(
  repo: Repo,
  branch: string,
  files: Record<string, string>,
  options: { from?: string; executable?: string } = {},
) {
  if (options.from) await repo.git("switch", "-q", "-c", branch, options.from);
  for (const [path, content] of Object.entries(files))
    await writeFile(join(repo.directory, path), content);
  if (options.executable)
    await chmod(join(repo.directory, options.executable), 0o755);
  await repo.git("add", "--all");
  await repo.git(
    "-c",
    "user.name=Owner",
    "-c",
    "user.email=owner@example.invalid",
    "commit",
    "-q",
    "-m",
    `Owner change on ${branch}`,
  );
  const sha = await repo.git("rev-parse", "HEAD");
  if (options.from) await repo.git("switch", "-q", "main");
  return sha;
}
