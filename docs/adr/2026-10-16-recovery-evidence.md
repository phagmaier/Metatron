# M6: recovery evidence before continuation

## Context

Triaged reference Findings 5, 6 and 9 refine the unfinished M6 stop/recovery work (spec §§9.1, 9.3, 10.1–10.2). Path existence, a closed view and unavailable usage cannot establish checkout identity, worker termination or provider exhaustion. The existing [worker-help stop boundary](2026-10-16-worker-help-stops.md) already journals stop intent and preserves ambiguous outcomes; this decision extends that mechanism rather than creating another stop journal.

Reference provenance: [FINDINGS.md](../reference-recon/outputs/FINDINGS.md), triaged 2026-10-16, Superset SHA `491ca53f4cd1d6a4ed06735cfd98a39a12480d67` (ELv2). No reference code copied.

## Decision

- Distinguish missing, inaccessible and replaced worktrees. Retain task/attempt, native-session and process evidence, including a surviving worker, alongside path/reason diagnostics. Block unsafe submissions until an explicit recovery decision validates repository/worktree identity. Recheck observes facts only; it neither submits work nor automatically relinks/deletes a checkout. A same-path replacement cannot inherit the prior checkout's authority.
- Extend existing stop journaling and history with pending-stop, failed and uncertain outcomes that survive navigation, view closure and restart. Inspect, close view and stop remain distinct actions. Supported process/session evidence must confirm termination; a disappearing folder/view or missing tokens cannot. Keep app-owned targeting and emergency-stop warnings about descendants and prior filesystem changes.
- Normalize only confirmed auth, rate-limit and exhausted-credit failures through existing Needs You blockers with evidence and an actionable owner next step. Unknown/unavailable usage stays explicit. Hard budgets remain independent; no credential management, inferred balance/reset time or automatic resumption is introduced.

## Consequences

M6 extends existing unchecked items and uses FakeAdapter/disposable Git fixtures for identity loss/replacement with a surviving worker, stop failure/restart and provider failure/unknown-usage restart. Recheck or an owner response alone never authorizes replay. Unrelated healthy tasks continue under existing dependency/blocker rules.

M8's existing capability and smoke gates verify native failure classification; M9's existing visible stop/restart/exhaustion checks verify recovery path/reason/recheck and retained outcomes. Live verification remains explicit opt-in on disposable repos; fixtures do not establish native support. This planning decision implements nothing and does not expand process containment or recovery authority.
