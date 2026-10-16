import { useState } from "react";
import type { Run } from "../shared/domain/entities.ts";
import { writeApi } from "./api.ts";

export function RunControls({
  run,
  onError,
}: {
  run: Run;
  onError: (error: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [scenario, setScenario] = useState("success");
  const [busy, setBusy] = useState(false);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    onError("");
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="form-row">
        <label>
          Run mode
          <select
            disabled={busy}
            value={run.mode}
            onChange={(event) =>
              void act(() =>
                writeApi(
                  "runs",
                  { id: run.id, mode: event.target.value },
                  "PATCH",
                ),
              )
            }
          >
            <option value="chat_plan">Chat/Plan</option>
            <option value="supervised">Supervised</option>
            <option value="autonomous_bounded">Autonomous (bounded)</option>
          </select>
        </label>
        <div className="actions">
          <button
            type="button"
            disabled={busy || !["active", "paused"].includes(run.status)}
            onClick={() =>
              void act(() =>
                writeApi(
                  "runs",
                  {
                    id: run.id,
                    status: run.status === "paused" ? "active" : "paused",
                  },
                  "PATCH",
                ),
              )
            }
          >
            {run.status === "paused" ? "Resume scheduling" : "Pause scheduling"}
          </button>
        </div>
      </div>
      <p className="note">
        Pause holds queued work; active turns finish. Chat/Plan cannot dispatch
        workers.
      </p>
      {run.execution === "fake" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await writeApi("runs/messages", {
                runId: run.id,
                text: message,
                scenario,
              });
              setMessage("");
            });
          }}
        >
          <label>
            Message the fake Lead
            <textarea
              required
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={2}
            />
          </label>
          <div className="actions">
            <label>
              Worker simulation
              <select
                value={scenario}
                onChange={(event) => setScenario(event.target.value)}
              >
                <option value="success">Success</option>
                <option value="failure">Failure</option>
                <option value="disconnect">Disconnect</option>
              </select>
            </label>
            <button type="submit" disabled={busy || run.status !== "active"}>
              Send to Lead
            </button>
          </div>
        </form>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            await writeApi("tasks", {
              runId: run.id,
              title: taskTitle,
              objective: taskTitle,
            });
            setTaskTitle("");
          });
        }}
      >
        <div className="form-row">
          <label>
            Add an owner task
            <input
              required
              value={taskTitle}
              onChange={(event) => setTaskTitle(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || run.status !== "active"}>
            Add task
          </button>
        </div>
      </form>
    </>
  );
}
