import { useCallback, useEffect, useState } from "react";
import {
  type AgentProfile,
  agentProfileSchema,
  harnessSchema,
  permissionSchema,
  type RoleTemplate,
} from "../shared/domain/entities.ts";
import {
  type ProfileCapabilities,
  type ProfileContent,
  profileCapabilitiesSchema,
  profilesResponseSchema,
} from "../shared/profiles.ts";
import { rolesResponseSchema } from "../shared/roles.ts";
import { readApi, writeApi } from "./api.ts";

function ProfileEditor({
  profile,
  roles,
  demo,
  busy,
  act,
  save,
  remove,
}: {
  profile: AgentProfile | undefined;
  roles: RoleTemplate[];
  demo: boolean;
  busy: boolean;
  act: (action: () => Promise<void>) => void;
  save: (content: ProfileContent) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [roleId, setRoleId] = useState(profile?.roleId ?? roles[0]?.id ?? "");
  const [harness, setHarness] = useState(profile?.harness ?? "pi");
  const [model, setModel] = useState(profile?.model ?? "");
  const [thinking, setThinking] = useState(profile?.thinking ?? "");
  const [permission, setPermission] = useState(profile?.permission ?? "");
  const [instructions, setInstructions] = useState(
    profile?.instructionOverride ?? "",
  );
  const [catalog, setCatalog] = useState<ProfileCapabilities>();
  const selectedModel = catalog?.models.find((item) => item.id === model);
  const available =
    catalog?.installed === true &&
    catalog.authenticated !== false &&
    selectedModel &&
    (!thinking ||
      selectedModel.thinking.some((item) => item.id === thinking)) &&
    catalog.permissions.some((item) => item === permission);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        act(() =>
          save({
            name,
            roleId,
            harness,
            model,
            thinking: thinking || null,
            permission: permissionSchema.parse(permission),
            instructionOverride: instructions.trim() || null,
          }),
        );
      }}
    >
      <fieldset disabled={busy || demo} className="role-fields">
        <legend>
          {profile
            ? `Edit profile · version ${profile.version}`
            : "New profile"}
        </legend>
        <div className="form-row">
          <label>
            Profile name
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Profile role
            <select
              required
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
            >
              <option value="" disabled>
                Choose a saved role
              </option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} · v{role.version}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Profile harness
          <select
            value={harness}
            onChange={(event) => {
              setHarness(harnessSchema.parse(event.target.value));
              setCatalog(undefined);
              setModel("");
              setThinking("");
              setPermission("");
            }}
          >
            {harnessSchema.options.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() =>
            act(async () => {
              setCatalog(undefined);
              const next = profileCapabilitiesSchema.parse(
                await readApi(`agent-profiles/discover?harness=${harness}`),
              );
              setCatalog(next);
              if (!model) setModel(next.models[0]?.id ?? "");
              if (!permission) setPermission(next.permissions[0] ?? "");
            })
          }
        >
          Discover profile settings
        </button>
        {catalog && (
          <>
            <p className="note">
              Adapter {catalog.implemented ? "implemented" : "unavailable"} ·
              installed {String(catalog.installed)} · authenticated{" "}
              {String(catalog.authenticated)}
            </p>
            {catalog.diagnostics.map((message) => (
              <p className="note" key={message}>
                {message}
              </p>
            ))}
          </>
        )}
        <div className="form-row">
          <label>
            Profile model
            <select
              required
              disabled={!catalog}
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setThinking("");
              }}
            >
              <option value="" disabled>
                Discover and choose a model
              </option>
              {model && !selectedModel && (
                <option value={model} disabled>
                  {model} · not in discovery
                </option>
              )}
              {catalog?.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Profile reasoning
            <select
              disabled={!selectedModel}
              value={thinking}
              onChange={(event) => setThinking(event.target.value)}
            >
              <option value="">Harness default (no explicit setting)</option>
              {thinking &&
                !selectedModel?.thinking.some(
                  (item) => item.id === thinking,
                ) && (
                  <option value={thinking} disabled>
                    {thinking} · not in discovery
                  </option>
                )}
              {selectedModel?.thinking.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Profile permission
            <select
              required
              disabled={!catalog}
              value={permission}
              onChange={(event) => setPermission(event.target.value)}
            >
              <option value="" disabled>
                Choose a supported permission
              </option>
              {permission &&
                !catalog?.permissions.some((item) => item === permission) && (
                  <option value={permission} disabled>
                    {permission} · not in discovery
                  </option>
                )}
              {catalog?.permissions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Additional profile instructions (optional)
          <textarea
            rows={3}
            maxLength={4000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </label>
        {!demo && (
          <p className="note">
            {!catalog
              ? "Discover settings before saving."
              : !available
                ? "Selection unavailable. Check discovery diagnostics and choose supported settings."
                : "Settings are checked again by the server when you save."}
          </p>
        )}
        <div className="actions">
          <button type="submit" disabled={!available || !roleId}>
            {profile ? "Save profile" : "Create profile"}
          </button>
          {profile && (
            <button
              type="button"
              className="danger"
              onClick={() => act(remove)}
            >
              Delete profile
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export function ProfilesPanel() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const [demoIds, setDemoIds] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const profile = profiles.find((item) => item.id === selected);
  const demo = !!profile && demoIds.includes(profile.id);

  const accept = useCallback((profilesValue: unknown, rolesValue: unknown) => {
    const data = profilesResponseSchema.parse(profilesValue);
    const nextRoles = rolesResponseSchema.parse(rolesValue).roles;
    setProfiles(data.profiles);
    setDemoIds(data.demoProfileIds);
    setRoles(nextRoles);
    setLoaded(true);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      readApi("agent-profiles", controller.signal),
      readApi("role-templates", controller.signal),
    ])
      .then(([profileData, roleData]) => {
        if (!controller.signal.aborted) accept(profileData, roleData);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : "Cannot load profiles",
          );
      });
    return () => controller.abort();
  }, [accept]);
  async function reload() {
    const [profileData, roleData] = await Promise.all([
      readApi("agent-profiles"),
      readApi("role-templates"),
    ]);
    accept(profileData, roleData);
  }
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Profile action failed",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Agent profiles">
      <details>
        <summary>Agent profiles</summary>
        <p className="note">
          Save a named role, harness, model, reasoning and permission
          configuration. Discovery queries the app-owned harness without a model
          turn. A saved profile is configuration, not a conversation.
        </p>
        <p className="note">
          Add saved profiles to a roster under Team presets. Existing runs keep
          their original snapshots. FAKE demo profiles remain fixed playback
          configuration.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="actions">
          <label>
            Saved profile
            <select
              disabled={busy || !loaded}
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                setNotice("");
                setError("");
              }}
            >
              <option value="">New profile</option>
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · v{item.version}
                  {demoIds.includes(item.id) ? " · FAKE demo (fixed)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(reload)}
          >
            Reload profiles and roles
          </button>
        </div>
        {demo && (
          <p className="note">
            FAKE demo only: these model and harness fields do not establish
            native availability. Choose New profile to save a discovered native
            configuration.
          </p>
        )}
        {loaded && (
          <ProfileEditor
            key={`${profile?.id ?? "new"}:${profile?.version ?? 0}`}
            profile={profile}
            roles={roles}
            demo={demo}
            busy={busy}
            act={(action) => void act(action)}
            save={async (content) => {
              const saved = agentProfileSchema.parse(
                await writeApi(
                  "agent-profiles",
                  profile
                    ? { ...content, id: profile.id, version: profile.version }
                    : content,
                  profile ? "PATCH" : "POST",
                ),
              );
              await reload();
              setSelected(saved.id);
              setNotice(
                "Profile saved. Existing runs keep their original configuration.",
              );
            }}
            remove={async () => {
              if (!profile) return;
              await writeApi(
                "agent-profiles",
                { id: profile.id, version: profile.version },
                "DELETE",
              );
              await reload();
              setSelected("");
              setNotice("Profile deleted.");
            }}
          />
        )}
      </details>
    </section>
  );
}
