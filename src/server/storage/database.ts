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
      } else if (version !== 1 && version !== 2) {
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
