import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPlanSchema } from "../src/shared/integration.ts";
import {
  api,
  approvedPreview,
  owner,
  ownerCommit,
  reviewed,
} from "./helpers/integration-fixture.ts";

const reader = "00000000-0000-4000-8000-000000000013";

test("an applied integration advances its own run's base, so a released dependent dispatches from the integrated result; an owner commit still halts dispatch", async () => {
  const f = await reviewed();
  try {
    const task = (title: string, dependencyIds: string[] = []) => {
      const created = f.store.createTask(
        {
          runId: f.run.id,
          title,
          objective: "Report the README",
          dependencyIds,
        },
        title,
      );
      f.engine.scheduling.enqueue(
        owner,
        { taskId: created.id, profileId: reader },
        `${title}:assign`,
      );
      return created;
    };
    const dependent = task("dependent", [f.original.id]);
    assert.equal(f.store.getTask(dependent.id).status, "WAITING_DEPENDENCY");
    const approved = await approvedPreview(f, "preview");
    const plan = applyPlanSchema.parse(
      (await api(f, `integrations/plan?integrationId=${approved.id}`)).value,
    );
    const applied = await api(f, "integrations/apply", {
      key: "apply",
      input: {
        integrationId: plan.integrationId,
        confirm: {
          method: plan.method,
          expectedSha: plan.expectedSha,
          resultSha: plan.resultSha,
          checkoutPath: plan.checkoutPath,
        },
      },
    });
    assert.equal(applied.status, 200);
    assert.equal(
      f.store.getRun(f.run.id).repository?.baseSha,
      f.candidate.candidateSha,
    );
    await f.engine.idle();
    assert.equal(f.store.getTask(dependent.id).status, "AWAITING_REVIEW");
    const [attempt] = f.store
      .listAttempts()
      .filter((a) => a.taskId === dependent.id);
    assert.equal(attempt?.baseSha, f.candidate.candidateSha);

    await ownerCommit(f.repo, "main", { "OWNER.md": "Owner change\n" });
    const later = task("after-owner-commit");
    for (let i = 0; i < 3; i++) await f.engine.pump();
    assert.equal(
      f.store.listAttempts().filter((a) => a.taskId === later.id).length,
      0,
    );
    assert.ok(
      f.store
        .events({ runId: f.run.id, limit: 500 })
        .some(
          (e) =>
            e.type === "dispatch.blocked" &&
            /HEAD changed/.test(String(e.payload.diagnostic)),
        ),
    );
    assert.equal(
      f.store.getRun(f.run.id).repository?.baseSha,
      f.candidate.candidateSha,
    );
  } finally {
    await f.app.close();
  }
});
