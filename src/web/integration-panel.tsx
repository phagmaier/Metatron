import { useEffect, useState } from "react";
import { z } from "zod";
import type { Run, Task } from "../shared/domain/entities.ts";
import {
  type IntegrationPreview,
  integrationPreviewSchema,
} from "../shared/integration.ts";
import { readApi, writeApi } from "./api.ts";

// Preview only: builds and tests the candidate in a separate app-owned
// worktree. Approval and applying to a local branch are later M5 items.
export function IntegrationPanel({
  task,
  run,
  refresh,
  onError,
}: {
  task: Task;
  run: Run;
  refresh: number | undefined;
  onError: (error: string) => void;
}) {
  const [previews, setPreviews] = useState<IntegrationPreview[]>([]);
  const [branch, setBranch] = useState(
    run.repository?.branch === "HEAD" ? "" : (run.repository?.branch ?? ""),
  );
  const [commands, setCommands] = useState("");
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new integration journal event triggers the refetch.
  useEffect(() => {
    const controller = new AbortController();
    readApi(`integrations?taskId=${task.id}`, controller.signal)
      .then((value) =>
        setPreviews(z.array(integrationPreviewSchema).parse(value)),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          onError(error instanceof Error ? error.message : "Load failed");
      });
    return () => controller.abort();
  }, [task.id, refresh, onError]);
  const latest = previews.at(-1);
  async function prepare() {
    setBusy(true);
    onError("");
    try {
      const preview = integrationPreviewSchema.parse(
        await writeApi("tasks/integration", {
          taskId: task.id,
          destinationBranch: branch.trim(),
          tests: commands
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => line.split(/\s+/)),
        }),
      );
      setPreviews((items) => [
        ...items.filter((item) => item.id !== preview.id),
        preview,
      ]);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>
        Integration preview{latest ? ` · ${latest.status}` : ""}
      </summary>
      <p className="note">
        Applies the reviewed candidate to the destination's recorded commit in a
        separate worktree (a fast-forward, or a merge if the branch moved) and
        runs your test commands there. Your checkout and branches are not
        changed; nothing is applied and conflicts are never resolved for you.
      </p>
      {task.status === "AWAITING_REVIEW" && (
        <div>
          <label>
            Destination branch
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            />
          </label>
          <label>
            Test commands (one per line)
            <textarea
              value={commands}
              placeholder="pnpm test"
              onChange={(event) => setCommands(event.target.value)}
            />
          </label>
          <p className="warning">
            Commands run with your user permissions on agent-written code; no
            shell, so quotes, pipes and variables are not interpreted.
          </p>
          <button
            type="button"
            disabled={
              busy ||
              !branch.trim() ||
              run.mode === "chat_plan" ||
              latest?.status === "preparing"
            }
            onClick={() => void prepare()}
          >
            Prepare integration preview
          </button>
        </div>
      )}
      {latest && (
        <div
          className={
            latest.status === "passed" &&
            latest.checks.every((check) => check.status !== "warning")
              ? "note"
              : "warning"
          }
        >
          <p>
            {latest.status} · {latest.destinationBranch} @{" "}
            {latest.destinationSha ?? "pending"} →{" "}
            {latest.resultSha ?? "not applied"}
          </p>
          <p className="path">{latest.worktreePath}</p>
          {latest.drift && (
            <p>
              Destination moved {latest.drift.commits}{" "}
              {latest.drift.commits === 1 ? "commit" : "commits"} since the
              candidate base; changed there:{" "}
              {latest.drift.files.map((file) => file.path).join(", ") || "none"}
              {latest.drift.filesTruncated ? " …" : ""}
              {latest.drift.overlapping.length > 0 &&
                `. Also changed by the candidate: ${latest.drift.overlapping.join(", ")}`}
            </p>
          )}
          {latest.conflicts.length > 0 && (
            <p>
              Conflicts left unresolved in the worktree above:{" "}
              {latest.conflicts.join(", ")}. Reconcile the destination or
              request a revision, then prepare a new preview.
            </p>
          )}
          <ul>
            {latest.checks.map((check) => (
              <li key={check.name}>
                {check.name}: {check.status} — {check.detail}
              </li>
            ))}
            {latest.testResults.map((result, index) => (
              <li key={result.artifactId}>
                Test {index + 1} ({result.argv.join(" ")}): {result.result}
                {result.exitCode !== null ? ` · exit ${result.exitCode}` : ""}
              </li>
            ))}
          </ul>
          {latest.diagnostic && <p>{latest.diagnostic}</p>}
        </div>
      )}
    </details>
  );
}
