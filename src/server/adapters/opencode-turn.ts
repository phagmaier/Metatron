import { unlink } from "node:fs/promises";
import type { OpenCodeClient } from "@opencode/client";
import { z } from "zod";
import { textSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { checkoutIdentity } from "../git/checkout-identity.ts";
import type { ManagedSession, SessionEvent } from "./contract.ts";
import type { OpenCodeEvents } from "./opencode-events.ts";
import {
  type OpenCodeExit,
  type OpenCodeHost,
  openCodeRules,
} from "./opencode-host.ts";
import {
  inspectOpenCodePermission,
  type OpenCodePermission,
} from "./opencode-permissions.ts";
import {
  type OpenCodeManifest,
  openCodeSession,
  saveOpenCodeManifest,
} from "./opencode-state.ts";
import type { AdapterQueue } from "./queue.ts";

export type OpenCodePending = {
  request: OpenCodePermission;
  input: Record<string, unknown>;
};
export type OpenCodeActive = {
  managed: ManagedSession;
  client: OpenCodeClient;
  host: OpenCodeHost;
  manifest: OpenCodeManifest;
  mapper: OpenCodeEvents;
  events: AdapterQueue<SessionEvent>;
  streamAbort: AbortController;
  pending: Map<string, OpenCodePending>;
  seenPermissions: Set<string>;
  replies: Set<Promise<void>>;
  used: boolean;
  busy: boolean;
  cancelled: boolean;
  closed: boolean;
  fault: boolean;
  lock: string | undefined;
  directory: string;
  done?: Promise<void>;
  cancelPromise?: Promise<void>;
  interruptConfirmed: boolean;
};
export async function validateOpenCodeIdentity(current: OpenCodeActive) {
  if (
    JSON.stringify(await checkoutIdentity(current.managed.input.cwd)) !==
    JSON.stringify(current.manifest.identity)
  )
    throw new DomainError(
      "POLICY_DENIED",
      "OpenCode refuses a replaced or changed checkout identity",
    );
  const session = openCodeSession.parse(
    await current.client.session.get(
      { sessionID: current.managed.nativeSessionId },
      { signal: AbortSignal.timeout(5000) },
    ),
  );
  if (
    session.id !== current.managed.nativeSessionId ||
    session.parentID ||
    session.agent !== "metatron" ||
    session.location.directory !== current.managed.input.cwd ||
    JSON.stringify(session.permissions) !==
      JSON.stringify(
        openCodeRules(
          current.managed.input.permission,
          !!current.managed.input.toolEndpoint,
        ),
      )
  )
    throw new DomainError(
      "POLICY_DENIED",
      "OpenCode native session/location/permission identity changed",
    );
  const expected = current.mapper.model;
  if (
    session.model.id !== expected.id ||
    session.model.providerID !== expected.providerID ||
    session.model.variant !== expected.variant
  )
    throw new DomainError(
      "POLICY_DENIED",
      "OpenCode native session changed the selected model/variant",
    );
  return session;
}
export async function requireOpenCodeIdle(current: OpenCodeActive) {
  const [inbox, active] = await Promise.all([
    current.client.session.inbox.list(
      { sessionID: current.managed.nativeSessionId },
      { signal: AbortSignal.timeout(5000) },
    ),
    current.client.session.active({ signal: AbortSignal.timeout(5000) }),
  ]);
  if (inbox.length || current.managed.nativeSessionId in active)
    throw new DomainError(
      "POLICY_DENIED",
      "OpenCode contains queued or active work; no automatic replay is permitted",
    );
}
export async function releaseOpenCodeLease(current: OpenCodeActive) {
  const lock = current.lock;
  // A completed session's later disposal must never unlink a successor's lease.
  current.lock = undefined;
  if (!lock) return;
  try {
    await unlink(lock);
  } catch {
    throw new DomainError(
      "STORAGE",
      "Owned OpenCode lease cleanup failed; retained state requires inspection",
    );
  }
}
async function permission(current: OpenCodeActive, value: unknown) {
  await validateOpenCodeIdentity(current);
  const bound = await inspectOpenCodePermission(
    current.client,
    current.managed,
    value,
  );
  current.mapper.checkModel(bound.model);
  if (current.cancelled || current.closed || current.fault)
    throw new DomainError(
      "CONFLICT",
      "OpenCode permission arrived after cancellation",
    );
  const id = bound.request.id;
  if (current.seenPermissions.has(id)) return;
  if (current.seenPermissions.size >= 4096)
    throw new DomainError("CONFLICT", "OpenCode permission capacity exceeded");
  current.seenPermissions.add(id);
  if (bound.mutation) {
    current.pending.set(id, { request: bound.request, input: bound.input });
    current.events.push({
      type: "approval_requested",
      nativeRequestId: id,
      details:
        "OpenCode requests one-shot approval for a policy-checked file mutation. Approve affects only this request. Deny rejects all pending native requests and stops this OpenCode turn; no tool input is retained here.",
    });
  } else {
    await validateOpenCodeIdentity(current);
    if (
      current.cancelled ||
      current.closed ||
      current.fault ||
      current.streamAbort.signal.aborted
    )
      throw new DomainError(
        "CONFLICT",
        "OpenCode permission was cancelled before its native grant",
      );
    await current.client.permission.reply(
      {
        sessionID: current.managed.nativeSessionId,
        requestID: id,
        decision: "once",
      },
      { signal: AbortSignal.timeout(5000) },
    );
  }
}
export function cancelOpenCodeTurn(current: OpenCodeActive): Promise<void> {
  current.cancelPromise ??= (async () => {
    if (current.done && !current.busy) {
      await current.host.stop();
      return;
    }
    current.cancelled = true;
    current.pending.clear();
    if (current.mapper.terminal) {
      await current.host.stop();
      current.streamAbort.abort();
      return;
    }
    try {
      const result = z
        .object({ interrupted: z.boolean() })
        .parse(
          await current.client.session.interrupt(
            { sessionID: current.managed.nativeSessionId, resume: false },
            { signal: AbortSignal.timeout(3000) },
          ),
        );
      current.interruptConfirmed = result.interrupted;
    } finally {
      await current.host.stop();
      current.streamAbort.abort();
    }
  })();
  return current.cancelPromise;
}
async function finish(current: OpenCodeActive, text: string) {
  try {
    const iterator = current.client.event
      .subscribe({ signal: current.streamAbort.signal })
      [Symbol.asyncIterator]();
    try {
      const deadline = Promise.withResolvers<never>();
      const timer = setTimeout(
        () =>
          deadline.reject(
            new DomainError(
              "UNSUPPORTED",
              "OpenCode event connection timed out",
            ),
          ),
        10000,
      );
      let connected: IteratorResult<unknown>;
      try {
        connected = await Promise.race([iterator.next(), deadline.promise]);
      } finally {
        clearTimeout(timer);
      }
      if (
        connected.done ||
        !z
          .object({ type: z.literal("server.connected") })
          .safeParse(connected.value).success
      )
        throw new DomainError(
          "CONFLICT",
          "OpenCode event stream did not establish a live connection",
        );
      if (
        current.cancelled ||
        current.closed ||
        current.fault ||
        current.streamAbort.signal.aborted
      )
        throw new DomainError(
          "CONFLICT",
          "OpenCode prompt was cancelled while connecting its native stream",
        );
      // API prompt is an inbox acknowledgement, never authoritative completion.
      const accepted = z
        .object({
          id: z.string(),
          sessionID: z.string(),
          type: z.literal("user"),
        })
        .parse(
          await current.client.session.prompt(
            {
              sessionID: current.managed.nativeSessionId,
              text,
              // This wakes only the newly authorized input; idle/inbox checks forbid replay.
              resume: true,
            },
            { signal: AbortSignal.timeout(10000) },
          ),
        );
      if (accepted.sessionID !== current.managed.nativeSessionId)
        throw new DomainError(
          "POLICY_DENIED",
          "OpenCode acknowledged a different native session",
        );
      while (!current.streamAbort.signal.aborted) {
        const next = await iterator.next();
        if (next.done) break;
        const mapped = current.mapper.consume(next.value);
        for (const event of mapped.events) current.events.push(event);
        if (mapped.permission !== undefined)
          await permission(current, mapped.permission);
        if (current.mapper.terminal) break;
      }
      if (!current.mapper.terminal && !current.cancelled)
        throw new DomainError(
          "CONFLICT",
          "OpenCode live-only event stream disconnected; no replay",
        );
      if (current.mapper.terminal === "completed" && !current.cancelled) {
        await current.client.session.wait(
          { sessionID: current.managed.nativeSessionId },
          { signal: AbortSignal.timeout(5000) },
        );
        const session = await validateOpenCodeIdentity(current);
        await requireOpenCodeIdle(current);
        if (session.outcome !== "succeeded")
          throw new DomainError(
            "CONFLICT",
            "OpenCode completion did not reconcile to a successful idle session",
          );
      }
    } finally {
      current.streamAbort.abort();
      await iterator.return?.();
    }
  } catch (error) {
    if (!current.cancelled) {
      current.fault = true;
      current.events.push({
        type: "session_error",
        code: "protocol",
        recoverable: false,
        message:
          error instanceof DomainError
            ? error.message
            : "OpenCode native stream/configuration failed; native details redacted; inspect retained state, never replay automatically",
      });
    }
  } finally {
    current.pending.clear();
    // A terminal SSE event can precede its control HTTP acknowledgement.
    // Preserve decision/interrupt receipts before closing the owned transport.
    await Promise.allSettled([...current.replies]);
    if (current.cancelPromise) {
      try {
        await current.cancelPromise;
      } catch {
        current.fault = true;
      }
    }
    let exit: OpenCodeExit | undefined;
    try {
      exit = await current.host.stop();
    } catch {
      current.fault = true;
    }
    current.busy = false;
    if (exit) {
      try {
        await releaseOpenCodeLease(current);
      } catch {
        current.fault = true;
        current.events.push({
          type: "session_error",
          code: "storage",
          recoverable: false,
          message:
            "OpenCode lease cleanup failed; retained state requires inspection, never automatic replay",
        });
      }
    }
    const success =
      !current.cancelled &&
      !current.fault &&
      current.mapper.terminal === "completed" &&
      !!exit?.expected;
    current.manifest.clean = success;
    try {
      await saveOpenCodeManifest(current.directory, current.manifest);
    } catch {
      current.fault = true;
      current.manifest.clean = false;
    }
    if (exit)
      current.events.push({
        type: "process_state",
        state: exit.expected ? "exited" : "crashed",
        exitCode: exit.code,
      });
    current.events.push({
      type: "turn_completed",
      nativeStatus: current.cancelled
        ? "interrupted"
        : success && !current.fault
          ? "completed"
          : "failed",
    });
    current.events.close();
  }
}
export async function* promptOpenCodeTurn(
  current: OpenCodeActive,
  text: string,
): AsyncIterable<SessionEvent> {
  if (current.used || current.closed || current.cancelled)
    throw new DomainError(
      "CONFLICT",
      "OpenCode accepts one prompt per owned process; use explicit clean same-checkout resume",
    );
  current.used = true;
  const instruction = textSchema.parse(text);
  await validateOpenCodeIdentity(current);
  await requireOpenCodeIdle(current);
  if (current.cancelled || current.closed)
    throw new DomainError(
      "CONFLICT",
      "OpenCode prompt was cancelled before dispatch",
    );
  current.busy = true;
  current.done = finish(
    current,
    `Assigned task context:\n${current.managed.input.contextPacket}\n\nTask instruction:\n${instruction}`,
  );
  try {
    for await (const event of current.events) yield event;
  } finally {
    if (current.busy) await cancelOpenCodeTurn(current);
    await current.done;
  }
}
