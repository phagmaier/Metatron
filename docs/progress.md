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

## 2026-10-16 — M5 item 1: deterministic candidate capture (archived)

- Completed deterministic private-index capture, create-only candidate refs and unsafe-state refusal, preserving owner checkout/worktree evidence. Checks passed: 96/96 tests, fixtures 3/3, typecheck/lint/build/smoke, protocol demo and browser QA; live calls omitted for cost.
- [Original files, commands, ADR and evidence](progress-m4-m5-history.md#2026-10-16--m5-item-1-deterministic-candidate-capture); next was candidate persistence.

## 2026-10-16 — M5 item 2: persisted integration candidates (archived)

- Completed durable candidate records, atomic completion/report linkage, base/attempt validation and migration v4 uniqueness. Checks passed: 100/100 tests, fixtures 3/3, typecheck/lint/build/smoke and protocol restart demo; live calls omitted for cost.
- [Original files, commands, ADR and evidence](progress-m4-m5-history.md#2026-10-16--m5-item-2-persisted-integration-candidates); next was independent review.

## 2026-10-16 — M5 item 3: Reviewer on the candidate snapshot (archived)

- Completed read-only candidate-bound reviews in separate worktrees with bounded context, gateway/API policy and request-review GUI. Checks passed: 105/105 tests, fixtures 3/3, typecheck/lint/build/smoke and protocol/browser QA; live calls omitted for cost.
- [Original files, commands, ADR and evidence](progress-m4-m5-history.md#2026-10-16--m5-item-3-reviewer-on-the-candidate-snapshot); next was structured review results.

## 2026-10-16 — M5 item 4: structured independent review results (archived)

- Completed typed independent review persistence, candidate linkage and structured findings with policy/Git gates. Tests 117/117; typecheck/lint/fixtures/build/smoke and protocol demo/restart passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — Explicit retry dispatch fix (archived)

- Explicit retries use a fresh dispatch generation and bounded launch budget; stale lifecycle callbacks cannot affect newer attempts. Tests 120/120; typecheck/lint/build/smoke passed; history preserved and live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — Recovery cleanup rollback fix (archived)

- Recovery cleanup rolls back atomically on SQLite ABORT/ROLLBACK failures while retaining explicit recovery decisions. Tests 122/122 plus targeted recovery 2/2; typecheck/lint/smoke passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 5: revision lifecycle and parent reconciliation (archived)

- Completed bounded revision handoffs, candidate lineage, safe fresh worktrees, parent reconciliation and retained review history. Tests 134/134; typecheck/lint/fixtures/build/smoke and protocol demo/restart passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — Review fixes (no checklist change)

- `storage/scheduling.ts`: owner and Lead assignments both reject with `BUDGET_EXCEEDED` once attempts + queued work reach the permanent launch budget; reassigning an already-queued task keeps its counted slot. `orchestration/tools.ts`: `read_report` returns structured report, candidate and reviews with `textExcerpt: null, textUnavailable: true` when the report file is missing/unreadable.
- `adapters/pi-rpc.ts`, `codex-rpc.ts`: native request rejection is `NATIVE_REJECTED`; process exit before/after a request is `NATIVE_TRANSPORT` (was `UNSUPPORTED`/`CONFLICT`). Native error text is still never surfaced. `pi.ts`/`codex.ts` `dispose` releases the session even when the diagnostics write fails. README health milestone (M4) and technology summary corrected.
- Checks PASS: `mise x -- pnpm test` (137/137), `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `git diff --check`. Live harness tests intentionally omitted (cost). No dependency, toolchain, migration or spec changes. Next unchanged: M5 item 6.

## 2026-10-16 — M5 item 6: isolated integration preview (archived)

- Completed owner-only, review-gated integration preview in an app-owned worktree: base/candidate ref checks, exact diff, `git diff --check`, argv-only owner tests with process-group kill; owner checkout untouched. Tests 143/143; typecheck/lint/fixtures/build/smoke and CDP GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 7: destination drift and merge conflicts (archived)

- Completed drift recording and `--no-ff` candidate merges in the isolated integration worktree; conflicts retained with a nonblocking owner request, never resolved/aborted/retried. Tests 147/147; typecheck/lint/fixtures/build/smoke and CDP GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 8: review details and owner approve/decline (archived)

- Completed owner-only approve/decline of a finished preview, review/diff/test GUI panels and lineage transitions; nothing applied. Tests 150/150; typecheck/lint/fixtures/build/smoke and CDP GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 9: confirmed application to the local branch (archived)

- Completed revalidated apply plans and owner-confirmed compare-and-swap/fast-forward application with claims, interruption on restart and no rerun. Tests 156/156; typecheck/lint/fixtures/build/smoke and CDP GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 10: retained integration evidence (archived)

- Completed GUI access to every saved candidate, review, preview, test log and diff across denial, blockage, revision and cancellation; server retention already existed. Tests 159/159; typecheck/lint/fixtures/build/smoke and GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 11: Git fixture integration gate (archived)

- Completed four owner-HTTP Git fixture workflows (fast-forward, clean merge, conflict, dirty main); all M5 items checked and its gate passes with protocol fixtures. Tests 163/163; typecheck/lint/fixtures/build/smoke passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

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

## 2026-10-17 — M7 item 1: reusable role library

- Completed item 1 only: `shared/roles.ts`, `storage/roles.ts`, `api.ts` and `web/roles-panel.tsx` add owner CRUD, version-checked edits/deletes and single-role JSON file/paste import/export. Import format v1 creates a new ID/version 1 and rejects profile/authority fields; referenced-role deletion is refused. Existing SQLite table/journal, no migration. Limits: name 160, instructions 12,000, output 8,000 characters; role HTTP bodies 128 KiB, including worst-case escaped JSON round-trip. Engine/run constructors snapshot saved built-in guidance; fake/Pi/Codex prompts include expected output. Existing runs/profiles retain their snapshots/settings. README documents usage.
- PASS: pinned Node 26.7.0/pnpm 11.22.0 via mise; baseline 258/258; final `mise x -- pnpm test` 264/264 ([suite](evidence/m7-roles-tests.txt)); `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod, `git diff --check`. Focused role/API/Pi/Codex protocol gate 32/32; minimal demo `mise x -- node --test tests/roles.test.ts tests/roles-api.test.ts` 4/4 covers idempotency, stale/refused writes, import validation, retained snapshots, HTTP token/Origin/body limits and app restart. Initial typecheck caught a test-helper UUID-inference error; fixed before final checks.
- Browser PASS (Playwright, disposable SQLite, production app): create/edit v2, JSON download → file import as a new v1 copy, delete unused copy, referenced-role refusal, reload persistence; inspected [desktop](evidence/m7-roles-desktop.png), [mobile](evidence/m7-roles-mobile.png), [390px/no-overflow readback](evidence/m7-roles-demo.json). Console: favicon 404 and expected deletion 409 only. Live model calls intentionally omitted (cost); protocol fixtures contacted no provider. Custom-role profile selection remains item 2. No new ADR, dependency/toolchain/spec change, adapter limitation or blocker; M7/beta incomplete. Next: M7 item 2 — named AgentProfile CRUD with discovered harness/model/reasoning/permission validation. Resume: "Implement M7 item 2 only"; preview: `mise x -- pnpm dev`.

## 2026-10-17 — M7 item 2: named AgentProfile library

- Completed item 2 only: `shared/profiles.ts`, `storage/profiles.ts`, `api.ts`, `engine.ts`, `web/profiles-panel.tsx` and `entities.ts` add owner CRUD with custom role selection, fresh server-side discovery, version/idempotency checks, relational role updates and saved team/workflow deletion guards. Existing run snapshots stay fixed; legacy profile JSON defaults to v1 without migration. Names 160, instructions 4,000; strict inputs cannot supply capabilities. FAKE demo identities are fixed and labeled. README/role panel explain usage.
- Capability limits follow existing adapters: Pi file-tool readers/writers (auth unknown is not entitlement); Codex coordinator only with app-owned login; Claude/OpenCode unimplemented, installation/auth unknown. Model/reasoning/permission drift, failed discovery, spoofed FAKE capabilities and unauthenticated setup cannot create/update a profile; failed discovery exposes a diagnostic without exception contents. Saving never dispatches work. Team/run selection remains item 3.
- PASS: baseline `mise x -- pnpm test` 264/264; final 269/269 ([suite](evidence/m7-profiles-tests.txt)); `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod, `git diff --check`. Minimal demo: `mise x -- node --test tests/profiles.test.ts tests/profiles-api.test.ts` 5/5 covers capability denials, rollback/reference consistency, immutable snapshots, version/restart/replay, token/Origin/body limits and zero dispatches. Initial lint hook dependency and missing Codex fixture feature-disable flags were fixed before final checks.
- Browser PASS (Playwright, production app, disposable SQLite, protocol subprocesses): custom role → Pi profile, edit, concurrent-edit/stale-save refusal, reload, unavailable Claude, Codex coordinator create/delete, fixed FAKE controls; inspected [desktop](evidence/m7-profiles-desktop.png), [mobile](evidence/m7-profiles-mobile.png), [stale save](evidence/m7-profiles-stale.png); [readback](evidence/m7-profiles-demo.json) confirms 390px/no overflow and zero attempts/sessions/dispatches. Console: favicon 404 and expected 409s only. No provider contacted; live cost-bearing calls intentionally omitted. Pinned Node 26.7.0/pnpm 11.22.0; harmless CLI version checks Pi 1.3.0/Codex 0.163.0. No new ADR, dependency/toolchain/spec change or blocker; M7/beta incomplete.
- Next: M7 item 3 — reusable TeamPresets with immutable per-run snapshots. Resume: "Implement M7 item 3 only"; preview: `mise x -- pnpm dev`.

## 2026-10-17 — M7 item 3: reusable TeamPresets with immutable run snapshots

- Completed item 3 only: `shared/teams.ts`, `storage/teams.ts`, `orchestration/team-run.ts`, `api.ts` (`/api/team-presets`, `POST /api/runs/team`), `web/teams-panel.tsx`, `web/team-run-form.tsx`, `main.tsx`. Owner CRUD for Lead, worker pool, available workflows, default mode and limits; version/idempotency checks; seeded FAKE demo team fixed. Teams are all-FAKE or all-native, coordinator Lead + non-coordinator workers; native = Codex Lead + Pi workers (only executors); workflow stages must use team profiles. No migration (existing table).
- Start requires the reviewed team version, resolves preset + current profiles/roles/workflows into the run's snapshot (mode/limits from the team) in one transaction with the first Lead turn; native starts re-validate fresh discovery and require Codex login inside it. Later edits/deletes never touch the snapshot. Also: `lead-run.ts` shares `beginLeadRun`; profiles in a saved team cannot change coordinator/worker class; the Codex Lead prompt now includes its profile's override (was silently dropped; workers already had it); codex fixture logs developer instructions.
- Tests: new `tests/teams.test.ts` (3) and `tests/teams-api.test.ts` (1): policy denials with no writes, stale/replay across restart, FAKE run snapshot unchanged after team/role/workflow edits, deletion and restart, next run uses v2, native refusals create nothing, HTTP token/Origin, Codex Lead → custom Pi profile with both overrides. [10/10 mutations detected](evidence/m7-teams-mutations.txt); sources restored.
- PASS: baseline 269/269; final `mise x -- pnpm test` 273/273 ([suite](evidence/m7-teams-tests.txt)); `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod, `git diff --check` ([checks](evidence/m7-teams-checks.txt)). Minimal demo: `mise x -- node --test tests/teams.test.ts tests/teams-api.test.ts`.
- Browser PASS (system Chromium over CDP; Playwright MCP needs absent Google Chrome; production app, disposable Git/SQLite, protocol subprocesses): create team v1, run v1 dispatched Ada, edit to Supervised v2, stale v1 start refused (409), v2 run only proposed, v1 header kept its snapshot, demo team fixed, 390px no overflow. [Evidence](evidence/m7-teams-demo.json), [desktop](evidence/m7-teams-desktop.png), [run](evidence/m7-teams-run.png), [stale](evidence/m7-teams-stale.png), [mobile](evidence/m7-teams-mobile.png). Console: favicon 404 + expected 409.
- Limits: no workflow templates can be saved yet (items 4+), so team workflow lists are empty in the GUI; older Lead/Pi run forms keep explicit settings. Live cost-bearing calls intentionally omitted; no provider contacted. No new ADR, dependency/toolchain/spec change or blocker. Archived three M6 entries to stay near the size cap. M7/beta incomplete.
- Next: M7 item 4 — static sequential stage and bounded parallel → synthesis execution templates with declared inputs and results. Resume: "Implement M7 item 4 only"; baseline: `mise x -- pnpm test`.

## 2026-10-17 — M7 item 4: static workflow execution templates

- Completed item 4 only: `shared/domain/workflow.ts`, `shared/workflows.ts` and `entities.ts` define named runtime inputs/results, topologically ordered single/parallel/synthesis stages, explicit partitions and consumer partial-failure policy. Reject cycles, missing/duplicate references, unknown parameters, nested stages and oversized recipes (128 children total; parallel count ≤64 and the run's fan-out bound).
- `storage/workflows.ts`, `orchestration/workflows.ts`, `engine.ts`, `scheduling.ts` and SQLite migration v8 persist template/execution snapshots and child tasks, prepare bounded report handoffs and atomically enqueue each eligible stage through existing workers. Scheduler guards prohibit dispatch before input preparation; normal owner reassignment of queued children still works.
- Stage success requires a completed attempt, saved report and released execution reservation, not Git integration or `DONE`; tasks retain `AWAITING_REVIEW`. Explicit partial failures retain task/artifact references; ambiguous disconnect/recovery and missing source reports hold synthesis without resubmission. Paused/Chat runs launch nothing. README documents contracts, bounds and backend-only services.
- `tests/workflows.test.ts` adds 8 behavior cases: graph/input validation; sequential ordering and owner override; concurrent readers with stop/include-partial failure policy; mode/fan-out/snapshot denials and restart; ambiguous disconnect; bounded/unavailable reports; all-child rollback on journal failure. Updated saved workflow fixtures in profile/team tests and migration fixtures in storage/review tests; removed incidental schema-version assertions.
- PASS: baseline `mise x -- pnpm test` 273/273; final 281/281. Focused `mise x -- node --test tests/workflows.test.ts` 8/8; `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production. Initial full gate caught the old profile-deletion workflow fixture; final lint caught one test line wrap; both corrected before the passing checks.
- [Disposable runtime smoke](evidence/m7-workflows-smoke.json): actual FAKE engine executed single → two partitioned readers → synthesis under a one-reader cap; four attempts, both source references, queued owner override honored, unchanged owner checkout. Throwaway script/fixtures removed. No provider contacted; live cost-bearing workflow calls intentionally omitted (later M7 gate); no new UI surface to verify.
- Scope: template creation and execution are internal services only; no Explore/Review preset, workflow authoring/grouped GUI, HTTP invocation or Lead tool added. Later M7 items remain unchecked. No new ADR, dependency/toolchain/spec change, adapter limitation or blocker. Archived M6's fault-test entry intact to keep progress near the size cap; M7/beta incomplete.
- Next: M7 item 5 — reusable `Explore Subsystem` template. Resume: "Implement M7 item 5 only"; focused check: `mise x -- node --test tests/workflows.test.ts`.
