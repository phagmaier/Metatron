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

## 2026-10-17 — M7 item 6: child scheduling and launch-budget guarantees (archived)

- Completed visible budget holds for unfunded workflow children (migration v9), FIFO admission when commitments free, shared slot caps; tests 295/295, focused 10/10 and standard checks passed; FAKE runtime and browser verified.
- [Original files, commands, evidence and limits](progress-m4-m5-history.md); [budget-hold ADR](adr/2026-10-17-workflow-budget-holds.md); live calls omitted; next was M7 item 7.

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

## 2026-10-17 — M8 item 1: Claude SDK implementation; authenticated live gate BLOCKED

- Dependency justification: add exact `@anthropic-ai/claude-agent-sdk@0.3.302` (matches installed Claude Code 2.1.302) for the official native query/session/permission runtime; stdlib and existing Pi/Codex transports cannot provide its supported SDK protocol. No lower-level model API substitution.
- BLOCKED: installed Claude Code 2.1.302 and SDK control/catalog handshake succeed, but no supported SDK API/provider environment is configured. The explicit live command exits 2 before any model prompt; no personal subscription/OAuth credentials are reused. Owner must privately configure `ANTHROPIC_API_KEY` or an approved Bedrock/Vertex/Foundry environment.
- Implemented `adapters/claude*.ts`: official query/installed CLI, isolated config, exact model/effort and root identity, whitespace-preserving streaming, authoritative result + actual owned exit, bounded cancel and clean same-checkout resume manifests. No shell/delegation/Claude Lead/live steering/OS sandbox claim.
- Wired Claude workers through profiles, teams, native dispatch, owned worktrees, stop/recovery/provider evidence and task Git views. Added authenticated `POST /api/native-approvals`, persisted one-shot inbox bindings/receipts and Approve once/Deny once; generic inbox replies cannot grant access. Cancel/end/restart expire callbacks without replay.
- Added 52 behavior/safety regressions (SDK-boundary fixtures, real inert subprocesses, engine/HTTP/Git). Reproduced and fixed receipt-journal failure skipping cancellation (AWAITING_REVIEW → required RETRY_DECISION). Removed obsolete “Claude unimplemented” assertions; retained unsupported-OpenCode policy coverage, not re-pinned incidental metadata/log wording.
- PASS: final `mise x -- pnpm test` **383/383**; Claude-focused **52/52**; migrated profile/team **8/8**; `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production.
- Native no-model PASS: `mise x -- pnpm test:live:claude --output /tmp/m8-claude-probe-20261017a.json`; [SDK/CLI probe](evidence/m8-claude-probe.json). `--allow-live --model sonnet --thinking low --output /tmp/m8-claude-blocked-20261017a.json` returned expected **BLOCKED/exit 2**, zero prompts, unchanged checkout/checked config metadata and verified fixture removal: [evidence](evidence/m8-claude-blocked.json).
- Chromium production UI PASS with explicit SCRIPTED fixture: Approve once changed only its worker README/candidate; Deny once preserved its worker README/no candidate; both receipts survived reload, 0 page errors, no owner integration/checkout changes; disposable app/Git fixtures removed. [Receipt](evidence/m8-claude-approve-once.png), [runtime checks](evidence/m8-claude-ui.json). Not a live Claude turn.
- [ADR](adr/2026-10-17-claude-worker-permissions.md), README and adapter reconnaissance record authority, auth/cost prerequisite, resume and sandbox limits. Toolchain pins/spec/other M8 items unchanged. Native model streaming/effectiveness/resume/hooks/active cancellation are blocked, not passed; no paid Pi/Codex or four-harness checks were run in this slice.
- Next remains M8 item 1 live gate, not item 2: privately configure supported SDK auth, then `mise x -- pnpm test:live:claude --allow-live --model sonnet --thinking low --output /tmp/m8-claude-live-evidence.json` (fresh output/settings; provider cost). Keep item 1 unchecked until observed. Resume: “Complete M8 item 1 live validation only”.
