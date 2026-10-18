import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  AgentProfile,
  Attempt,
  Event,
  Run,
  Session,
  Task,
  TeamPreset,
} from "../src/shared/domain/entities.ts";
import type { IntegrationPreview } from "../src/shared/integration.ts";
import type { TeamContent } from "../src/shared/teams.ts";
import { createGitFixture } from "../tests/helpers/git-fixture.ts";

export type Mode = "fixtures" | "live";
export type Check = { name: string; pass: boolean; detail: string };
export const roleIds = {
  lead: "00000000-0000-4000-8000-000000000001",
  writer: "00000000-0000-4000-8000-000000000002",
  reviewer: "00000000-0000-4000-8000-000000000003",
  reader: "00000000-0000-4000-8000-000000000004",
  synthesizer: "00000000-0000-4000-8000-000000000005",
};
export type Selection = { harness: string; model: string; thinking: string };

const files: Record<string, string> = {
  "README.md":
    "# Inventory service\n\nDisposable acceptance fixture. `src/inventory.js` filters stock; `src/pricing.js` totals order lines in cents. Run `node --test`.\n",
  "package.json":
    '{\n  "name": "acceptance-fixture",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  "src/inventory.js":
    "export function inStock(items) {\n  return items.filter((item) => item.quantity > 0).map((item) => item.name);\n}\n\nexport function lowStock(items, threshold) {\n  return items.filter((item) => item.quantity > 0 && item.quantity < threshold);\n}\n",
  "src/pricing.js":
    "export function subtotalCents(lines) {\n  return lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);\n}\n",
  "tests/inventory.test.js":
    "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { inStock, lowStock } from '../src/inventory.js';\n\ntest('inStock keeps positive quantities', () => {\n  assert.deepEqual(inStock([{ name: 'bolt', quantity: 2 }, { name: 'nut', quantity: 0 }]), ['bolt']);\n});\n\ntest('lowStock finds items under the threshold', () => {\n  assert.deepEqual(lowStock([{ name: 'bolt', quantity: 2 }, { name: 'nut', quantity: 9 }], 3), [{ name: 'bolt', quantity: 2 }]);\n});\n",
  "tests/pricing.test.js":
    "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { subtotalCents } from '../src/pricing.js';\n\ntest('subtotal multiplies unit price by quantity', () => {\n  assert.equal(subtotalCents([{ unitCents: 150, quantity: 2 }, { unitCents: 25, quantity: 4 }]), 400);\n});\n",
};

// A fresh disposable repository; nothing here ever points at a user checkout.
export async function acceptanceRepo() {
  const fixture = await createGitFixture();
  for (const folder of ["src", "tests"])
    await mkdir(join(fixture.directory, folder));
  for (const [path, content] of Object.entries(files))
    await writeFile(join(fixture.directory, path), content);
  await fixture.git("add", "--", ...Object.keys(files));
  await fixture.git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Acceptance fixture baseline",
  );
  return {
    ...fixture,
    head: () => fixture.git("rev-parse", "HEAD"),
    status: () => fixture.git("status", "--porcelain", "--untracked-files=all"),
  };
}
export type AcceptanceRepo = Awaited<ReturnType<typeof acceptanceRepo>>;

