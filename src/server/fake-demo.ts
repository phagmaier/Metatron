import { FakeAdapter } from "./adapters/fake.ts";
import type { Store } from "./storage/store.ts";

const demoTitle = "M1 · FAKE persistence demonstration";
export async function seedFakeDemo(store: Store, repositoryPath: string) {
  const existing = store
    .listRuns()
    .find((run) => run.title === demoTitle && run.execution === "fake");
  // Seeding is explicit and one-shot. A partially seeded run is retained for
  // recovery, never interpreted as permission to replay a prompt.
  if (existing) return existing;
  const project = store.createProject(
    { name: "FAKE · disposable fixture", repositoryPath },
    "m1-demo:project",
  );
  const run = store.createRun(
    {
      projectId: project.id,
      title: demoTitle,
      initialPrompt:
        "Demonstrate fake completion and an ambiguous disconnect without any model tokens.",
      mode: "supervised",
    },
    "m1-demo:run",
  );
  for (const scenario of ["completed", "disconnected"] as const) {
    const adapter = new FakeAdapter([
      scenario === "completed"
        ? [
            {
              type: "text_delta",
              text: "FAKE: fixture inspection complete. This is scripted playback, not a native harness report.",
            },
            { type: "turn_completed", nativeStatus: "completed" },
          ]
        : [{ type: "process_state", state: "disconnected", exitCode: null }],
    ]);
    const prefix = `m1-demo:${scenario}`;
    const task = store.createTask(
      {
        runId: run.id,
        title:
          scenario === "completed"
            ? "FAKE · inspect fixture"
            : "FAKE · disconnect simulation",
        objective:
          scenario === "completed"
            ? "Persist a deterministic report for review."
            : "Retain an ambiguous attempt for an explicit retry decision.",
      },
      `${prefix}:task`,
    );
    for (const status of ["READY", "QUEUED", "RUNNING"] as const)
      store.transitionTask(
        {
          id: task.id,
          expectedStatus: store.getTask(task.id).status,
          status,
          reason: "Explicit fake demonstration",
        },
        `${prefix}:${status}`,
      );
    const attempt = store.createAttempt(
      {
        taskId: task.id,
        adapter: "fake",
        intendedOperation: `FAKE ${scenario} playback`,
        cwd: repositoryPath,
      },
      `${prefix}:attempt`,
    );
    const session = store.createSession(
      { attemptId: attempt.id },
      `${prefix}:session`,
    );
    store.updateAttempt(
      { id: attempt.id, status: "running" },
      `${prefix}:attempt-running`,
    );
    store.updateSession(
      { id: session.id, expectedState: "not_started", state: "starting" },
      `${prefix}:starting`,
    );
    const managed = await adapter.startSession({
      runId: run.id,
      taskId: task.id,
      attemptId: attempt.id,
      cwd: repositoryPath,
      roleInstructions: "Simulate a read-only task",
      model: "fake-deterministic",
      thinking: null,
      permission: "read_only",
      contextPolicy: "fresh",
      contextPacket: "M1 explicit fake demo",
      toolEndpoint: null,
      environment: {},
    });
    store.updateSession(
      {
        id: session.id,
        expectedState: "starting",
        state: "busy",
        nativeSessionId: managed.nativeSessionId,
      },
      `${prefix}:native-id`,
    );
    let cause: string | null = null;
    let index = 0;
    for await (const event of adapter.prompt(
      managed,
      "Return the scripted fake report",
    )) {
      const recorded = store.recordEvent(
        {
          runId: run.id,
          taskId: task.id,
          attemptId: attempt.id,
          sessionId: session.id,
          type: `fake.${event.type}`,
          correlationId: prefix,
          causationId: cause,
          payload: event,
        },
        `${prefix}:event:${index++}`,
      );
      cause = recorded.id;
      if (event.type === "process_state" && event.state === "disconnected") {
        store.updateSession(
          { id: session.id, expectedState: "busy", state: "disconnected" },
          `${prefix}:disconnected`,
        );
      }
      if (
        event.type === "turn_completed" &&
        event.nativeStatus === "completed"
      ) {
        store.updateAttempt(
          { id: attempt.id, status: "completed" },
          `${prefix}:attempt-completed`,
        );
        store.transitionTask(
          {
            id: task.id,
            expectedStatus: "RUNNING",
            status: "AWAITING_REVIEW",
            reason:
              "Authoritative fake turn completion; no integration performed",
          },
          `${prefix}:review`,
        );
        store.updateSession(
          { id: session.id, expectedState: "busy", state: "idle" },
          `${prefix}:idle`,
        );
      }
    }
    await adapter.dispose(managed);
  }
  return run;
}
