import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { startApp } from "../src/server/app.ts";
import { seedFakeDemo } from "../src/server/fake-demo.ts";
import {
  eventsResponseSchema,
  projectsResponseSchema,
  sessionsResponseSchema,
  tasksResponseSchema,
} from "../src/shared/api.ts";
import {
  type Event,
  eventSchema,
  projectSchema,
  taskSchema,
} from "../src/shared/domain/entities.ts";
import { domainFixture } from "./helpers/domain-fixture.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";

async function localToken(origin: string) {
  const response = await fetch(`${origin}/api/local-session`);
  const value: unknown = await response.json();
  assert.ok(
    value &&
      typeof value === "object" &&
      "token" in value &&
      typeof value.token === "string",
  );
  return value.token;
}
async function journalEvents(response: Response, count: number) {
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/event-stream/,
  );
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const events: Event[] = [];
  try {
    while (events.length < count) {
      const chunk = await reader.read();
      assert.equal(
        chunk.done,
        false,
        "stream ended before expected journal event",
      );
      pending += decoder.decode(chunk.value, { stream: true });
      let boundary = pending.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (data) {
          const event = eventSchema.parse(JSON.parse(data));
          assert.equal(/^id: (\d+)$/m.exec(frame)?.[1], String(event.sequence));
          events.push(event);
        }
        boundary = pending.indexOf("\n\n");
      }
    }
    return events;
  } finally {
    await reader.cancel();
  }
}

