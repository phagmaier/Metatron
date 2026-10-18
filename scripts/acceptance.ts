import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { appLocations } from "../src/server/storage/database.ts";
import type { ProfileCapabilities } from "../src/shared/profiles.ts";
import {
  Acceptance,
  acceptanceRepo,
  type Selection,
  writeEvidence,
} from "./acceptance-kit.ts";
import { type Context, scenarios } from "./acceptance-scenarios.ts";

// Owner-perspective acceptance scenarios (spec §13.4) against the real app in
// its own process, over the same HTTP API the GUI uses, on a fresh disposable
// repository. --fixtures rehearses with deterministic protocol subprocesses;
// --allow-live uses the installed native harnesses within a hard turn cap,
// and every live integration waits for the owner's approval in the GUI.
const { values } = parseArgs({
  options: {
    scenario: { type: "string" },
    fixtures: { type: "boolean" },
    "allow-live": { type: "boolean" },
    "approve-disposable": { type: "boolean" },
    output: { type: "string" },
    port: { type: "string", default: "4318" },
    lead: { type: "string" },
    writer: { type: "string" },
    reader: { type: "string" },
  },
});
const key = values.scenario?.toUpperCase() as keyof typeof scenarios;
const scenario = scenarios[key];
const live = values["allow-live"] === true;
if (!scenario || live === (values.fixtures === true) || !values.output)
  throw new Error(
    "Usage: --scenario A..G (--fixtures | --allow-live --lead codex:model:thinking --writer pi:model:thinking --reader harness:model:thinking [--approve-disposable]) --output <new evidence.json>",
  );
const output = resolve(values.output);
if (existsSync(output))
  throw new Error("Evidence file already exists; choose a new --output");
// harness:model:thinking; the model itself may contain colons.
const parse = (value: string | undefined, name: string): Selection => {
  const text = value ?? "";
  const [first, last] = [text.indexOf(":"), text.lastIndexOf(":")];
  const selection = {
    harness: text.slice(0, first),
    model: text.slice(first + 1, last),
    thinking: text.slice(last + 1),
  };
  if (first < 1 || last <= first + 1 || !selection.thinking)
    throw new Error(`--${name} must be harness:model:thinking`);
  return selection;
};

const startedAt = new Date().toISOString();
const directory = live
  ? appLocations().data
  : await mkdtemp(join(tmpdir(), "lao-acceptance-"));
if (live && !existsSync(directory))
  throw new Error(`App-owned data directory ${directory} does not exist`);
const database = join(
  directory,
  live ? `acceptance-${key}-${crypto.randomUUID()}.sqlite` : "state.sqlite",
);
if (!live) writeFileSync(join(directory, "pi.queue"), "");
const repo = await acceptanceRepo();
const baseSha = await repo.head();
const k = new Acceptance({
  mode: live ? "live" : "fixtures",
  approve: !live || values["approve-disposable"] === true,
  port: Number(values.port),
  database,
  queue: live ? null : directory,
  ...("codexScenario" in scenario && !live
    ? { codexScenario: scenario.codexScenario }
    : {}),
  ...("codexRole" in scenario && !live
    ? { codexRole: scenario.codexRole }
    : {}),
  log: `${database}.log`,
});
const runs: string[] = [];
let sel: Context["sel"] | null = null;
let error: string | null = null;
await k.start();
try {
  const discover = (harness: string) =>
    k.read<ProfileCapabilities>(`agent-profiles/discover?harness=${harness}`);
  if (live) {
    sel = {
      lead: parse(values.lead, "lead"),
      writer: parse(values.writer, "writer"),
      reader: parse(values.reader, "reader"),
    };
    // Zero-prompt preflight: no turn starts unless every harness is usable.
    for (const harness of new Set(Object.values(sel).map((s) => s.harness))) {
      const found = await discover(harness);
      if (found.state !== "available")
        throw new Error(
          `BLOCKED before any prompt: ${harness} is ${found.state}. ${found.nextStep ?? ""}`,
        );
    }
  } else {
    const [pi, codex] = await Promise.all([discover("pi"), discover("codex")]);
    const fixture = (
      models: ProfileCapabilities["models"],
      harness: string,
    ) => ({
      harness,
      model: models[0]?.id ?? "",
      thinking: "low",
    });
    sel = {
      lead: fixture(codex.models, "codex"),
      writer: fixture(pi.models, "pi"),
      reader: fixture(pi.models, "pi"),
    };
  }
  const project = await k.write<{ id: string }>("projects", {
    name: `Acceptance ${key}`,
    repositoryPath: repo.directory,
  });
  await scenario.run({
    k,
    repo,
    projectId: project.id,
    cap: scenario.cap,
    runs,
    sel,
  });
} catch (failure) {
  error = failure instanceof Error ? failure.message : String(failure);
  k.check("scenario ran to completion", false, error);
}
const attempts = (
  await Promise.all(runs.map((runId) => k.attempts(runId)))
).flat();
const leadTasks = new Set(
  (await Promise.all(runs.map((runId) => k.tasks(runId))))
    .flat()
    .filter((t) => t.kind === "lead")
    .map((t) => t.id),
);
const lead = attempts.filter((a) => leadTasks.has(a.taskId)).length;
k.check(
  "native turns within the scenario cap",
  attempts.length <= scenario.cap,
  `${attempts.length}/${scenario.cap} (${lead} Lead, ${attempts.length - lead} worker)`,
);
await k.stop();
const pass = k.checks.every((c) => c.pass);
const git = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
writeEvidence(output, {
  scenario: key,
  title: scenario.title,
  mode: live
    ? "live native harnesses"
    : "rehearsal: deterministic protocol subprocesses, not a live harness",
  result: pass ? "PASS" : "FAIL",
  startedAt,
  finishedAt: new Date().toISOString(),
  versions: { node: process.version, git },
  selections: live ? sel : null,
  integrationApproval: !live
    ? "script (rehearsal fixture)"
    : values["approve-disposable"]
      ? "script-issued under the owner's --approve-disposable authorization (disposable fixture only)"
      : "owner in the GUI",
  turns: { cap: scenario.cap, total: attempts.length, lead },
  checks: k.checks,
  notes: k.notes,
  repository: { path: repo.directory, baseSha, finalSha: await repo.head() },
  database: live || !pass ? database : null,
});
console.log(`${pass ? "PASS" : "FAIL"} scenario ${key}; evidence ${output}`);
if (!live && pass) {
  await rm(directory, { recursive: true });
  await repo.verify(async () => {});
} else
  console.log(`Retained repository ${repo.directory} and data ${database}`);
process.exitCode = pass ? 0 : 1;
