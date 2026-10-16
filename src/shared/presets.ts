import { defaultLimits, teamSnapshotSchema } from "./domain/entities.ts";

const identity = (number: number) => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
});
const definitions = [
  {
    name: "Lead",
    permission: "coordinator",
    instructions:
      "Propose scoped tasks and choose from saved workers. Respect mode, owner overrides, and resource limits.",
  },
  {
    name: "Backend Engineer",
    permission: "workspace_write",
    instructions:
      "Implement the scoped objective, verify acceptance criteria and report evidence. Never integrate into the owner's branch.",
  },
  {
    name: "Reviewer",
    permission: "read_only",
    instructions:
      "Independently inspect evidence and context. Return actionable findings with file references.",
  },
  {
    name: "Reader",
    permission: "read_only",
    instructions:
      "Read the scoped repository context and return a concise evidence-bearing report.",
  },
  {
    name: "Synthesizer",
    permission: "read_only",
    instructions:
      "Combine supplied reports, cite evidence, and state gaps explicitly.",
  },
] as const;

// Harness/model fields describe saved configuration. M2 executes only FakeAdapter
// and labels it as such; no native availability is inferred from these presets.
export const fakeTeamSnapshot = teamSnapshotSchema.parse({
  preset: {
    ...identity(100),
    version: 1,
    name: "Fake demo team",
    leadProfileId: identity(10).id,
    workerProfileIds: [11, 12, 13, 14].map((id) => identity(id).id),
    workflowTemplateIds: [],
    mode: "autonomous_bounded",
    limits: defaultLimits,
  },
  roles: definitions.map((role, index) => ({
    ...identity(index + 1),
    version: 1,
    name: role.name,
    instructions: role.instructions,
    expectedOutput:
      "Concise structured report with outcome, evidence and limitations.",
  })),
  profiles: definitions.map((role, index) => ({
    ...identity(index + 10),
    name: `Fake ${role.name}`,
    roleId: identity(index + 1).id,
    harness: "pi",
    model: "fake-deterministic",
    thinking: null,
    permission: role.permission,
    instructionOverride: null,
  })),
  workflows: [],
});