export class Acceptance {
  origin = "";
  checks: Check[] = [];
  notes: string[] = [];
  private token = "";
  private app: ChildProcess | null = null;
  private exited: Promise<void> = Promise.resolve();
  readonly options: {
    mode: Mode;
    port: number;
    database: string;
    queue: string | null;
    codexScenario?: string;
    codexRole?: string;
    // Script-issued approvals; the driver's own fresh /tmp repository only.
    approve: boolean;
    log: string;
  };
  constructor(options: Acceptance["options"]) {
    this.options = options;
  }
  get live() {
    return this.options.mode === "live";
  }
  async start() {
    const launcher = fileURLToPath(
      new URL("./acceptance-app.ts", import.meta.url),
    );
    const { database, port, queue, codexScenario, codexRole, log } =
      this.options;
    const child = spawn(
      process.execPath,
      [
        launcher,
        "--database",
        database,
        "--port",
        String(port),
        ...(queue ? ["--fixtures", queue] : []),
        ...(codexScenario ? ["--codex-scenario", codexScenario] : []),
        ...(codexRole ? ["--codex-role", codexRole] : []),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.app = child;
    this.exited = new Promise((resolve) => child.once("exit", () => resolve()));
    child.stderr?.on("data", (chunk) => appendFileSync(log, chunk));
    const lines = createInterface({ input: child.stdout });
    this.origin = await new Promise<string>((resolve, reject) => {
      child.once("exit", (code) =>
        reject(new Error(`App exited during startup (${code}); see ${log}`)),
      );
      lines.on("line", (line) => {
        appendFileSync(log, `${line}\n`);
        if (line.startsWith("READY ")) resolve(line.slice(6));
      });
    });
    this.token = z
      .object({ token: z.string() })
      .parse(
        await (await fetch(`${this.origin}/api/local-session`)).json(),
      ).token;
  }
  async stop() {
    this.app?.kill("SIGTERM");
    await this.exited;
  }
  // An abrupt app death: no shutdown hooks, no stop journal, no session cleanup.
  async crash() {
    this.app?.kill("SIGKILL");
    await this.exited;
  }
  async read<T = unknown>(path: string): Promise<T> {
    const response = await fetch(`${this.origin}/api/${path}`);
    const body = await response.json();
    if (!response.ok) throw new Error(`GET ${path}: ${JSON.stringify(body)}`);
    return body as T;
  }
  async write<T = unknown>(
    path: string,
    input: unknown,
    method = "POST",
  ): Promise<T> {
    const response = await fetch(`${this.origin}/api/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        "X-Local-Token": this.token,
      },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(`${method} ${path}: ${JSON.stringify(body)}`);
    return body as T;
  }
  async until<T>(
    label: string,
    probe: () => Promise<T | undefined | false>,
    minutes = this.live ? 5 : 1,
  ): Promise<T> {
    const deadline = Date.now() + minutes * 60_000;
    while (Date.now() < deadline) {
      const value = await probe();
      if (value) return value;
      await delay(500);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }
  check(name: string, pass: boolean, detail = "") {
    this.checks.push({ name, pass, detail });
    console.log(
      `${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`,
    );
  }
  note(text: string) {
    this.notes.push(text);
    console.log(`NOTE ${text}`);
  }
  // Scripted worker behaviors are consumed in spawn order (fixtures only).
  queuePi(...scenarios: string[]) {
    if (this.options.queue)
      appendFileSync(
        join(this.options.queue, "pi.queue"),
        scenarios.map((s) => `${s}\n`).join(""),
      );
  }
  async tasks(runId: string) {
    return (await this.read<{ tasks: Task[] }>(`tasks?runId=${runId}`)).tasks;
  }
  async task(runId: string, id: string) {
    const task = (await this.tasks(runId)).find((t) => t.id === id);
    if (!task) throw new Error(`Missing task ${id}`);
    return task;
  }
  async attempts(runId: string) {
    const ids = new Set((await this.tasks(runId)).map((t) => t.id));
    return (
      await this.read<{ attempts: Attempt[] }>("attempts")
    ).attempts.filter((a) => ids.has(a.taskId));
  }
  async sessions() {
    return (await this.read<{ sessions: Session[] }>("sessions")).sessions;
  }
  async events(runId: string) {
    const all: Event[] = [];
    for (;;) {
      const page = (
        await this.read<{ events: Event[] }>(
          `events?runId=${runId}&limit=500&after=${all.at(-1)?.sequence ?? 0}`,
        )
      ).events;
      all.push(...page);
      if (page.length < 500) return all;
    }
  }
  async status(
    runId: string,
    taskId: string,
    statuses: string[],
    failing = ["FAILED", "RETRY_DECISION", "CANCELLED"],
  ) {
    return this.until(`${statuses.join("/")} for ${taskId}`, async () => {
      const task = await this.task(runId, taskId);
      if (failing.includes(task.status) && !statuses.includes(task.status))
        throw new Error(`Task "${task.title}" reached ${task.status}`);
      return statuses.includes(task.status) && task;
    });
  }
  // Hard turn cap: every native launch (Lead or worker) is an attempt.
  async budget(runId: string, cap: number) {
    const used = (await this.attempts(runId)).length;
    if (used > cap) {
      await this.write("runs/stop", { runId });
      throw new Error(`Turn cap exceeded: ${used} > ${cap}; run stopped`);
    }
    return used;
  }
  async profile(
    name: string,
    roleId: string,
    selection: Selection,
    permission: string,
  ) {
    return this.write<AgentProfile>("agent-profiles", {
      name,
      roleId,
      ...selection,
      permission,
      instructionOverride: null,
    });
  }
  async team(content: TeamContent) {
    return this.write<TeamPreset>("team-presets", content);
  }
  async teamRun(projectId: string, team: TeamPreset, prompt: string) {
    return this.write<Run>("runs/team", {
      projectId,
      teamId: team.id,
      teamVersion: team.version,
      title: `Acceptance ${team.name}`,
      initialPrompt: prompt,
    });
  }
  async latestReview(taskId: string) {
    const history = await this.read<{
      reviews: {
        review: {
          recommendation: string;
          summary: string;
          findings: unknown[];
        };
      }[];
    }>(`reviews?taskId=${taskId}`);
    return history.reviews.at(-1)?.review;
  }
  // The owner approves in the GUI during live runs unless they launched the
  // driver with --approve-disposable; the target is always this driver's own
  // freshly created fixture repository.
  async integrate(runId: string, taskId: string) {
    const list = () =>
      this.read<IntegrationPreview[]>(`integrations?taskId=${taskId}`);
    const known = (await list()).length;
    await this.write("tasks/integration", {
      taskId,
      tests: [["node", "--test"]],
    });
    const preview = await this.until("integration preview", async () => {
      const all = await list();
      const latest = all.at(-1);
      return all.length > known && latest?.status !== "preparing" && latest;
    });
    if (preview.status !== "passed") return preview;
    if (this.options.approve) {
      await this.write("integrations/decision", {
        integrationId: preview.id,
        decision: "approve",
      });
      const plan = await this.read<{
        method: string;
        expectedSha: string;
        resultSha: string;
        checkoutPath: string | null;
      }>(`integrations/plan?integrationId=${preview.id}`);
      await this.write("integrations/apply", {
        integrationId: preview.id,
        confirm: {
          method: plan.method,
          expectedSha: plan.expectedSha,
          resultSha: plan.resultSha,
          checkoutPath: plan.checkoutPath,
        },
      });
    } else
      console.log(
        `OWNER ACTION REQUIRED: open ${this.origin}, inspect the reviewed diff for task ${taskId} and approve then apply integration ${preview.id} (or decline).`,
      );
    return this.until(
      "owner integration decision",
      async () => {
        const current = (await list()).find((p) => p.id === preview.id);
        if (current?.decision?.outcome === "declined")
          throw new Error("Owner declined the integration");
        return (
          current?.applications.some((a) =>
            ["applied", "blocked"].includes(a.status),
          ) && current
        );
      },
      this.live ? 120 : 1,
    ).then(async (done) => {
      await this.status(runId, taskId, ["DONE", "BLOCKED_CONFLICT"]);
      return done;
    });
  }
}

// Content digest of a worktree (excluding Git metadata) to prove no later write.
export async function treeDigest(directory: string) {
  const hash = createHash("sha256");
  const entries = (await readdir(directory, { recursive: true }))
    .filter((path) => path !== ".git" && !path.startsWith(".git/"))
    .sort();
  for (const path of entries) {
    const full = join(directory, path);
    if (!(await stat(full)).isFile()) continue;
    hash
      .update(`${path}\0`)
      .update(await readFile(full))
      .update("\0");
  }
  return hash.digest("hex");
}

export function writeEvidence(path: string, evidence: object) {
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
}
