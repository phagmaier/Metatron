import { useState } from "react";
import type { Run } from "../shared/domain/entities.ts";
import { workflowRunSchema } from "../shared/workflows.ts";
import { writeApi } from "./api.ts";

// The owner fills only declared inputs of a template frozen in this run's team
// snapshot; the server revalidates the template, roster, bounds and mode.
export function WorkflowRunForm({
  run,
  onError,
}: {
  run: Run;
  onError: (error: string) => void;
}) {
  const snapshot = run.teamSnapshot;
  const templates = (snapshot?.workflows ?? []).filter((template) =>
    snapshot?.preset.workflowTemplateIds.includes(template.id),
  );
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState("");
  const template = templates.find((item) => item.id === templateId);
  if (!template) return null;
  const agents = template.stages.reduce((sum, stage) => sum + stage.count, 0);
  const held =
    run.status !== "active"
      ? "Resume the run before starting a workflow."
      : run.mode === "chat_plan"
        ? "Chat/Plan cannot start workflows; change the run mode first."
        : null;
  return (
    <details className="new-run">
      <summary>Run a saved workflow</summary>
      <p className="note">
        Only workflows saved in this run's team snapshot are offered. Each of
        its {agents} child agents uses normal scheduling slots and launch
        budget.{" "}
        {run.execution === "fake"
          ? "This FAKE run uses scripted playback only."
          : "Children start live native harness sessions that may incur costs."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setStarted("");
          onError("");
          writeApi("workflows", {
            runId: run.id,
            templateId: template.id,
            parameters: Object.fromEntries(
              template.inputs.map((input) => [
                input.name,
                values[input.name] ?? "",
              ]),
            ),
          })
            .then((value) => {
              setStarted(workflowRunSchema.parse(value).id);
              setValues({});
            })
            .catch((error: unknown) =>
              onError(
                error instanceof Error
                  ? error.message
                  : "Workflow start failed",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Saved workflow
          <select
            value={template.id}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · v{item.version}
              </option>
            ))}
          </select>
        </label>
        <p className="note">
          {template.stages
            .map((stage) => `${stage.id} ×${stage.count} (${stage.type})`)
            .join(" → ")}
        </p>
        {template.inputs.map((input) => (
          <label key={input.name}>
            {input.name}
            <span className="note">{input.description}</span>
            <textarea
              required
              rows={2}
              maxLength={4000}
              value={values[input.name] ?? ""}
              onChange={(event) =>
                setValues({ ...values, [input.name]: event.target.value })
              }
            />
          </label>
        ))}
        {held && <p className="warning">{held}</p>}
        {started && (
          <p className="note">Started workflow {started.slice(0, 8)}.</p>
        )}
        <button type="submit" disabled={busy || Boolean(held)}>
          Start workflow
        </button>
      </form>
    </details>
  );
}
