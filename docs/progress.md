# Progress

## 2026-10-15 — M0: preparation and reconnaissance (archived)

- Completed all 10 items: loopback shell, contracts, fixtures, pinned tooling, dependencies and reconnaissance. Checks passed: tests 12/12, fixtures 3/3, typecheck/lint/build/smoke; live calls omitted for cost.
- [Original commands, versions, ADRs and limitations](progress-initial-history.md#2026-10-15--m0-preparation-and-reconnaissance); next was M1.

## 2026-10-15 — M1: persisted domain and FakeAdapter (archived)

- Completed all 11 items: schemas/transitions, SQLite transactions, ownership, journal/idempotency and FakeAdapter. Checks passed: tests 37/37, fixtures 3/3, typecheck/lint/build/smoke; restart never replayed ambiguous work.
- [Original commands, evidence and limitations](progress-initial-history.md#2026-10-15--m1-persisted-domain-and-fakeadapter); next was M2.

## 2026-10-15 — M2: fake orchestration loop and browser gate (archived)

- Completed all 11 items: Git validation, bounded fake scheduling, GUI writes, proposals and owner controls. Checks passed: tests 56/56, fixtures 3/3, typecheck/lint/build/smoke and browser success/failure/restart/policy paths.
- [Original entries and diagnostics](progress-m2-history.md), [later summary](progress-initial-history.md#2026-10-15--m2-fake-orchestration-loop-and-browser-gate-archived); native calls omitted for cost; next was M3.

## 2026-10-15 — M3: isolated worktrees and native Pi workers (archived)

- Completed all 12 items: non-destructive worktrees, Pi RPC/model discovery, file policy, reports and retained evidence. Checks passed: tests 70/70, fixtures 3/3, typecheck/lint/build/smoke, two opt-in live reader/writer calls and browser/restart QA.
- [Original commands, evidence, ADR and limitations](progress-initial-history.md#2026-10-15--m3-isolated-worktrees-and-native-pi-workers); no OS sandbox or resume claimed; next was M4.

## 2026-10-15 — M4: Codex Lead and session-scoped tool gateway (archived)

- Initially completed 7/10 items: scoped/versioned gateway, native Codex Lead, bounded serialized wake-ups and worker tools. Tests 86/86 and standard checks passed; no-model probes passed; live gate initially blocked on app-owned login.
- [Original diagnostics, owner commands, ADR and limitations](progress-initial-history.md#2026-10-15--m4-codex-lead-and-session-scoped-tool-gateway); the dated live-gate follow-up below records resolution.

## 2026-10-16 — M4 live gate completed (archived)

- Completed the live gate with owner-authorized Codex/Pi calls, scoped MCP approval configuration, conversation retention and recorded exits. Checks passed: 86/86 tests, fixtures 3/3, typecheck/lint/build/smoke, live policy/report/resume and browser QA; beta remained incomplete.
- [Original commands, initial failure, fixes and evidence](progress-m4-m5-history.md#2026-10-16--m4-live-gate-completed); next was M5.

## 2026-10-16 — M5: review, revisions and safe local integration (archived)

- Completed all 11 items: deterministic candidates, independent reviews, revisions, isolated previews, owner-confirmed local integration and retained evidence. Final tests 163/163; typecheck/lint/fixtures/build/smoke and protocol integration gate passed.
- [Original entries, review fixes, retained summaries and evidence](progress-m4-m5-history.md); live cost-bearing calls omitted; next was M6.

## 2026-10-16 — M6: human requests, steering, stop and recovery (archived)

- Completed all 12 items: durable requests/inbox/dependencies, owner steering/stops, observation-only restart and identity-gated recovery, context policy and provider blockers; no automatic replay.
- Final gate: tests 258/258, focused 47/47, mutations 10/10 and standard checks passed; native cost-bearing calls omitted. Limits: direct-child stops only, Pi fresh successors/no resume, Codex permission denials only; visible recovery checks remain M9.
- [Original per-item commands, ADRs, evidence, failures and limitations](progress-m4-m5-history.md); next was M7 item 1.

## 2026-10-17 — M7 item 1: reusable role library (archived)

- Completed owner role CRUD/import-export, version checks and immutable run guidance; tests 264/264 and standard checks passed, browser round-trip/reload verified.
- [Original files, commands, evidence and limits](progress-m4-m5-history.md); live calls omitted; next was M7 item 2.

## 2026-10-17 — M7 item 2: named AgentProfile library (archived)

- Completed capability-validated named profile CRUD and role/reference guards; tests 269/269 and standard checks passed, browser stale-save/reload/unavailable-harness paths verified.
- [Original files, commands, evidence and limits](progress-m4-m5-history.md); native turns omitted, no provider contacted; next was M7 item 3.

## 2026-10-17 — M7 item 3: reusable TeamPresets (archived)

- Completed team CRUD and immutable per-run snapshots with fresh native discovery/login validation; tests 273/273, mutations 10/10 and standard checks passed, browser save/start/stale/reload verified.
- [Original files, commands, evidence and limits](progress-m4-m5-history.md); live calls omitted; next was M7 item 4.

## 2026-10-17 — M7 item 4: static workflow execution (archived)

- Completed validated static sequential/parallel/synthesis recipes, durable children, bounded handoffs and atomic dispatch; tests 281/281, focused 8/8 and standard checks passed; FAKE runtime demonstrated ordering, references and owner override.
- [Original files, commands, evidence and limits](progress-m4-m5-history.md); authoring/invocation remained backend-only, live calls omitted; next was M7 item 5.

## 2026-10-17 — M7 item 5: reusable Explore Subsystem (archived)

- Completed saved 1–4-reader exploration plus synthesis, read-only-profile factory and non-destructive FAKE example seeding; tests 285/285, focused 13/13 and standard checks passed; FAKE runtime and browser save/reload verified.
- [Original files, commands, evidence and limits](progress-m4-m5-history.md); live calls omitted; next was M7 item 6.

## 2026-10-17 — M7 item 6: child scheduling and launch-budget guarantees (archived)

- Completed visible budget holds for unfunded workflow children (migration v9), FIFO admission when commitments free, shared slot caps; tests 295/295, focused 10/10 and standard checks passed; FAKE runtime and browser verified.
- [Original files, commands, evidence and limits](progress-m4-m5-history.md); [budget-hold ADR](adr/2026-10-17-workflow-budget-holds.md); live calls omitted; next was M7 item 7.

## 2026-10-17 — Post-M7 item 6 correctness checkpoint (archived)

- Fixed workflow generation/cancellation/preparation and terminal-before-release recovery boundaries; 10 failing-before/passing-after regressions, full 305/305, focused 45/45 and standard checks passed; FAKE runtime verified no replay/root changes.
- [Original commands, initial failure, evidence and limitations](progress-m4-m5-history.md#2026-10-17--post-m7-item-6-correctness-checkpoint); no authority/schema/dependency change, live calls omitted; next remained M7 item 7.

## 2026-10-17 — M7 item 7: durable reader evidence and synthesis provenance (archived)

- Completed immutable handoff bindings, original report/artifact/diagnostic history and atomic dispatch. Tests 314/314; focused checks and typecheck/lint/fixtures/build/smoke passed; FAKE restart retained all original report hashes without replay.
- [Original commands, evidence, review findings and limitations](progress-m4-m5-history.md); legacy handoffs stay explicitly absent; live calls omitted; next was M7 item 8.

## 2026-10-17 — M7 item 8: grouped workflow view (archived)

- Completed expandable stage/child/agent/log/report/provenance views with normal task controls, grouped API reads and child journal filtering. Tests 317/317, standard checks and desktop/mobile/reload browser gate passed; no stray board cards or automatic launches.
- [Original files, commands, browser evidence and limitations](progress-m4-m5-history.md); live calls omitted; next was M7 item 9.

## 2026-10-17 — M7 items 9–11: invocation, independent review and live workflow gate (archived)

- Completed owner/Lead saved-workflow invocation, single-reviewer candidate-bound review, and FAKE plus real read-only Pi exploration with bounded fan-out/explicit partial evidence.
- PASS: tests 331/331, typecheck/lint/fixtures/build/smoke; browser review/invocation checks and opt-in Pi readers/synthesis; unchanged owner checkouts and restart without replay.
- [Original files, commands, evidence and limitations](progress-m4-m5-history.md). M7 complete; M8/four-harness matrix and beta remained incomplete; next was M8 item 1.

## 2026-10-17/18 — M8: remaining harnesses and smoke matrix (archived)

- Completed all 8 items: official Claude Agent SDK and OpenCode v2 adapters, Pi/Codex capability revisit, harness setup diagnostics, four read-only workers, Codex-only Lead with tested worker fallbacks, config/session/credential isolation, and the §13.3 matrix (every row native PASS or recorded unsupported/limitation).
- Owner-authorized native evidence: four live read-only workers, Codex Lead lifecycle, Pi strict cancellation (earlier failures retained), zero-prompt worker catalogs for all four (12/12 Lead-only `POLICY_DENIED`, probe-originated), one Pi writer → independent review → owner-approved fast-forward of a disposable fixture.
- Limitations: only Codex can Lead; Pi resume and Codex writers unsupported; Claude/OpenCode writers not run through review/integration; Codex reads not confined to the worktree; no OS sandbox. ADRs: Claude setup-token/worker permissions, Codex read-only workers, harness environment isolation.
- Final checks: tests 456/456, fixtures 3/3, typecheck/lint/build/smoke; also a desktop readiness check with no milestone change.
- [Per-entry summaries and originals](progress-m8-history.md#progress-log-m8-entries-moved-verbatim-at-m9-start-2026-10-18), [matrix](adapter-smoke-matrix.md); next was M9 item 1.

## 2026-10-18 — M9 item 1: suite stability and flake hunt

- Completed suite/stress checks (456/456, fixtures 3/3, standard checks); fixed fixture-directory leaks with run-owned cleanup and retained failing roots. Live calls omitted; next was acceptance A–G.
- [Original commands, evidence, failures and limitations](progress-m9-history.md#2026-10-18--m9-item-1-suite-stability-and-flake-hunt).

## 2026-10-18 — M9 item 2: acceptance scenarios A–G (in progress)

- Added disposable API acceptance driver; rehearsals A–G passed, initial live A/B/C failures retained. Fixed owner pause, saved templates, integration-base advancement and answer propagation; tests 462/462 and standard checks passed.
- [Original commands, evidence, failures and limitations](progress-m9-history.md#2026-10-18--m9-item-2-acceptance-scenarios-ag-in-progress).

## 2026-10-18 — M9 item 2 completed: live A and C reruns

- Completed live A–G with owner-authorized reruns (43 total turns). OpenCode feedback-only recovery failed and was reverted; Pi passed C. Tests 462/462 and standard checks passed; next was permission/Git audit.
- [Original commands, evidence, failures and limitations](progress-m9-history.md#2026-10-18--m9-item-2-completed-live-a-and-c-reruns).

## 2026-10-18 — M9 item 3: permission and Git safety audit

- Completed bounded safety audit; fixed dangling-symlink writes, sensitive paths, Codex command summaries and unsafe Git defaults. Tests 475/475, fixtures 3/3 and standard checks passed; existing containment/OpenCode limits retained.
- [Original commands, evidence, failures and limitations](progress-m9-history.md#2026-10-18--m9-item-3-permission-and-git-safety-audit).

## 2026-10-18 — M9 item 4: visible GUI recovery and blocker statuses

- Completed desktop/mobile fixture GUI checks for stop/restart, approvals, conflicts, credits and fresh-checkpoint recovery; tests 475/475 and standard checks passed. No live model calls; next was startup verification.
- [Original commands, evidence, failures and limitations](progress-m9-history.md#2026-10-18--m9-item-4-visible-gui-recovery-and-blocker-statuses).

## 2026-10-18 — M9 item 5: local Arch/Omarchy startup instructions

- Verified pinned install and dev/build/start on Omarchy 4.0.5, missing-harness diagnostics, loopback/port/exit behavior; tests 475/475 and standard checks passed. Fresh-OS/network install untested, no model calls; next was project switching.
- [Original commands, evidence, failures and limitations](progress-m9-history.md#2026-10-18--m9-item-5-local-archomarchy-startup-instructions).

## 2026-10-18 — M9 item 6: project-switching isolation

- Fixed Codex durable thread/run/repo binding and project-specific drafts; two-repo protocol/Git and browser/restart checks passed. Tests 478/478, focused 89/89 and standard checks passed; no native turns; next was onboarding.
- [Original commands, evidence, failures and limitations](progress-m9-history.md#2026-10-18--m9-item-6-project-switching-isolation).

## 2026-10-18 — M9 item 7: onboarding and safety documentation

- Shortened README and added configuration, usage and development guides; configuration/no-cost demo/restart checks passed. Tests 478/478, fixtures 3/3 and standard checks passed; no paid turns; next was completion/safety claims.
- [Original commands, evidence, failures and limitations](progress-m9-history.md#2026-10-18--m9-item-7-onboarding-and-safety-documentation).

## 2026-10-18 — M9 item 8: completion and safety claims

- Audited checklist/native/FAKE/sandbox claims against retained evidence; corrected stale health and permission wording. Tests 478/478, fixtures 3/3 and standard checks passed; no new native turns; next was release checklist and owner review.
- [Original commands, evidence, failures and limitations](progress-m9-history.md#2026-10-18--m9-item-8-completion-and-safety-claims).

## 2026-10-18 — M9 item 9: beta release checklist (review pending)

**Status:** M9 implementation checklist 9/9; **owner beta release review remains pending**. This section supersedes earlier “next item” notes without changing their evidence. [Session verification receipt](evidence/m9-release-checklist.json).

- [x] Local startup, configuration and onboarding documented and exercised on this Omarchy installation: [startup](startup-verification.md), [configuration](configuration-example.md), [usage](usage.md). Fresh-OS/network installation remains untested; retain Node 26.7.0 (not LTS)/pnpm 11.22.0 pins unless the owner approves a change.
- [x] Automated gate: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **478/478**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production PASS. No added tests for this documentation-only item; smoke is the minimal running demonstration.
- [x] Retained native [A–G PASS evidence](../todo.md#m9---beta-hardening-and-release-spec-134-15), earlier failures and separate rehearsals; [four-harness matrix](adapter-smoke-matrix.md) with unsupported/partial cells; [GUI recovery](gui-status-checks.md), [project switching](project-switching-verification.md), [security](security-audit.md) and [completion/safety claims](completion-safety-audit.md) reviewed. No new native model turns or browser QA in this item.
- [ ] **Owner beta sign-off:** review the evidence and known issues below, then explicitly accept the limits for personal experimentation or select a fix/retest. Checklist completion is not release approval; this decision has not been given.
- **Known failure — OpenCode 2.0.32:** a refused native file tool can end the turn; a feedback-only recovery attempt failed and was reverted. Use the tested Pi reader/reviewer profiles for exploration; inspect retained work and make an explicit recovery decision before retrying. Later OpenCode reader/reviewer successes do not establish full version compatibility. [Failed C evidence](evidence/m9-acceptance-C-live.json), [second failure](evidence/m9-acceptance-C-live-2.json).
- **Adapter/coverage limits:** only Codex can Lead; Codex writers/worker resume and Pi native resume/per-call approvals are unsupported. Claude/OpenCode same-checkout adapter resume does not enable engine cross-checkout worker resume; assignments use fresh worktrees/checkpoints. Only Pi has a full live writer → independent review → approved integration receipt; worker Lead-tool denials are probe-originated. Use preview test results, not the legacy worktree “M3 shell disabled” reason, as execution evidence. [Precise scope](adapter-smoke-matrix.md), [audit](completion-safety-audit.md).
- **Safety/operation limits:** no OS sandbox/race-proof containment; Codex reads outside the checkout; preview tests run with owner permissions; path filters/logs cannot guarantee secrecy. Emergency stop covers app-owned direct children, not all descendants. Dirty/drifted/replaced checkouts and executable Git filters/drivers (including LFS)/hidden or sparse index state are refused. Inspect recovery evidence; ambiguous mutations never auto-replay. Caps bound agents/launches, not exact provider spending. [Safety and owner controls](../README.md#safety-before-real-work).
- Completed item 9 only; `README.md`/`todo.md` now link this checklist. Documentation links/anchors, receipt assertions and `git diff --check` PASS; no new ADR, runtime/dependency/toolchain/spec change or newly discovered blocker. Live cost-bearing tests intentionally omitted (cost). **Next: owner beta review**, not future-backlog implementation; resume with `mise current`, then review this checklist and its linked evidence.

## 2026-10-18 — POST-001: beta closeout and development workflow

- Completed the owner-requested docs/instructions slice: [active backlog](../backlog.md), [beta release note](releases/beta.md), AGENTS/README/development routing and historical banners on the original plan, harness guidance/reconnaissance and research report. Current work follows one issue with acceptance criteria; deferred ideas do not dispatch automatically.
- Owner beta sign-off remains pending; this change grants no publication, native-spend or integration approval. `beta` stays at `12a9cc6`. No application/spec/dependency/toolchain changes, new ADR or newly discovered runtime blocker.
- Preserved 85 lines of M9 items 1–8 [verbatim](progress-m9-history.md); summaries retain their existing heading anchors and the original item 9 checklist remains intact. Active progress stays below 200 lines.
- PASS: `mise current`; `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **478/478**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod. Smoke is the minimal running demonstration; no new runtime tests for prose.
- PASS documentation verification: 848 local file/heading/source-line links with zero new errors, 17 shell blocks (`bash -n`), 22 pnpm command names against package.json, verbatim archive/tag checks and `git diff --check`. Fixed an older M8 anchor typo; two pre-existing unavailable temporary/research artifacts remain recorded. The command-name checker was corrected to inspect code examples rather than prose.
- Native cost-bearing tests intentionally omitted (cost); no fresh browser/native compatibility claim. Changes remain uncommitted. Next **POST-002**: independent baseline review of integration/restart safety, findings before fixes; resume with `mise current`, then `backlog.md` → POST-002 and `docs/development.md`.

## 2026-10-18 — POST-002: independent beta integration/restart review

- Completed both requested flows against `beta` **`12a9cc653b563d1b801728eaa95b94321c0c283a`**; [findings, source locations, reproductions, limits and assumption experiments](reviews/post-002-beta.md). Initial workspace clean at `947657a`; source/tests/scripts match beta, later changes were documentation only.
- Three reproduced **P1** findings: same-path replacement repository inherits integration/recovery authority; recovered review findings leave old approval usable; Chat/Plan changes during awaits fail to stop integration/first worker prompt. The root-identity finding qualifies earlier blanket replaced-checkout refusal claims.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **478/478**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod.
- PASS bug reproductions on disposable Git/SQLite/protocol/FakeAdapter state; `mise x -- pnpm acceptance --scenario E --fixtures --output <temporary-path>` passed actual worker/app crash/restart with no ambiguous replay, no owner-checkout change and retained worktrees. One startup probe initially rejected an invalid fixture key; corrected only the throwaway key.
- Report links/command names/whitespace validated; temporary drivers/state removed. No application/test edits, fixes, ADR, dependency/toolchain/spec changes, native model calls, credential/config changes or retained owner-data mutations. Native cost-bearing tests intentionally omitted (not authorized); no fresh browser/native-compatibility claim.
- Proposed **POST-006–008**, not started; recommended next selection **POST-006** (repository identity), then stale-review/policy boundaries. Exact integration mid-Git crash cuts remain unverified. Owner beta release sign-off stays pending; POST-003 not begun. Resume: `mise current`, then selected backlog entry and review.

## 2026-10-18 — POST-006: repository filesystem identity

- Completed owner-selected F1 fix in shared repository schema, Git inspection/worktrees, run admission/dispatch, integration and recovery; existing POST-002 report/closeout changes preserved. Root/common-directory device/inode/birth-time identity is persisted, not inferred from matching paths/SHA; no source-repo marker or automatic trust backfill.
- [ADR and legacy-data transition](adr/2026-10-18-repository-filesystem-identity.md): explicit **Open clean project** enables new runs only; old runs/approvals/worktrees stay bound or unverified and retained. Usage/README/release note updated; beta tag and pending owner sign-off unchanged. No dependency/toolchain/spec or SQL schema version change.
- Added 8 behavioral regressions in `tests/repository-identity.test.ts`: independent root/common replacement, application/preview/capture/dispatch refusal, restart/recovery, legacy data and reopening without old authority inheritance. Initial focused command (`mise x -- node --test --test-global-setup=tests/helpers/temp-root.ts tests/repository-identity.test.ts`) failed all 7 original cases before the fix; an intermediate 40/41 focused run exposed an incidental new-test status assertion, removed rather than re-pinned.
- PASS: `mise x -- pnpm format`, `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **486/486**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod.
- PASS running demonstration: `mise x -- node /tmp/post-006-smoke-gcwgvv2a/smoke.ts`; [retained HTTP/protocol receipt](evidence/post-006-identity-smoke.json). Replacement-clone apply returned 409 before/after restart with zero application claims; recovery retry 409 despite accepted uncertainty; explicit reopen/new FAKE run completed, old task stayed RETRY_DECISION with partial work and both heads unchanged. Temporary driver/state removed after recording evidence.
- Native cost-bearing calls intentionally omitted (not authorized); no personal credentials/config/sessions, owner databases or retained owner worktrees touched. No fresh browser or OS race-proofing claim. F2 stale-review and F3 Chat/Plan interleaving remain open; no fixes outside POST-006.
- Next recommended selection: **POST-007**, then POST-008; neither started and POST-003 not begun. Resume `mise current`, then `backlog.md` → POST-007 and the review's F2 reproduction. Owner release sign-off remains pending.

## 2026-10-18 — POST-007: current independent review at application

- Completed owner-selected F2 only: `storage/reviews.ts` shares exact review/in-flight eligibility with integration approval/application and atomically reopens the implementation lineage on newer durable evidence; `integration-apply.ts` checks after Git planning and inside the final claim. Reviewer admission refuses INTEGRATING/DONE; explicit recovery, budgets, Git and POST-006 filesystem identity guards remain intact.
- `review.ts`, task transitions and existing GUI controls preserve a usable owner revision/re-review → current pass → fresh preview → explicit approval path. Reviews, prior decisions and unresolved worktrees stay retained; no approval rewrite/auto-approval. [Authority/deferred-review ADR](adr/2026-10-18-current-integration-review.md); usage/release/backlog updated, historical beta review and tag unchanged.
- Added six behavioral regressions in `tests/integration-review-freshness.test.ts`, plus state-table contract updates. Initial `mise x -- node --test --test-global-setup=tests/helpers/temp-root.ts tests/integration-review-freshness.test.ts` failed **4/4** before fixing (unsafe apply/missing blockers); final command passed **6/6**, including async planning and post-plan/pre-claim microtask cuts, lineage reopening, fresh approval/replay and no retry after integration.
- PASS focused related suites **56/56** via the same Node command with review, integration-approval/apply, recovery-decisions, repository-identity, revision and domain test files. PASS `mise x -- pnpm format`, `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **492/492**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod.
- PASS running demo `mise x -- node /tmp/post-007-smoke-ZF9O2IUT/smoke.mjs`: [HTTP/protocol + browser receipt](evidence/post-007-review-smoke.json). Queued/running reviewer, newer important findings and a newer pass refused stale apply with 409, zero claims and unchanged destination; browser explicitly approved/applied only the fresh preview, yielding one claim/DONE with old approval replay/history/worktrees preserved. Browser-driver context/wait corrections are recorded in the receipt; no repeated apply.
- PASS final documentation checks: 62 local links/anchors, documented command names and receipt assertions; progress remains under 200 lines; final `mise x -- pnpm lint` passes. Cleanup removed the owned smoke/failing-before roots; two already-absent gate-negative fixture paths caused ENOENT diagnostics only (recorded in the receipt).
- Native cost-bearing tests intentionally omitted (not authorized); protocol fixtures/disposable Git/SQLite only, no credentials/global configuration/personal sessions/owner data touched. Throwaway driver/state removed after evidence retention; no dependency/toolchain/spec change. No new adapter limitation or unresolved POST-007 blocker.
- Next recommended selection: **POST-008**, F3 current-mode checks; not started. POST-003 and other recommendations untouched. Resume `mise current`, then `backlog.md` → POST-008 and review F3. **Owner beta release sign-off remains pending.**

## 2026-10-18 — Owner beta release acceptance

- Owner explicitly stated: “i sign off on the beta release.” Recorded acceptance in [beta release note](releases/beta.md), preserving known issues and baseline `12a9cc653b563d1b801728eaa95b94321c0c283a`.
- Acceptance only: no publication, tag push/movement, native model spending or automatic integration authorized. POST-008 remains selected for focused safety work; POST-003 and other recommendations are not started.

## 2026-10-18 — POST-008: current mode at claims and first prompt

- Completed owner-selected F3 only: `integration.ts` and `integration-apply.ts` re-read mode inside approval/application transactions after Git awaits; application rechecks shutdown. `native-execute.ts` checks current mode plus interruption/stop/cancellation immediately before the first initialized worker prompt.
- Preserved scheduling pause for active startup, POST-006 filesystem identity, POST-007 current review provenance, budgets, Git safety, recovery barriers and replay. Refused claims preserve previews/decisions; interrupted startup closes its owned session and retains session/worktree/Git evidence in RETRY_DECISION until explicit recovery.
- Added `tests/current-mode-boundaries.test.ts` (9 cases). Initial `mise x -- node --test --test-global-setup=tests/helpers/temp-root.ts tests/current-mode-boundaries.test.ts` failed **5/9**: approval, planning apply, final-claim mode/shutdown and first prompt; the four pause/cancel/stop compatibility cases passed. Final focused command **9/9 PASS**.
- Related command with current-mode-boundaries, integration-review-freshness, integration-approval/apply, repository-identity, recovery-decisions, owner-pause, stops and native-engine test files: **69/69 PASS**.
- PASS `mise x -- pnpm format`, `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **501/501**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production. Fixture-negative cases deliberately printed retention diagnostics while all fixture tests passed.
- PASS running demo `mise x -- node /tmp/post-008-smoke-jx3XUlam/smoke.mjs`: [HTTP/protocol receipt](evidence/post-008-mode-smoke.json). Gated real Git reads → committed Chat/Plan → approval/apply **403**, zero claims/unchanged destination; initialized startup → zero prompts, retained evidence, explicit fresh recovery only. Scheduling pause permitted active startup; later explicit apply/replay yielded one claim/DONE.
- Updated usage/release/backlog and README acceptance status; historical beta review/revision attribution and known issues retained. No spec/authority/dependency/toolchain change or new ADR. Checks do not retract submitted prompts or interrupt already-claimed Git; external Git races/direct-child stop limitations remain.
- Native cost-bearing tests intentionally omitted (not authorized); protocol/disposable Git/SQLite only, no credentials/global config/personal sessions/retained owner-data changes. Removed owned driver/Git gate/state and failing-before fixtures after evidence retention; existing workspace changes preserved, no commit/publication/tag changes.
- PASS final documentation checks: 84 local file/heading links, retained smoke boundary assertions, owned temporary-root absence and `mise x -- pnpm lint` after evidence/docs updates. POST-008 entry remains within 15 lines.
- Next recommended selection: **POST-003**, existing no-cost checks in CI; **not started**. No remaining POST-008 blocker. Resume `mise current`, then `backlog.md` → POST-003 and `docs/development.md`; native spending and integration/publication approvals remain separate from recorded owner beta sign-off.

## 2026-10-18 — POST-003: no-cost CI implementation and clean-checkout rehearsal

- Implemented `.github/workflows/checks.yml`: hosted Ubuntu 24.04, PR/main-push/manual triggers, read-only contents token, no persisted checkout credentials, SHA-pinned checkout/mise actions, mise 2026.10.13 and unchanged `.mise.toml` pins. No caches restored, native/live scripts, publication, tagging or integration.
- Frozen dependency install precedes the six verbatim development commands; development guide/backlog updated. No application behavior, exported contract, dependency, toolchain pin, spec or ADR change; previous POST-006/007/008 work and owner beta acceptance preserved.
- PASS actionlint **1.7.12** (scoped official download/checksum verified), command/action-permission contract checks and initial 34 local docs links. Context7 lookup returned an invalid-key error; verified official action metadata/SHAs directly instead.
- First private `/tmp` bootstrap failed extracting Node with **Disk quota exceeded**. Fresh `/var/tmp` state downloaded/installed Node **26.7.0**, pnpm **11.22.0** and all 134 dependencies with empty HOME/XDG, no inherited credentials/caches and no native executables; frozen lockfile unchanged.
- Clean-clone first `mise x -- pnpm test`: **500/501**; `tests/worker-messages.test.ts:165` expected queued after the native fixture's 100ms timer had already delivered. Replaced timer-driven delivery in `tests/helpers/pi-rpc-fixture.ts` with explicit test RPC release; retained queued/matching-delivery/replay assertions, no retries/exclusions/product fix.
- PASS isolated focused `mise x -- node --test --test-global-setup=tests/helpers/temp-root.ts tests/worker-messages.test.ts` **9/9**. PASS full exact gate: `mise x -- pnpm typecheck`, `lint`, `test` **501/501**, `test:fixtures` **3/3**, `build`, `smoke` dev/prod, each with the unchanged `mise x -- pnpm` prefix. Disposable checkout clean before/after.
- Running demonstration/commands: `mise x -- node /tmp/post-003-ci-ASoZhw5q/rehearse.mjs`, then `mise x -- node /tmp/post-003-ci-ASoZhw5q/resume.mjs`; [receipt retains failures, all passing checks and limits](evidence/post-003-ci-rehearsal.json). Smoke exercised real loopback development/production servers; no browser or native compatibility claim.
- **BLOCKED hosted acceptance only:** Docker socket permission denied; local rehearsal used this Linux host, not Ubuntu. New workflow cannot run on GitHub until an owner-authorized workspace commit/push; neither push nor dispatch was authorized/performed. POST-003 remains unchecked pending that hosted result.
- Native cost-bearing tests intentionally omitted (not authorized); no credentials/global config/personal sessions/retained owner-data mutations, release publication or tag movement. Only disposable snapshot commits were made, never a workspace commit.
- Removed owned rehearsal/validator/private tool/dependency state and fixture repositories after evidence retention; no personal or system installs changed.
- PASS final documentation/evidence checks: 38 local file/heading links, exact verified workflow SHA-256, receipt assertions, owned-root absence and explicit unchecked hosted acceptance.
- Next active item remains **POST-003**, hosted validation; resume `mise current`, review `backlog.md` and the CI receipt, then authorize the intended commit/push before observing **No-cost checks / Pinned no-cost gate**. POST-004/005 and other recommendations not begun.
