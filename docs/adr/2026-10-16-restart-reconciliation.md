# M6: restart reconciliation by observation only

## Context

Spec §10.2 requires that, on restart, the app reconciles local process state, native session IDs, task attempts and worktree Git state, and exposes ambiguous attempts for a decision rather than rerunning them. Spec §10.1 adds that a missing folder does not prove the worker stopped, and that a checkout at the same path does not prove it is the same checkout. Before this item, `recoverInterrupted` moved unfinished attempts to `RECOVERY_REQUIRED`/`RETRY_DECISION` and observed nothing. Its reason said exactly that. A recorded PID was compared only by existence, so after a reboot or a reused PID an unrelated process looked like a surviving worker. Native tool calls that were in flight at the crash were visible only in the raw journal. The [recovery decisions ADR](2026-10-16-recovery-decisions.md) already provides observation-only recheck and identity-gated retry.

## Decision

- **Observe once at startup.** `startApp` reopens the database, runs `recoverInterrupted`, then awaits `reconcileRestart` before the API exists.
  - Every work task in `RETRY_DECISION` whose latest attempt has no observation yet gets one check and a `recovery.reconciled` event. This always includes every attempt that the restart itself found unfinished.
  - An attempt that already has observations keeps them, so a quiet later restart leaves the journal unchanged. Any decision observes again anyway.
  - If an observation fails, a `recovery.reconcile_failed` event is recorded and startup continues. The decision barrier stays in place.
- **Process identity.** When the PID is recorded, the session also records `processIdentity`: the Linux boot ID plus the kernel start time from `/proc/<pid>/stat`. A present PID whose identity differs is classified `not_running` ("different process"). A matching identity is `pid_present` ("still running"), which still needs explicit acceptance before a retry. Sessions without a recorded identity keep the earlier wording ("may be reused").
- **More facts in each check.** All of these default to `null`, meaning "not observed", so no migration is needed.
  - `nativeSession`: `recorded`, `not_recorded` or `conflict`. It is a conflict when the same adapter session ID is recorded for an attempt in another run or checkout; the Lead's own thread resume within one run and checkout is not a conflict.
  - `worktree.git`: HEAD, starting SHA and the number of uncommitted paths. It is filled only for a `verified` checkout.
  - `unfinishedTools`: Pi and Codex tool calls journaled as started without a finish, at most 20. They may have completed.
- **Nothing is replayed.** Reconciliation never prompts, resumes, reattaches, re-signals, relinks, repairs or deletes, and it never changes task, session or worktree state. The previous app's children are not owned by this one. Pending stops still settle as `uncertain` (item 7). Unconfirmed worker messages stay unconfirmed (item 6).

## Consequences

- The recovery card shows the restart reason, the worktree Git state, process identity, the native session match and unfinished tools, and requires acceptance where needed.
- Fact comparison for decisions is unchanged. New native-session, Git and tool facts are evidence only, because a retry always uses a new worktree and session.
- Limitations:
  - Identity is Linux-only and best-effort. An unreadable identity remains `pid_present`.
  - Descendants are still untracked.
  - Lead attempts are not reconciled because they have no recovery decision path.
  - Native resume is item 10.
  - M9 verifies the owner-visible path, reason and recheck presentation. M8 verifies native behaviour.
