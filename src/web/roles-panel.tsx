import { useEffect, useState } from "react";
import {
  type RoleTemplate,
  roleTemplateSchema,
} from "../shared/domain/entities.ts";
import { roleExportSchema, rolesResponseSchema } from "../shared/roles.ts";
import { readApi, writeApi } from "./api.ts";

function RoleEditor({
  role,
  busy,
  save,
  remove,
}: {
  role: RoleTemplate | undefined;
  busy: boolean;
  save: (content: {
    name: string;
    instructions: string;
    expectedOutput: string;
  }) => void;
  remove: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [instructions, setInstructions] = useState(role?.instructions ?? "");
  const [expectedOutput, setExpectedOutput] = useState(
    role?.expectedOutput ?? "",
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({ name, instructions, expectedOutput });
      }}
    >
      <fieldset disabled={busy} className="role-fields">
        <legend>
          {role ? `Edit role · version ${role.version}` : "New role"}
        </legend>
        <label>
          Role name
          <input
            required
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Role instructions
          <textarea
            required
            rows={5}
            maxLength={12_000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <label>
          Expected output
          <textarea
            required
            rows={3}
            maxLength={8_000}
            value={expectedOutput}
            onChange={(e) => setExpectedOutput(e.target.value)}
          />
        </label>
        <div className="actions">
          <button type="submit">{role ? "Save role" : "Create role"}</button>
          {role && (
            <button type="button" className="danger" onClick={remove}>
              Delete role
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export function RolesPanel() {
  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importText, setImportText] = useState("");
  const role = roles.find((item) => item.id === selected);

  useEffect(() => {
    const controller = new AbortController();
    void readApi("role-templates", controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setRoles(rolesResponseSchema.parse(value).roles);
        setLoaded(true);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "Cannot load roles",
          );
      });
    return () => controller.abort();
  }, []);

  async function act(change: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await change();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Role action failed",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setRoles(rolesResponseSchema.parse(await readApi("role-templates")).roles);
    setLoaded(true);
  }
  return (
    <section aria-label="Role templates">
      <details>
        <summary>Role templates</summary>
        <p className="note">
          Save reusable guidance and an expected output shape. Harness, model,
          reasoning and permissions belong to profiles. Saved runs keep their
          original role snapshots.
        </p>
        <p className="note">
          Editing a built-in role affects future runs. Choose custom roles in
          Agent profiles; reload profiles and roles after creating a role. Roles
          used by saved profiles cannot be deleted.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="actions">
          <label>
            Saved role
            <select
              disabled={busy || !loaded}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setNotice("");
              }}
            >
              <option value="">New role</option>
              {roles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · v{item.version}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(reload)}
          >
            Reload roles
          </button>
          <button
            type="button"
            disabled={busy || !role}
            onClick={() =>
              void act(async () => {
                if (!role) return;
                const value = roleExportSchema.parse(
                  await readApi(`role-templates/export?id=${role.id}`),
                );
                const url = URL.createObjectURL(
                  new Blob([`${JSON.stringify(value, null, 2)}\n`], {
                    type: "application/json",
                  }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `role-${role.id}.json`;
                link.click();
                URL.revokeObjectURL(url);
                setNotice("Role exported as JSON.");
              })
            }
          >
            Export role
          </button>
        </div>
        {loaded && (
          <RoleEditor
            key={`${role?.id ?? "new"}:${role?.version ?? 0}`}
            role={role}
            busy={busy}
            save={(content) =>
              void act(async () => {
                const saved = roleTemplateSchema.parse(
                  await writeApi(
                    "role-templates",
                    role
                      ? { ...content, id: role.id, version: role.version }
                      : content,
                    role ? "PATCH" : "POST",
                  ),
                );
                await reload();
                setSelected(saved.id);
                setNotice(
                  "Role saved. Existing runs keep their original guidance.",
                );
              })
            }
            remove={() =>
              void act(async () => {
                if (!role) return;
                await writeApi(
                  "role-templates",
                  { id: role.id, version: role.version },
                  "DELETE",
                );
                await reload();
                setSelected("");
                setNotice("Role deleted.");
              })
            }
          />
        )}
        <details>
          <summary>Import role JSON</summary>
          <p className="note">
            Import creates a new local copy, including when its name already
            exists. Use a JSON file exported from this app, up to 128 KiB.
          </p>
          <label>
            Role JSON file
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void act(async () => {
                    if (file.size > 131_072)
                      throw new Error("Role file exceeds 128 KiB");
                    setImportText(await file.text());
                  });
              }}
            />
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                if (new TextEncoder().encode(importText).length > 131_072)
                  throw new Error("Role JSON exceeds 128 KiB");
                let input: unknown;
                try {
                  input = JSON.parse(importText);
                } catch {
                  throw new Error("Role JSON is not valid JSON");
                }
                if (!roleExportSchema.safeParse(input).success)
                  throw new Error(
                    "Expected a version 1 role export with name, instructions and expectedOutput only",
                  );
                const saved = roleTemplateSchema.parse(
                  await writeApi("role-templates/import", input),
                );
                await reload();
                setSelected(saved.id);
                setImportText("");
                setNotice("Role imported as a new local copy.");
              });
            }}
          >
            <label>
              Role JSON
              <textarea
                required
                rows={5}
                value={importText}
                disabled={busy}
                onChange={(e) => setImportText(e.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || !importText.trim()}>
              Import as new role
            </button>
          </form>
        </details>
      </details>
    </section>
  );
}
