import { useEffect, useState } from "react";
import { z } from "zod";
import {
  type Run,
  type Session,
  type Task,
  type WorkerMessage,
  workerMessageSchema,
} from "../shared/domain/entities.ts";
import { steeringUnsupported } from "../shared/native-controls.ts";
import { readApi, writeApi } from "./api.ts";

export function WorkerMessagePanel({
  task,
  run,
  session,
  onError,
}: {
  task: Task;
  run: Run;
  session: Session;
  onError: (error: string) => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"steer" | "follow_up">("steer");
  const [messages, setMessages] = useState<WorkerMessage[]>([]);
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: persisted session updates from SSE refresh delivery history.
  useEffect(() => {
    const controller = new AbortController();
    void readApi(`worker-messages?taskId=${task.id}`, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setMessages(z.array(workerMessageSchema).parse(value));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          onError("Cannot load worker message history.");
      });
    return () => controller.abort();
  }, [task.id, session.updatedAt, onError]);
  const unsupported = steeringUnsupported[session.adapter];
  const available =
    unsupported === null &&
    run.status === "active" &&
    run.mode !== "chat_plan" &&
    task.status === "RUNNING" &&
    session.state === "busy" &&
    session.recovery === "none";
  async function send() {
    setBusy(true);
    onError("");
    try {
      const result = workerMessageSchema.parse(
        await writeApi("worker-messages", {
          taskId: task.id,
          sessionId: session.id,
          kind,
          text,
        }),
      );
      setMessages((previous) => [
        ...previous.filter((item) => item.id !== result.id),
        result,
      ]);
      setText("");
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Cannot send worker message",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Message worker</summary>
      {unsupported === null && (
        <p className="note">
          Steer at the next native input boundary, or follow up after current
          work. Queued means accepted by the native queue; delivered confirms
          input receipt, not that instructions were followed.
        </p>
      )}
      <label>
        Delivery
        <select
          value={kind}
          onChange={(event) =>
            setKind(event.target.value === "follow_up" ? "follow_up" : "steer")
          }
        >
          <option value="steer">Steer</option>
          <option value="follow_up">Follow-up</option>
        </select>
      </label>
      <label>
        Message to this worker
        <textarea
          value={text}
          maxLength={4000}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || !available || !text.trim()}
        onClick={() => void send()}
      >
        Send to worker
      </button>
      {!available && (
        <p className="note">
          unsupported · {unsupported ?? "This session cannot accept input now"}.
          No automatic restart or resume.
        </p>
      )}
      <ol>
        {messages.map((message) => (
          <li key={message.id}>
            <strong>
              {message.kind === "follow_up" ? "Follow-up" : "Steer"} ·{" "}
              {message.status}
            </strong>
            <p>{message.text}</p>
            <p className="note">{message.diagnostic}</p>
            <small>
              {message.updatedAt} · session {message.sessionId} · attempt{" "}
              {message.attemptId}
            </small>
          </li>
        ))}
      </ol>
    </details>
  );
}
