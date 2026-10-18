import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test files and their fixture children inherit TMPDIR from the runner, so
// every fixture that a test does not remove itself lands in one run-owned root
// instead of accumulating in RAM-backed /tmp across runs.
let root: string | undefined;

export async function globalSetup() {
  root = await mkdtemp(join(tmpdir(), "lao-test-run-"));
  process.env.TMPDIR = root;
}

export async function globalTeardown() {
  if (!root) return;
  // A failing run keeps every fixture for diagnosis; a passing run removes
  // only the root this process just created.
  if (process.exitCode) {
    console.error(`Test fixtures retained at ${root}`);
    return;
  }
  await rm(root, { recursive: true });
}
