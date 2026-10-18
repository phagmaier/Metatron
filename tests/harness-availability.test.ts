import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ClaudeAdapter } from "../src/server/adapters/claude.ts";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import { OpenCodeAdapter } from "../src/server/adapters/opencode.ts";
import { openCodeProviderKeys } from "../src/server/adapters/opencode-host.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { opencodeFixtureOptions } from "./helpers/opencode-fixture.ts";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./helpers/${name}`, import.meta.url));

// Inert stand-ins that only record that they ran; shell builtins only, so they
// would leave evidence even with a PATH that cannot find external commands.
const harnesses = ["codex", "claude", "opencode", "pi"];
async function plant(marker: string, directory: string, names = harnesses) {
  await mkdir(directory, { recursive: true });
  for (const name of names) {
    await writeFile(join(directory, name), `#!/bin/sh\n: > '${marker}'\n`);
    await chmod(join(directory, name), 0o755);
  }
}
async function withPath<T>(path: string, run: () => Promise<T>) {
  const original = process.env.PATH;
  process.env.PATH = path;
  try {
    return await run();
  } finally {
    process.env.PATH = original;
  }
}

test("a harness is missing only without an absolute PATH executable, and a relative PATH entry is never run", async () => {
  const root = await mkdtemp(join(tmpdir(), "lao-availability-"));
  try {
    const app = join(root, "app");
    const marker = join(root, "executed");
    // Harness children run in app or worktree directories, where a relative
    // entry would otherwise find repository-controlled executables. Codex
    // discovery runs in its home, Pi's in the app directory.
    await plant(marker, join(app, "planted"));
    await plant(marker, join(app, "codex", "planted"));
    await withPath("planted", async () => {
      for (const [name, adapter] of [
        ["codex", new CodexAdapter(app)],
        ["claude", new ClaudeAdapter(app)],
        ["opencode", new OpenCodeAdapter(app)],
        ["pi", new PiAdapter(app)],
      ] as const) {
        const caps = await adapter.discover();
        assert.equal(caps.installed, false, name);
        assert.deepEqual(caps.models, []);
        assert.equal(caps.version, null);
        assert.ok(caps.nextStep?.includes(`\`${name}\``), name);
      }
    });
    await assert.rejects(stat(marker), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a found executable that fails discovery is installed but not ready, never missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "lao-availability-"));
  try {
    const bin = join(root, "bin");
    const marker = join(root, "executed");
    await plant(marker, bin);
    await withPath(bin, async () => {
      for (const adapter of [
        new CodexAdapter(join(root, "app")),
        new PiAdapter(join(root, "app")),
      ]) {
        const caps = await adapter.discover();
        assert.equal(caps.installed, true);
        assert.deepEqual(caps.models, []);
        assert.ok(caps.nextStep);
      }
    });
    await stat(marker);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery names the owner's login step and reports the version the harness itself gives", async () => {
  const root = await mkdtemp(join(tmpdir(), "lao-availability-"));
  try {
    const pi = await new PiAdapter(
      join(root, "pi"),
      (_args, cwd, env) =>
        new PiRpc(process.execPath, [fixture("pi-rpc-fixture.ts")], cwd, {
          ...env,
          LAO_FIXTURE_SCENARIO: "no-models",
        }),
    ).discover();
    assert.equal(pi.installed, true);
    assert.equal(pi.authenticated, false);
    assert.ok(pi.nextStep);
    // An injected launcher is not Pi, so no version is claimed for it.
    assert.equal(pi.version, null);

    const opencode = await new OpenCodeAdapter(
      join(root, "opencode"),
      opencodeFixtureOptions("no-models"),
    ).discover();
    assert.equal(opencode.authenticated, false);
    assert.equal(opencode.version, "2.0.29-fixture");
    for (const key of openCodeProviderKeys)
      assert.ok(opencode.nextStep?.includes(key), key);

    const adapter = new CodexAdapter(
      join(root, "codex"),
      (args, cwd, env) =>
        new CodexRpc(
          process.execPath,
          [fixture("codex-fixture.ts"), ...args],
          cwd,
          { ...env, LAO_CODEX_FIXTURE_AUTH: "none" },
        ),
    );
    const codex = await adapter.discover();
    assert.equal(codex.authenticated, false);
    assert.equal(codex.version, "0.163.0-fixture");
    assert.ok(codex.nextStep?.includes(`CODEX_HOME='${adapter.home}'`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
