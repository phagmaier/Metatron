import { useEffect, useState } from "react";
import { z } from "zod";
import { artifactContentResponseSchema } from "../shared/api.ts";
import type {
  IntegrationCandidate,
  Run,
  Task,
} from "../shared/domain/entities.ts";
import {
  type IntegrationPreview,
  integrationPreviewSchema,
} from "../shared/integration.ts";
import { readApi, writeApi } from "./api.ts";
import { ApplyPanel } from "./apply-panel.tsx";

const short = (sha: string | null) => sha?.slice(0, 12) ?? "pending";

// Loads a saved test log or diff only when the owner asks for it.
export function ArtifactText({
  artifactId,
  label,
  onError,
}: {
  artifactId: string;
  label: string;
  onError: (error: string) => void;
}) {
  const [text, setText] =
    useState<z.infer<typeof artifactContentResponseSchema>>();
  if (text)
    return (
      <div>
        <pre className="report diff">{text.content}</pre>
        {text.truncated && (
          <p className="warning">
            Truncated for display; the full file is {text.artifact.path}
          </p>
        )}
      </div>
    );
  return (
    <button
      type="button"
      onClick={() =>
        void readApi(`artifacts?id=${artifactId}`)
          .then((value) => setText(artifactContentResponseSchema.parse(value)))
          .catch((error: unknown) =>
            onError(error instanceof Error ? error.message : "Load failed"),
          )
      }
    >
      {label}
    </button>
  );
}

