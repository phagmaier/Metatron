# M9 item 4: visible recovery and blocker checks

2026-10-18: **PASS**, using Playwright against the production GUI and real local engine/SQLite/Git. All harness behavior was deterministic fixture playback, explicitly labelled in project/run names and prompts. No model/provider was called. This is GUI evidence, not an additional live harness smoke result.

[Machine-readable results and retained fixture locations](evidence/m9-gui-status.json).

| Exercise | Observed GUI behavior | Evidence |
| --- | --- | --- |
| Emergency stop | Confirmation; run paused; task `RETRY_DECISION`; stop `confirmed` only after the owned Pi protocol process exited. A separate manual sentinel survived. | [Stop history](evidence/m9-gui-emergency-stop.png) |
| Abrupt app restart | SIGKILL/restart retained attempts, requests, stop history, conflict preview and context lineage. Four restarts across two fixture sessions added no attempts. | [Restart outcome](evidence/m9-gui-stop-restart.png), [saved records](evidence/m9-gui-status.json) |
| Pending native approval | `WAITING_HUMAN` / `waiting_permission`, one-shot approve/deny controls; reload retained pending state. Restart moved the request to resolved history as `expired` and removed approval controls. A separate live callback accepted **Approve once** and changed only its isolated file. | [Pending](evidence/m9-gui-approval-pending.png), [expired](evidence/m9-gui-approval-expired.png), [accepted](evidence/m9-gui-approval-accepted.png) |
| Conflict | `Integration · conflict`, README path and retained integration checkout, destination drift, skipped tests, disabled approval. The task stays `AWAITING_REVIEW` because this is a preview conflict; nothing was applied. | [Conflict details](evidence/m9-gui-conflict.png) |
| Exhausted credits | Confirmed `Credits exhausted` request in Needs You, usage unavailable, provider balance/reset unknown. **Mark completed** resolved the notice; the task remained `WAITING_HUMAN` with its one original attempt, including after restart. | [Credit notice](evidence/m9-gui-credit.png) |
| Context refresh | **Pause worker → Recheck → Fresh + checkpoint → Retry** created a successor in a separate worktree; task/session showed effective fresh policy, predecessor link, checkpoint and new transcript. **View report** showed the saved checkpoint; both sessions survived restart. | [Checkpoint and lineage](evidence/m9-gui-context.png) |
| Stop evidence failures | `pending` survived navigation/reload; a restarted pending stop became `uncertain`. Refused cancellation stayed `failed`; an ended callback without process-exit evidence stayed `uncertain`. | [Pending](evidence/m9-gui-stop-pending.png), [failed](evidence/m9-gui-stop-failed.png), [uncertain](evidence/m9-gui-stop-uncertain.png) |
| Worktree identity | Recovery showed recorded path and correct `missing`, `inaccessible` and `replaced` reasons; no claim that a missing directory proves termination. **Recheck (observe only)** added observations without dispatching. Retry required acknowledgement of unverified state. Restoring the original checkout gave `verified`, preserving its unfinished file and original attempt. | [Missing](evidence/m9-gui-missing.png), [inaccessible](evidence/m9-gui-inaccessible.png), [replaced](evidence/m9-gui-replaced.png) |
| Narrow viewport | Recovery and approval controls remained readable at 390px; document width was 390px. | [Recovery](evidence/m9-gui-recovery-mobile.png), [approval](evidence/m9-gui-approval-mobile.png) |

## Reproduce without model spend

Run in a terminal that keeps stdin open:

```sh
mise current
mise x -- pnpm build
mise x -- node scripts/gui-status.ts
```

Open the printed loopback URL (port 4319). The driver creates fresh disposable repositories and metadata, uses the existing acceptance app/protocol fixtures, and prints commands/actions. Choose each labelled run in the GUI's **Run** selector.

- `stop`: GUI **Emergency stop…**, then `stop-check` verifies the unrelated sentinel survived.
- `approval`: inspect/reload the pending request; `restart` expires it. In a separate fresh fixture session, use **Approve once** to inspect accepted history and the isolated result.
- `credit`: inspect the notice, **Mark completed**, and verify no new attempt or automatic continuation.
- `context`: **Pause worker**, **Recheck**, choose **Fresh + checkpoint**, **Retry**, **View report**.
- `conflict`: creates a reviewed candidate plus an intentional destination commit in the disposable repo and a conflicting preview. Inspect **Integration · conflict**.
- `failed`, `uncertain`, `pending`: GUI **Stop run…**; inspect stop history. After `pending`, use `restart`, reload, and verify `uncertain`.
- `missing`: starts an owned protocol worker, moves only its disposable checkout aside, then abruptly restarts the app. Inspect recovery and **Recheck**. In order, `inaccessible`, `replaced`, `restore` change only that fixture path; recheck after each. All observations and unfinished work are retained.
- `save` writes a versioned observation JSON in the printed data directory. `quit` saves again and stops the fixture app/manual sentinel, retaining repositories and worktrees for inspection.

The commands are an interactive QA sequence, not an unattended GUI test suite. Run `conflict` after the context check: its intentional destination commit advances the disposable repository's HEAD. Command failures print `FIXTURE FAILED`; inspect them before treating a run as evidence. The full gate used two sessions so stop ambiguity and worktree permutations had a separate clean baseline.

## Validation and limits

Passed: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` (475/475), `mise x -- pnpm test:fixtures` (3/3), `mise x -- pnpm build`, `mise x -- pnpm smoke` (development/production). Focused stop/restart/context/provider/conflict checks: 35/35. Persisted evidence assertions verified isolated writes, no replay, all worktree observations, original unfinished content, checkpoint artifact and unapplied conflict.

No runtime product fix, dependency, schema or ADR was needed. Initial fixture typecheck and stdin-shutdown issues were corrected; a final start/quit check exited cleanly with no fixture app/driver processes remaining. Early browser waits were corrected for collapsed resolved history and exact diagnostic wording. Console errors during intentional app death were expected disconnected/refused HTTP requests; the initial favicon request returned 404. No application JavaScript exception was observed.

Context refresh is the explicit continuation/retry flow above; there is no dedicated **Refresh session** button. Worker native resume remains unsupported. The GUI worktree permutations observed the prior protocol PID as `not_running`; surviving-worker variants are covered by `tests/restart-reconciliation.test.ts`, not claimed as GUI verification here. Uncertain/failed stop fixtures have no OS process and deliberately supply no exit evidence; only the confirmed-stop exercise uses an actual protocol subprocess.

Native cost-bearing tests were intentionally omitted. Existing direct-child emergency-stop, filesystem sandbox and OpenCode refused-tool limitations remain unchanged. M9 and the beta remain incomplete; next is M9 item 5, local Arch/Omarchy start-instruction verification.
