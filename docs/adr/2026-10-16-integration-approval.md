# M5: owner approval and decline of integration previews

## Context

Spec §8.6.4 and §11.2 require the owner to inspect independent findings, the candidate diff, the final diff and test summaries, then explicitly approve or reject integration. Spec §7.1 puts `READY_TO_INTEGRATE` after `AWAITING_REVIEW` and keeps rejected integrations as history. Applying to a branch, with its own confirmation and final revalidation, is a separate later item (§8.6.5).

## Decision

- **Owner-only verdict on one finished preview.** `POST /api/integrations/decision` (`approve` or `decline`, optional note). No Lead or worker tool reaches it. The decision is written once on the preview record (`decision`, JSON default `null`, so no migration) and mirrored on its candidate (`status`/`humanDecision` `approved` or `rejected`, `decidedAt`), journaled as `integration.approved`/`integration.declined`.
- **Approval binds exactly what the owner saw.** It requires the whole revision lineage in `AWAITING_REVIEW`, a `passed` preview of the current candidate, that preview's review still being the candidate's latest and passing, no review of the candidate still queued or running, no earlier decision, Run mode other than Chat/Plan, and `refs/heads/<destination>` still at the preview's destination SHA (a read-only check; a replay with the same idempotency key returns the recorded decision). It then moves the original task and every revision in its lineage to `READY_TO_INTEGRATE` together. **Approval applies nothing**; branches, the owner's checkout and the retained integration worktree are untouched.
- **Decline rejects the candidate, not the task.** Any finished preview of the current candidate can be declined, in any mode. The task stays `AWAITING_REVIEW`, so the owner can request a revision (a new candidate needs its own review, preview and decision) or cancel; new previews of the declined candidate are refused. Nothing is deleted.
- **No way back from approval except cancellation.** §7.1 has no `READY_TO_INTEGRATE → AWAITING_REVIEW`; the owner can defer indefinitely or cancel (which now also cancels an approved current revision). Changing the state table is a spec change and was not needed. (Amended by the [apply ADR](2026-10-16-integration-apply.md): an approved, unapplied candidate may be previewed and approved again, e.g. after the destination moved.)
- **Read-only GUI data.** `GET /api/reviews` (candidates and reviews across the lineage, reviewer profile), `GET /api/candidates/diff` (base..candidate, external diff/textconv off) and `GET /api/artifacts` (recorded artifact text only), each truncated for display and flagged as such, back the task card's Review and Integration panels.

## Consequences

The owner can see review evidence, both diffs and test logs and record a durable, auditable verdict without any branch changing. Application must recheck the approved preview against the destination, its worktree and the owner's checkout immediately before acting; `BLOCKED_CONFLICT` belongs to that step ([apply ADR](2026-10-16-integration-apply.md)). Per-finding accept/reject (§8.5) is not implemented. No dependency, toolchain, migration or spec change.
