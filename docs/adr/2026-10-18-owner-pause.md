# M9: owner pause and takeover of a running worker

## Context

Spec §4 lets the owner "request worker pause/cancel" and "assign/reassign"; acceptance scenario D (§13.4) needs the owner to pause a running worker, change its priority, reassign it to another profile and see the old worktree retained with the Lead notified. Before this item the only per-task owner stop was cancel, and `CANCELLED` is terminal, so a running worker could not be taken over.

## Decision

- **Pause is a stop that does not cancel.** `POST /api/tasks/pause` (owner only, the GUI's "Pause worker") accepts a `RUNNING` worker task with a live session. It journals a `pause`-scope `StopRecord` in the command transaction and signals the existing cooperative cancel. The same stop-outcome evidence rules as the [owner stops ADR](2026-10-16-owner-stops.md) settle it. Lead tasks are refused; stopping the run halts a Lead turn.
- **The interrupted attempt waits for an explicit decision.** Both executors already end an interrupted attempt through `engine.fail` into `INTERRUPTED` → `RETRY_DECISION`. A pending pause prefixes the recorded reason with "Owner paused this worker". Priority stays editable. The existing [recovery decision](2026-10-16-recovery-decisions.md) is the only continuation: it rechecks facts, accepts any profile in the run's roster and starts a new attempt in a new worktree. The paused checkout is retained and never relinked.
- **The Lead is notified without a paid wake-up.** The `lead.notification` kind is `paused`, which, like `cancelled`, reaches the Lead in its next turn's digest but does not request an automatic turn: the owner has taken the task over.

## Consequences

Takeover reuses audited stop and recovery paths; no new task state or transition was added. A pause that races a completed turn has no effect: the task finishes normally and the stop settles. A pending pause at an app crash is reconciled like any other pending stop (`uncertain`, never re-signalled), and the restart marks the attempt for recovery without the pause prefix.
