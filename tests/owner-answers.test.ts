import assert from "node:assert/strict";
import { test } from "node:test";
import { requestRevision } from "../src/server/orchestration/revision.ts";
import { artifactText, owner } from "./helpers/integration-fixture.ts";
import { reviewFixture } from "./helpers/review-fixture.ts";

test("the owner's answer to an implementation's request reaches its independent review and its revision, never the implementer's report", async () => {
  const f = await reviewFixture("review-findings");
  try {
    const request = f.store.createHumanRequest(
      {
        runId: f.run.id,
        affectedTaskIds: [f.original.id],
        type: "environment",
        reason: "Need the SHIPPING_SURCHARGE_CENTS value",
        suggestedAction: "Provide the value",
        blocking: false,
      },
      "ask",
    );
    f.store.updateHumanRequest(
      {
        id: request.id,
        expectedStatus: "open",
        status: "answered",
        ownerResponse: "SHIPPING_SURCHARGE_CENTS is 250",
      },
      "answer",
    );
    const packet = (type: string) => {
      const event = f.store
        .events({ runId: f.run.id, limit: 500 })
        .findLast((e) => e.type === type);
      return artifactText(f.store, String(event?.payload.artifactId));
    };
    f.request();
    await f.engine.idle();
    const review = await packet("review.packet");
    assert.match(review, /owner answered "SHIPPING_SURCHARGE_CENTS is 250"/);
    assert.doesNotMatch(review, /Protocol fixture structured summary/);
    requestRevision(
      f.engine,
      owner,
      { taskId: f.original.id, feedback: "Address the review" },
      "revise",
    );
    await f.engine.idle();
    assert.match(
      await packet("revision.packet"),
      /owner answered "SHIPPING_SURCHARGE_CENTS is 250"/,
    );
  } finally {
    await f.app.close();
  }
});
