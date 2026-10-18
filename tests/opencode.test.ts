import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, watch } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type {
  ManagedSession,
  SessionEvent,
} from "../src/server/adapters/contract.ts";
import { OpenCodeAdapter } from "../src/server/adapters/opencode.ts";
import { OpenCodeEvents } from "../src/server/adapters/opencode-events.ts";
import { createGitFixture } from "./helpers/git-fixture.ts";
import { opencodeFixture } from "./helpers/opencode-fixture.ts";

function status(events: SessionEvent[]) {
  return events.find((event) => event.type === "turn_completed")?.nativeStatus;
}
async function missing(path: string) {
  await assert.rejects(readFile(path), { code: "ENOENT" });
}
async function collect(source: AsyncIterable<SessionEvent>) {
  const events: SessionEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}
async function marker(directory: string, name: string) {
  for await (const event of watch(directory, {
    signal: AbortSignal.timeout(10000),
  }))
    if (event.filename === name) return;
  throw new Error("Native fixture synchronization marker missing");
}

test("OpenCode streams cumulative whitespace exactly once and clean same-checkout resume survives adapter reconstruction", async () => {
  const f = await opencodeFixture("foreign");
  try {
    const session = await f.start();
    const events = await collect(f.adapter.prompt(session, "Read"));
    assert.equal(status(events), "completed");
    assert.equal(
      events
        .filter((event) => event.type === "text_delta")
        .map((event) => event.text)
        .join(""),
      "  native\nend\n",
    );
    await f.adapter.dispose(session);
    const other = new OpenCodeAdapter(f.directory, f.options);
    const resumed = await other.resume(session.nativeSessionId, {
      ...f.input,
      contextPolicy: "resume",
    });
    try {
      assert.equal(resumed.nativeSessionId, session.nativeSessionId);
      assert.equal(
        status(await collect(other.prompt(resumed, "Read again"))),
        "completed",
      );
    } finally {
      await other.dispose(resumed);
    }
    await assert.rejects(
      other.resume(session.nativeSessionId, {
        ...f.input,
        runId: randomUUID(),
        contextPolicy: "resume",
      }),
      { code: "POLICY_DENIED" },
    );
    const repoB = await createGitFixture();
    await repoB.verify(async () => {
      await assert.rejects(
        other.resume(session.nativeSessionId, {
          ...f.input,
          cwd: repoB.directory,
          contextPolicy: "resume",
        }),
        { code: "POLICY_DENIED" },
      );
    });
  } finally {
    await f.close();
  }
});

for (const scenario of [
  "ack-only",
  "disconnect",
  "unexpected-exit",
  "model-drift",
  "unreconciled",
]) {
  test(`OpenCode ${scenario} cannot establish success or enable replay`, async () => {
    const f = await opencodeFixture(scenario);
    try {
      const session = await f.start();
      const events = await collect(f.adapter.prompt(session, "Read"));
      assert.equal(status(events), "failed");
      await assert.rejects(
        f.adapter.resume(session.nativeSessionId, {
          ...f.input,
          contextPolicy: "resume",
        }),
      );
      assert.ok(!events.some((event) => event.type === "approval_requested"));
      await missing(join(f.repo.directory, "approved.txt"));
    } finally {
      await f.close();
    }
  });
}

test("one OpenCode approval writes only its bound operation; independent denial stops the turn and stale grants fail", async () => {
  const f = await opencodeFixture("approval");
  try {
    const session = await f.start({ permission: "workspace_write" });
    const ids: string[] = [];
    const events: SessionEvent[] = [];
    for await (const event of f.adapter.prompt(session, "Write")) {
      events.push(event);
      if (event.type !== "approval_requested") continue;
      ids.push(event.nativeRequestId);
      if (ids.length === 1) {
        await missing(join(f.repo.directory, "approved.txt"));
        await f.adapter.respondToApproval(
          session,
          event.nativeRequestId,
          "approve",
        );
      } else {
        assert.equal(
          await readFile(join(f.repo.directory, "approved.txt"), "utf8"),
          "approved\n",
        );
        await f.adapter.respondToApproval(
          session,
          event.nativeRequestId,
          "deny",
        );
      }
    }
    assert.equal(status(events), "interrupted");
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
    await missing(join(f.repo.directory, "denied.txt"));
    for (const id of ids)
      await assert.rejects(f.adapter.respondToApproval(session, id, "approve"));
    await assert.rejects(
      f.adapter.resume(session.nativeSessionId, {
        ...session.input,
        contextPolicy: "resume",
      }),
    );
  } finally {
    await f.close();
  }
});

