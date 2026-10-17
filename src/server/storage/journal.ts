import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { eventSchema } from "../../shared/domain/entities.ts";
import {
  appendEventSchema,
  eventQuerySchema,
} from "../../shared/domain/inputs.ts";

export function appendEvent(db: DatabaseSync, input: unknown) {
  const event = appendEventSchema.parse(input);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(`INSERT INTO events
    (id, created_at, run_id, task_id, attempt_id, session_id, type, correlation_id, causation_id, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      createdAt,
      event.runId,
      event.taskId,
      event.attemptId,
      event.sessionId,
      event.type,
      event.correlationId,
      event.causationId,
      JSON.stringify(event.payload),
    );
  return eventSchema.parse({
    ...event,
    id,
    createdAt,
    sequence: Number(result.lastInsertRowid),
  });
}

export function queryEvents(db: DatabaseSync, input: unknown = {}) {
  const query = eventQuerySchema.parse(input);
  // Column names are fixed here; only validated IDs are bound as values.
  const filters: [string, string][] = [];
  if (query.runId) filters.push(["run_id", query.runId]);
  if (query.taskId) filters.push(["task_id", query.taskId]);
  const rows = db
    .prepare(
      `SELECT * FROM events WHERE sequence > ?${filters.map(([column]) => ` AND ${column} = ?`).join("")} ORDER BY sequence LIMIT ?`,
    )
    .all(query.after, ...filters.map(([, value]) => value), query.limit);
  return rows.map((row) =>
    eventSchema.parse({
      id: row.id,
      sequence: row.sequence,
      createdAt: row.created_at,
      runId: row.run_id,
      taskId: row.task_id,
      attemptId: row.attempt_id,
      sessionId: row.session_id,
      type: row.type,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      payload: JSON.parse(String(row.payload)),
    }),
  );
}
