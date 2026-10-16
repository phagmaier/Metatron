import { useState } from "react";
import { z } from "zod";
import type { Project } from "../shared/domain/entities.ts";
import { runSchema } from "../shared/domain/entities.ts";
import { readApi, writeApi } from "./api.ts";

const catalogSchema = z.object({
  installed: z.boolean(),
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
export function NativeRunForm({
  project,
  onRun,
  onError,
}: {
  project: Project;
  onRun: (id: string) => void;
  onError: (error: string) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [permission, setPermission] = useState("read_only");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    onError("");
    try {
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Native command failed");
    } finally {
      setBusy(false);
    }
  }
  const selected = catalog?.models.find((m) => m.id === model);
  return (
    <details className="new-run">
      <summary>Run a real Pi worker</summary>
      <p>
        Owner-directed native worker in a retained isolated worktree, without a
        Lead. Live calls use your configured provider and may incur costs.
      </p>
      <p className="note">
        File tools plus the app's session report tools. Readers cannot write;
        writers can read/edit/write within the worktree. Shell, personal MCP
        servers and extensions are disabled. This is not an OS sandbox. Tests
        are reported as not run.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void act(async () => {
            const next = catalogSchema.parse(await readApi("adapters/pi"));
            setCatalog(next);
            setModel(next.models[0]?.id ?? "");
            setThinking("");
          })
        }
      >
        Discover Pi models
      </button>
      {catalog && (
        <>
          {catalog.diagnostics.map((message) => (
            <p className="note" key={message}>
              {message}
            </p>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                const run = runSchema.parse(
                  await writeApi("runs/native", {
                    projectId: project.id,
                    title: `Pi ${permission === "read_only" ? "reader" : "writer"}`,
                    initialPrompt: prompt,
                    model,
                    thinking: thinking || null,
                    permission,
                  }),
                );
                onRun(run.id);
              });
            }}
          >
            <div className="form-row">
              <label>
                Pi model
                <select
                  required
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value);
                    setThinking("");
                  }}
                >
                  {catalog.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pi thinking
                <select
                  value={thinking}
                  onChange={(event) => setThinking(event.target.value)}
                >
                  <option value="">Native model default</option>
                  {selected?.thinking.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Worker permissions
                <select
                  value={permission}
                  onChange={(event) => setPermission(event.target.value)}
                >
                  <option value="read_only">Reader (file reads only)</option>
                  <option value="workspace_write">Writer (file edits)</option>
                </select>
              </label>
            </div>
            <label>
              Native worker objective
              <textarea
                required
                rows={3}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={busy || !catalog.installed || !model}
            >
              Start real Pi worker
            </button>
          </form>
        </>
      )}
    </details>
  );
}
