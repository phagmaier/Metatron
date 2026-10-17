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

## 2026-10-17 — M7 item 5: reusable Explore Subsystem

- Completed item 5 only: `shared/workflow-presets.ts` builds the static reader → synthesis recipe, with runtime `target`, named `exploration` result, evidence/citation/gap guidance and explicit partial-reader failure. Save-time reader count is 1–4 (default 4); fewer readers group all four areas exactly once: entry points/architecture, state/data flow, dependencies, tests/edge cases.
- `storage/workflows.ts` adds `createExploreSubsystemTemplate` for saved read-only reader/synthesizer profiles. `shared/presets.ts` supplies a fixed FAKE-profile example; `engine.ts` seeds it without replacing saved library rows, changing team access or dispatching. No scheduler/runtime contract, migration or adapter changes.
- New `tests/explore-subsystem.test.ts` (4) covers saved-team fan-in and source links, one-/three-/four-reader execution, confirmed partial failure and later reuse, restart/idempotency, invalid counts/profile permissions and preservation of owner library/team choices. Removed the incidental empty-workflow-list assertion from `teams-api.test.ts`.
- PASS: baseline `mise x -- pnpm test` 281/281; final 285/285; focused exploration/workflow/team-API gate 13/13; `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production. Resume check: `mise x -- node --test tests/explore-subsystem.test.ts`.
- [Runtime smoke](evidence/m7-explore-smoke.json): real app/engine on disposable Git/SQLite, four-reader success and one-reader-failure partial paths, five child attempts each, source references retained, owner checkout unchanged; all 1–4 partition layouts inspected. FAKE playback only; no repository analysis or model synthesis claimed.
- Browser PASS (managed Chromium, production app): select Fake Reader/Synthesizer plus Explore Subsystem, save team and reload; [inspected screenshot](evidence/m7-explore-preset.png), [persisted readback](evidence/m7-explore-browser.json); twelve existing attempts unchanged by saving, no page/console errors. Demo server exited cleanly; throwaway script/fixtures removed.
- Scope: no workflow invocation endpoint, Lead tool, grouped board or Review preset; later M7 items remain unchecked. Live cost-bearing workflow turns intentionally omitted; no new ADR, dependency/toolchain/spec change, adapter limitation or blocker. Older M7 entries archived intact to keep progress near the size cap; M7/beta incomplete.
- Next: M7 item 6 — normal scheduling/attempt/launch budgets for every child, retaining queued children over cap. Resume: "Implement M7 item 6 only"; focused check above.
