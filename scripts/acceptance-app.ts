import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CodexAdapter } from "../src/server/adapters/codex.ts";
import { CodexRpc } from "../src/server/adapters/codex-rpc.ts";
import { PiAdapter } from "../src/server/adapters/pi.ts";
import { PiRpc } from "../src/server/adapters/pi-rpc.ts";
import { startApp } from "../src/server/app.ts";

// The real app in its own process for scripts/acceptance.ts, so a scenario
// can kill it like a crash. --fixtures substitutes deterministic protocol
// subprocesses for Codex and Pi: no model, no provider, no login.
const { values } = parseArgs({
  options: {
    database: { type: "string" },
    port: { type: "string" },
    fixtures: { type: "string" },
    "codex-scenario": { type: "string" },
    "codex-role": { type: "string" },
  },
});
if (!values.database || !values.port)
  throw new Error("Usage: --database <path> --port <n> [--fixtures <dir>]");
const directory = dirname(values.database);
const helper = (name: string) =>
  fileURLToPath(new URL(`../tests/helpers/${name}`, import.meta.url));

// Each Pi session takes the next scripted behavior. Only sessions get a
// gateway binding; discovery spawns take none, so dispatch order decides.
function nextPiScenario(queue: string) {
  const path = join(queue, "pi.queue");
  const [next = "success", ...rest] = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean);
  writeFileSync(path, rest.map((line) => `${line}\n`).join(""));
  return next;
}

const queue = values.fixtures;
const app = await startApp({
  development: false,
  port: Number(values.port),
  databasePath: values.database,
  adapters: queue
    ? {
        pi: new PiAdapter(
          directory,
          (_args, cwd, env) =>
            new PiRpc(process.execPath, [helper("pi-rpc-fixture.ts")], cwd, {
              ...env,
              ...(env.LAO_GATEWAY_URL
                ? { LAO_FIXTURE_SCENARIO: nextPiScenario(queue) }
                : {}),
            }),
        ),
        codex: new CodexAdapter(
          directory,
          (args, cwd, env) =>
            new CodexRpc(
              process.execPath,
              [helper("codex-fixture.ts"), ...args],
              cwd,
              {
                ...env,
                LAO_CODEX_FIXTURE_SCENARIO:
                  values["codex-scenario"] ?? "delegate",
                LAO_CODEX_FIXTURE_ROLE: values["codex-role"] ?? "Reader",
              },
            ),
        ),
      }
    : {},
});
console.log(`READY ${app.origin}`);
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  app.close().catch((error: unknown) => {
    console.error("Shutdown failed", error);
    process.exitCode = 1;
  });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
