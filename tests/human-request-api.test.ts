import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { startApp } from "../src/server/app.ts";
import { humanRequestsResponseSchema } from "../src/shared/api.ts";
import { humanRequestSchema } from "../src/shared/domain/entities.ts";
import { writeApi } from "../src/web/api.ts";
import { humanRequestActions } from "../src/web/human-request-actions.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";

test("owner HTTP requests validate authority and transitions, persist deferred blockers across restart, and never auto-resume on reply", async () => {
  const f = await domainFixture();
  const options = {
    development: false,
    port: 0,
    databasePath: join(f.directory, "state.sqlite"),
  };
  let app = await startApp(options);
  const sessionToken = async () =>
    z
      .object({ token: z.string() })
      .parse(await (await fetch(`${app.origin}/api/local-session`)).json())
      .token;
  let token = await sessionToken();
  const send = (method: string, input: unknown, key: string, headers = {}) =>
    fetch(`${app.origin}/api/human-requests`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Local-Token": token,
        "Idempotency-Key": key,
        ...headers,
      },
      body: JSON.stringify(input),
    });
  const input = {
    runId: f.run.id,
    affectedTaskIds: [f.task.id],
    type: "clarification",
    urgency: "urgent",
    reason: "Choose the fixture target",
    suggestedAction: "Answer with its name",
    blocking: true,
  };
  try {
    assert.equal(
      (await send("POST", input, "untrusted", { "X-Local-Token": "" })).status,
      403,
    );
    assert.equal(
      (
        await send("POST", input, "cross-origin", {
          Origin: "https://example.invalid",
        })
      ).status,
      403,
    );
    for (const patch of [
      { affectedTaskIds: [] },
      { urgency: "invented" },
      { status: "completed" },
    ])
      assert.equal(
        (await send("POST", { ...input, ...patch }, "invalid")).status,
        400,
      );
    assert.equal(f.store.listHumanRequests().length, 0);
    assert.equal(f.store.getTask(f.task.id).status, "BACKLOG");
    const created = await send("POST", input, "request");
    assert.equal(created.status, 200);
    const request = humanRequestSchema.parse(await created.json());
    assert.equal(request.urgency, "urgent");
    assert.equal(f.store.getTask(f.task.id).status, "WAITING_HUMAN");
    assert.deepEqual(
      await (await send("POST", input, "request")).json(),
      request,
    );
    assert.equal(
      (await send("POST", { ...input, reason: "Changed" }, "request")).status,
      409,
    );
    assert.equal(
      (
        await send(
          "PATCH",
          { id: request.id, status: "answered", ownerResponse: "Target" },
          "missing-status",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await send(
          "PATCH",
          { id: request.id, expectedStatus: "open", status: "answered" },
          "missing-answer",
        )
      ).status,
      400,
    );
    const deferredResponse = await send(
      "PATCH",
      {
        id: request.id,
        expectedStatus: "open",
        status: "deferred",
        ownerResponse: "Later",
      },
      "defer",
    );
    assert.equal(deferredResponse.status, 200);
    const deferred = humanRequestSchema.parse(await deferredResponse.json());
    assert.equal(deferred.resolvedAt, null);
    const events = f.store.events({ limit: 500 });
    await app.close();
    app = await startApp(options);
    token = await sessionToken();
    const list = humanRequestsResponseSchema.parse(
      await (await fetch(`${app.origin}/api/human-requests`)).json(),
    );
    assert.deepEqual(list.humanRequests, [deferred]);
    assert.deepEqual(f.store.listTaskBlockers(f.task.id), [deferred]);
    assert.deepEqual(f.store.events({ limit: 500 }), events);
    assert.equal(
      (
        await send(
          "PATCH",
          { id: request.id, expectedStatus: "open", status: "completed" },
          "stale",
        )
      ).status,
      409,
    );
    const reply = {
      id: request.id,
      expectedStatus: "deferred",
      status: "answered",
      ownerResponse: "Use the disposable target",
    };
    const answeredResponse = await send("PATCH", reply, "answer");
    assert.equal(answeredResponse.status, 200);
    const answered = humanRequestSchema.parse(await answeredResponse.json());
    assert.ok(answered.resolvedAt);
    assert.deepEqual(
      await (await send("PATCH", reply, "answer")).json(),
      answered,
    );
    assert.equal(
      (
        await send(
          "PATCH",
          { id: request.id, expectedStatus: "answered", status: "completed" },
          "late",
        )
      ).status,
      409,
    );
    assert.deepEqual(f.store.listTaskBlockers(f.task.id), []);
    assert.equal(f.store.getTask(f.task.id).status, "WAITING_HUMAN");
    assert.equal(f.store.listAttempts().length, 0);
    assert.equal(f.store.listSessions().length, 0);
    const history = f.store
      .events({ limit: 500 })
      .filter((event) => event.type.startsWith("human_request."));
    assert.deepEqual(
      history.map((event) => [
        event.type,
        event.payload.from,
        event.payload.status,
        event.payload.ownerResponse,
      ]),
      [
        ["human_request.created", undefined, undefined, undefined],
        ["human_request.updated", "open", "deferred", "Later"],
        [
          "human_request.updated",
          "deferred",
          "answered",
          "Use the disposable target",
        ],
      ],
    );
  } finally {
    await app.close();
    await f.close();
  }
});

