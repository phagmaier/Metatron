# M6: owner pause, stop run and emergency stop

## Context

Spec §9.3 and the [recovery evidence ADR](2026-10-16-recovery-evidence.md) require pause scheduling, stop run and emergency stop of app-owned processes, with pending, failed and uncertain stop outcomes that survive navigation, view closure and restart. Before this item, pausing existed, task cancellation only journaled a `cancel.diagnostic` on an unacknowledged abort, and a generic `PATCH /api/runs` could label a run `stopped` while its sessions kept running.

## Decision

- **Stop records on the session.** Each owner stop adds a `StopRecord` (`task`, `run` or `emergency`; targeted PID; `pending`/`confirmed`/`failed`/`uncertain`; evidence/diagnostic) to `session.stops`, mirrored by `stop.requested`, `stop.signal_failed` and `stop.outcome` journal events. The field defaults to `[]`, so no migration is needed. Intent commits inside the command transaction before any native signal. Only sessions holding a live reservation are targeted; worker-help stops keep their existing journal.
- **Evidence settles outcomes.** After the executor ends, the outcome is `confirmed` only when there is a supervised Pi/Codex child exit (`*.process_exit` from the child's close), a closed FAKE playback (labelled "no OS process"), or a native launch that never completed. If the signal was not acknowledged and there was no exit, the outcome is `failed`. In every other case it is `uncertain`. On restart a pending stop becomes `uncertain` unless exit evidence was already journaled. Restart never re-signals or replays.
- **Pause scheduling** keeps its existing behavior: it halts new reservations while live sessions finish.
- **Stop run** is terminal. It cancels the run's reserved tasks and cooperatively cancels their sessions. Queued tasks stay recorded but never dispatch. Worktrees, artifacts, history and owner-controlled integration of existing candidates are preserved. A run that is already terminal refuses another stop, so the owner can escalate to emergency stop. Generic run PATCH may set only `active` or `paused`.
- **Emergency stop** is global. It pauses every active run (resuming is an explicit owner action, and reservation rechecks everything). For every reserved session it skips Pi/Codex cooperative abort and closes the app-spawned child: stdin EOF, then TERM and KILL at the existing 2s/4s (Pi) or 3s/6s (Codex) deadlines. FAKE sessions are cancelled. Interrupted tasks go through `INTERRUPTED` to `RETRY_DECISION`. Executors check for a pending stop before launch and again once a session exists, so a stop that arrives during startup is not lost.
- **Interpretation of spec §9.3 "process groups".** Children are not spawned in their own process groups, and only the direct app-owned child is signalled. Descendants and filesystem changes already made may remain, and the GUI warns about this. No unrelated or manual process is discovered or signalled. Adding process groups would change spawn lifecycle and containment claims, and the recovery ADR excludes that here. It needs a separate owner decision.
- **Out of scope.** An in-progress local integration Git operation is not interrupted.

## Consequences

The GUI separates the actions. Inspect or closing a session view is view-only. Cancel task, Stop run and Emergency stop are separate, confirmed actions. A durable stop history, loaded from the server, shows evidence or diagnostics. Unknown outcomes stay visible instead of being inferred. Descendant containment remains unproven. Native verification of real Pi/Codex shutdown under load remains opt-in M8 smoke work.
