import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DomainError } from "../../shared/domain/states.ts";

export function appLocations(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
) {
  const xdg = (key: string, fallback: string) => {
    const value = env[key];
    return value && isAbsolute(value) ? value : fallback;
  };
  const data = join(
    xdg("XDG_DATA_HOME", join(home, ".local/share")),
    "local-agent-orchestrator",
  );
  return {
    data,
    database: join(data, "state.sqlite"),
    artifacts: join(data, "artifacts"),
    config: join(
      xdg("XDG_CONFIG_HOME", join(home, ".config")),
      "local-agent-orchestrator",
    ),
    runtime:
      env.XDG_RUNTIME_DIR && isAbsolute(env.XDG_RUNTIME_DIR)
        ? join(env.XDG_RUNTIME_DIR, "local-agent-orchestrator")
        : null,
  };
}

// Each entity has a concrete table and relational ownership; JSON preserves the
// validated versioned snapshot without turning future milestones into migrations here.
const migration1 = `
CREATE TABLE projects (id TEXT PRIMARY KEY, repository_path TEXT NOT NULL UNIQUE, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE role_templates (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE agent_profiles (id TEXT PRIMARY KEY, role_id TEXT NOT NULL REFERENCES role_templates(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE team_presets (id TEXT PRIMARY KEY, lead_profile_id TEXT NOT NULL REFERENCES agent_profiles(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE workflow_templates (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), parent_task_id TEXT REFERENCES tasks(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE task_dependencies (task_id TEXT NOT NULL REFERENCES tasks(id), dependency_id TEXT NOT NULL REFERENCES tasks(id), PRIMARY KEY(task_id, dependency_id), CHECK(task_id != dependency_id)) STRICT;
CREATE TABLE attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), dispatch_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE sessions (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE human_requests (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), session_id TEXT REFERENCES sessions(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE human_request_tasks (request_id TEXT NOT NULL REFERENCES human_requests(id), task_id TEXT NOT NULL REFERENCES tasks(id), PRIMARY KEY(request_id, task_id)) STRICT;
CREATE TABLE integration_candidates (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), attempt_id TEXT NOT NULL REFERENCES attempts(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE reviews (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), reviewer_attempt_id TEXT NOT NULL REFERENCES attempts(id), candidate_id TEXT NOT NULL REFERENCES integration_candidates(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE artifacts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), attempt_id TEXT REFERENCES attempts(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, run_id TEXT REFERENCES runs(id), task_id TEXT REFERENCES tasks(id),
  attempt_id TEXT REFERENCES attempts(id), session_id TEXT REFERENCES sessions(id),
  type TEXT NOT NULL, correlation_id TEXT NOT NULL, causation_id TEXT REFERENCES events(id),
  payload TEXT NOT NULL CHECK(json_valid(payload))
) STRICT;
CREATE INDEX events_run_sequence ON events(run_id, sequence);
CREATE INDEX tasks_run ON tasks(run_id);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'Events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'Events are append-only'); END;
CREATE TABLE mutations (key TEXT PRIMARY KEY, operation TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result))) STRICT;
`;
const migration2 = `
CREATE TABLE dispatches (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
  run_id TEXT NOT NULL REFERENCES runs(id), profile_id TEXT NOT NULL, cwd TEXT NOT NULL,
  scenario TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','active','released','blocked')),
  attempt_id TEXT UNIQUE REFERENCES attempts(id), diagnostic TEXT
) STRICT;
CREATE TABLE reservations (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL CHECK(kind IN ('lead','reader','writer')), cwd TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX one_writer ON reservations(cwd) WHERE kind = 'writer';
CREATE UNIQUE INDEX one_lead ON reservations(run_id) WHERE kind = 'lead';
`;
const migration3 = `
CREATE TABLE worktrees (attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), path TEXT NOT NULL UNIQUE, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
`;
// A retried capture must map onto the attempt's existing candidate, never a second one.
const migration4 = `
CREATE UNIQUE INDEX one_candidate_per_attempt ON integration_candidates(attempt_id);
`;
const migration5 = `
CREATE UNIQUE INDEX one_review_per_attempt ON reviews(reviewer_attempt_id);
CREATE TRIGGER reviews_no_update BEFORE UPDATE ON reviews BEGIN SELECT RAISE(ABORT, 'Reviews are append-only'); END;
CREATE TRIGGER reviews_no_delete BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT, 'Reviews are append-only'); END;
`;
// Each preview owns one app-owned worktree; a task prepares at most one at a time.
const migration6 = `
CREATE TABLE integrations (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), candidate_id TEXT NOT NULL REFERENCES integration_candidates(id), path TEXT NOT NULL UNIQUE, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE UNIQUE INDEX one_preparing_integration ON integrations(task_id) WHERE json_extract(data,'$.status')='preparing';
`;
// Dispatches queued before context policies always ran fresh, so they keep it.
// Assignment validates the named session against the task's own lineage.
const migration7 = `
ALTER TABLE dispatches ADD COLUMN context_policy TEXT NOT NULL DEFAULT 'fresh' CHECK(context_policy IN ('auto','fresh','resume'));
ALTER TABLE dispatches ADD COLUMN resume_session_id TEXT;
`;
const migration8 = `
CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE INDEX workflow_runs_run ON workflow_runs(run_id);
`;
// A budget hold is an unlaunched intent, never a way to replay an attempt.
const migration9 = `
ALTER TABLE dispatches ADD COLUMN blocked_reason TEXT CHECK(blocked_reason IS NULL OR (blocked_reason='launch_budget' AND state='blocked' AND attempt_id IS NULL));
`;
// Prepared source bindings are immutable even if tasks later retry or cancel.
const migration10 = `
CREATE TABLE workflow_handoffs (task_id TEXT PRIMARY KEY REFERENCES tasks(id), workflow_id TEXT NOT NULL REFERENCES workflow_runs(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE INDEX workflow_handoffs_workflow ON workflow_handoffs(workflow_id);
CREATE TRIGGER workflow_handoffs_no_update BEFORE UPDATE ON workflow_handoffs BEGIN SELECT RAISE(ABORT, 'Workflow handoffs are immutable'); END;
CREATE TRIGGER workflow_handoffs_no_delete BEFORE DELETE ON workflow_handoffs BEGIN SELECT RAISE(ABORT, 'Workflow handoffs are immutable'); END;
`;
function migrateModes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateModes);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "mode" && item === "chat"
          ? "chat_plan"
          : key === "mode" && item === "autonomous"
            ? "autonomous_bounded"
            : migrateModes(item),
      ]),
    );
  return value;
}

