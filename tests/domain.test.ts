import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentProfileSchema,
  roleTemplateSchema,
} from "../src/shared/domain/entities.ts";
import {
  assertSessionTransition,
  assertTaskTransition,
  processStateSchema,
  sessionTransitions,
  taskStatusSchema,
  taskTransitions,
} from "../src/shared/domain/states.ts";

const expectedTaskEdges: Record<string, string[]> = {
  BACKLOG: ["READY", "WAITING_HUMAN", "CANCELLED"],
  READY: ["QUEUED", "WAITING_HUMAN", "WAITING_DEPENDENCY", "CANCELLED"],
  QUEUED: [
    "RUNNING",
    "WAITING_HUMAN",
    "WAITING_DEPENDENCY",
    "INTERRUPTED",
    "FAILED",
    "CANCELLED",
  ],
  RUNNING: [
    "AWAITING_REVIEW",
    "WAITING_HUMAN",
    "WAITING_DEPENDENCY",
    "INTERRUPTED",
    "FAILED",
    "CANCELLED",
  ],
  AWAITING_REVIEW: ["READY_TO_INTEGRATE", "CHANGES_REQUESTED", "CANCELLED"],
  CHANGES_REQUESTED: ["READY", "AWAITING_REVIEW", "CANCELLED"],
  WAITING_HUMAN: ["READY", "RUNNING", "INTERRUPTED", "CANCELLED"],
  WAITING_DEPENDENCY: ["READY", "WAITING_HUMAN", "INTERRUPTED", "CANCELLED"],
  INTERRUPTED: ["RETRY_DECISION"],
  FAILED: ["RETRY_DECISION"],
  RETRY_DECISION: ["READY", "CANCELLED"],
  CANCELLED: [],
  READY_TO_INTEGRATE: [
    "AWAITING_REVIEW",
    "INTEGRATING",
    "BLOCKED_CONFLICT",
    "CANCELLED",
  ],
  INTEGRATING: ["DONE", "BLOCKED_CONFLICT", "INTERRUPTED", "FAILED"],
  BLOCKED_CONFLICT: ["AWAITING_REVIEW", "READY_TO_INTEGRATE", "CANCELLED"],
  DONE: [],
};
test("task transition matrix accepts only specified edges, including explicit retry decisions", () => {
  assert.deepEqual(taskTransitions, expectedTaskEdges);
  for (const from of taskStatusSchema.options)
    for (const to of taskStatusSchema.options) {
      if (expectedTaskEdges[from]?.includes(to))
        assert.doesNotThrow(() => assertTaskTransition(from, to));
      else
        assert.throws(() => assertTaskTransition(from, to), {
          code: "INVALID_TRANSITION",
        });
    }
});
test("process transition matrix permits permission waits and disconnects, with terminal exits", () => {
  const expected = {
    not_started: ["starting"],
    starting: ["busy", "idle", "disconnected", "crashed", "exited", "stopping"],
    busy: [
      "idle",
      "waiting_permission",
      "disconnected",
      "crashed",
      "exited",
      "stopping",
    ],
    idle: ["busy", "disconnected", "crashed", "exited", "stopping"],
    waiting_permission: [
      "busy",
      "idle",
      "disconnected",
      "crashed",
      "exited",
      "stopping",
    ],
    disconnected: ["starting", "stopping", "exited", "crashed"],
    stopping: ["exited", "crashed", "disconnected"],
    exited: [],
    crashed: [],
  };
  assert.deepEqual(sessionTransitions, expected);
  for (const from of processStateSchema.options)
    for (const to of processStateSchema.options) {
      const allowed: readonly string[] = expected[from];
      if (allowed.includes(to))
        assert.doesNotThrow(() => assertSessionTransition(from, to));
      else
        assert.throws(() => assertSessionTransition(from, to), {
          code: "INVALID_TRANSITION",
        });
    }
});
test("role guidance excludes harness configuration and profiles do not invent thinking enums", () => {
  const meta = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const role = {
    ...meta,
    version: 1,
    name: "Reader",
    instructions: "Read",
    expectedOutput: "Evidence",
  };
  assert.equal(
    roleTemplateSchema.safeParse({ ...role, model: "invented" }).success,
    false,
  );
  assert.equal(
    agentProfileSchema.parse({
      ...meta,
      name: "Ada",
      roleId: role.id,
      harness: "pi",
      model: "provider/model",
      thinking: "discovered-setting",
      permission: "read_only",
      instructionOverride: null,
    }).thinking,
    "discovered-setting",
  );
});
