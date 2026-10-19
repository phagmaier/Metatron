# First beta baseline

Baseline: local Git tag **`beta`**, commit **`12a9cc653b563d1b801728eaa95b94321c0c283a`** (2026-10-18). This note was added after the tagged commit to describe its scope and guide subsequent development; it is not part of the tagged snapshot. Keep that tag attached to its baseline and use distinct numbered tags for later releases.

**Status:** M0–M9 implementation is complete within its recorded capability limits. **Owner release sign-off remains pending.** The intended scope is personal experimentation by one Arch/Omarchy user with trusted repositories. Checklist completion and the tag do not imply full harness parity, OS containment, or general production readiness.

## Delivered scope and evidence

The application provides a local React GUI and one loopback Node/SQLite engine for saved roles/profiles/teams, static workflows, bounded native dispatch, durable tasks/reports/requests, isolated working copies, independent review and owner-confirmed local Git integration. Restart recovery retains ambiguous work for an explicit decision rather than replaying mutations.

- [Original M0–M9 checklist](../../todo.md): all implementation items checked with dated evidence and explicit capability limits.
- [A–G acceptance outcomes](../../todo.md#m9---beta-hardening-and-release-spec-134-15): retained native PASS receipts for all seven scenarios; earlier failures and protocol rehearsals remain distinct. Recorded native spend was 43 turns including failures, 24 across the final passing receipts.
- [Four-harness support and smoke matrix](../adapter-smoke-matrix.md#current-support-independent-of-completed-smoke-coverage): four native readers, Codex Lead, Pi writer → independent review → approved disposable integration; unsupported/partial cells remain explicit.
- [M9 release checklist](../progress.md#2026-10-18--m9-item-9-beta-release-checklist-review-pending) and [verification receipt](../evidence/m9-release-checklist.json): typecheck, lint, **478/478 tests**, **3/3 fixtures**, build and development/production smoke passed at the baseline. These are dated observations, not a compatibility guarantee after upstream changes.
- [Safety audit](../security-audit.md), [GUI recovery](../gui-status-checks.md), [project switching](../project-switching-verification.md), [completion claims](../completion-safety-audit.md) and [startup verification](../startup-verification.md) record their tested boundaries and omissions.

## Known issues and coverage limits

| Area | Beta limitation and current handling |
| --- | --- |
| OpenCode | On 2.0.32 a refused native file tool can end the turn. A feedback-only recovery attempt failed and was reverted. Use tested Pi exploration profiles where suitable; inspect retained evidence before an explicit retry. Later subset successes do not establish full version compatibility. [Failed C](../evidence/m9-acceptance-C-live.json), [failed follow-up](../evidence/m9-acceptance-C-live-2.json). |
| Harness roles and continuity | Only Codex implements Lead. Codex writers and worker native resume are unsupported; Pi native resume/per-call approvals are unsupported. Claude/OpenCode adapter-level same-checkout resume does not enable engine worker resume across fresh assignments. Reassignments use fresh worktrees/checkpoints. [Support details](../adapter-smoke-matrix.md#current-support-independent-of-completed-smoke-coverage). |
| Live coverage | Only Pi has a complete live writer → review → approved integration receipt. Claude/OpenCode direct adapter write receipts do not establish that whole path. Worker Lead-tool denials were probe-originated. No automated GUI suite exists; browser QA and protocol/default tests are separate evidence. |
| Isolation and secrets | Worktrees are working-copy isolation, not an OS sandbox or race-proof containment. Codex reads can reach outside the checkout; preview test commands run with owner permissions. Path filters cannot detect all embedded secrets; retained reports/transcripts/test output may contain sensitive data. |
| Stop and recovery | Emergency stop covers app-owned direct children, not every descendant. Inspect pending/failed/uncertain stop evidence. Ambiguous mutations require an owner recovery decision and never automatically replay. There is no dedicated Refresh session button; use Pause → Recheck → Fresh + checkpoint → Retry. |
| Git compatibility | Dirty, drifted or replaced checkouts, executable Git filters/custom merge drivers (including LFS), and hidden/sparse index state are refused. Preserve these safety refusals until compatibility changes are deliberately designed and verified. |
| Costs and setup | Caps bound agents/launches, not exact provider spending. Clean-OS/network installation was not verified; local setup reused the installed dependency cache. Keep Node 26.7.0 (not LTS) and pnpm 11.22.0 pins unless an owner-approved toolchain decision changes them. |

Runtime workflow authoring, OS sandboxing, automatic integration and remote-repository integration remain outside this baseline. [Usage](../usage.md), [configuration](../configuration-example.md) and [README safety notes](../../README.md#safety-before-real-work) describe the available controls.

## Owner release checklist

- [x] Implementation and retained acceptance evidence are linked, with native/fixture results distinguished.
- [x] Known issues, unsupported controls and safety/coverage limits are explicit.
- [ ] Owner explicitly accepts the stated limits for a personal-use beta, or selects a fix/retest first. Record the decision/date here and append a progress entry; do not infer acceptance from the tag or documentation work.
- [ ] If publication is requested, publish the chosen tag and create a GitHub prerelease with this scope and known issues. No tag push or release publication is performed by this closeout.

Before inviting outside use/contributions, choose a license deliberately; this closeout does not select one. Review and development can proceed independently of publication. [backlog.md](../../backlog.md) is the active queue; the historical checklist does not automatically authorize deferred features or new live calls.
