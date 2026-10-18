import { randomUUID } from "node:crypto";
import {
  agentProfileSchema,
  workflowTemplateSchema,
} from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { fakeTeamSnapshot } from "../../shared/presets.ts";
import {
  deleteProfileSchema,
  type ProfileCapabilities,
  type ProfileContent,
  profileCapabilitiesSchema,
  profileContentSchema,
  profileDiscoverySchema,
  profileReferenceSchema,
  updateProfileSchema,
} from "../../shared/profiles.ts";
import {
  type AdapterCapabilities,
  capabilitiesSchema,
  type HarnessAdapter,
} from "../adapters/contract.ts";
import { appendEvent } from "./journal.ts";
import { mutate } from "./mutations.ts";
import { getRole } from "./roles.ts";
import type { Store } from "./store.ts";
import { teamsUsingProfile } from "./teams.ts";

export function getProfile(store: Store, input: unknown) {
  const { id } = profileReferenceSchema.parse(input);
  const row = store.db
    .prepare("SELECT data FROM agent_profiles WHERE id=?")
    .get(id);
  if (!row) throw new DomainError("NOT_FOUND", "Agent profile not found");
  return agentProfileSchema.parse(JSON.parse(String(row.data)));
}

export class Profiles {
  private readonly store: Store;
  private readonly adapters: {
    pi: HarnessAdapter;
    codex: HarnessAdapter;
    "claude-code": HarnessAdapter;
    opencode: HarnessAdapter;
  };
  readonly demoProfileIds = fakeTeamSnapshot.profiles.map(
    (profile) => profile.id,
  );

