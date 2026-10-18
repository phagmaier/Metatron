import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";

for (const harness of ["codex", "pi", "pi-version"] as const) {
  test(`${harness} cannot inherit a Claude setup-token, personal-session selectors or executable preload`, async () => {
    const root = await mkdtemp("/tmp/lao-env-isolation-");
    const marker = join(root, "preload-executed");
    const preload = join(root, "preload.mjs");
    await writeFile(
      preload,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "Ambient preload executed");`,
    );
    const planted = {
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      CLAUDE_CODE_OAUTH_TOKEN:
        "inert-claude-setup-token-not-for-other-harnesses",
      GITHUB_TOKEN: "inert-unrelated-github-token",
      DEEPSEEK_API_KEY: "inert-explicit-pi-provider-key",
      CODEX_HOME: join(root, "personal-codex"),
      CODEX_THREAD_ID: "personal-codex-thread",
      PI_CODING_AGENT_DIR: join(root, "personal-pi"),
      PI_CODING_AGENT_SESSION_DIR: join(root, "personal-sessions"),
      PI_SESSION_FILE: join(root, "personal-session.jsonl"),
      PI_SESSION_ID: "personal-pi-session",
      LAO_GATEWAY_TOKEN: "inert-unrelated-gateway-token",
      LAO_GATEWAY_URL: "http://127.0.0.1:1/personal-gateway",
      GIT_DIR: join(root, "personal.git"),
      GIT_WORK_TREE: root,
    };
    const original = Object.fromEntries(
      Object.keys(planted).map((key) => [key, process.env[key]]),
    );
    let childKeys: string[] = [];
    const data = join(root, "app");
    try {
      Object.assign(process.env, planted);
      if (harness === "pi-version") {
        // A harmless executable exercises BOTH default Pi launch paths, including
        // --version (which an injected RPC factory deliberately bypasses).
        const executable = join(root, "pi");
        const versionProbe = join(root, "pi-entry.mjs");
        const versionKeys = join(root, "version-keys.json");
        await writeFile(
          versionProbe,
          `import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  writeFileSync(${JSON.stringify(versionKeys)}, JSON.stringify(Object.keys(process.env)));
  console.log("1.3.0-inert");
} else {
  // Test module-loading boundary: --version must not register the RPC stdin handler.
  await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./helpers/pi-rpc-fixture.ts", import.meta.url))).href)});
}`,
        );
        await writeFile(
          executable,
          `#!/bin/sh\nexec '${process.execPath}' '${versionProbe}' "$@"\n`,
        );
        await chmod(executable, 0o700);
        const path = process.env.PATH;
        process.env.PATH = root;
        try {
          const discovery = await new PiAdapter(data).discover();
          assert.equal(discovery.version, "1.3.0-inert");
          childKeys = JSON.parse(await readFile(versionKeys, "utf8"));
        } finally {
          if (path === undefined) delete process.env.PATH;
          else process.env.PATH = path;
        }
      } else if (harness === "codex") {
        const discovery = await new CodexAdapter(
          data,
          async (args, cwd, env) => {
            const rpc = new CodexRpc(
              process.execPath,
              [
                fileURLToPath(
                  new URL("./helpers/codex-fixture.ts", import.meta.url),
                ),
                ...args,
              ],
              cwd,
              env,
            );
            assert.ok(rpc.child.pid);
            // Inspect only our inert child's environment names, never dump values.
            childKeys = (
              await readFile(`/proc/${rpc.child.pid}/environ`, "utf8")
            )
              .split("\0")
              .filter(Boolean)
              .map((item) => item.slice(0, item.indexOf("=")));
            return rpc;
          },
        ).discover();
        assert.equal(discovery.installed, true);
      } else {
        const discovery = await new PiAdapter(data, async (_args, cwd, env) => {
          const rpc = new PiRpc(
            process.execPath,
            [
              fileURLToPath(
                new URL("./helpers/pi-rpc-fixture.ts", import.meta.url),
              ),
            ],
            cwd,
            env,
          );
          assert.ok(rpc.child.pid);
          childKeys = (await readFile(`/proc/${rpc.child.pid}/environ`, "utf8"))
            .split("\0")
            .filter(Boolean)
            .map((item) => item.slice(0, item.indexOf("=")));
          return rpc;
        }).discover();
        assert.equal(discovery.installed, true);
      }
      for (const key of [
        "CLAUDE_CODE_OAUTH_TOKEN",
        "GITHUB_TOKEN",
        "NODE_OPTIONS",
        "CODEX_THREAD_ID",
        "PI_SESSION_FILE",
        "PI_SESSION_ID",
        "GIT_DIR",
        "GIT_WORK_TREE",
        "LAO_GATEWAY_TOKEN",
        "LAO_GATEWAY_URL",
      ])
        assert.equal(
          childKeys.includes(key),
          false,
          `${harness} inherited ${key}`,
        );
      if (harness === "pi") assert.ok(childKeys.includes("DEEPSEEK_API_KEY"));
      else assert.equal(childKeys.includes("DEEPSEEK_API_KEY"), false);
      await assert.rejects(access(marker), { code: "ENOENT" });
      await assert.rejects(access(planted.CODEX_HOME), { code: "ENOENT" });
      await assert.rejects(access(planted.PI_CODING_AGENT_DIR), {
        code: "ENOENT",
      });
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}
