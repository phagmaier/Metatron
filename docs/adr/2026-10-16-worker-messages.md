# Direct owner input to an existing worker

## Context

M6 item 6 needs direct steer/follow-up input with honest delivery states (§4.5,
§9, §10.2). Pi 1.3.0 acknowledges native queue acceptance separately from
user-message events. Its `abort` can continue queued input. Native transport
failure does not prove a message was rejected.

## Decision

- Only the owner may target a specific task/session. Require a running attempt,
  busy app-owned worker, active non-Chat/Plan run, and no recovery/help stop.
  An unavailable session or unsupported adapter yields `unsupported`; this
  action never dispatches, resumes, restarts, or changes assignments/budgets.
- Persist a typed message in the session snapshot and its journal event in one
  transaction before submitting once. Existing snapshots default to an empty
  history; no migration is needed. Bound input to 4,000 characters and 256
  messages per session. Include message status/text in the next Lead digest.
- Expose `sending`, `queued`, `delivered`, `unsupported`, and `unconfirmed`.
  Pi `steer` and `follow_up` acknowledgements with `queued` stay queued. An exact
  native user-message event with a per-operation ID confirms delivery;
  `handled` confirms receipt by the native input handler. Neither proves the
  instructions were followed. A literal owner-message prefix prevents command
  expansion and disambiguates identical text sent by different operations.
- Preserve delivery evidence if it arrives before the RPC reply. On transport
  ambiguity, session end, or restart, retain unresolved messages as
  `unconfirmed`. Reusing an idempotency key returns current persisted status
  without submitting again; never transfer input to another attempt.
- Before Pi cancellation, clear its native input queue, then abort. If clearing
  fails, close this owned process with existing bounded shutdown instead of
  aborting with an unknown queue. This adds no run/emergency-stop controls.

## Consequences and verification

FakeAdapter simulates both input boundaries; Pi implements the native queue.
Codex worker control and the remaining native workers remain unsupported by
the current execution path. There is no offline app message queue or automatic
cancel/restart fallback. App data and native transcripts retain evidence.

Current [official RPC commands](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md)
were fetched through Context7 and compared with installed Pi docs.
The [no-model installed probe](../evidence/m6-worker-message-probe.json) verifies
both queues and clearing. [Behavioral tests](../evidence/m6-worker-message-tests.txt)
and [browser evidence](../evidence/m6-worker-message-demo.json) use protocol
fixtures. Live model-turn delivery is intentionally unverified to avoid cost.
