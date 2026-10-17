import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHumanRequestTransition,
  humanRequestStatusSchema,
} from "../src/shared/domain/states.ts";
import { humanRequestActions } from "../src/web/human-request-actions.ts";

test("the inbox exposes only owner actions allowed by the request's current status", () => {
  const expected = {
    open: ["answered", "completed", "declined", "deferred"],
    deferred: ["answered", "completed", "declined"],
    answered: [],
    completed: [],
    declined: [],
  };
  for (const status of humanRequestStatusSchema.options) {
    const actions = humanRequestActions(status);
    assert.deepEqual(
      actions.map((action) => action.status),
      expected[status],
    );
    for (const action of actions)
      assert.doesNotThrow(() =>
        assertHumanRequestTransition(status, action.status),
      );
  }
});
