import { randomUUID } from "node:crypto";
import { z } from "zod";
import { roleTemplateSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import {
  deleteRoleSchema,
  roleContentSchema,
  roleExportSchema,
  roleReferenceSchema,
  updateRoleSchema,
} from "../../shared/roles.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
import type { Store } from "./store.ts";

export function listRoles(store: Store) {
  return store.db
    .prepare("SELECT data FROM role_templates ORDER BY rowid")
    .all()
    .map((row) => roleTemplateSchema.parse(JSON.parse(String(row.data))));
}

export function getRole(store: Store, input: unknown) {
  const { id } = roleReferenceSchema.parse(input);
  const row = store.db
    .prepare("SELECT data FROM role_templates WHERE id=?")
    .get(id);
  if (!row) throw new DomainError("NOT_FOUND", "Role template not found");
  return roleTemplateSchema.parse(JSON.parse(String(row.data)));
}

function insertRole(store: Store, input: unknown, key: string) {
  const content = roleContentSchema.parse(input);
  const now = new Date().toISOString();
  const role = roleTemplateSchema.parse({
    ...content,
    id: randomUUID(),
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  store.db
    .prepare("INSERT INTO role_templates(id,data) VALUES (?,?)")
    .run(role.id, JSON.stringify(role));
  appendEvent(store.db, {
    type: "role.created",
    correlationId: key,
    payload: { roleId: role.id, version: role.version },
  });
  return role;
}

export function createRole(store: Store, input: unknown, key: string) {
  const data = roleContentSchema.parse(input);
  return mutate(store.db, key, "createRole", data, roleTemplateSchema, () =>
    insertRole(store, data, key),
  );
}

export function updateRole(store: Store, input: unknown, key: string) {
  const data = updateRoleSchema.parse(input);
  return mutate(store.db, key, "updateRole", data, roleTemplateSchema, () => {
    const previous = getRole(store, { id: data.id });
    if (previous.version !== data.version)
      throw new DomainError(
        "CONFLICT",
        "Role changed; reload it before saving",
      );
    const role = roleTemplateSchema.parse({
      ...previous,
      ...data,
      version: previous.version + 1,
      updatedAt: new Date().toISOString(),
    });
    // Only the library row changes. Historical and active run snapshots stay fixed.
    store.db
      .prepare("UPDATE role_templates SET data=? WHERE id=?")
      .run(JSON.stringify(role), role.id);
    appendEvent(store.db, {
      type: "role.updated",
      correlationId: key,
      payload: { roleId: role.id, version: role.version },
    });
    return role;
  });
}

export function deleteRole(store: Store, input: unknown, key: string) {
  const data = deleteRoleSchema.parse(input);
  return mutate(
    store.db,
    key,
    "deleteRole",
    data,
    z.strictObject({ id: deleteRoleSchema.shape.id }),
    () => {
      const role = getRole(store, { id: data.id });
      if (role.version !== data.version)
        throw new DomainError(
          "CONFLICT",
          "Role changed; reload it before deleting",
        );
      if (
        store.db
          .prepare("SELECT id FROM agent_profiles WHERE role_id=? LIMIT 1")
          .get(role.id)
      )
        throw new DomainError(
          "CONFLICT",
          "Role is used by a saved profile; change its role before deleting",
        );
      store.db.prepare("DELETE FROM role_templates WHERE id=?").run(role.id);
      appendEvent(store.db, {
        type: "role.deleted",
        correlationId: key,
        payload: { roleId: role.id, version: role.version },
      });
      return { id: role.id };
    },
  );
}

export function exportRole(store: Store, input: unknown) {
  const { name, instructions, expectedOutput } = getRole(store, input);
  return roleExportSchema.parse({
    format: "local-agent-orchestrator.role-template",
    formatVersion: 1,
    role: { name, instructions, expectedOutput },
  });
}

export function importRole(store: Store, input: unknown, key: string) {
  const data = roleExportSchema.parse(input);
  return mutate(store.db, key, "importRole", data, roleTemplateSchema, () =>
    insertRole(store, data.role, key),
  );
}
