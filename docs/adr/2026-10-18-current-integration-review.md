# POST-007: integration authority requires current independent review

## Context

[POST-002 F2](../reviews/post-002-beta.md#f2--p1-a-recovered-reviewer-can-invalidate-the-verdict-without-invalidating-the-old-approval) reproduced an approved preview applying after an explicitly recovered reviewer durably recorded important findings. Spec §§8.5–8.6, 10.2 and 12 require retained reviews, explicit owner decisions and current evidence at mutation boundaries. Merely blocking apply would strand an approved implementation if revision/re-review remained unavailable.

## Decision

- The apply plan checks database eligibility after asynchronous Git observations; the final application claim repeats it inside its transaction. The preview must name the latest durable review of its exact implementation/candidate, that review must pass, and no review of that candidate may be READY, QUEUED, RUNNING, WAITING_HUMAN or WAITING_DEPENDENCY. Existing candidate, latest-approved-preview, repository filesystem identity and Git checks remain mandatory.
- A failed/interrupted review in `RETRY_DECISION` has no accepted verdict and does not execute automatically. It may remain deferred while the owner approves/applies existing passing evidence. Explicit recovery requeue immediately blocks the old approval; no retry may be admitted after the implementation becomes INTEGRATING or DONE. Refused recovery rolls back its decision and launch admission.
- A newer durable review of the current approved, unapplied candidate atomically returns its complete implementation/revision lineage from READY_TO_INTEGRATE or BLOCKED_CONFLICT to AWAITING_REVIEW. This happens for both pass and changes_requested. The ordinary bounded revision/re-review path is available again; completion never approves anything.
- The owner may also explicitly request a read-only re-review of approved, unapplied work. This supports reassessment and provides a safe path for previously persisted stale approvals without relinking history or silently adopting new authority. Lead permission is not expanded. Re-review still consumes ordinary budget/slots; native calls remain an owner cost decision.
- A current passing review needs a corresponding fresh passed preview and explicit owner approval. An already-approved candidate may receive that new preview decision, but cannot be retroactively declined. Cancellation/revision remain available. Reviews and old preview decisions are never rewritten, deleted or auto-approved; candidate decision fields retain the recorded owner history. Replaying a committed decision/application returns its historical result, not permission for a different operation.

## Consequences and verification

No SQL migration, identity backfill, new dependency, toolchain change or spec change. New state-table edges reopen review; transaction failures roll back evidence/state together. Existing stale records are denied dynamically even without a new completion; owners can explicitly re-review pending approved work. Earlier reviews/approvals/worktrees remain inspectable.

Six focused behavioral regressions cover important findings through real retry and Git application, a usable revision/re-review lineage, a newer passing review with fresh approval, queued/running reviews, async planning and final-claim interleavings, and refusal to retry after integration. Four original cases failed before the fix. [API/protocol and browser receipt](../evidence/post-007-review-smoke.json); [verification commands/results](../progress.md#2026-10-18--post-007-current-independent-review-at-application).

POST-006 root/common-directory identity and explicit recovery/budget/Git guardrails remain intact. POST-008 Chat/Plan interleavings are separate and unfixed. This change neither provides OS isolation nor grants beta release sign-off, publication, native spending or integration approval for owner repositories.