  constructor(
    store: Store,
    adapters: {
      pi: HarnessAdapter;
      codex: HarnessAdapter;
      "claude-code": HarnessAdapter;
      opencode: HarnessAdapter;
    },
  ) {
    this.store = store;
    this.adapters = adapters;
  }
  list() {
    return this.store.db
      .prepare("SELECT data FROM agent_profiles ORDER BY rowid")
      .all()
      .map((row) => agentProfileSchema.parse(JSON.parse(String(row.data))));
  }
  get(input: unknown) {
    return getProfile(this.store, input);
  }
  async discover(input: unknown): Promise<ProfileCapabilities> {
    const { harness } = profileDiscoverySchema.parse(input);
    const adapter = this.adapters[harness];
    let capability: AdapterCapabilities;
    try {
      capability = capabilitiesSchema.parse(await adapter.discover());
    } catch (error) {
      return profileCapabilitiesSchema.parse({
        harness,
        state: "unknown",
        version: null,
        nextStep:
          "Check again. If discovery keeps failing, compare the installed version with the one recorded in docs/adapter-recon.md.",
        implemented: true,
        installed: "unknown",
        authenticated: "unknown",
        models: [],
        permissions: [],
        diagnostics: [
          `Discovery failed (${error instanceof DomainError ? error.code : "UNEXPECTED_ERROR"}); check the app-owned harness installation/login and retry. No native settings were validated.`,
        ],
      });
    }
    const usable =
      capability.adapter === harness &&
      capability.installed &&
      capability.supportsToolGateway;
    // Available only when validate() can accept some selection. Unknown
    // authentication still is not entitlement.
    const state = !capability.installed
      ? "missing"
      : capability.authenticated === false
        ? "auth_required"
        : usable && capability.models.length
          ? "available"
          : "installed";
    // These are the implemented adapters' enforced tool policies, not grants
    // inferred from model names or supplied by a browser/role prompt.
    return profileCapabilitiesSchema.parse({
      harness,
      state,
      version: capability.version,
      nextStep:
        capability.nextStep ??
        (state === "installed"
          ? "No usable model or tool gateway was discovered; check the diagnostics, then check again."
          : null),
      implemented: true,
      installed: capability.installed,
      authenticated: capability.authenticated,
      models: usable ? capability.models : [],
      permissions: usable
        ? harness === "codex"
          ? ["coordinator"]
          : ["read_only", "workspace_write"]
        : [],
      diagnostics: [
        ...capability.diagnostics,
        harness === "codex"
          ? "Profiles support the read-only Codex coordinator only; Codex worker execution is not implemented yet."
          : `${harness} profiles support file-tool readers and writers, not coordinator control. Catalog discovery does not prove provider entitlement.`,
      ],
    });
  }
  validate(content: ProfileContent, catalog: ProfileCapabilities) {
    getRole(this.store, { id: content.roleId });
    const model = catalog.models.find((item) => item.id === content.model);
    if (
      catalog.harness !== content.harness ||
      !catalog.implemented ||
      catalog.installed !== true ||
      catalog.authenticated === false ||
      !catalog.permissions.includes(content.permission) ||
      !model ||
      (content.thinking !== null &&
        !model.thinking.some((level) => level.id === content.thinking))
    )
      throw new DomainError(
        "UNSUPPORTED",
        "Harness, model, reasoning or permission is unavailable; refresh profile discovery and check its setup diagnostics",
      );
  }
  private assertEditable(id: string) {
    // Fixed playback identities must never be presented as a native profile
    // validated by discovery, or recreated over an owner's edited/deleted row.
    if (this.demoProfileIds.includes(id))
      throw new DomainError(
        "POLICY_DENIED",
        "FAKE demo profiles are fixed playback configuration; create a named native profile instead",
      );
  }
  async create(input: unknown, key: string) {
    const data = profileContentSchema.parse(input);
    const catalog = await this.discover({ harness: data.harness });
    return mutate(
      this.store.db,
      key,
      "createProfile",
      data,
      agentProfileSchema,
      () => {
        // Validate inside the transaction, after idempotent replay and before any
        // row/event write. A role deleted during discovery cannot be referenced.
        this.validate(data, catalog);
        const now = new Date().toISOString();
        const profile = agentProfileSchema.parse({
          ...data,
          id: randomUUID(),
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        this.store.db
          .prepare("INSERT INTO agent_profiles(id,role_id,data) VALUES (?,?,?)")
          .run(profile.id, profile.roleId, JSON.stringify(profile));
        appendEvent(this.store.db, {
          type: "profile.created",
          correlationId: key,
          payload: { profileId: profile.id, version: profile.version },
        });
        return profile;
      },
    );
  }
  async update(input: unknown, key: string) {
    const data = updateProfileSchema.parse(input);
    const catalog = await this.discover({ harness: data.harness });
    return mutate(
      this.store.db,
      key,
      "updateProfile",
      data,
      agentProfileSchema,
      () => {
        const previous = this.get({ id: data.id });
        this.assertEditable(previous.id);
        if (previous.version !== data.version)
          throw new DomainError(
            "CONFLICT",
            "Profile changed; reload it before saving",
          );
        this.validate(data, catalog);
        // A saved team's Lead must stay its coordinator and a worker must
        // never gain Lead tools; the team is edited first.
        if (
          previous.permission !== data.permission &&
          [previous.permission, data.permission].includes("coordinator") &&
          teamsUsingProfile(this.store, previous.id).length
        )
          throw new DomainError(
            "CONFLICT",
            "Profile is used by a saved team; keep its Lead or worker permission, or edit the team first",
          );
        const profile = agentProfileSchema.parse({
          ...previous,
          ...data,
          version: previous.version + 1,
          updatedAt: new Date().toISOString(),
        });
        // Existing run snapshots own their configuration; only the library row changes.
        this.store.db
          .prepare("UPDATE agent_profiles SET role_id=?,data=? WHERE id=?")
          .run(profile.roleId, JSON.stringify(profile), profile.id);
        appendEvent(this.store.db, {
          type: "profile.updated",
          correlationId: key,
          payload: { profileId: profile.id, version: profile.version },
        });
        return profile;
      },
    );
  }
  delete(input: unknown, key: string) {
    const data = deleteProfileSchema.parse(input);
    return mutate(
      this.store.db,
      key,
      "deleteProfile",
      data,
      profileReferenceSchema,
      () => {
        const profile = this.get({ id: data.id });
        this.assertEditable(profile.id);
        if (profile.version !== data.version)
          throw new DomainError(
            "CONFLICT",
            "Profile changed; reload it before deleting",
          );
        if (teamsUsingProfile(this.store, profile.id).length)
          throw new DomainError(
            "CONFLICT",
            "Profile is used by a saved team; remove its reference before deleting",
          );
        for (const row of this.store.db
          .prepare("SELECT data FROM workflow_templates")
          .all()) {
          const workflow = workflowTemplateSchema.parse(
            JSON.parse(String(row.data)),
          );
          if (workflow.stages.some((stage) => stage.profileId === profile.id))
            throw new DomainError(
              "CONFLICT",
              "Profile is used by a saved workflow; remove its reference before deleting",
            );
        }
        this.store.db
          .prepare("DELETE FROM agent_profiles WHERE id=?")
          .run(profile.id);
        appendEvent(this.store.db, {
          type: "profile.deleted",
          correlationId: key,
          payload: { profileId: profile.id, version: profile.version },
        });
        return { id: profile.id };
      },
    );
  }
}