test("inbox client decisions persist as terminal history and stale replies surface without retry", async (t) => {
  const f = await domainFixture();
  const options = {
    development: false,
    port: 0,
    databasePath: join(f.directory, "state.sqlite"),
  };
  let app = await startApp(options);
  const originalFetch = globalThis.fetch;
  let patches = 0;
  t.mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") patches++;
      return originalFetch(
        typeof input === "string" ? new URL(input, app.origin) : input,
        init,
      );
    },
  );
  const saved = [];
  try {
    for (const initialStatus of ["open", "deferred"] as const)
      for (const action of humanRequestActions(initialStatus)) {
        let request = humanRequestSchema.parse(
          await writeApi("human-requests", {
            runId: f.run.id,
            affectedTaskIds: [f.task.id],
            type: "manual_check",
            urgency: "normal",
            reason: "Check fixture evidence",
            suggestedAction: "Record an owner decision",
            blocking: true,
          }),
        );
        if (initialStatus === "deferred")
          request = humanRequestSchema.parse(
            await writeApi(
              "human-requests",
              { id: request.id, expectedStatus: "open", status: "deferred" },
              "PATCH",
            ),
          );
        const response = humanRequestSchema.parse(
          await writeApi(
            "human-requests",
            {
              id: request.id,
              expectedStatus: initialStatus,
              status: action.status,
              ownerResponse: "Owner checked the fixture evidence",
            },
            "PATCH",
          ),
        );
        assert.equal(response.status, action.status);
        assert.equal(
          response.resolvedAt !== null,
          action.status !== "deferred",
        );
        const before = f.store.events({ limit: 500 });
        const count = patches;
        await assert.rejects(
          writeApi(
            "human-requests",
            {
              id: request.id,
              expectedStatus: initialStatus,
              status: "declined",
              ownerResponse: "Stale decision must not overwrite history",
            },
            "PATCH",
          ),
          /status changed; refresh before replying/,
        );
        assert.equal(patches, count + 1);
        if (action.status !== "deferred")
          await assert.rejects(
            writeApi(
              "human-requests",
              {
                id: request.id,
                expectedStatus: action.status,
                status: "open",
              },
              "PATCH",
            ),
            /cannot transition/,
          );
        assert.deepEqual(f.store.getHumanRequest(request.id), response);
        assert.deepEqual(f.store.events({ limit: 500 }), before);
        saved.push(response);
      }
    await app.close();
    app = await startApp(options);
    const history = humanRequestsResponseSchema.parse(
      await (await fetch("/api/human-requests")).json(),
    );
    assert.deepEqual(history.humanRequests, saved);
    assert.equal(f.store.getTask(f.task.id).status, "WAITING_HUMAN");
    assert.equal(f.store.listAttempts().length, 0);
    assert.equal(f.store.listSessions().length, 0);
  } finally {
    t.mock.restoreAll();
    await app.close();
    await f.close();
  }
});
