import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import { mutationKeySchema } from "../../shared/domain/inputs.ts";
import { DomainError } from "../../shared/domain/states.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function mutate<T>(
  db: DatabaseSync,
  keyInput: string,
  operation: string,
  input: unknown,
  schema: z.ZodType<T>,
  change: () => T,
): T {
  const key = mutationKeySchema.parse(keyInput);
  const fingerprint = createHash("sha256")
    .update(canonical(input))
    .digest("hex");
  // Command transactions compose existing domain mutations using savepoints.
  // The outer commit alone makes state, reservations, events and keys durable.
  const savepoint = db.isTransaction
    ? `nested_${randomUUID().replaceAll("-", "")}`
    : null;
  db.exec(savepoint ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  const commit = () => db.exec(savepoint ? `RELEASE ${savepoint}` : "COMMIT");
  try {
    const previous = db
      .prepare("SELECT * FROM mutations WHERE key = ?")
      .get(key);
    if (previous) {
      if (
        previous.operation !== operation ||
        previous.fingerprint !== fingerprint
      )
        throw new DomainError(
          "CONFLICT",
          "Idempotency key reused with different input",
        );
      const result = schema.parse(JSON.parse(String(previous.result)));
      commit();
      return result;
    }
    const result = schema.parse(change());
    // A scheduler with no available slot made no mutation and must try later.
    if (result === null) {
      commit();
      return result;
    }
    db.prepare(
      "INSERT INTO mutations(key, operation, fingerprint, result) VALUES (?, ?, ?, ?)",
    ).run(key, operation, fingerprint, JSON.stringify(result));
    commit();
    return result;
  } catch (error) {
    if (savepoint) db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    else db.exec("ROLLBACK");
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_SQLITE_ERROR"
    ) {
      throw new DomainError(
        "STORAGE",
        `SQLite mutation rejected: ${error.message}`,
      );
    }
    throw error;
  }
}
