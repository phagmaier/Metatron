import { useState } from "react";
import { z } from "zod";
import type { Project } from "../shared/domain/entities.ts";
import { runSchema } from "../shared/domain/entities.ts";
import { readApi, writeApi } from "./api.ts";

const catalogSchema = z.object({
  installed: z.boolean(),
  authenticated: z.union([z.boolean(), z.literal("unknown")]),
  diagnostics: z.array(z.string()),
  models: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      thinking: z.array(z.object({ id: z.string(), label: z.string() })),
    }),
  ),
});
type Catalog = z.infer<typeof catalogSchema>;
function ModelPicker({
  label,
  catalog,
  model,
  thinking,
  onChange,
}: {
  label: string;
  catalog: Catalog;
  model: string;
  thinking: string;
  onChange: (model: string, thinking: string) => void;
}) {
  const selected = catalog.models.find((m) => m.id === model);
  return (
    <>
      <label>
        {label} model
        <select
          required
          value={model}
          onChange={(event) => onChange(event.target.value, "")}
        >
          {catalog.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {label} thinking
        <select
          value={thinking}
          onChange={(event) => onChange(model, event.target.value)}
        >
          <option value="">Native model default</option>
          {selected?.thinking.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
export function LeadRunForm({
  project,
  onRun,
  onError,
}: {
  project: Project;
  onRun: (id: string) => void;
  onError: (error: string) => void;
}) {
  const [catalogs, setCatalogs] = useState<{ codex: Catalog; pi: Catalog }>();
  const [lead, setLead] = useState({ model: "", thinking: "" });
  const [worker, setWorker] = useState({ model: "", thinking: "" });
  const [mode, setMode] = useState("chat_plan");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    onError("");
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Lead command failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="new-run">
      <summary>Run a real Codex Lead with Pi workers</summary>
      <p>
        The Lead coordinates through session-scoped tools; workers run in
        retained isolated worktrees. Live calls use your Codex and Pi providers
        and may incur costs.
      </p>
      <p className="note">
        Lead: read-only Codex sandbox without network, approvals never granted,
        no native sub-agents. Mode, roster, budgets and owner overrides are
        enforced server-side. This is not an OS isolation boundary for reads.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void act(async () => {
            const [codex, pi] = await Promise.all([
              readApi("adapters/codex").then((v) => catalogSchema.parse(v)),
              readApi("adapters/pi").then((v) => catalogSchema.parse(v)),
            ]);
            setCatalogs({ codex, pi });
            setLead({ model: codex.models[0]?.id ?? "", thinking: "" });
            setWorker({ model: pi.models[0]?.id ?? "", thinking: "" });
          })
        }
      >
        Discover Codex and Pi models
      </button>
      {catalogs && (
        <>
          {[...catalogs.codex.diagnostics, ...catalogs.pi.diagnostics].map(
            (message) => (
              <p className="note" key={message}>
                {message}
              </p>
            ),
          )}
          <p
            className={
              catalogs.codex.authenticated === true ? "note" : "warning"
            }
          >
            Codex login for this app:{" "}
            {catalogs.codex.authenticated === true ? "available" : "required"}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                const run = runSchema.parse(
                  await writeApi("runs/lead", {
                    projectId: project.id,
                    title: `Codex Lead · ${mode}`,
                    initialPrompt: prompt,
                    mode,
                    lead: {
                      model: lead.model,
                      thinking: lead.thinking || null,
                    },
                    worker: {
                      model: worker.model,
                      thinking: worker.thinking || null,
                    },
                  }),
                );
                onRun(run.id);
              });
            }}
          >
            <div className="form-row">
              <ModelPicker
                label="Lead"
                catalog={catalogs.codex}
                model={lead.model}
                thinking={lead.thinking}
                onChange={(model, thinking) => setLead({ model, thinking })}
              />
            </div>
            <div className="form-row">
              <ModelPicker
                label="Worker"
                catalog={catalogs.pi}
                model={worker.model}
                thinking={worker.thinking}
                onChange={(model, thinking) => setWorker({ model, thinking })}
              />
              <label>
                Mode
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value)}
                >
                  <option value="chat_plan">Chat/Plan</option>
                  <option value="supervised">Supervised</option>
                  <option value="autonomous_bounded">
                    Autonomous (bounded)
                  </option>
                </select>
              </label>
            </div>
            <label>
              Objective for the Lead
              <textarea
                required
                rows={3}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={
                busy ||
                catalogs.codex.authenticated !== true ||
                !lead.model ||
                !worker.model
              }
            >
              Start Codex Lead run
            </button>
          </form>
        </>
      )}
    </details>
  );
}
