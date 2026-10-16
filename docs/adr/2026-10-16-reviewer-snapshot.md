# M5 reviewer: independent read-only review of a candidate snapshot

## Context

Spec §8.3 and §8.5 require reviewers to see the candidate in the context of the surrounding repository, ideally in a separate read-oriented worktree at the candidate commit. They must not be limited to a diff, and should judge the change before seeing the implementer's summary. Pi workers have no shell or Git access, so a reviewer cannot compute the diff itself. Role templates carry no capability flags yet (role CRUD is M7).

## Decision

- **A review is a child task bound to one integration candidate.** `task.reviewCandidateId` is set only by the engine (`request_review` / `POST /api/tasks/review`), never through generic task create/update. A review is requested only for an implementation task in AWAITING_REVIEW that has a persisted candidate. Request revisions on the implementation task, never on its review.
- **Only read-only profiles review.** This is checked when the review is requested and again at enqueue, so an owner cannot approve a review task onto a writer either. Any read-only roster profile qualifies; the preset Reviewer role is the intended one.
- **Fresh worktree at the candidate commit** on its own `lao/attempt-<id>` branch. Before any Git mutation, the engine refuses if `lao/candidate-<attempt>` no longer points at the recorded SHA or the base differs. The candidate branch is never moved.
- **Context packet as the prompt:** the review objective, the original task's objective and acceptance criteria, base/candidate SHAs, changed files and a diff bounded to 48,000 characters. The packet is saved as a `reference` artifact; the journal (`review.packet`) records only refs and paths. The implementer's report is excluded, and worker tools cannot read reports.
- **Completion check:** the M3 any-change rule for read-only sessions, plus HEAD must still equal the starting commit (the candidate for reviewers, the base for readers). A violation fails to RETRY_DECISION.
- **New Lead tool `request_review`:** Supervised mode records a proposal for owner approval; Chat/Plan cannot use it. It counts against the worker launch budget like any worker.

## Consequences

- The reviewer currently returns the standard handoff report. M5 item 4 adds the structured review (recommendation, confidence, file/line findings) and persists `reviews`. A finished review task sits in AWAITING_REVIEW like a reader.
- Reviewers cannot run tests (no shell); they report tests as not run.
- A diff larger than the Git output buffer (4 MiB) fails the review attempt safely to RETRY_DECISION instead of truncating silently.
- Worktrees remain working-copy isolation, not an OS sandbox; read-only enforcement is the Pi tool allowlist and guard extension plus the engine's post-run Git check.
