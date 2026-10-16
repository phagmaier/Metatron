import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  candidateDiffResponseSchema,
  type ReviewHistory,
  reviewHistoryResponseSchema,
} from "../shared/api.ts";
import type { Run } from "../shared/domain/entities.ts";
import { readApi } from "./api.ts";

const severityOrder = ["blocking", "important", "suggestion", "nit"];
const short = (sha: string) => sha.slice(0, 12);

export function useReviewHistory(
  taskId: string | null,
  refresh: string,
  onError: (error: string) => void,
) {
  const [history, setHistory] = useState<ReviewHistory>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new review, candidate or integration event triggers the refetch.
  useEffect(() => {
    if (!taskId) return;
    const controller = new AbortController();
    readApi(`reviews?taskId=${taskId}`, controller.signal)
      .then((value) => setHistory(reviewHistoryResponseSchema.parse(value)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          onError(error instanceof Error ? error.message : "Load failed");
      });
    return () => controller.abort();
  }, [taskId, refresh, onError]);
  return history;
}

type ReviewEntry = ReviewHistory["reviews"][number];

function ReviewItem({ entry, run }: { entry: ReviewEntry; run: Run }) {
  const { review } = entry;
  const reviewer = run.teamSnapshot?.profiles.find(
    (profile) => profile.id === entry.reviewerProfileId,
  );
  const findings = [...review.findings].sort(
    (a, b) =>
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );
  return (
    <li>
      <p>
        <strong>
          {review.recommendation === "pass" ? "Pass" : "Changes requested"}
        </strong>{" "}
        · {reviewer ? `${reviewer.name} (${reviewer.model})` : "Reviewer"} ·{" "}
        <time dateTime={review.createdAt}>
          {new Date(review.createdAt).toLocaleString()}
        </time>
      </p>
      <p>{review.summary}</p>
      {findings.length === 0 ? (
        <p className="note">No findings.</p>
      ) : (
        <ul className="findings">
          {findings.map((finding) => (
            <li
              key={`${finding.file}:${finding.line}:${finding.justification}`}
            >
              <code>{finding.severity}</code>{" "}
              <span className="path">
                {finding.file}:{finding.line}
              </span>{" "}
              · confidence {Math.round(finding.confidence * 100)}%
              <p>{finding.justification}</p>
              <p className="note">Evidence: {finding.evidence}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="note">
        Tests the reviewer named, not run (reviewers have no shell):{" "}
        {review.tests.map((t) => t.command).join("; ")}
      </p>
    </li>
  );
}

// Browse saved candidates and their independent reviews without changing the
// current candidate that integration actions resolve to.
export function ReviewPanel({
  history,
  run,
  onError,
}: {
  history: ReviewHistory;
  run: Run;
  onError: (error: string) => void;
}) {
  const [diff, setDiff] =
    useState<z.infer<typeof candidateDiffResponseSchema>>();
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const shown =
    history.candidates.find((c) => c.id === selectedId) ??
    history.candidates.find((c) => c.id === history.currentCandidateId) ??
    history.candidates.at(-1);
  const shownReviews = history.reviews
    .filter((entry) => entry.review.candidateId === shown?.id)
    .reverse();
  const earlier = history.reviews
    .filter((entry) => entry.review.candidateId !== shown?.id)
    .reverse();
  const latest = shownReviews[0]?.review.recommendation;
  async function loadDiff(candidateId: string) {
    setBusy(true);
    onError("");
    try {
      setDiff(
        candidateDiffResponseSchema.parse(
          await readApi(`candidates/diff?candidateId=${candidateId}`),
        ),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Diff failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>
        Review · {shownReviews.length}{" "}
        {shownReviews.length === 1 ? "review" : "reviews"}
        {latest
          ? ` · latest ${latest === "pass" ? "pass" : "changes requested"}`
          : ""}
      </summary>
      {history.candidates.length > 1 && (
        <label>
          Saved candidate
          <select
            value={shown?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {history.candidates.toReversed().map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {short(candidate.candidateSha)} · {candidate.status}
                {candidate.id === history.currentCandidateId
                  ? " · current"
                  : " · earlier"}
              </option>
            ))}
          </select>
        </label>
      )}
      {shown ? (
        <div>
          <p className="note">
            Candidate {short(shown.candidateSha)} on base {short(shown.baseSha)}{" "}
            · {shown.status}
            {shown.reportSubmitted ? "" : " · no worker report submitted"}
          </p>
          {shown.id !== history.currentCandidateId && (
            <p className="note">
              Saved candidate from an earlier attempt. Its diff and reviews
              remain available while revisions proceed or after cancellation.
            </p>
          )}
          {diff?.candidateId === shown.id ? (
            <div>
              <p className="note">
                {diff.files.length} {diff.files.length === 1 ? "file" : "files"}{" "}
                changed:{" "}
                {diff.files.map((f) => `${f.status} ${f.path}`).join(", ")}
              </p>
              <pre className="report diff">{diff.patch}</pre>
              {diff.truncated && (
                <p className="warning">
                  Diff truncated for display; inspect the candidate branch for
                  the rest.
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadDiff(shown.id)}
            >
              Show candidate diff
            </button>
          )}
        </div>
      ) : (
        <p className="note">The shown revision has no captured candidate.</p>
      )}
      {shownReviews.length === 0 ? (
        <p className="note">No independent review of this candidate yet.</p>
      ) : (
        <ul className="reviews">
          {shownReviews.map((entry) => (
            <ReviewItem key={entry.review.id} entry={entry} run={run} />
          ))}
        </ul>
      )}
      {earlier.length > 0 && (
        <details>
          <summary>Reviews of other candidates ({earlier.length})</summary>
          <ul className="reviews">
            {earlier.map((entry) => (
              <ReviewItem key={entry.review.id} entry={entry} run={run} />
            ))}
          </ul>
        </details>
      )}
    </details>
  );
}
