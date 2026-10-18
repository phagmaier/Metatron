import type {
  ManagedSession,
  SessionEvent,
} from "../src/server/adapters/contract.ts";
import { DomainError } from "../src/shared/domain/states.ts";
import { ScriptedClaude } from "../tests/helpers/claude-engine-fixture.ts";

// Exercises stop uncertainty without inventing process-exit evidence. All
// other turns use the existing labelled, deterministic approval fixture.
export class GuiStatusStops extends ScriptedClaude {
  private readonly finish = new Map<string, () => void>();
  override async *prompt(session: ManagedSession): AsyncIterable<SessionEvent> {
    if (!session.input.contextPacket.includes("STOP_")) {
      yield* super.prompt(session);
      return;
    }
    const ended = new Promise<void>((resolve) =>
      this.finish.set(session.nativeSessionId, resolve),
    );
    yield { type: "text_delta", text: "SCRIPTED stop fixture; no OS process." };
    await ended;
  }
  override async cancel(session: ManagedSession) {
    const text = session.input.contextPacket;
    if (!text.includes("STOP_")) return super.cancel(session);
    if (text.includes("STOP_PENDING")) await new Promise<void>(() => {});
    this.finish.get(session.nativeSessionId)?.();
    if (text.includes("STOP_FAILED"))
      throw new DomainError(
        "NATIVE_TRANSPORT",
        "SCRIPTED cancellation refused",
      );
  }
}
