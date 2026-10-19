# Active development backlog

The initial beta implementation is recorded in [todo.md](todo.md). The `beta` tag points to `12a9cc653b563d1b801728eaa95b94321c0c283a`; [release scope, evidence and pending owner sign-off](docs/releases/beta.md) are separate from development task status.

Follow the owner's current request; otherwise use the first unblocked **Now** item. Work on one focused item. **Next/Later** are candidates to select and refine, not instructions to implement automatically. Historical milestone/reconnaissance “next task” notes do not choose work.

Before implementing a selected item, record its problem, relevant spec sections, acceptance criteria, safety/data impact and verification. Use [AGENTS.md](AGENTS.md) and the [development guide](docs/development.md#working-on-one-item). Keep detailed findings in a linked report rather than expanding this file into another session diary.

## Now

- [x] **POST-001 — Beta closeout and post-beta development workflow.** Docs/instructions only: record beta scope and known limits with owner release sign-off pending; retain the original plan/evidence; route active work here; retire old execution guidance. Done when local links/anchors and commands validate, standard checks pass, and the diff contains only documentation. [Session result](docs/progress.md#2026-10-18--post-001-beta-closeout-and-development-workflow).
- [x] **POST-002 — Independent baseline review: integration and restart safety.** Produce a review report before any fixes. Review the `beta` baseline and relevant tests against spec §§8, 10, 12–13.2; assess assumptions separately under §§0–1 and 17. Current docs may supply navigation, but identify the commit used for every code finding. This review can proceed while release sign-off is pending.

  **Done:** trace owner confirmation → Git apply and ambiguous attempt → restart/recovery. Report demonstrated risks of lost work, duplicate execution, stale approval or wrong-repository mutation with source locations, severity, confidence, reproduction/verification and smallest proposed fix. Identify coverage gaps separately. For design assumptions, state the tradeoff and a small reversible experiment; no actionable bugs is a valid result. Link the report and propose individually scoped follow-ups. No application edits, native model calls or changes to retained owner data/worktrees in this item.

  **Result:** [Independent review](docs/reviews/post-002-beta.md) of `12a9cc653b563d1b801728eaa95b94321c0c283a`; both flows traced and three P1 defects reproduced on disposable Git/SQLite/protocol state. Standard checks and crash/restart rehearsal passed; gaps and assumption experiments are separate. No fixes, application/test edits or native calls; owner release sign-off remains pending.
- [x] **POST-006 — Bind integration/recovery authority to repository filesystem identity.** Address review F1: a same-path replacement clone currently inherits the original run's authority. Relevant contract: spec §§8.1, 8.6, 10.2, 12. Done when replacement root/common-directory fixtures refuse application and recovery retry before mutation, legacy/unverified identity requires explicit reopening, and original/replacement work is retained unchanged. [Finding and reproduction](docs/reviews/post-002-beta.md).

  **Result:** persisted root/common-directory directory identity is enforced at run admission, dispatch/worktree use, integration and recovery. Eight regressions and the 486/486 full suite pass; HTTP clone/restart smoke refused mutation/retry with unchanged original/replacement heads and retained partial work. Explicit reopening authorizes new runs only. [Decision and legacy transition](docs/adr/2026-10-18-repository-filesystem-identity.md), [session result](docs/progress.md#2026-10-18--post-006-repository-filesystem-identity). POST-007/008 remain unfixed; recommended next selection is **POST-007**, not started. Owner release sign-off remains pending.

## Next — candidates

Remaining POST-002 follow-ups are proposals, not started:

- [ ] **POST-007 — Revalidate current independent review at integration application.** Address review F2: a failed reviewer can be retried after approval and save important findings without blocking the old preview. Relevant contract: spec §§8.5–8.6, 10.2, 12. Done when the failed-review → approval → explicit retry → newer findings sequence refuses stale application, including queued/running reviews, while retaining review/decision history and requiring a current passing preview plus owner approval. [Finding and reproduction](docs/reviews/post-002-beta.md).
- [ ] **POST-008 — Enforce current mode at integration and first-prompt boundaries.** Address review F3: asynchronous planning/startup can outlive a switch to Chat/Plan. Relevant contract: spec §§4.2, 8.6, 10.2, 12. Done when deterministic mode-change interleavings refuse integration approval/application and initial worker prompting, with retained evidence, explicit recovery and unchanged ordinary scheduling-pause semantics. [Finding and reproduction](docs/reviews/post-002-beta.md).

- [ ] **POST-003 — Run existing no-cost checks in CI.** Protect changes with the pinned toolchain and the exact [default commands](docs/development.md#default-checks--no-model-turns). Done when a clean CI checkout passes and no native model calls, harness credentials or personal configuration are required. Relevant contract: spec §13.
- [ ] **POST-004 — Diagnose OpenCode tool-refusal turn loss.** Capture the installed native protocol on a disposable fixture before changing refusal behavior; the earlier feedback-only attempt failed. Preserve the file policy and explicit recovery. Done when a reproduction and regression verify a supported fix, or a precise unsupported diagnostic/limitation is retained. Relevant contract: spec §§5, 10, 13. Native model calls require separately scoped authorization. [Existing failures](docs/releases/beta.md#known-issues-and-coverage-limits).
- [ ] **POST-005 — Turn actual-use friction into focused issues.** Record owner-selected small workflows, expected/actual behavior, manual interventions and recovery outcomes; distinguish usability problems from unavailable capabilities. Done when observed friction yields prioritized reproductions or small experiments. Relevant contract: spec §§1, 11, 17. This entry grants no native spending or managed-repository mutation authority.

## Later — ideas, not commitments

- Expand live Claude/OpenCode writer → independent review → approved integration coverage if those paths are needed; require explicit native-call/disposable-write scope and separate integration approval.
- Evaluate backup/restore and upgrade guidance for persisted app data as real usage accumulates; preserve existing databases, pending decisions and retained worktrees.
- Revisit the [original deferred ideas](todo.md#future-backlog---deliberately-out-of-beta) only after selecting a concrete problem: stronger OS isolation, dynamic/nested workflows, context strategy, richer notifications or broader automation. Their original order is not a roadmap.

## Release decisions outside the implementation queue

Owner acceptance of beta limits, tag/release publication and license choice are separate from completing an engineering item. Current release status lives in the [beta release note](docs/releases/beta.md). Updating this backlog does not grant release approval, model spend, automatic integration or broader product authority.
