# M9 item 8 — completion and safety claims

**Item 8 audited; M9 and beta review remain pending.** This audit checks recorded milestone gates, evidence provenance, the production dispatch path and owner-facing safety wording against spec §§13.3–13.4 and 15. It does not rerun paid native turns or certify a hostile-code sandbox. [Verification receipt](evidence/m9-completion-safety-audit.json).

## Completion evidence

| Scope | Audit disposition | Evidence and limits |
| --- | --- | --- |
| M0–M2 | Checked work retained | [Preparation/domain history](progress-initial-history.md), [FAKE GUI history](progress-m2-history.md). Their gates explicitly use placeholders/playback; they do not establish native support. |
| M3–M4 | Checked work retained | [Native Pi summary](evidence/m3-live-summary.json), [Codex/Pi Lead gate](evidence/m4-live-summary.json), [current Codex lifecycle](evidence/m8-codex-lead-lifecycle-native.json). Historical versions remain historical; only Codex can Lead. |
| M5–M6 | Checked work retained within stated limits | [Review/integration and recovery history](progress-m4-m5-history.md), [fault matrix](m6-fault-tests.md), [later native writer integration](evidence/m8-writer-integration-native.json), [M9 recovery GUI](gui-status-checks.md). Native callbacks and resume differ by adapter; direct-child stop is not descendant termination. |
| M7 | Checked work retained | [Workflow history](progress-m4-m5-history.md), [FAKE workflow receipt](evidence/m7-workflow-fake-smoke.json), [native Pi workflow receipt](evidence/m7-workflow-pi-smoke.json). Static saved recipes only; no dynamic graph authoring. |
| M8 | Checked work retained with explicit unsupported/partial cells | [Four-harness matrix](adapter-smoke-matrix.md). Four native readers, Codex Lead, Pi writer/review/approved integration. Worker Lead-tool denials are probe-originated; Claude/OpenCode full writer integration has not been run live. |
| M9 items 1–7 | Checked work retained | Individual linked receipts in [todo.md](../todo.md). A–G each have a retained live PASS; earlier A/B/C FAILs and all seven protocol rehearsals remain separate. C's passing live run used Pi and had zero failed children; it does not itself prove live partial-failure handling. |
| M9 item 8 / item 9 | This audit closes only item 8 | Item 9 release checklist and owner beta review remain pending. Future backlog stays unchecked. No earlier item required reopening after accounting for its documented capability limits. |

Earlier checkbox dispositions compare completion histories and their gate artifacts; this session does not independently replay every historical manual gate. The receipt validates scenario mode/result/checks/turn caps and hashes the linked native/rehearsal JSON. These are retained observations, not a new compatibility test of installed harnesses. M9's live allowance covered **43 total turns**, including failed runs; the seven final passing receipts total **24**. No old failure is upgraded to PASS.

## FAKE and native presentation

The normal [entrypoint](../src/server/main.ts) supplies no test adapters. [Engine construction and dispatch](../src/server/orchestration/engine.ts) select the four native adapters for native runs and a separate scripted executor for FAKE runs; native failure records recovery rather than falling back to FAKE. [Team resolution](../src/server/storage/teams.ts) rejects mixed demo/native profile rosters, and [team creation](../src/server/orchestration/team-run.ts) refuses simulated native outcomes. Existing team/profile policy regressions exercise refusal and atomicity.

Run badges, sessions, Lead messages, workflow children and workflow forms explicitly identify FAKE playback. [Scripted reports](../src/server/orchestration/execute.ts) say that no repository files were read/edited and no native execution/tests occurred. The demo was rechecked through production HTTP with retained FAKE sessions/reports and no native adapters invoked. `smoke` verifies GUI assets, not rendered labels; this session's label review is source inspection, with prior browser evidence linked above.

Protocol/SDK/HTTP fixtures can exercise a `native` engine run without a real harness. They are injected only by test/QA callers, not the production entrypoint. The GUI/project-switching scripts put **FIXTURE / no model** in project/run/prompt text; acceptance receipts explicitly say `rehearsal` versus `live native harnesses`. Their native engine badges alone are not native proof. See [development commands](development.md).

## Safety wording and corrections

- Replaced stale health `M4` metadata with the current **M9** development milestone. That field identifies development stage, not release sign-off.
- Corrected M6 checklist notes that still described native owner approval as unimplemented and Pi resume as future M8 work. Claude/OpenCode one-shot approval now exists; pending grants expire on restart. Engine worker assignments remain fresh-checkout/checkpoint based, while Codex completed Lead-thread resume and Claude/OpenCode clean same-checkout adapter resume have narrower scopes.
- Marked the M9 gate as an unsigned target. Added checkpoint context to the retained M6 fault and M8 matrix documents so their historical “remaining” statements cannot be mistaken for current status. Append-only progress/ADRs/evidence were preserved.
- Changed the Pi form's absolute “Readers cannot write” to describe the enforced file-tool policy and filesystem-race limitation. README and adapter diagnostics already distinguish application guards from OS isolation.

Worktrees separate working copies. Pi/Claude/OpenCode file-tool guards do not confine an arbitrary process at OS level. Codex's verified native read-only/no-network shell policy is a narrower harness control: **its reads are not confined to the checkout**, and it is not an application-wide sandbox. Owner-declared preview tests execute repository code with the owner's permissions. Path filters cannot find every embedded secret, and logs/model/test output can contain sensitive data. [Security audit](security-audit.md), [Codex worker decision](adr/2026-10-17-codex-read-only-workers.md).

Other limits remain explicit: only Codex Lead; Codex writers and worker resume unsupported; Pi native resume/per-call approval unsupported; OpenCode 2.0.32 can end a turn on a refused tool; no exact provider-spend cap; no automatic integration or replay of ambiguous mutations; no guarantee of descendant termination or race-proof Git/filesystem containment. Configured executable Git filters/merge drivers and hidden/sparse index state are refused. No authority, isolation or adapter capability was expanded in this audit.

The legacy worktree-evidence `tests` literal still says `not_run: shell tools are disabled in M3`, as already recorded in the Codex ADR. It is historical compatibility metadata, not evidence that tests executed or that Codex has no shell. Worker instructions require `not_run`; owner-declared integration preview results are the actual test receipts. This audit leaves persisted schemas/history unchanged.

Verification used codebase-memory symbol/dispatch traces plus direct source/literal reads. All relied-on source paths and the `src`/`scripts` scopes had no recorded coverage gap at the audited generation; that best-effort index signal is not proof of completeness. Standard checks and the local FAKE demonstration are recorded in the receipt. No new browser automation or cost-bearing native turns were run; no new ADR, dependency, toolchain or security-policy decision was needed.
