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

## 2026-10-16 — M6 item 1: durable human requests and transitions (archived)

- Completed durable HumanRequest storage, same-run blocker links, urgency, transactional waits and owner replies that never dispatch or resume work.
- Tests 173/173; typecheck/lint/fixtures/build/smoke and backend/API demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M6 item 2: Needs You inbox (archived)

- Completed the run inbox with respond/decline/complete/defer, evidence and durable history; stale decisions refused without retry; no native reply delivery claimed.
- Tests 175/175; typecheck/lint/fixtures/build/smoke and CDP GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M6 item 3: worker help and issues (archived)

- Completed `request_human_action`/`report_issue`: durable session-bound signals stop only the reporting worker after confirmed shutdown, then wait with a retained session, worktree and blocker.
- Tests 185/185; typecheck/lint/fixtures/build/smoke and CDP gateway/inbox demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M6 item 4: dependency waits (archived)

- Completed WAITING_DEPENDENCY handling: downstream tasks wait until prerequisites are DONE, unrelated work continues, and saved assignments resume in FIFO order without replaying ambiguous work.
- Tests 193/193; typecheck/lint/fixtures/build/smoke and FAKE engine demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M6 item 5: native permission denial notices (archived)

- Completed Codex denial notices: typed native denials become nonblocking, idempotent Needs You records with session evidence; no native approval or continuation; Pi has no per-tool callback.
- Tests 195/195; typecheck/lint/fixtures/build/smoke, schema generation and no-model Codex probe passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M6 item 6: direct owner worker messages (archived)

- Completed owner steer/follow-up with delivered/queued/unsupported/unconfirmed states; Pi queues at native boundaries, nothing is resubmitted, resumed or dispatched.
- Tests 203/203; typecheck/lint/fixtures/build/smoke, offline Pi probe and CDP demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M6 planning: triaged recovery findings (archived)

- Docs only: extended M6 stop/recovery/reconciliation/fault-test items and confirmed provider-failure blockers; spec §§9–10 and the recovery-evidence ADR updated. `git diff --check` passed; tests not run (docs only).
- [Original entry](progress-m4-m5-history.md); next was M6 item 7.

## 2026-10-16 — M6 item 7: pause, stop run and emergency stop (archived)

