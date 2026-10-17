# M6: explicit recovery causes and identity-gated retry decisions

## Context

Spec §§10.1–10.2 and the [recovery evidence ADR](2026-10-16-recovery-evidence.md) require explicit interrupted/crashed/disconnected/recovery-required states, a bounded retry choice and missing/inaccessible/replaced worktree distinctions. Before this item, every unfinished task ended in `RETRY_DECISION` with only a journal diagnostic. Engine failures carried a boolean `interrupted` flag, and Pi `disconnected` was stored as `crashed`. No API could leave `RETRY_DECISION` except cancel. Worktree `verify()` accepted any checkout at the recorded path whose marker, Git root, common directory and branch matched, so a checkout removed and re-added at the same path and branch passed.

## Decision

- **Explicit cause on the attempt.** `attempt.recovery` records the `cause` (`interrupted`, `crashed`, `disconnected`, `recovery_required`, `failed`), the reason, bounded observations (`checks`, at most 20) and the owner `decision`. It defaults to `null`, so no migration is needed, and older attempts get a labelled fallback. `engine.fail` takes an explicit cause, and the Pi, Codex and FAKE executors and worker help pass one. Restart records `recovery_required`. Task states are unchanged: the attempt keeps the specific cause, and the task still waits in `RETRY_DECISION`.
- **Checkout identity.** A new worktree manifest records the device, inode and birth time of the checkout directory after `git worktree add`. `verify()` (prepare, capture, candidate) also compares this identity. A same-path replacement is refused and does not inherit authority. Older manifests have no identity and are reported as `unverified`, never `verified`.
- **Observation only.** `POST /api/recovery/recheck` classifies the repository (`verified`/`changed`/`unavailable` against the run's root, common directory and HEAD), the worktree (`verified`/`missing`/`inaccessible`/`replaced`/`unverified`/`not_isolated`) and the recorded PID (`not_running`/`pid_present`/`unknown`/`not_recorded`, using signal 0, which delivers nothing). It persists the observation and a `recovery.rechecked` event. It never submits work, relinks, repairs, deletes or signals. A PID that is present may have been reused. An absent PID says nothing about descendants.
- **Bounded retry decision.** `POST /api/recovery/decision` is the only path from `RETRY_DECISION` back to scheduling. A decision is accepted only if all of these hold:
  - It names the newest recheck.
  - A fresh observation matches that recheck.
  - The repository is `verified`.
  - Unverified facts (any worktree state other than `verified`/`not_isolated`, or a PID that is present or unknown) were explicitly accepted.

  It then moves the task to `READY` and enqueues it in one transaction, under the existing roster, blocker, dependency and hard launch-budget rules. Any refusal rolls back the whole decision. The retry is always a fresh attempt with a new session and a new worktree path. The prior checkout is retained, and a stored key replays the result without observing again. Cancel remains the other choice. Native resume is item 10 (context policies).

## Consequences

The GUI shows the cause, reason, attempt/session/PID/exit evidence, the path and the latest facts on `RETRY_DECISION` cards, and provides Recheck and Retry controls. Unverified facts need an explicit checkbox. The facts can change between the decision and the new worktree's own checks (TOCTOU). That window is acceptable because the new attempt never uses the prior path. Restart reconciliation of live processes and worktrees (item 9), context policies (item 10) and the full fault matrix (item 11) remain open. M8/M9 gates verify native behaviour and visible recovery.
