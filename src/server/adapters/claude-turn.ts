import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type {
  Options,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { textSchema } from "../../shared/domain/entities.ts";
import { DomainError } from "../../shared/domain/states.ts";
import { checkoutIdentity } from "../git/checkout-identity.ts";
import type { ClaudeEvents } from "./claude-events.ts";
import { type Manifest, saveClaudeManifest } from "./claude-manifest.ts";
import type { ClaudeExit, ClaudeProcess } from "./claude-process.ts";
import type { ManagedSession, SessionEvent } from "./contract.ts";
import type { AdapterQueue } from "./queue.ts";

export type ClaudeQuery = AsyncIterable<unknown> &
  Pick<
    Query,
    "supportedModels" | "accountInfo" | "initializationResult" | "close"
  >;
export type ClaudeQueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => ClaudeQuery;
type Pending = { finish: (approved: boolean) => void };
export type Active = {
  query: ClaudeQuery;
  process: ClaudeProcess;
  input: AdapterQueue<SDKUserMessage>;
  events: AdapterQueue<SessionEvent>;
  mapper: ClaudeEvents;
  abort: AbortController;
  managed: ManagedSession;
  manifest: Manifest;
  lock: string;
  pending: Map<string, Pending>;
  seenRequests: Set<string>;
  used: boolean;
  busy: boolean;
  cancelled: boolean;
  closed: boolean;
  fault: boolean;
  diagnostics: string[];
  done?: Promise<void>;
  ready: Promise<boolean>;
  resolveReady: ((ready: boolean) => void) | undefined;
};

export async function claudeInitialized(
  current: Active,
  signal: AbortSignal,
): Promise<boolean> {
  if (
    signal.aborted ||
    current.abort.signal.aborted ||
    current.cancelled ||
    current.closed
  )
    return false;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      current.ready,
      new Promise<false>((resolve) => {
        onAbort = () => resolve(false);
        signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => resolve(false), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
export async function sameClaudeCheckout(current: Active): Promise<boolean> {
  try {
    const identity = await checkoutIdentity(current.manifest.cwd);
    return (
      JSON.stringify(identity) === JSON.stringify(current.manifest.identity)
    );
  } catch {
    return false;
  }
}
function denyClaudePending(current: Active): void {
  for (const pending of current.pending.values()) pending.finish(false);
}
async function finishClaudeTurn(
  directory: string,
  current: Active,
): Promise<void> {
  try {
    for await (const message of current.query) {
      for (const event of current.mapper.consume(message))
        current.events.push(event);
      if (current.mapper.initialized) current.resolveReady?.(true);
      if (current.mapper.result) {
        current.input.close();
        break;
      }
    }
  } catch {
    current.fault = true;
    current.events.push({
      type: "session_error",
      code: "protocol",
      recoverable: false,
      message:
        "Claude native stream failed; no automatic replay; native details are redacted",
    });
  } finally {
    current.resolveReady?.(false);
    denyClaudePending(current);
    current.input.close();
    let exit: ClaudeExit | undefined;
    try {
      exit = await current.process.stop();
    } catch {
      current.fault = true;
      current.diagnostics.push("Owned Claude subprocess did not confirm exit");
    }
    current.query.close();
    current.busy = false;
    const success =
      !current.fault &&
      !current.cancelled &&
      !current.abort.signal.aborted &&
      current.mapper.result === "success" &&
      exit?.code === 0 &&
      exit.signal === null;
    current.manifest.clean = success;
    try {
      await saveClaudeManifest(directory, current.manifest);
    } catch {
      current.fault = true;
      current.manifest.clean = false;
      current.diagnostics.push(
        "App-owned Claude resume manifest could not be persisted",
      );
    }
    await unlink(current.lock).catch(() => {
      current.fault = true;
    });
    if (exit)
      current.events.push({
        type: "process_state",
        state: exit.code === 0 && !exit.signal ? "exited" : "crashed",
        exitCode: exit.code,
      });
    const status =
      current.cancelled || current.abort.signal.aborted
        ? "interrupted"
        : success && !current.fault
          ? "completed"
          : "failed";
    const settings = current.mapper.settings();
    if (status === "completed" && settings) current.events.push(settings);
    current.events.push({ type: "turn_completed", nativeStatus: status });
    current.events.close();
  }
}
export async function* promptClaudeTurn(
  directory: string,
  current: Active,
  text: string,
): AsyncIterable<SessionEvent> {
  const session = current.managed;
  if (current.used || current.closed || current.cancelled)
    throw new DomainError(
      "CONFLICT",
      "Claude accepts one prompt per owned process; use explicit clean-session resume for another turn",
    );
  const content = textSchema.parse(text);
  current.used = true;
  const identity = await checkoutIdentity(session.input.cwd);
  if (
    JSON.stringify(identity) !== JSON.stringify(current.manifest.identity) ||
    current.cancelled ||
    current.closed ||
    current.abort.signal.aborted
  )
    throw new DomainError(
      "POLICY_DENIED",
      "Claude refuses a changed checkout identity or an ended session before submitting a model turn",
    );
  current.busy = true;
  const deadline = setTimeout(() => {
    void cancelClaudeTurn(current).catch(() => {
      current.fault = true;
    });
  }, 180000);
  current.input.push({
    type: "user",
    session_id: session.nativeSessionId,
    parent_tool_use_id: null,
    uuid: randomUUID(),
    client_composed: true,
    message: {
      role: "user",
      content: `Assigned task context:\n${session.input.contextPacket}\n\nTask instruction:\n${content}`,
    },
  });
  current.done = finishClaudeTurn(directory, current);
  try {
    for await (const event of current.events) yield event;
  } finally {
    clearTimeout(deadline);
    if (current.busy) await cancelClaudeTurn(current);
    await current.done;
  }
}
export async function cancelClaudeTurn(current: Active): Promise<void> {
  // Once native work and its owned exit have settled, cancellation cannot
  // retroactively invalidate a completed turn while its manifest is saved.
  if (current.done && !current.busy) {
    await current.process.stop();
    return;
  }
  if (current.cancelled) {
    await current.process.stop();
    return;
  }
  current.cancelled = true;
  current.resolveReady?.(false);
  denyClaudePending(current);
  current.input.close();
  try {
    await current.process.stop();
  } finally {
    current.abort.abort();
    current.query.close();
  }
}
export async function disposeClaudeTurn(current: Active): Promise<void> {
  current.closed = true;
  current.resolveReady?.(false);
  denyClaudePending(current);
  if (current.busy) await cancelClaudeTurn(current);
  else {
    current.input.close();
    await current.process.stop();
    current.query.close();
  }
  await current.done;
  await unlink(current.lock).catch(() => {});
}