test("API mutations require a process token, validated inputs and an idempotency key", async () => {
  const f = await domainFixture();
  const git = await createGitFixture();
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(f.directory, "state.sqlite"),
  });
  try {
    const token = await localToken(app.origin);
    const input = {
      name: "Second project",
      repositoryPath: git.directory,
    };
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${app.origin}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    assert.equal((await post(input)).status, 403);
    assert.equal((await post(input, { "X-Local-Token": "wrong" })).status, 403);
    assert.equal((await post(input, { "X-Local-Token": token })).status, 400);
    const headers = { "X-Local-Token": token, "Idempotency-Key": "api-create" };
    assert.equal(
      (await post({ ...input, extra: "not allowed" }, headers)).status,
      400,
    );
    assert.equal(
      (await post(input, { ...headers, Origin: "https://example.invalid" }))
        .status,
      403,
    );
    const created = projectSchema.parse(
      await (await post(input, headers)).json(),
    );
    assert.deepEqual(
      projectSchema.parse(await (await post(input, headers)).json()),
      created,
    );
    assert.equal(
      (await post({ ...input, name: "Conflicting input" }, headers)).status,
      409,
    );
    const projects = projectsResponseSchema.parse(
      await (await fetch(`${app.origin}/api/projects`)).json(),
    ).projects;
    assert.equal(projects.length, 2);
    assert.equal(
      f.store.events().filter((event) => event.correlationId === "api-create")
        .length,
      1,
    );
    assert.equal(
      (await fetch(`${app.origin}/api/tasks?runId=not-a-uuid`)).status,
      400,
    );
    assert.equal(
      (await fetch(`${app.origin}/api/events?after=-1`)).status,
      400,
    );
  } finally {
    await app.close();
    await git.verify(async () =>
      assert.equal(await git.git("status", "--porcelain"), ""),
    );
    await f.close();
  }
});
test("task API persists descriptors and refuses direct status writes that bypass scheduling", async () => {
  const f = await domainFixture();
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(f.directory, "state.sqlite"),
  });
  try {
    const token = await localToken(app.origin);
    const mutate = (
      path: string,
      body: unknown,
      key: string,
      method = "POST",
    ) =>
      fetch(`${app.origin}/api/${path}`, {
        method,
        headers: {
          "X-Local-Token": token,
          "Idempotency-Key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await mutate(
          "tasks/transition",
          {
            id: f.task.id,
            expectedStatus: "BACKLOG",
            status: "DONE",
            reason: "Skip",
          },
          "skip",
        )
      ).status,
      405,
    );
    const ready = await mutate(
      "tasks/transition",
      {
        id: f.task.id,
        expectedStatus: "BACKLOG",
        status: "READY",
        reason: "Owner",
      },
      "ready",
    );
    assert.equal(ready.status, 405);
    assert.equal(f.store.getTask(f.task.id).status, "BACKLOG");
    const changed = await mutate(
      "tasks",
      { id: f.task.id, title: "Revised objective", priority: 5 },
      "edit",
      "PATCH",
    );
    assert.equal(taskSchema.parse(await changed.json()).priority, 5);
    assert.equal(f.store.events().at(-1)?.type, "task.updated");
    assert.equal(
      (
        await mutate(
          "tasks",
          { id: f.task.id, status: "DONE" },
          "arbitrary",
          "PATCH",
        )
      ).status,
      400,
    );
  } finally {
    await app.close();
    await f.close();
  }
});
test("event stream replays ordered history and delivers new events after Last-Event-ID reconnect", async () => {
  const f = await domainFixture();
  const app = await startApp({
    development: false,
    port: 0,
    databasePath: join(f.directory, "state.sqlite"),
  });
  try {
    const history = await journalEvents(
      await fetch(`${app.origin}/api/events/stream`, {
        signal: AbortSignal.timeout(5000),
      }),
      3,
    );
    assert.deepEqual(
      history.map((event) => event.sequence),
      [1, 2, 3],
    );
    const reconnect = await fetch(`${app.origin}/api/events/stream?after=0`, {
      headers: { "Last-Event-ID": "3" },
      signal: AbortSignal.timeout(5000),
    });
    const incoming = journalEvents(reconnect, 2);
    const a = f.store.recordEvent(
      {
        runId: f.run.id,
        taskId: f.task.id,
        type: "fake.message",
        correlationId: "live",
        causationId: history[2]?.id,
        payload: { text: "FAKE streamed event" },
      },
      "live-a",
    );
    const b = f.store.recordEvent(
      {
        runId: f.run.id,
        type: "fake.message",
        correlationId: "live",
        causationId: a.id,
        payload: { text: "Next" },
      },
      "live-b",
    );
    assert.deepEqual(
      (await incoming).map((event) => event.id),
      [a.id, b.id],
    );
    const queried = eventsResponseSchema.parse(
      await (
        await fetch(`${app.origin}/api/events?after=3&runId=${f.run.id}`)
      ).json(),
    );
    assert.deepEqual(
      queried.events.map((event) => event.sequence),
      [4, 5],
    );
    assert.equal(
      (
        await fetch(`${app.origin}/api/events/stream`, {
          headers: { "Last-Event-ID": "bad" },
        })
      ).status,
      400,
    );
  } finally {
    await app.close();
    await f.close();
  }
});
test("fake demo survives server restart with recovery, no replay, and a rotated process token", async () => {
  const f = await domainFixture();
  await seedFakeDemo(f.store, join(f.directory, "fake-repo-reference"));
  const path = join(f.directory, "state.sqlite");
  let app = await startApp({ development: false, port: 0, databasePath: path });
  try {
    const oldToken = await localToken(app.origin);
    const tasks = tasksResponseSchema.parse(
      await (await fetch(`${app.origin}/api/tasks`)).json(),
    ).tasks;
    assert.ok(tasks.some((task) => task.status === "AWAITING_REVIEW"));
    assert.ok(tasks.some((task) => task.status === "RETRY_DECISION"));
    const sessions = sessionsResponseSchema.parse(
      await (await fetch(`${app.origin}/api/sessions`)).json(),
    ).sessions;
    assert.equal(sessions.length, 2);
    assert.ok(
      sessions.every(
        (session) =>
          session.adapter === "fake" &&
          session.nativeSessionId?.startsWith("fake-session-"),
      ),
    );
    const before = f.store.events();
    await app.close();
    app = await startApp({ development: false, port: 0, databasePath: path });
    assert.deepEqual(
      tasksResponseSchema.parse(
        await (await fetch(`${app.origin}/api/tasks`)).json(),
      ).tasks,
      tasks,
    );
    assert.deepEqual(f.store.events(), before);
    await seedFakeDemo(f.store, "/tmp/ignored-on-repeat");
    assert.deepEqual(f.store.events(), before);
    assert.equal(
      (
        await fetch(`${app.origin}/api/tasks`, {
          method: "POST",
          headers: { "X-Local-Token": oldToken },
        })
      ).status,
      403,
    );
    assert.notEqual(await localToken(app.origin), oldToken);
  } finally {
    await app.close();
    await f.close();
  }
});
