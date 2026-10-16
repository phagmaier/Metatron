# M6: durable human requests and explicit continuation

## Context

Spec §9.1 requires persistent requests, affected-task waits and owner replies; §9.3 and §10 forbid an implicit restart or ambiguous replay. M1 stored requests and task links, but did not enforce blocking, retain reply details in events, or validate a transition table. Active worker suspension, reply delivery and native permission callbacks are later M6 items.

## Decision

- Keep the existing SQLite request/link tables. Open and deferred blocking requests hold every linked task. Creation atomically records links, urgency, the event and `WAITING_HUMAN` transitions for pending/executing tasks. Nonblocking diagnostics leave tasks alone. Blocking requests require at least one unique task in the same run; source sessions must also belong to that run. Review/integration/terminal task phases cannot enter a new execution wait.
- Permit open → deferred/answered/completed/declined and deferred → open/answered/completed/declined. Final responses are immutable. Owner writes use the existing loopback token/Origin protection and idempotency journal; replies require the expected status, and answers require text. Events preserve each response and prior/new status. Completion/decline/deferral may omit a note.
- Resolving a request clears its active blocker, but leaves the task waiting, cancelled or awaiting recovery. It grants no native permission, verifies no external action and launches nothing. Explicit new scheduling still rechecks dependencies, quotas and Git state. Store transitions, attempt creation and scheduler enqueue/reservation enforce active blocker links, including legacy records whose task status was never changed. Resolving such a legacy request first holds pending work so the old queue cannot resume automatically.
- Do not infer process suspension from a request. Active attempts can enter a blocking wait only when their persisted session is already `waiting_permission` without recovery required; otherwise creation fails with a diagnostic. Reservations, native IDs and worktrees remain intact. Storage cannot move a waiting task straight to RUNNING or queue a fresh attempt over a live/ambiguous one. Existing restart reconciliation retains requests and moves unfinished attempts to RETRY_DECISION.

## Consequences

M6 item 1 provides storage, HTTP transitions and scheduling holds. The Needs You controls, worker help tools, native permission delivery and safe continuation remain subsequent items; no live adapter suspension/resume is claimed. Multiple blockers must all resolve, including deferred ones. A declined request is resolved, while its task stays waiting for an explicit alternative or cancellation. No dependency, schema migration, toolchain or spec change.