- Completed durable owner stop intent/outcomes, scoped app-owned cancellation and GUI history; direct children only, descendants untracked. ADR and original evidence retained in history.
- Tests 212/212; typecheck/lint/fixtures/build/smoke and protocol/browser demo passed; live calls omitted.
- [Original commands, ADRs, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M6 item 8: explicit recovery causes and identity-gated retry (archived)

- Completed explicit recovery causes, worktree identity observations and an owner-gated fresh retry; recheck never resubmits, relinks or deletes. Native resume remained item 10.
- Tests 223/223; typecheck/lint/fixtures/build/smoke and FAKE/browser demo passed; live calls omitted.
- [Original commands, ADRs, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M6 item 9: restart reconciliation by observation (archived)

- Completed startup observation of pending recovery decisions: process identity, native session match, worktree Git state and unfinished tools; no replay. Lead attempts and descendants remained untracked.
- Tests 228/228; typecheck/lint/fixtures/build/smoke and protocol/browser demo passed; live calls omitted.
- [Original commands, ADRs, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M6 item 10: per-assignment context policies (archived)

- Completed auto/fresh/resume context policies with lineage, checkpoints and refused explicit resumes; Pi never resumes (adapter limit). Tests 232/232, 12/12 mutations; typecheck/lint/fixtures/build/smoke and CDP browser demo passed; live calls omitted.
- [Original commands, ADR, evidence and limitations](progress-m4-m5-history.md); next was M6 item 11.

## 2026-10-16 — M6 item 11: confirmed provider failure blockers (archived)

- Completed confirmed auth/rate-limit/credit/usage blockers linked to native evidence, holding Lead wake-ups until a new owner turn. Tests 250/250; typecheck/lint/fixtures/build/smoke and HTTP demo passed; GUI capture failed (NSS), live calls omitted.
- [Original commands, ADR, evidence and limitations](progress-m4-m5-history.md); next was M6 item 12.

## 2026-10-16 — M6 item 12: deterministic fault-test gate (archived)

- Completed the FAKE/protocol fault gate: delayed tools/approvals, recovery/worktree identity, durable stops, provider failures and explicit continuation. Tests 258/258, focused 47/47, mutations 10/10; typecheck/lint/fixtures/build/smoke passed.
- [Original commands, matrix, evidence and limits](progress-m4-m5-history.md); live calls omitted, visual checks remain M9; next was M7 item 1.

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

## 2026-10-17 — M7 item 6: child scheduling and launch-budget guarantees

- Completed item 6 only. `storage/scheduling.ts` retains every prepared workflow child's normal dispatch intent when a stage exceeds remaining launch budget: funded children queue normally; unfunded children stay `QUEUED` with a `blocked` dispatch, typed `launch_budget` reason, actionable diagnostic and no attempt/slot. Ordinary over-budget assignments still return `BUDGET_EXCEEDED`.
- `storage/budget-waits.ts` and `engine.ts` admit eligible unlaunched holds in priority/FIFO order when an unstarted commitment is freed, preserving generation and owner pin. Shared reader/writer/total caps still count every child and active Lead; failures, retries and cancelled spawned attempts stay charged. Pause/Chat/human/repository/recovery holds never become implicit retries.
- Migration v9 (`storage/database.ts`, `shared/orchestration.ts`) permits budget reasons only on blocked dispatches without an attempt ID; historical mutation results default null. `storage/workflows.ts` and `orchestration/workflows.ts` expose blocked children as blocked workflows, not fabricated partial reports. Existing task-card warnings show the reason; no new UI/worker invocation surface.
- Added 10 behavioral regressions in `workflow-scheduling.test.ts` / `workflow-slots.test.ts`, sharing a disposable fixture: funded prefix and synthesis exhaustion; cancellation versus spent launches; priority/FIFO and owner override; pause/Chat/human/repository holds; cross-run reader/writer/total/Lead slots; retry charging; journal rollback; v8 migration; queued restart/no replay. Updated the v4 review migration fixture for the added column.
- PASS: baseline `mise x -- pnpm test` 285/285; final 295/295. `mise x -- node --test tests/workflow-scheduling.test.ts tests/workflow-slots.test.ts` 10/10; `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production.
- Before-fix regression reproduced an all-child rollback (`BACKLOG`, `BACKLOG` instead of two durable queue entries). The first throwaway demo used invalid space-containing idempotency keys; corrected the fixture, not validation, before the passing runtime proof.
- [FAKE runtime smoke](evidence/m7-workflow-budgets-smoke.json): three workflows plus ordinary work/Lead shared a one-agent/one-reader cap; observed peaks 1/1, one cancellation-funded admission, ten attempts unchanged across restart and identical dispatch generations. Unfunded children retained null attempt IDs; owner checkout unchanged.
- Browser PASS (managed Chromium, production app): visible `QUEUED` child with actionable hold reason; [inspected task card](evidence/m7-workflow-budgets-child.png), [reload readback](evidence/m7-workflow-budgets-browser.json); no additional attempts or page/console errors. Demo exited cleanly; throwaway script/fixtures removed. No native provider contacted; live cost-bearing workflow turns intentionally omitted.
- [Budget-hold ADR](adr/2026-10-17-workflow-budget-holds.md); README/checklist updated. No dependency/toolchain/spec change, adapter limitation or unresolved blocker. Archived item 5 intact near the progress size cap. Later M7 items remain unchecked; M7/beta incomplete.
- Next: M7 item 7 — persist per-reader evidence and synthesis references, including explicit partial failures. Resume: "Implement M7 item 7 only"; focused check above.

## 2026-10-17 — Post-M7 item 6 correctness checkpoint

- Fixed the four independently reproduced boundary findings only; M7 item 7 and all milestone checkboxes remain unchanged.
- `storage/workflows.ts` now distinguishes an unlaunched dispatch generation from historical attempts/reports and honors cancellation after reservation drain; funded/admitted retries no longer settle stages prematurely.
- `orchestration/workflows.ts` prepares eligible siblings despite cancellation/human holds, retains held inputs atomically, and requires normal explicit owner continuation without bypassing prerequisites.
- `storage/recovery.ts` releases active dispatch bookkeeping for already-terminal attempts after restart, preserving outcomes, diagnostics, launch charges and explicit recovery decisions; nothing is requeued.
- Added 10 failing-before/passing-after behavioral regressions in `tests/workflow-lifecycle.test.ts` and `tests/recovery.test.ts`, including journal rollback, stale generations, reservation drain and repeated restart.
- Initial full suite: 304/305; the existing four-reader test assumed simultaneous `RUNNING` after asynchronous dispatch. Replaced that incidental assertion with each reader's durable report-before-synthesis ordering; exploration checks passed 4/4.
- PASS: `mise x -- pnpm test` 305/305; focused `mise x -- node --test tests/workflow-lifecycle.test.ts tests/workflow-scheduling.test.ts tests/workflow-slots.test.ts tests/workflows.test.ts tests/recovery.test.ts tests/restart-reconciliation.test.ts tests/stops.test.ts` 45/45.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production.
- [Disposable FAKE app smoke](evidence/m7-boundary-fixes-smoke.json): authenticated recovery/assignment/cancellation/human actions, funded and budget-admitted retries, cancellation during preparation, retained reports and terminal-before-release restart; 15 attempts, no automatic replay, owner checkout unchanged. Script/database/Git fixture removed.
- Two concurrent read-only omp reviewers found no material issues in lifecycle/preparation and recovery/accounting. No new ADR, schema/dependency/toolchain/spec change or unresolved blocker; native cost-bearing turns and UI verification intentionally omitted.
- Next remains M7 item 7: persist per-reader evidence and synthesis references, including explicit partial failures. Resume: "Implement M7 item 7 only"; run the focused command above first.

## 2026-10-17 — M7 item 7: durable reader evidence and synthesis provenance

- Completed item 7 only: `shared/workflows.ts`, `storage/workflow-evidence.ts`, `orchestration/workflows.ts` and migration v10 retain typed immutable per-child source bindings alongside canonical attempt/artifact/result/diagnostic history.
- `engine.workflows.evidence(id)` exposes all original attempts and artifacts, including task-owned integration artifacts, without parsing mutable task text. Confirmed failed/cancelled sources retain exact event references/reasons and no fabricated successful report; provisional partial submissions stay evidence, not completion authority.
- Handoffs, prepared input and dispatch commit atomically; source-read cancellation, journal rollback, retries, human holds, budget holds and restart retain existing scheduling/recovery rules. Legacy v9 children expose absent provenance explicitly (`handoff: null`), never retrospective invention or replay.
- Added 9 regressions in `workflow-evidence.test.ts` / `workflow-artifacts.test.ts`; extended cancellation provenance checks and updated v1/v4/v8 downgrade fixtures. README documents the backend contract and legacy limits.
- PASS: `mise x -- pnpm test` 314/314; expanded focused workflow/recovery gate 57/57 before review; final `mise x -- node --test tests/workflow-artifacts.test.ts tests/workflow-lifecycle.test.ts tests/workflow-evidence.test.ts` 16/16 after review.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production.
- [FAKE app smoke](evidence/m7-workflow-evidence-smoke.json): success, partial failure, ambiguous disconnect and budget-held synthesis; restart retained 10 attempts, 11 bindings, all 8 original report hashes and a task-owned log hash. No automatic replay; owner checkout unchanged. Throwaway script/fixtures removed.
- Two concurrent read-only omp reviewers: lifecycle passed; persistence found omitted task-owned artifacts, independently reproduced then fixed/tested and re-reviewed closed. No remaining material finding, ADR, dependency/toolchain/spec change or blocker. Compacted older M5 summaries into history to keep this file below the size cap.
- Scope remains backend-only; no grouped workflow GUI or invocation surface. Native cost-bearing turns and new UI verification intentionally omitted; M7/beta incomplete.
- Next: M7 item 8 — render one expandable workflow with child stages/agents, logs and reports. Resume: "Implement M7 item 8 only"; first run the focused evidence/lifecycle command above.

## 2026-10-17 — M7 item 8: grouped workflow view

- Completed item 8 only. `src/web/workflow-panel.tsx` renders each run workflow as one expandable item: status/agent counts, parameters, named results with the result-stage report, every stage (type, status, dependency/partial-failure policy, diagnostics) and each child agent with profile/harness/model/thinking/permission (FAKE labelled as playback), session state, failure reason, attempts, diagnostics, unverified submitted-result summary, report/log artifacts, inputs/provenance and its persisted journal log.
- Workflow children are excluded from flat board columns (`main.tsx`); **Task controls** embeds the existing `TaskCard` (extracted into a shared `card()` helper) so continue, steer, recovery, review and cancel stay on the normal validated endpoints. Reused `ArtifactText` from `integration-panel.tsx`.
- Backend reads only: `GET /api/workflows?runId=` (strict, run-scoped) returns `workflowsResponseSchema` (`shared/workflows.ts`) built from `listWorkflowRuns` + `workflowEvidence`; `eventQuerySchema`/`queryEvents` gained an optional `taskId` filter for paged child logs. No schema migration, mutation, dependency or spec change.
- Added 3 behavioral API regressions in `tests/workflow-view-api.test.ts` (grouped partial view scoped to one of two runs with explicit failure, no invented report and synthesis provenance, read-only with no attempt/journal change; paged per-child log; malformed/missing IDs → 400). Fail-before reproduced: 0/3 with the route/filter stashed.
- PASS: baseline focused `mise x -- node --test tests/workflow-artifacts.test.ts tests/workflow-lifecycle.test.ts tests/workflow-evidence.test.ts` 16/16; final `mise x -- pnpm test` 317/317, `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production.
- Browser PASS (Playwright driving installed `/usr/bin/chromium`, production build, disposable FAKE fixture: 4 readers with one forced failure + synthesis): one workflow item, 0 stray board cards, 5 child agents, failed child reason/log/cancel control, provenance without invented report, synthesis report, reload readback, no 390px overflow; attempts 5 → 5; owner checkout clean; fixtures removed. [Desktop](evidence/m7-workflow-view-desktop.png), [mobile](evidence/m7-workflow-view-mobile.png), [failed child](evidence/m7-workflow-view-child.png), [readback](evidence/m7-workflow-view-browser.json).
- Browser run found the failed-child reason hidden inside collapsed attempts; fixed by surfacing the last diagnostic/cancellation in the child header. Only console error is the pre-existing `/favicon.ico` 404. Cached Playwright's managed Chromium download was incomplete; no browser was installed.
- No ADR, adapter limitation or blocker. Observation: older suites leave many `/tmp/lao-*` fixtures (≈13k); the new test leaves none. Native cost-bearing workflow turns intentionally omitted; M7/beta incomplete.
- Next: M7 item 9 — let the owner run a workflow manually and the Lead invoke only a saved template with validated parameters. Resume: "Implement M7 item 9 only"; first run `mise x -- node --test tests/workflow-view-api.test.ts tests/workflow-evidence.test.ts`.
