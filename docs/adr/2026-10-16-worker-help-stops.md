# M6: worker help at an explicit stop boundary

## Context

Spec §9 requires durable worker requests, isolation of affected work, high-priority Lead notification and honest suspension semantics. The installed Pi 1.3.0 adapter exposes cancellation and bounded process shutdown, but no application suspend/resume operation. M6 item 1 intentionally refuses to label a busy native process as waiting. Native permission replies, owner steering and safe continuation remain later checklist items.

## Decision

- Add `request_human_action` and extend `report_issue` in `lao-tools/3`. The gateway binds task/run/session/attempt itself; workers cannot select other tasks or acquire Lead authority. Requests accept type, urgency, reason, suggested action and blocking. Informational issues only record evidence and notify the Lead. An explicit issue blocker or high/urgent issue also requests owner attention and a stop of the reporting worker; no unrelated task/run is stopped.
- Persist a blocking intent, issue evidence and bounded Lead notification atomically before cancellation. Equal normalized signals in one attempt share a durable result, including across transport retries with different gateway command keys; conflicting reuse of a command key is refused. While stopping, additional results/progress and different help signals are refused. Keep the execution reservation until shutdown and Git capture finish.
- Pi help uses its existing cancel and bounded app-owned process shutdown. This ends an attempt; it is not native suspension. Retain the session identity, transcript and unfinished worktree. After confirmed shutdown, atomically interrupt the attempt, create the blocking HumanRequest and enter `WAITING_HUMAN`; never capture an unfinished candidate as success. Fake execution follows the same boundary. Owner cancellation retains priority.
- If an executor cannot stop a session, save an explicitly nonblocking diagnostic with `stop: unsupported`; do not claim it paused. If shutdown is unconfirmed, or the app restarts with a pending intent, preserve a nonblocking owner diagnostic and the task's cancellation/recovery decision. Never replay a stop, tool or worker on restart. A finalization journal failure rolls back the wait and is reconciled conservatively on restart.
- Owner responses remain evidence only. They do not deliver a native permission reply, verify setup, resume a session or enqueue another attempt. Dependency WAITING propagation remains M6 item 4. Lead escalation tools retain their existing nonblocking semantics.

## Consequences

Healthy workers continue and stopped workers free capacity without losing work. Current Pi help ends the owned process, so continuation needs a later explicit recovery/handoff decision. No OS containment is claimed: already performed filesystem changes remain, and worktrees do not isolate OS access. No dependency, migration, toolchain or spec change.
