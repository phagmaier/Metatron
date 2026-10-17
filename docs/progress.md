# Progress

## 2026-10-15 — M0: preparation and reconnaissance (archived)

- Completed all 10 items: loopback shell, contracts, fixtures, pinned tooling, dependencies and reconnaissance.
- Checks passed: tests 12/12, fixtures 3/3, typecheck/lint/build/smoke; live calls omitted for cost.
- [Original commands, versions, ADRs and limitations](progress-initial-history.md#2026-10-15--m0-preparation-and-reconnaissance); next was M1.

## 2026-10-15 — M1: persisted domain and FakeAdapter (archived)

- Completed all 11 items: schemas/transitions, SQLite transactions, ownership, journal/idempotency and FakeAdapter.
- Checks passed: tests 37/37, fixtures 3/3, typecheck/lint/build/smoke; restart never replayed ambiguous work.
- [Original commands, evidence and limitations](progress-initial-history.md#2026-10-15--m1-persisted-domain-and-fakeadapter); next was M2.

## 2026-10-15 — M2: fake orchestration loop and browser gate (archived)

- Completed all 11 items: Git validation, bounded fake scheduling, GUI writes, proposals and owner controls.
- Checks passed: tests 56/56, fixtures 3/3, typecheck/lint/build/smoke and browser success/failure/restart/policy paths.
- [Original entries and diagnostics](progress-m2-history.md), [later summary](progress-initial-history.md#2026-10-15--m2-fake-orchestration-loop-and-browser-gate-archived); native calls omitted for cost; next was M3.

## 2026-10-15 — M3: isolated worktrees and native Pi workers (archived)

- Completed all 12 items: non-destructive worktrees, Pi RPC/model discovery, file policy, reports and retained evidence.
- Checks passed: tests 70/70, fixtures 3/3, typecheck/lint/build/smoke, two opt-in live reader/writer calls and browser/restart QA.
- [Original commands, evidence, ADR and limitations](progress-initial-history.md#2026-10-15--m3-isolated-worktrees-and-native-pi-workers); no OS sandbox or resume claimed; next was M4.

## 2026-10-15 — M4: Codex Lead and session-scoped tool gateway (archived)

- Initially completed 7/10 items: scoped/versioned gateway, native Codex Lead, bounded serialized wake-ups and worker tools.
- Tests 86/86 and standard checks passed; no-model probes passed; live gate initially blocked on app-owned login.
- [Original diagnostics, owner commands, ADR and limitations](progress-initial-history.md#2026-10-15--m4-codex-lead-and-session-scoped-tool-gateway); the dated live-gate follow-up below records resolution.

## 2026-10-16 — M4 live gate completed (archived)

- Completed the live gate with owner-authorized Codex/Pi calls, scoped MCP approval configuration, conversation retention and recorded exits.
- Checks passed: 86/86 tests, fixtures 3/3, typecheck/lint/build/smoke, live policy/report/resume and browser QA; beta remained incomplete.
- [Original commands, initial failure, fixes and evidence](progress-m4-m5-history.md#2026-10-16--m4-live-gate-completed); next was M5.

## 2026-10-16 — M5 item 1: deterministic candidate capture (archived)

- Completed deterministic private-index capture, create-only candidate refs and unsafe-state refusal, preserving owner checkout/worktree evidence.
- Checks passed: 96/96 tests, fixtures 3/3, typecheck/lint/build/smoke, protocol demo and browser QA; live calls omitted for cost.
- [Original files, commands, ADR and evidence](progress-m4-m5-history.md#2026-10-16--m5-item-1-deterministic-candidate-capture); next was candidate persistence.

## 2026-10-16 — M5 item 2: persisted integration candidates (archived)

- Completed durable candidate records, atomic completion/report linkage, base/attempt validation and migration v4 uniqueness.
- Checks passed: 100/100 tests, fixtures 3/3, typecheck/lint/build/smoke and protocol restart demo; live calls omitted for cost.
- [Original files, commands, ADR and evidence](progress-m4-m5-history.md#2026-10-16--m5-item-2-persisted-integration-candidates); next was independent review.

## 2026-10-16 — M5 item 3: Reviewer on the candidate snapshot (archived)

- Completed read-only candidate-bound reviews in separate worktrees with bounded context, gateway/API policy and request-review GUI.
- Checks passed: 105/105 tests, fixtures 3/3, typecheck/lint/build/smoke and protocol/browser QA; live calls omitted for cost.
- [Original files, commands, ADR and evidence](progress-m4-m5-history.md#2026-10-16--m5-item-3-reviewer-on-the-candidate-snapshot); next was structured review results.

## 2026-10-16 — M5 item 4: structured independent review results (archived)

- Completed typed independent review persistence, candidate linkage and structured findings with policy/Git gates.
- Tests 117/117; typecheck/lint/fixtures/build/smoke and protocol demo/restart passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — Explicit retry dispatch fix (archived)

- Explicit retries use a fresh dispatch generation and bounded launch budget; stale lifecycle callbacks cannot affect newer attempts.
- Tests 120/120; typecheck/lint/build/smoke passed; history preserved and live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — Recovery cleanup rollback fix (archived)

- Recovery cleanup rolls back atomically on SQLite ABORT/ROLLBACK failures while retaining explicit recovery decisions.
- Tests 122/122 plus targeted recovery 2/2; typecheck/lint/smoke passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 5: revision lifecycle and parent reconciliation (archived)

- Completed bounded revision handoffs, candidate lineage, safe fresh worktrees, parent reconciliation and retained review history.
- Tests 134/134; typecheck/lint/fixtures/build/smoke and protocol demo/restart passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — Review fixes (no checklist change)

- `storage/scheduling.ts`: owner and Lead assignments both reject with `BUDGET_EXCEEDED` once attempts + queued work reach the permanent launch budget; reassigning an already-queued task keeps its counted slot. `orchestration/tools.ts`: `read_report` returns structured report, candidate and reviews with `textExcerpt: null, textUnavailable: true` when the report file is missing/unreadable.
- `adapters/pi-rpc.ts`, `codex-rpc.ts`: native request rejection is `NATIVE_REJECTED`; process exit before/after a request is `NATIVE_TRANSPORT` (was `UNSUPPORTED`/`CONFLICT`). Native error text is still never surfaced. `pi.ts`/`codex.ts` `dispose` releases the session even when the diagnostics write fails. README health milestone (M4) and technology summary corrected.
- Checks PASS: `mise x -- pnpm test` (137/137), `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `git diff --check`. Live harness tests intentionally omitted (cost). No dependency, toolchain, migration or spec changes. Next unchanged: M5 item 6.

## 2026-10-16 — M5 item 6: isolated integration preview (archived)

- Completed owner-only, review-gated integration preview in an app-owned worktree: base/candidate ref checks, exact diff, `git diff --check`, argv-only owner tests with process-group kill; owner checkout untouched.
- Tests 143/143; typecheck/lint/fixtures/build/smoke and CDP GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 7: destination drift and merge conflicts (archived)

- Completed drift recording and `--no-ff` candidate merges in the isolated integration worktree; conflicts retained with a nonblocking owner request, never resolved/aborted/retried.
- Tests 147/147; typecheck/lint/fixtures/build/smoke and CDP GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 8: review details and owner approve/decline (archived)

- Completed owner-only approve/decline of a finished preview, review/diff/test GUI panels and lineage transitions; nothing applied.
- Tests 150/150; typecheck/lint/fixtures/build/smoke and CDP GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 9: confirmed application to the local branch (archived)

- Completed revalidated apply plans and owner-confirmed compare-and-swap/fast-forward application with claims, interruption on restart and no rerun.
- Tests 156/156; typecheck/lint/fixtures/build/smoke and CDP GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 10: retained integration evidence (archived)

- Completed GUI access to every saved candidate, review, preview, test log and diff across denial, blockage, revision and cancellation; server retention already existed.
- Tests 159/159; typecheck/lint/fixtures/build/smoke and GUI/restart demo passed; live calls omitted.
- [Original commands, evidence and limitations](progress-m4-m5-history.md); next checklist item is recorded there.

## 2026-10-16 — M5 item 11: Git fixture integration gate (archived)

- Completed four owner-HTTP Git fixture workflows (fast-forward, clean merge, conflict, dirty main); all M5 items checked and its gate passes with protocol fixtures.
- Tests 163/163; typecheck/lint/fixtures/build/smoke passed; live calls omitted.
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

## 2026-10-16 — M6 item 7: pause, stop run and emergency stop

- Completed item 7 only. `orchestration/stops.ts` + `entities.ts` keep durable `session.stops` records (scope task/run/emergency; pending/confirmed/failed/uncertain; targeted PID, evidence/diagnostic) and `stop.requested`/`stop.signal_failed`/`stop.outcome` events. Intent commits before signalling; outcomes settle when the executor ends (`engine.ts`) and only process exit evidence, closed FAKE playback or a never-completed launch confirm. Restart turns pending into uncertain and never re-signals. Default `[]`, no migration. [ADR](adr/2026-10-16-owner-stops.md).
- Owner-only `POST /api/runs/stop` (terminal; cancels reserved tasks, keeps worktrees/artifacts/history) and `POST /api/emergency-stop` (pauses every active run; Pi/Codex skip cooperative abort and close only the app-spawned child; tasks → RETRY_DECISION). Task cancel now records a task-scope stop (replaces `cancel.diagnostic`). Generic run PATCH refuses stopped/completed. Pi/Codex/FAKE executors observe a pending stop before launch and once a session exists. GUI: Stop run…, global Emergency stop… with descendant/filesystem warning, run stop history and view-only "Inspect session" labelling (`stop-panel.tsx`, `run-controls.tsx`, `main.tsx`, `style.css`).
- Tests: `tests/stops.test.ts` (8) + Codex Lead emergency in `lead.test.ts`: pause keeps live work, run isolation, process-exit confirmation, terminal refusals, token/PATCH policy, restart persistence, failed/uncertain without evidence, crash-pending → uncertain without re-signal/replay, startup-window stop, unrelated process survives emergency. [Eight mutations detected](evidence/m6-stop-mutations.txt); sources restored.
- PASS: baseline `mise x -- pnpm test` 203/203; final 212/212 ([suite](evidence/m6-stop-tests.txt)); `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod, `git diff --check` ([checks](evidence/m6-stop-checks.txt)). Minimal demo: `mise x -- node --test tests/stops.test.ts`.
- Browser PASS (system Chromium 152 over CDP; Playwright MCP has no Chrome installed): disposable Git/SQLite, Pi protocol subprocesses. Pause kept the worker busy; inspect/close changed nothing; Stop run confirmed; navigation/reload kept history; ignored cancel stayed pending, SIGKILL restart showed uncertain; emergency confirmed while an unrelated `sleep` survived; zero console errors, no narrow overflow. [Evidence](evidence/m6-stop-demo.json), [controls](evidence/m6-stop-controls.png), [confirmed](evidence/m6-stop-run-confirmed.png), [pending](evidence/m6-stop-pending.png), [uncertain](evidence/m6-stop-uncertain-restart.png), [emergency](evidence/m6-stop-emergency.png), [narrow](evidence/m6-stop-mobile.png).
- Limitations: only the direct app-owned child is signalled (no process groups; spec §9.3 wording interpreted in the ADR); descendants and prior filesystem changes may remain; in-progress integration Git operations are not interrupted. Live cost-bearing turns intentionally omitted; native shutdown under real load remains M8 smoke. No dependency, migration, toolchain or spec change, no blocker. Archived M5 item 6 in [history](progress-m4-m5-history.md). M6/beta incomplete.
- Next: M6 item 8 — explicit interrupted/crashed/disconnected/recovery-required states, bounded retry choice and missing/inaccessible/replaced worktree identity gating. Resume: "Implement M6 item 8 only"; baseline: `mise x -- pnpm test`.

## 2026-10-16 — M6 item 8: explicit recovery causes and identity-gated retry

- Completed item 8 only. `attempt.recovery` (`entities.ts`, default `null`, no migration) records an explicit cause (`interrupted`/`crashed`/`disconnected`/`recovery_required`/`failed`), reason, bounded observations and the owner decision. `engine.fail` now takes a cause from Pi/Codex/FAKE executors and worker help. Pi `disconnected` is no longer stored as `crashed`. Restart records `recovery_required`. [ADR](adr/2026-10-16-recovery-decisions.md).
- `git/worktrees.ts`: manifests record checkout device/inode/birth time, and `verify()` refuses a same-path replacement. `observe()` classifies `verified`/`missing`/`inaccessible`/`replaced`/`unverified`/`not_isolated`. A native attempt whose final worktree check fails records that classification, its path and a `recovery_required` cause.
- `orchestration/recovery-decisions.ts` + `shared/recovery.ts`: owner `POST /api/recovery/recheck` observes repository/worktree/PID (signal 0) and writes only the observation. `POST /api/recovery/decision` is the only path out of `RETRY_DECISION`. It needs the newest recheck, unchanged facts, a verified repository and explicit acceptance of an unverified worktree/process. It then enqueues one fresh attempt in a new worktree under the launch budget, all or nothing, and replays by key. GUI: `recovery-panel.tsx` on RETRY_DECISION cards; cards now use the latest attempt/session/evidence.
- Tests: `tests/recovery-decisions.test.ts` (11) covers a FAKE disconnect → recheck → retry; a surviving `sleep` worker with a same-path-replaced worktree (observation-only, capture refused, nothing relinked/deleted); stale, unaccepted, moved-HEAD and budget refusals rolling back; restart persistence; assignment cannot leave RETRY_DECISION; missing/replaced/inaccessible classification; and a worktree vanishing mid-attempt. [Eight mutations detected](evidence/m6-recovery-mutations.txt); sources restored.
- PASS: baseline `mise x -- pnpm test` 212/212; final 223/223 ([suite](evidence/m6-recovery-tests.txt)); `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod, `git diff --check` ([checks](evidence/m6-recovery-checks.txt)). Minimal demo: `mise x -- node --test --test-name-pattern='fake disconnect' tests/recovery-decisions.test.ts`.
- Browser PASS (system Chromium 152 over CDP, disposable Git/SQLite, FAKE run): cause shown and Retry disabled before recheck; recheck facts kept across an app restart with one attempt; no overflow at 390px; retry → AWAITING_REVIEW with attempts interrupted+completed. Only console entries: favicon 404. [Evidence](evidence/m6-recovery-demo.json), [decision](evidence/m6-recovery-decision.png), [rechecked](evidence/m6-recovery-rechecked.png), [mobile](evidence/m6-recovery-mobile.png), [retried](evidence/m6-recovery-retried.png).
- Limitations: retry is fresh-only (native resume is item 10). Restart does not yet reconcile live processes/worktrees (item 9). A present PID may be reused and descendants are untracked. Older manifests read `unverified`. Live cost-bearing turns intentionally omitted. No dependency, toolchain or spec change, and no blocker. Archived M5 items 7–9 in [history](progress-m4-m5-history.md). M6/beta incomplete.
- Next: M6 item 9 — restart reconciliation of native sessions/process state and worktrees without repeating ambiguous mutating tools. Resume: "Implement M6 item 9 only"; baseline: `mise x -- pnpm test`.

## 2026-10-16 — M6 item 9: restart reconciliation by observation

- Completed item 9 only. `startApp` reopens SQLite, runs `recoverInterrupted`, then awaits `reconcileRestart` (`recovery-decisions.ts`) before the API exists. Each work task in RETRY_DECISION without an observation gets one check + `recovery.reconciled`; observed attempts are untouched, so a quiet restart leaves the journal unchanged. Failures journal `recovery.reconcile_failed`; startup continues. [ADR](adr/2026-10-16-restart-reconciliation.md).
- `orchestration/recovery-observe.ts` (read-only observers moved from `recovery-decisions.ts`) adds: session `processIdentity` (boot ID + `/proc` start time, Pi worker and Codex Lead), so a reused PID is `not_running` and a match is "still running" (needs acceptance); native session `recorded`/`not_recorded`/`conflict` across runs/checkouts; HEAD/start SHA/uncommitted-path count for a verified worktree (`worktrees.ts`); native tools started without a finish. New fields default null, no migration. `recovery-panel.tsx` shows them; fixed a pre-existing squeezed acceptance checkbox (`style.css`).
- Tests: `tests/restart-reconciliation.test.ts` (5), via `startApp` except the conflict case: surviving worker with a vanished folder; reused PID + same-path replacement; verified checkout's uncommitted work recorded once and intact across a second restart; unobservable attempt; session conflict. A counting harness proves no launch/prompt/resume/signal. [Eight mutations detected](evidence/m6-restart-mutations.txt); sources restored.
- PASS: baseline `mise x -- pnpm test` 223/223; final 228/228 ([suite](evidence/m6-restart-tests.txt)); `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod, `git diff --check` ([checks](evidence/m6-restart-checks.txt)). Minimal demo: `mise x -- node --test --test-name-pattern='surviving worker' tests/restart-reconciliation.test.ts`.
- Browser PASS (system Chromium over CDP, production app on a disposable crashed database): one `recovery.reconciled`, worker alive, worktrees unchanged, all new facts visible at 1280/390px without overflow; only console entry favicon 404. [Evidence](evidence/m6-restart-demo.json), [desktop](evidence/m6-restart-desktop.png), [mobile](evidence/m6-restart-mobile.png).
- Limitations: identity is Linux-only/best-effort; descendants untracked; Lead attempts not reconciled; an older check is not refreshed by a later restart (decisions re-observe). Live cost-bearing turns intentionally omitted. No dependency, toolchain or spec change; no blocker. Archived M5 items 10–11 and M6 items 1–2 in [history](progress-m4-m5-history.md). M6/beta incomplete.
- Next: M6 item 10 — context policies auto/fresh/resume per assignment; preserve prior attempt and native transcript links. Resume: "Implement M6 item 10 only"; baseline: `mise x -- pnpm test`.

## 2026-10-16 — M6 item 10: per-assignment context policies

- Completed item 10 only. Owner assignment, Lead `assign_task` (`lao-tools/4`) and recovery retries take `contextPolicy` auto (default)/fresh/resume plus `resumeSessionId`. Migration 7 stores it on the dispatch; rows queued earlier read `fresh`. `orchestration/context-policy.ts` plans each attempt from its lineage (the task's latest earlier attempt, else a revision's source) and records `session.context` (effective, reason, predecessor attempt/session, checkpoint) plus `context.planned`. [ADR](adr/2026-10-16-context-policies.md).
- auto resumes only the task's own cleanly ended session on the same profile, harness and checkout with confirmed stops and an unshared native ID; otherwise it starts fresh with an app-generated checkpoint artifact (records only, not a transcript). Explicit resume is refused at assignment with nothing queued and asks for fresh. FAKE resumes in simulation; Pi records its `pi-sessions/<attempt>` transcript path and never resumes (adapter limitation; new worktree per attempt). Reviews and revisions start fresh; the Lead links its resumed thread. The owner (not the Lead) can now continue a WAITING_HUMAN task once every blocker resolves. GUI: Context picker on cards/retry, lineage and transcript on cards and Sessions.
- Tests: `tests/context-policy.test.ts` (4): FAKE help → owner continuation resumes, Lead continuation refused, unrelated/revision fresh, restart keeps links; explicit-resume refusals roll back; fresh retry checkpoint; Pi refusal + fresh successor prompt/checkpoint/transcripts across restart; blocker table. Updated retry/migration/Lead tests. [12/12 mutations detected](evidence/m6-context-mutations.txt); sources restored.
- PASS: baseline `mise x -- pnpm test` 228/228; final 232/232 ([suite](evidence/m6-context-tests.txt)); `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` 3/3, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod, `git diff --check` ([checks](evidence/m6-context-checks.txt)). Minimal demo: `mise x -- node --test tests/context-policy.test.ts`.
- Browser PASS (system Chromium over CDP, production app, disposable Git/SQLite, FAKE + Pi protocol subprocesses): Pi resume refused (409, nothing queued); auto continuation → fresh successor with checkpoint in View report; FAKE recheck → explicit resume reused the native ID; links unchanged after restart; no overflow at 390px. Console: favicon 404, the expected 409, SSE cut by the restart. [Evidence](evidence/m6-context-demo.json), [refused](evidence/m6-context-resume-refused.png), [Pi fresh](evidence/m6-context-pi-fresh.png), [FAKE resume](evidence/m6-context-fake-resume.png), [restart](evidence/m6-context-restart.png), [mobile](evidence/m6-context-mobile.png).
- Limitations: no real harness worker resumes yet (Pi reopen + same-worktree continuation belong to M8's adapter revisit and smoke #4); a fresh successor starts from base/candidate, so uncommitted earlier work stays only in the retained checkout; FAKE resume is simulated. `scheduling.ts` is now ~550 lines. Live cost-bearing turns intentionally omitted. No dependency, toolchain or spec change; no blocker. Archived M6 items 3–6 in [history](progress-m4-m5-history.md). M6/beta incomplete.
- Next: M6 item 11 — normalize confirmed auth failure, rate limiting and exhausted credits into the Needs You blocker flow. Resume: "Implement M6 item 11 only"; baseline: `mise x -- pnpm test`.