export function openDatabase(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path);
  try {
    database.exec(
      "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    );
    database.exec("BEGIN IMMEDIATE");
    try {
      const version = database
        .prepare("PRAGMA user_version")
        .get()?.user_version;
      if (version === 0) {
        database.exec(migration1);
        database.exec("PRAGMA user_version=1");
      } else if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(Number(version))) {
        throw new DomainError("STORAGE", "Unsupported database schema version");
      }
      if (version === 0 || version === 1) {
        database.exec(migration2);
        for (const table of ["runs", "team_presets"])
          for (const row of database
            .prepare(`SELECT id, data FROM ${table}`)
            .all())
            database
              .prepare(`UPDATE ${table} SET data = ? WHERE id = ?`)
              .run(
                JSON.stringify(migrateModes(JSON.parse(String(row.data)))),
                String(row.id),
              );
        for (const row of database
          .prepare("SELECT key, result FROM mutations")
          .all())
          database
            .prepare("UPDATE mutations SET result = ? WHERE key = ?")
            .run(
              JSON.stringify(migrateModes(JSON.parse(String(row.result)))),
              String(row.key),
            );
        database.exec("PRAGMA user_version=2");
      }
      if (version === 0 || version === 1 || version === 2) {
        database.exec(migration3);
        database.exec("PRAGMA user_version=3");
      }
      if (Number(version) < 4) {
        database.exec(migration4);
        database.exec("PRAGMA user_version=4");
      }
      if (Number(version) < 5) {
        database.exec(migration5);
        database.exec("PRAGMA user_version=5");
      }
      if (Number(version) < 6) {
        database.exec(migration6);
        database.exec("PRAGMA user_version=6");
      }
      if (Number(version) < 7) {
        database.exec(migration7);
        database.exec("PRAGMA user_version=7");
      }
      if (Number(version) < 8) {
        database.exec(migration8);
        database.exec("PRAGMA user_version=8");
      }
      if (Number(version) < 9) {
        database.exec(migration9);
        database.exec("PRAGMA user_version=9");
      }
      if (Number(version) < 10) {
        database.exec(migration10);
        database.exec("PRAGMA user_version=10");
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
