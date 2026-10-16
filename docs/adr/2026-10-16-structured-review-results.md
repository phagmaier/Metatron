# M5: structured independent review results

## Context

Spec §8.5 and M5 item 4 require categorized, actionable findings and an independent pass/changes-requested recommendation. The [snapshot decision](2026-10-16-reviewer-snapshot.md) already isolates each reviewer at an immutable candidate commit; its ordinary worker report did not carry a validated recommendation or persist a review.

## Decision

- Review tasks use their own `submit_result` schema, advertised per assignment by the gateway and checked again by the engine. Ordinary workers cannot submit reviews. Candidate/task/attempt linkage is engine-owned, never supplied by the model.
- Require summary, recommendation, findings and test limitations. Each finding has a `blocking`, `important`, `suggestion` or `nit` severity, a repository-relative file, a positive line, justification, evidence and confidence in [0,1]. Locations refer to candidate lines, or base lines for deleted files. A pass cannot contain blocking/important findings; changes requested needs an actionable finding. Location content and evidence remain model claims, not engine verification.
- Current reviewers have no shell: require at least one test entry, all `not_run`. Do not accept claimed test passes/failures. No tools or permissions are widened.
- Tool submissions are provisional journal entries. Persist a review only after authoritative native completion, shutdown and the existing clean-HEAD/worktree checks. The storage boundary also requires clean Git evidence at the assigned candidate. Missing/invalid/text-only results, tampering or ambiguous exits require `RETRY_DECISION`; no review is inferred or automatically retried.
- Migration v5 enforces one review per reviewer attempt and append-only review records. Save the record, candidate `reviewIds`/`reviewed` status, event and completed attempt atomically. Separate review attempts preserve every prior assessment; completed mutations are idempotent. Restart never adopts provisional submissions.
- `read_report` exposes recorded review history for either the implementation task or its review child. The normal saved report artifact contains the structured result. Workers still cannot read reports, preserving independent assessment.

## Consequences

A review recommendation grants no integration authority. Both tasks remain `AWAITING_REVIEW`; applying `CHANGES_REQUESTED` and safe revision handoff are item 5. Review GUI and owner decision controls remain item 8. The independent context packet still excludes the implementer's report. There were no review-producing APIs before this milestone, so no legacy review data is backfilled. No dependency, toolchain or spec changes.
