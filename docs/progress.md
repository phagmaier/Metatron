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

## 2026-10-16 — M6 planning: triaged recovery findings

- Planning only: extended unchecked M6 stop/recovery/reconciliation/fault-test items for Findings 5/6; added confirmed auth/rate-limit/credit blocker handling for Finding 9. No boxes checked or implementation added.
- `todo.md` places identity-loss/same-path replacement/surviving-worker fixtures, durable stop failure/restart evidence and actionable failure/unknown-usage cases in M6; references existing M8 native-classification and M9 visible recovery/exhaustion gates without adding work there.
- `spec.md` §§9.1, 9.3, 10.1–10.2 makes these boundaries explicit; [ADR](adr/2026-10-16-recovery-evidence.md) records identity-gated submissions, observation-only recheck, persistent stop outcomes and confirmed failure evidence. Existing stop journaling is reused.
- Verification PASS: `git diff --check`; reviewed diff scope and preserved completed items/M8/M9/Future backlog. Read-only `mise current`/`mise ls` confirmed pinned Node 26.7.0/pnpm 11.22.0 installed.
- Docs only: typecheck/lint/tests not run; live probes/model turns intentionally omitted (scope/cost). Native failure classification and visible recovery remain unverified until M8/M9. No reference code copied, dependencies changed, commits or new blockers.
- Next: M6 item 7 — implement pause scheduling, stop selected run and emergency stop of app-owned processes only, including durable pending/failed/uncertain outcomes. Resume: "Implement M6 item 7 only"; baseline: `mise x -- pnpm test`.

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

## 2026-10-16 — M6 item 10: per-assignment context policies