for (const scenario of ["read-only-write", "secret"]) {
  test(`OpenCode ${scenario} is refused before a native operation is granted`, async () => {
    const f = await opencodeFixture(scenario);
    try {
      const session = await f.start();
      const events = await collect(f.adapter.prompt(session, "Unsafe request"));
      assert.equal(status(events), "failed");
      assert.ok(events.some((event) => event.type === "session_error"));
      assert.ok(!events.some((event) => event.type === "approval_requested"));
      await missing(join(f.repo.directory, "approved.txt"));
    } finally {
      await f.close();
    }
  });
}

test("OpenCode revalidates the pending native input before owner consent is delivered", async () => {
  const f = await opencodeFixture("retarget");
  try {
    const session = await f.start({ permission: "workspace_write" });
    for await (const event of f.adapter.prompt(session, "Write")) {
      if (event.type !== "approval_requested") continue;
      await assert.rejects(
        f.adapter.respondToApproval(session, event.nativeRequestId, "approve"),
      );
      await f.adapter.cancel(session);
    }
    await missing(join(f.repo.directory, "approved.txt"));
    await missing(join(f.repo.directory, "unapproved.txt"));
  } finally {
    await f.close();
  }
});

test("replacing an OpenCode checkout during owner consent never grants a mutation", async () => {
  const f = await opencodeFixture("single-write");
  const backup = join(dirname(f.repo.directory), "original-checkout");
  let swapped = false;
  try {
    const session = await f.start({ permission: "workspace_write" });
    for await (const event of f.adapter.prompt(session, "Write")) {
      if (event.type !== "approval_requested") continue;
      await rename(f.repo.directory, backup);
      swapped = true;
      await mkdir(f.repo.directory);
      await assert.rejects(
        f.adapter.respondToApproval(session, event.nativeRequestId, "approve"),
      );
      await f.adapter.cancel(session);
      await missing(join(backup, "approved.txt"));
      await missing(join(f.repo.directory, "approved.txt"));
    }
  } finally {
    if (swapped) {
      await rm(f.repo.directory, { recursive: true });
      await rename(backup, f.repo.directory);
    }
    await f.close();
  }
});

test("a competing OpenCode resume cannot remove the first owner's exclusive native lease", async () => {
  const f = await opencodeFixture();
  try {
    const session = await f.start();
    assert.equal(
      status(await collect(f.adapter.prompt(session, "Read"))),
      "completed",
    );
    await f.adapter.dispose(session);
    const first = new OpenCodeAdapter(f.directory, f.options);
    const second = new OpenCodeAdapter(f.directory, f.options);
    const resumed = await first.resume(session.nativeSessionId, {
      ...f.input,
      contextPolicy: "resume",
    });
    try {
      for (let count = 0; count < 2; count++)
        await assert.rejects(
          second.resume(session.nativeSessionId, {
            ...f.input,
            contextPolicy: "resume",
          }),
        );
      assert.equal(
        status(await collect(first.prompt(resumed, "Read"))),
        "completed",
      );
    } finally {
      await first.dispose(resumed);
    }
  } finally {
    await f.close();
  }
});

test("active OpenCode cancellation records native interrupt and owned exit without making the session resumable", async () => {
  const f = await opencodeFixture("active");
  try {
    const session = await f.start();
    const events: SessionEvent[] = [];
    for await (const event of f.adapter.prompt(session, "Generate")) {
      events.push(event);
      if (event.type === "text_delta") await f.adapter.cancel(session);
    }
    assert.equal(status(events), "interrupted");
    assert.equal(f.adapter.evidence(session).interruptConfirmed, true);
    assert.ok(
      events.some(
        (event) => event.type === "process_state" && event.state === "exited",
      ),
    );
    await assert.rejects(
      f.adapter.resume(session.nativeSessionId, {
        ...f.input,
        contextPolicy: "resume",
      }),
    );
  } finally {
    await f.close();
  }
});

test("OpenCode critical event identity and effective model boundaries fail closed", () => {
  const mapper = new OpenCodeEvents("ses_owned", "/checkout", {
    id: "model",
    providerID: "fixture",
    variant: "low",
  });
  assert.throws(() =>
    mapper.consume({ type: "session.execution.succeeded", data: {} }),
  );
  assert.throws(() =>
    mapper.consume({
      type: "session.execution.succeeded",
      data: { sessionID: "ses_owned" },
    }),
  );
  assert.throws(() =>
    mapper.consume({
      type: "session.execution.started",
      location: { directory: "/replaced" },
      data: { sessionID: "ses_owned" },
    }),
  );
  mapper.consume({
    type: "session.execution.started",
    data: { sessionID: "ses_owned" },
  });
  assert.throws(() =>
    mapper.consume({
      type: "session.step.started",
      data: {
        sessionID: "ses_owned",
        agent: "metatron",
        model: { id: "model", providerID: "fixture", variant: "high" },
      },
    }),
  );
});

