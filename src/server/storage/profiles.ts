import { randomUUID } from "node:crypto";
import {
  agentProfileSchema,
  teamPresetSchema,
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

export class Profiles {
  private readonly store: Store;
  private readonly adapters: { pi: HarnessAdapter; codex: HarnessAdapter };
  readonly demoProfileIds = fakeTeamSnapshot.profiles.map(
    (profile) => profile.id,
  );

  constructor(
    store: Store,
    adapters: { pi: HarnessAdapter; codex: HarnessAdapter },
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
    const { id } = profileReferenceSchema.parse(input);
    const row = this.store.db
      .prepare("SELECT data FROM agent_profiles WHERE id=?")
      .get(id);
    if (!row) throw new DomainError("NOT_FOUND", "Agent profile not found");
    return agentProfileSchema.parse(JSON.parse(String(row.data)));
  }
  async discover(input: unknown): Promise<ProfileCapabilities> {
    const { harness } = profileDiscoverySchema.parse(input);
    if (harness !== "pi" && harness !== "codex")
      return profileCapabilitiesSchema.parse({
        harness,
        implemented: false,
        installed: "unknown",
        authenticated: "unknown",
        models: [],
        permissions: [],
        diagnostics: [
          "This app's adapter is not implemented yet (M8); CLI installation and login have not been checked.",
        ],
      });
    let capability: AdapterCapabilities;
    try {
      capability = capabilitiesSchema.parse(
        await this.adapters[harness].discover(),
      );
    } catch (error) {
      return profileCapabilitiesSchema.parse({
        harness,
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
    // These are the implemented adapters' enforced tool policies, not grants
    // inferred from model names or supplied by a browser/role prompt.
    return profileCapabilitiesSchema.parse({
      harness,
      implemented: true,
      installed: capability.installed,
      authenticated: capability.authenticated,
      models: usable ? capability.models : [],
      permissions: usable
        ? harness === "pi"
          ? ["read_only", "workspace_write"]
          : ["coordinator"]
        : [],
      diagnostics: [
        ...capability.diagnostics,
        harness === "pi"
          ? "Profiles support file-tool readers and writers only; Pi coordinator control is unavailable. Catalog discovery does not prove provider entitlement."
          : "Profiles support the read-only Codex coordinator only; Codex worker execution is not implemented yet.",
        ...(!usable
          ? [
              "Native adapter/gateway capability is unavailable; refresh discovery after fixing setup.",
            ]
          : []),
      ],
    });
  }
  private validate(content: ProfileContent, catalog: ProfileCapabilities) {
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
        for (const row of this.store.db
          .prepare("SELECT data FROM team_presets")
          .all()) {
          const team = teamPresetSchema.parse(JSON.parse(String(row.data)));
          if (
            team.leadProfileId === profile.id ||
            team.workerProfileIds.includes(profile.id)
          )
            throw new DomainError(
              "CONFLICT",
              "Profile is used by a saved team; remove its reference before deleting",
            );
        }
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
