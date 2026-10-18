import { randomUUID } from "node:crypto";
import { z } from "zod";
import { textSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { steeringUnsupported } from "../../shared/native-controls.ts";
import {
  type ApprovalDecision,
  capabilitiesSchema,
  type HarnessAdapter,
  type ManagedSession,
  type ResumeInput,
  type SessionEvent,
  type StartSessionInput,
  type SteeringOptions,
  sessionEventSchema,
  startSessionSchema,
} from "./contract.ts";

type Playback = {
  session: ManagedSession;
  turn: number;
  active: boolean;
  cancelled: boolean;
  disconnected: boolean;
  terminal: boolean;
  prompts: string[];
  steering: string[];
  queuedMessages: SteeringOptions[];
  approval: {
    id: string;
    resolve: (decision: ApprovalDecision) => void;
  } | null;
};

export class FakeAdapter implements HarnessAdapter {
  private readonly sessions = new Map<string, Playback>();
  private nextId = 1;
  private readonly namespace = randomUUID();
  private readonly turns: SessionEvent[][];
  // FAKE has no native session store. `resumable` stands in for sessions an
  // earlier attempt recorded, so resume identity rules run without a model.
  constructor(
    turns: SessionEvent[][] = [
      [
        {
          type: "text_delta",
          text: "FAKE: deterministic result; no native harness was called.",
        },
        { type: "turn_completed", nativeStatus: "completed" },
      ],
    ],
    resumable: ManagedSession[] = [],
  ) {
    this.turns = z.array(z.array(sessionEventSchema)).parse(turns);
    for (const session of resumable) this.track(structuredClone(session));
  }
  private track(session: ManagedSession) {
    this.sessions.set(session.nativeSessionId, {
      session,
      turn: 0,
      active: false,
      cancelled: false,
      disconnected: false,
      terminal: false,
      prompts: [],
      steering: [],
      queuedMessages: [],
      approval: null,
    });
  }
  async discover() {
    return capabilitiesSchema.parse({
      adapter: "fake",
      installed: true,
      authenticated: true,
      models: [
        {
          id: "fake-deterministic",
          label: "Fake playback (no model)",
          thinking: [],
        },
      ],
      supportsResume: true,
      supportsLiveSteer: steeringUnsupported.fake === null,
      supportsCancel: true,
      supportsPermissionPrompts: true,
      supportsToolGateway: false,
      version: null,
      nextStep: null,
      diagnostics: [
        "Simulation only. No native harness, tools, billing, or filesystem isolation.",
      ],
    });
  }
  private validate(input: StartSessionInput) {
    const parsed = startSessionSchema.parse(input);
    if (
      parsed.model !== "fake-deterministic" ||
      parsed.thinking !== null ||
      parsed.toolEndpoint !== null
    )
      throw new DomainError(
        "UNSUPPORTED",
        "FakeAdapter supports only its discovered model, no thinking settings or tool gateway",
      );
    return parsed;
  }
  async startSession(input: StartSessionInput) {
    const session: ManagedSession = {
      nativeSessionId: `fake-session-${this.namespace}-${this.nextId++}`,
      adapter: "fake",
      input: this.validate(input),
    };
    this.track(session);
    return structuredClone(session);
  }
  private lookup(session: ManagedSession) {
    const playback = this.sessions.get(session.nativeSessionId);
    if (!playback || session.adapter !== "fake")
      throw new DomainError("NOT_FOUND", "Fake session not found");
    const original = playback.session.input;
    if (
      session.input.runId !== original.runId ||
      session.input.taskId !== original.taskId ||
      session.input.attemptId !== original.attemptId ||
      session.input.cwd !== original.cwd
    )
      throw new DomainError(
        "INVALID_REFERENCE",
        "Session identity belongs to another assignment",
      );
    return playback;
  }
  async *prompt(
    session: ManagedSession,
    text: string,
  ): AsyncIterable<SessionEvent> {
    textSchema.parse(text);
    const playback = this.lookup(session);
    if (
      playback.active ||
      playback.disconnected ||
      playback.terminal ||
      playback.cancelled
    )
      throw new DomainError("CONFLICT", "Session cannot accept a prompt");
    playback.active = true;
    playback.prompts.push(text);
    try {
      yield { type: "process_state", state: "busy", exitCode: null };
      const events = this.turns[playback.turn++] ?? [];
      for (const event of events) {
        if (playback.cancelled) break;
        const ready = playback.queuedMessages.filter(
          (message) =>
            message.kind === "steer" || event.type === "turn_completed",
        );
        playback.queuedMessages = playback.queuedMessages.filter(
          (message) => !ready.includes(message),
        );
        for (const message of ready)
          yield {
            type: "owner_message_delivered",
            messageId: message.messageId,
          };
        if (event.type === "approval_requested") {
          let decide: ((decision: ApprovalDecision) => void) | undefined;
          const decision = new Promise<ApprovalDecision>((resolve) => {
            decide = resolve;
          });
          if (!decide) throw new Error("Missing fake approval resolver");
          playback.approval = { id: event.nativeRequestId, resolve: decide };
          yield {
            type: "process_state",
            state: "waiting_permission",
            exitCode: null,
          };
          yield structuredClone(event);
          const answer = await decision;
          playback.approval = null;
          if (answer === "deny") {
            playback.cancelled = true;
            break;
          }
          yield { type: "process_state", state: "busy", exitCode: null };
          continue;
        }
        if (event.type === "process_state") {
          if (event.state === "disconnected") playback.disconnected = true;
          if (event.state === "exited" || event.state === "crashed")
            playback.terminal = true;
        }
        yield structuredClone(event);
        if (playback.disconnected || playback.terminal) return;
        if (event.type === "turn_completed") return;
      }
      if (playback.cancelled)
        yield { type: "turn_completed", nativeStatus: "interrupted" };
      // Exhausting a script is idle, never authoritative task completion.
    } finally {
      playback.active = false;
      playback.approval = null;
    }
  }
  // A successor attempt of the same task may continue the session; another
  // task, run or checkout may not.
  async resume(nativeSessionId: string, input: ResumeInput) {
    const data = this.validate(input);
    const playback = this.sessions.get(nativeSessionId);
    if (!playback) throw new DomainError("NOT_FOUND", "Fake session not found");
    const original = playback.session.input;
    if (
      data.runId !== original.runId ||
      data.taskId !== original.taskId ||
      data.cwd !== original.cwd
    )
      throw new DomainError(
        "INVALID_REFERENCE",
        "Session identity belongs to another assignment",
      );
    if (playback.active || playback.terminal || playback.cancelled)
      throw new DomainError("CONFLICT", "Fake session cannot resume");
    playback.disconnected = false;
    playback.session = { ...playback.session, input: data };
    return structuredClone(playback.session);
  }
  async steer(
    session: ManagedSession,
    text: string,
    options?: SteeringOptions,
  ) {
    const playback = this.lookup(session);
    textSchema.parse(text);
    if (playback.disconnected || playback.terminal || playback.cancelled)
      return "unsupported" as const;
    playback.steering.push(text);
    const sent =
      playback.active && !playback.approval && options?.kind !== "follow_up";
    if (!sent && options) playback.queuedMessages.push(options);
    return sent ? ("sent" as const) : ("queued" as const);
  }
  async cancel(session: ManagedSession) {
    const playback = this.lookup(session);
    playback.cancelled = true;
    playback.approval?.resolve("deny");
  }
  async respondToApproval(
    session: ManagedSession,
    id: string,
    decision: ApprovalDecision,
  ) {
    z.enum(["approve", "deny"]).parse(decision);
    const playback = this.lookup(session);
    if (playback.approval?.id !== id)
      throw new DomainError("NOT_FOUND", "No matching fake permission request");
    playback.approval.resolve(decision);
  }
  async dispose(session: ManagedSession) {
    await this.cancel(session);
    this.sessions.delete(session.nativeSessionId);
  }
  history(session: ManagedSession) {
    const playback = this.lookup(session);
    return { prompts: [...playback.prompts], steering: [...playback.steering] };
  }
}