// Builds and tests the candidate in a separate app-owned worktree and takes the
// owner's verdict. Only ApplyPanel, after its own confirmation, changes a branch.
export function IntegrationPanel({
  task,
  run,
  candidate,
  refresh,
  onError,
}: {
  task: Task;
  run: Run;
  candidate: IntegrationCandidate | undefined;
  refresh: number | undefined;
  onError: (error: string) => void;
}) {
  const [previews, setPreviews] = useState<IntegrationPreview[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [branch, setBranch] = useState(
    run.repository?.branch === "HEAD" ? "" : (run.repository?.branch ?? ""),
  );
  const [commands, setCommands] = useState("");
  const [rationale, setRationale] = useState("");
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
  const shown = previews.find((preview) => preview.id === selectedId) ?? latest;
  const declined = candidate?.humanDecision === "rejected";
  // An approved, unapplied candidate may get a new preview, e.g. after the
  // destination moved; approving it replaces the earlier approval.
  const approvedStage =
    ["READY_TO_INTEGRATE", "BLOCKED_CONFLICT"].includes(task.status) &&
    candidate?.humanDecision === "approved";
  const reviewStage =
    task.status === "AWAITING_REVIEW" && !!candidate && !declined;
  const approved = previews.findLast(
    (p) =>
      p.decision?.outcome === "approved" && p.candidateId === candidate?.id,
  );
  async function send(path: string, input: unknown) {
    setBusy(true);
    onError("");
    try {
      const preview = integrationPreviewSchema.parse(
        await writeApi(path, input),
      );
      setPreviews((items) => [
        ...items.filter((item) => item.id !== preview.id),
        preview,
      ]);
      setSelectedId("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  const decidable =
    latest &&
    shown?.id === latest.id &&
    latest.status !== "preparing" &&
    !latest.decision &&
    candidate?.id === latest.candidateId &&
    ((reviewStage && !candidate.humanDecision) || approvedStage);
  return (
    <details>
      <summary>
        Integration{latest ? ` · ${latest.status}` : ""}
        {latest?.decision ? ` · ${latest.decision.outcome}` : ""}
        {approved?.applications.length
          ? ` · ${approved.applications.at(-1)?.status}`
          : ""}
      </summary>
      <p className="note">
        A preview applies the reviewed candidate to the destination's recorded
        commit in a separate worktree (a fast-forward, or a merge if the branch
        moved) and runs your test commands there. Previews never change your
        checkout or branches, and conflicts are never resolved for you.
      </p>
      <p className="note">
        Saved previews, diffs, test logs and worktrees remain available after
        denial, blocked integration, revision or cancellation.
      </p>
      {previews.length > 1 && (
        <label>
          Saved preview
          <select
            value={shown?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {previews.toReversed().map((preview) => (
              <option key={preview.id} value={preview.id}>
                {preview.id === latest?.id ? "Latest" : "Earlier"} ·{" "}
                {preview.destinationBranch} · {preview.status}
                {preview.decision ? ` · ${preview.decision.outcome}` : ""} ·{" "}
                {short(preview.candidateSha)} ·{" "}
                {new Date(preview.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}
      {task.status === "AWAITING_REVIEW" && declined && (
        <p className="warning">
          You declined this candidate. Request a revision to integrate new work;
          its history, diff, logs and worktrees are kept.
        </p>
      )}
      {(reviewStage || approvedStage) && (
        <div>
          {approvedStage && (
            <p className="note">
              If the destination moved, prepare a new preview against it and
              approve that one before applying.
            </p>
          )}
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
            onClick={() =>
              void send("tasks/integration", {
                taskId: task.id,
                destinationBranch: branch.trim(),
                tests: commands
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => line.split(/\s+/)),
              })
            }
          >
            Prepare integration preview
          </button>
        </div>
      )}
      {shown && (
        <div
          key={`evidence-${shown.id}`}
          className={
            shown.status === "passed" &&
            shown.checks.every((check) => check.status !== "warning")
              ? "note"
              : "warning"
          }
        >
          <p>
            Preview {shown.status} · {shown.destinationBranch} @{" "}
            {short(shown.destinationSha)} →{" "}
            {shown.resultSha ? short(shown.resultSha) : "no result commit"}
            {shown.id !== latest?.id ? " · saved earlier preview" : ""}
          </p>
          <p className="note">
            Candidate {short(shown.candidateSha)} · {shown.branch}
          </p>
          <p className="path">{shown.worktreePath}</p>
          {shown.drift && (
            <p>
              Destination moved {shown.drift.commits}{" "}
              {shown.drift.commits === 1 ? "commit" : "commits"} since the
              candidate base; changed there:{" "}
              {shown.drift.files.map((file) => file.path).join(", ") || "none"}
              {shown.drift.filesTruncated ? " …" : ""}
              {shown.drift.overlapping.length > 0 &&
                `. Also changed by the candidate: ${shown.drift.overlapping.join(", ")}`}
            </p>
          )}
          {shown.conflicts.length > 0 && (
            <p>
              Conflicts left unresolved in the worktree above:{" "}
              {shown.conflicts.join(", ")}. Reconcile the destination or request
              a revision, then prepare a new preview.
            </p>
          )}
          <ul>
            {shown.checks.map((check) => (
              <li key={check.name}>
                {check.name}: {check.status} — {check.detail}
              </li>
            ))}
          </ul>
          {shown.testResults.length > 0 && (
            <ul className="reviews">
              {shown.testResults.map((result, index) => (
                <li key={result.artifactId}>
                  Test {index + 1} <code>{result.argv.join(" ")}</code>:{" "}
                  {result.result}
                  {result.exitCode !== null ? ` · exit ${result.exitCode}` : ""}
                  {result.signal ? ` · ${result.signal}` : ""} ·{" "}
                  {(result.durationMs / 1000).toFixed(1)} s
                  {result.outputTruncated ? " · earlier output truncated" : ""}
                  <ArtifactText
                    artifactId={result.artifactId}
                    label="Show output"
                    onError={onError}
                  />
                </li>
              ))}
            </ul>
          )}
          {shown.diffArtifactId && (
            <ArtifactText
              artifactId={shown.diffArtifactId}
              label={`Show final diff ${short(shown.destinationSha)}..${short(shown.resultSha)}`}
              onError={onError}
            />
          )}
          {shown.diagnostic && <p>{shown.diagnostic}</p>}
        </div>
      )}
      {shown?.decision && (
        <p className="note">
          {shown.decision.outcome === "approved"
            ? `Approved for ${shown.destinationBranch} @ ${short(shown.destinationSha)} (result ${short(shown.resultSha)}).`
            : "Declined; the candidate is rejected and kept as history."}{" "}
          <time dateTime={shown.decision.decidedAt}>
            {new Date(shown.decision.decidedAt).toLocaleString()}
          </time>
          {shown.decision.rationale ? ` · ${shown.decision.rationale}` : ""}
        </p>
      )}
      {decidable && (
        <div>
          <label>
            Decision note (optional)
            <textarea
              value={rationale}
              maxLength={4000}
              onChange={(event) => setRationale(event.target.value)}
            />
          </label>
          <p className="note">
            Approving records your decision for this exact preview; applying it
            to {latest.destinationBranch} is a separate, confirmed step.
            {reviewStage &&
              " Declining rejects the candidate; the task stays open for a revision or cancellation."}
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={
                busy || latest.status !== "passed" || run.mode === "chat_plan"
              }
              onClick={() =>
                void send("integrations/decision", {
                  integrationId: latest.id,
                  decision: "approve",
                  rationale,
                })
              }
            >
              Approve for {latest.destinationBranch}
            </button>
            {reviewStage && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void send("integrations/decision", {
                    integrationId: latest.id,
                    decision: "decline",
                    rationale,
                  })
                }
              >
                Decline candidate
              </button>
            )}
          </div>
        </div>
      )}
      {shown?.decision?.outcome === "approved" && (
        <ApplyPanel
          key={`apply-${shown.id}`}
          preview={shown}
          task={task}
          canApply={shown.id === approved?.id}
          onApplied={(preview) =>
            setPreviews((items) =>
              items.map((item) => (item.id === preview.id ? preview : item)),
            )
          }
          onError={onError}
        />
      )}
    </details>
  );
}