- Completed item 10 only. Owner assignment, Lead `assign_task` (`lao-tools/4`) and recovery retries take `contextPolicy` auto (default)/fresh/resume plus `resumeSessionId`. Migration 7 stores it on the dispatch; rows queued earlier read `fresh`. `orchestration/context-policy.ts` plans each attempt from its lineage (the task's latest earlier attempt, else a revision's source) and records `session.context` (effective, reason, predecessor attempt/session, checkpoint) plus `context.planned`. [ADR](adr/2026-10-16-context-policies.md).
- auto resumes only the task's own cleanly ended session on the same profile, harness and checkout with confirmed stops and an unshared native ID; otherwise it starts fresh with an app-generated checkpoint artifact (records only, not a transcript). Explicit resume is refused at assignment with nothing queued and asks for fresh. FAKE resumes in simulation; Pi records its `pi-sessions/<attempt>` transcript path and never resumes (adapter limitation; new worktree per attempt). Reviews and revisions start fresh; the Lead links its resumed thread. The owner (not the Lead) can now continue a WAITING_HUMAN task once every blocker resolves. GUI: Context picker on cards/retry, lineage and transcript on cards and Sessions.
- Tests: `tests/context-policy.test.ts` (4): FAKE help → owner continuation resumes, Lead continuation refused, unrelated/revision fresh, restart keeps links; explicit-resume refusals roll back; fresh retry checkpoint; Pi refusal + fresh successor prompt/checkpoint/transcripts across restart; blocker table. Updated retry/migration/Lead tests. [12/12 mutations detected](evidence/m6-context-mutations.txt); sources restored.
- PASS: baseline `mise x -- pnpm test` 228/228; final 232/232 ([suite](evidence/m6-context-tests.txt)); `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod, `git diff --check` ([checks](evidence/m6-context-checks.txt)). Minimal demo: `mise x -- node --test tests/context-policy.test.ts`.
- Browser PASS (system Chromium over CDP, production app, disposable Git/SQLite, FAKE + Pi protocol subprocesses): Pi resume refused (409, nothing queued); auto continuation → fresh successor with checkpoint in View report; FAKE recheck → explicit resume reused the native ID; links unchanged after restart; no overflow at 390px. Console: favicon 404, the expected 409, SSE cut by the restart. [Evidence](evidence/m6-context-demo.json), [refused](evidence/m6-context-resume-refused.png), [Pi fresh](evidence/m6-context-pi-fresh.png), [FAKE resume](evidence/m6-context-fake-resume.png), [restart](evidence/m6-context-restart.png), [mobile](evidence/m6-context-mobile.png).
- Limitations: no real harness worker resumes yet (Pi reopen + same-worktree continuation belong to M8's adapter revisit and smoke #4); a fresh successor starts from base/candidate, so uncommitted earlier work stays only in the retained checkout; FAKE resume is simulated. `scheduling.ts` is now ~550 lines. Live cost-bearing turns intentionally omitted. No dependency, toolchain or spec change; no blocker. Archived M6 items 3–6 in [history](progress-m4-m5-history.md). M6/beta incomplete.
- Next: M6 item 11 — normalize confirmed auth failure, rate limiting and exhausted credits into the Needs You blocker flow. Resume: "Implement M6 item 11 only"; baseline: `mise x -- pnpm test`.

## 2026-10-16 — M6 item 11: confirmed provider failure blockers

- Completed item 11 only. `adapters/contract.ts`, `pi-events.ts`, `codex-events.ts` mark confirmed runtime failures with `providerFailureKind`; exact Codex variants/status fields and narrow Pi failure statements distinguish auth, rate limits, credits and usage limits. Unknown/zero usage, generic/legacy codes, aborted messages and wrong-turn events cannot establish exhaustion. Codex `usageLimitExceeded` does not claim exhausted credits; native session budgets remain separate.
- `orchestration/provider-failures.ts` atomically links one Needs You request to its native error event and last native token sample; `shared/provider-failures.ts`, `entities.ts` and `needs-you-panel.tsx` expose evidence, unavailable/partial usage, unknown balance/reset and owner next steps. Safe failed-turn + shutdown/checkout evidence → WAITING_HUMAN; ambiguity keeps recovery with a notice. Restart finalizes pending evidence without replay; retained sessions/worktrees and hard budgets remain intact. New metadata defaults null, no migration.
- Pi worker/Codex Lead executors connect the flow. `lead-run.ts` and blocker links hold both prequeued and future Lead wake-ups even after owner completion; only a new owner turn can continue. A later success/different final error supersedes transient provider evidence. [ADR](adr/2026-10-16-provider-failures.md); [adapter evidence/limits](adapter-recon.md#m6-item-11--provider-failure-evidence-2026-10-16).
- Tests: new `tests/provider-failures.test.ts` plus Pi/Codex mapper, native engine and Lead protocol cases verify one request, unavailable/partial/zero usage, legacy errors, downstream hold + unrelated completion, hard launch cap, duplicate notifications, prequeued Lead holds, uncertain/no-terminal shutdown and pending-error restart. Baseline 232/232; final `mise x -- pnpm test` 250/250 ([suite](evidence/m6-provider-tests.txt)).
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod, `git diff --check` ([checks](evidence/m6-provider-checks.txt)). Minimal demo: `mise x -- node --test tests/provider-failures.test.ts`. Production HTTP demo (disposable Git/SQLite, Pi protocol subprocesses): credits blocker + independent reader; owner PATCH completion + app restart retained metadata/status and exactly two attempts/starts ([evidence](evidence/m6-provider-demo.json)). No provider contacted.
- GUI capture attempted with isolated headless Chromium; NSS initialization failed (`-8126`) under the restricted environment and produced no screenshot. Visual verification remains pending under M9; owner check: `mise x -- pnpm dev`. Live cost-bearing calls intentionally omitted; native classifications remain M8, Pi text matching is deliberately narrow, and preflight login/capability refusals stay setup diagnostics. No dependency/toolchain/spec change or implementation blocker. Archived summaries compacted without changing recorded facts. M6/beta incomplete.
- Next: M6 item 12 — the delayed-tool/approval, quota, disconnect/crash/restart and owner-intervention fault-test gate. Resume: "Implement M6 item 12 only"; baseline: `mise x -- pnpm test`.

## 2026-10-16 — M6 item 12: deterministic fault-test gate

- Completed item 12 only: new `tests/runtime-faults.test.ts` covers a held FAKE tool with independent progress/dependency waits, pause/inspection and four distinct failure/restart/explicit-retry paths, retaining unresolved Git changes and session identity without replay. No production changes.
- Extended `fake-adapter.test.ts` for withheld approval/denial; `restart-reconciliation.test.ts` for missing/inaccessible/replaced checkouts with a surviving worker, observation-only recheck, capture/retry refusal and another restart; `stops.test.ts` for failed/uncertain history across app restart and API view reads.
- `provider-failures.test.ts` now restarts the full app for confirmed failures versus unknown/unavailable/partial/zero usage. `worker-help.test.ts` retains deferred blockers/unfinished files through restart, then verifies one explicit owner continuation, its idempotent replay and another restart. [Coverage matrix](m6-fault-tests.md).
- PASS: baseline `mise x -- pnpm test` 250/250; final 258/258 ([suite](evidence/m6-fault-tests.txt)); `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod and `git diff --check` ([checks](evidence/m6-fault-checks.txt)). Minimal demo: `mise x -- node --test tests/runtime-faults.test.ts` 5/5; focused six-file gate 47/47.
- [Mutation audit](evidence/m6-fault-mutations.txt): 10/10 safety regressions detected; source files restored. Initial targeted failures were test-fixture setup errors (unsupported MCP endpoint/shared tool gate), fixed before final validation.
- Limits: FAKE/protocol fixtures only; native cost-bearing turns intentionally omitted. Native approval/continuation/classification remain M8 limits, browser-visible outcomes remain M9; API reads do not verify rendering. No new ADR, dependency/toolchain/spec change or blocker. Archived M6 items 7–9 below the progress size cap; originals retained in history. M6's automated gate passed; beta incomplete.
- Next: M7 item 1 — build CRUD/import-export for RoleTemplates separate from model/harness choice. Resume: "Implement M7 item 1 only"; baseline: `mise x -- pnpm test`.
