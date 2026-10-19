# POST-006: repository filesystem identity binds run authority

## Context

[POST-002 F1](../reviews/post-002-beta.md) demonstrated that an approved integration could apply to a separate clone installed at the original root path. Recovery likewise reported that clone as verified. The beta repository snapshot recorded canonical paths/SHA, but not directory identity. Existing worker-worktree identity already uses device, inode and birth time. Spec §§8.1, 8.6, 10.2 and 12 require identity-bound mutation and retained ambiguous work.

## Decision

- Repository snapshots record canonical root/common-directory paths plus `identity.root` and `identity.commonDirectory`, each a decimal device/inode/birth-time-nanoseconds tuple. Big integers are stored as strings, without precision loss. Inspection checks directory identity before and after Git observations; it neither marks nor changes the repository.
- One comparison checks paths and both directory identities. All run-admission paths, dispatch, worktree preparation/candidate verification, integration preparation/approval/application and recovery enforce the recorded authority. Application rechecks before Git and before accepting the observed result. A changed common directory cannot authorize an existing managed checkout merely because its path, marker and branch still match.
- Missing legacy identity defaults to `null`, never the currently observed directories. No migration backfills trust. Recheck reports an unverified legacy repository as unavailable, replacement as changed; acceptance of uncertain prior worktree/process facts cannot override that repository refusal.
- **Open clean project** explicitly records the current project identity. A new run can use it; existing runs keep their original snapshots, approvals, artifacts and worktrees. Reopening never rebinds an old run. To use legacy data or a replacement checkout, inspect retained work and start a new run after reopening; do not relink/adopt old writable checkouts or reuse old approvals. Restoring the actual original directories can satisfy an already identity-bound run's checks again.

## Consequences and verification

This deliberately makes old/unverified runs inspection/cancellation-only until suitable fresh work is selected; preserving evidence is safer than inferring identity from equal bytes or commit IDs. Existing JSON snapshots remain readable through nullable defaults, with no SQL schema version change, dependencies, toolchain change or source-repository marker. Before upgrading, close the app and keep a consistent app-data backup; do not use older application versions against data written by this change or strip identity fields to bypass refusals.

Directory identity is a Linux best-effort observation, not an OS lock/sandbox or race-proof containment. Ordinary edits, commits and app restarts do not change these directory stamps; filesystem replacement/restore may. The documented last-check/Git race and descendant-process limits remain. POST-007 stale-review approval and POST-008 Chat/Plan interleavings are separate, unfixed findings.

Eight regressions cover independent root/common-directory replacement, candidate/dispatch/application refusal, restart/recovery, legacy data and reopening without inherited authority. Seven initial cases failed before the fix. Final no-cost gate: typecheck/lint, tests **486/486**, fixtures **3/3**, build and development/production smoke passed. A [disposable HTTP/protocol smoke](../evidence/post-006-identity-smoke.json) confirmed `409` refusal before/after restart, unchanged original/replacement heads, retained partial work and a completed new FAKE run after explicit reopening. No native model calls or owner-data mutation; beta tag/release sign-off unchanged.