test("native transient deltas, duplicate IDs and durable final text preserve whitespace without duplicate output", () => {
  const mapper = new OpenCodeEvents("ses_owned", "/checkout", {
    id: "model",
    providerID: "fixture",
    variant: "low",
  });
  mapper.consume({
    type: "session.execution.started",
    data: { sessionID: "ses_owned" },
  });
  mapper.consume({
    type: "session.step.started",
    data: { sessionID: "ses_owned", agent: "metatron", model: mapper.model },
  });
  const delta = {
    id: "evt_delta",
    type: "session.text.delta",
    data: {
      sessionID: "ses_owned",
      assistantMessageID: "msg_text",
      ordinal: 0,
      delta: "  hello\n",
    },
  };
  const events = [
    ...mapper.consume(delta).events,
    ...mapper.consume(delta).events,
    ...mapper.consume({
      type: "session.text.ended",
      data: {
        sessionID: "ses_owned",
        assistantMessageID: "msg_text",
        ordinal: 0,
        text: "  hello\nworld\n",
      },
    }).events,
    ...mapper.consume({
      type: "session.message.content.updated",
      data: {
        sessionID: "ses_owned",
        messageID: "msg_text",
        content: [
          {
            type: "text",
            text: "  hello\nworld\n",
            state: { opaqueProviderMetadata: true },
          },
        ],
      },
    }).events,
  ];
  assert.equal(
    events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.text)
      .join(""),
    "  hello\nworld\n",
  );
  assert.throws(() =>
    mapper.consume({
      type: "session.text.ended",
      data: {
        sessionID: "ses_owned",
        assistantMessageID: "msg_text",
        ordinal: 0,
        text: "rewritten",
      },
    }),
  );
  assert.throws(() =>
    mapper.consume({
      type: "session.text.delta",
      data: {
        sessionID: "ses_owned",
        assistantMessageID: "msg_text",
        ordinal: 0,
      },
    }),
  );
});

test("a fragmented native password line authenticates only after its complete delimiter", async () => {
  const f = await opencodeFixture("split-startup");
  try {
    const session = await f.start();
    assert.equal(
      status(await collect(f.adapter.prompt(session, "Read"))),
      "completed",
    );
  } finally {
    await f.close();
  }
});

test("completed OpenCode disposal cannot release a successor's native lease", async () => {
  const f = await opencodeFixture();
  const started = Promise.withResolvers<void>();
  const factory = f.options.spawn;
  assert.ok(factory);
  const next = new OpenCodeAdapter(f.directory, {
    ...f.options,
    spawn: (...args) => {
      const child = factory(...args);
      started.resolve();
      return child;
    },
  });
  let resuming: Promise<ManagedSession> | undefined;
  try {
    const completed = await f.start();
    assert.equal(
      status(await collect(f.adapter.prompt(completed, "Read"))),
      "completed",
    );
    resuming = next.resume(completed.nativeSessionId, {
      ...f.input,
      contextPolicy: "resume",
    });
    await started.promise;
    await f.adapter.dispose(completed);
    await access(
      join(
        f.directory,
        "opencode-sessions",
        `${completed.nativeSessionId}.lock`,
      ),
    );
    const third = new OpenCodeAdapter(f.directory, f.options);
    await assert.rejects(
      third.resume(completed.nativeSessionId, {
        ...f.input,
        contextPolicy: "resume",
      }),
    );
    await resuming;
  } finally {
    if (resuming) {
      const [result] = await Promise.allSettled([resuming]);
      if (result?.status === "fulfilled") await next.dispose(result.value);
    }
    await f.close();
  }
});

test("cancellation while the native SSE connection is opening cannot wake fresh model work", async () => {
  const f = await opencodeFixture("cancel-connect");
  try {
    const session = await f.start();
    assert.ok(session.transcriptPath);
    const connected = marker(
      session.transcriptPath,
      "fixture-awaiting-connect",
    );
    const turn = collect(f.adapter.prompt(session, "Read"));
    await connected;
    await f.adapter.cancel(session);
    assert.equal(status(await turn), "interrupted");
    await missing(join(session.transcriptPath, "unapproved-prompt.txt"));
  } finally {
    await f.close();
  }
});

test("cancellation during final native read validation cannot issue a late automatic grant", async () => {
  const f = await opencodeFixture("cancel-read");
  try {
    const session = await f.start();
    assert.ok(session.transcriptPath);
    const validating = marker(
      session.transcriptPath,
      "fixture-awaiting-validation",
    );
    const turn = collect(f.adapter.prompt(session, "Read"));
    await validating;
    await f.adapter.cancel(session);
    assert.equal(status(await turn), "interrupted");
    await missing(join(session.transcriptPath, "cancelled-read-result.txt"));
  } finally {
    await f.close();
  }
});
