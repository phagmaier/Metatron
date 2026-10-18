import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { humanRequestSchema } from "../src/shared/domain/entities.ts";
import { opencodeEngineFixture } from "./helpers/opencode-engine-fixture.ts";

test("OpenCode owner consent is durable and isolated; unrelated work continues and normal foreground exit 130 is not a failed task", async () => {
  const f = await opencodeEngineFixture();
  try {
    const writer = await f.run("workspace_write");
    const request = await f.request(writer.id);
    assert.equal(request.nativeApproval?.adapter, "opencode");
    assert.ok(request.sessionId);
    const session = f.store.getSession(request.sessionId);
    const attempt = f.store.getAttempt(session.attemptId);
    await assert.rejects(access(join(attempt.cwd, "approved.txt")), {
      code: "ENOENT",
    });
    const reader = await f.run("read_only");
    for (
      let count = 0;
      count < 1000 &&
      f.store.listTasks(reader.id)[0]?.status !== "AWAITING_REVIEW";
      count++
    ) {
      await f.engine.pump();
      await delay(10);
    }
    assert.equal(f.store.listTasks(reader.id)[0]?.status, "AWAITING_REVIEW");
    assert.equal(f.store.getTask(attempt.taskId).status, "WAITING_HUMAN");
    assert.equal(
      (
        await f.send(
          "native-approvals",
          { id: request.id, decision: "approve" },
          "foreign",
          { Origin: "https://attacker.invalid" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.send(
          "native-approvals",
          { id: request.id, decision: "approve" },
          "missing-token",
          { "X-Local-Token": "" },
        )
      ).status,
      403,
    );
    await assert.rejects(access(join(attempt.cwd, "approved.txt")), {
      code: "ENOENT",
    });
    const response = await f.send(
      "native-approvals",
      { id: request.id, decision: "approve" },
      "approve-once",
    );
    assert.equal(response.status, 200, await response.clone().text());
    const receipt = humanRequestSchema.parse(await response.json());
    assert.equal(receipt.nativeApproval?.state, "accepted");
    assert.equal(receipt.nativeApproval?.decision, "approve");
    await f.engine.idle();
    assert.equal(
      await readFile(join(attempt.cwd, "approved.txt"), "utf8"),
      "approved\n",
    );
    assert.equal(f.store.getTask(attempt.taskId).status, "AWAITING_REVIEW");
    assert.notEqual(attempt.cwd, f.repo.directory);
    await assert.rejects(access(join(f.repo.directory, "approved.txt")), {
      code: "ENOENT",
    });
    const exit = f.store
      .events()
      .find(
        (event) =>
          event.type === "opencode.process_exit" &&
          event.attemptId === attempt.id,
      );
    assert.ok(
      exit &&
        typeof exit.payload === "object" &&
        exit.payload !== null &&
        "exitCode" in exit.payload,
    );
    assert.equal(exit.payload.exitCode, 130);
    const attempts = f.store.listAttempts().map((attempt) => attempt.id);
    await f.restart();
    await f.engine.idle();
    assert.deepEqual(
      f.store.getHumanRequest(request.id).nativeApproval,
      receipt.nativeApproval,
    );
    assert.deepEqual(
      f.store.listAttempts().map((attempt) => attempt.id),
      attempts,
    );
    assert.equal(
      (
        await f.send("native-approvals", {
          id: request.id,
          decision: "approve",
        })
      ).status,
      409,
    );
  } finally {
    await f.close();
  }
});

test("OpenCode restart expires pending consent and never replays a mutating native attempt", async () => {
  const f = await opencodeEngineFixture();
  try {
    const run = await f.run("workspace_write");
    const request = await f.request(run.id);
    assert.ok(request.sessionId);
    const attempt = f.store.getAttempt(
      f.store.getSession(request.sessionId).attemptId,
    );
    const attempts = f.store.listAttempts().map((attempt) => attempt.id);
    await f.restart();
    await f.engine.pump();
    assert.equal(
      f.store.getHumanRequest(request.id).nativeApproval?.state,
      "expired",
    );
    assert.equal(
      (
        await f.send("native-approvals", {
          id: request.id,
          decision: "approve",
        })
      ).status,
      409,
    );
    assert.deepEqual(
      f.store.listAttempts().map((attempt) => attempt.id),
      attempts,
    );
    await assert.rejects(access(join(attempt.cwd, "approved.txt")), {
      code: "ENOENT",
    });
    await assert.rejects(access(join(f.repo.directory, "approved.txt")), {
      code: "ENOENT",
    });
  } finally {
    await f.close();
  }
});
