# M5 deterministic candidate capture

## Context

Spec §8.4 requires the engine to capture tracked changes and intentionally included new files. It forbids silent loss, blind `git add -A` and committing credentials, and requires unknown or sensitive additions to block for owner review. Worker reports are not proof of worktree state. Candidate capture must be retry-safe: capturing the same content again must not produce a different commit or move an existing one.

## Decision

- Build the candidate in a **private index** (`GIT_INDEX_FILE` in the app-owned attempt directory) seeded with the recorded base tree. Status is computed against that index, so worker staging can neither add nor hide paths. The worktree's files, index, HEAD and branch are never modified; the private index is removed afterwards.
- **Explicit inclusion:** tracked modifications, deletions and type changes are included. A new file is included only when the worker's tool-submitted handoff report lists it in `changedFiles`; that declaration is the explicit allowance. Text-only reports declare nothing.
- **Blocked, with no commit:** secret-sensitive names (any status, including ignored), undeclared new files, declared ignored files, symlinks, submodules/embedded repositories/special files, HEAD moved from the base, a failed `git diff --check`, or an existing candidate branch holding a different commit. Undeclared ignored files are excluded and listed, never silently dropped.
- **Captured:** `commit-tree` with a fixed app identity and the attempt's creation time, so the same content yields the same SHA. The commit is stored on a create-only `lao/candidate-<attempt>` branch (update-ref with a zero old value) next to the existing attempt branches; it is never moved or overwritten.
- Every capture result is journaled as `candidate.captured`; a capture error is recorded as the attempt diagnostic. Either a blocked candidate or a capture error keeps the worker report, opens a nonblocking high-urgency `manual_check` request and moves the task FAILED → RETRY_DECISION. No new task state was added.

## Consequences

- Workers must declare new files; worker instructions and `read_assignment` say so. Readers keep the stricter M3 rule: any worktree change fails the attempt.
- Harnesses that commit inside their worktree will block until that is supported explicitly (M8).
- Owner resolution is currently: inspect the retained worktree, then cancel. Retry/resume controls are M6; per-path owner allowlisting of blocked files is not implemented.
- Persistence (M5 item 2): a captured candidate gets one `integration_candidates` row, written in the transaction that completes its attempt and enforced unique per attempt by migration v4. Only a running writer attempt with the recorded base qualifies. A crash after the commit but before that transaction leaves an unrecorded candidate branch on a RECOVERY_REQUIRED attempt; it is never adopted automatically, and re-capture yields the same SHA for an explicit M6 decision. Blocked and empty captures stay journal-only; candidates captured before v4 are not backfilled.
- Ignored files are listed individually; a listing beyond the Git output buffer fails capture safely rather than truncating.
