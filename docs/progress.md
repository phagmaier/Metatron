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

## 2026-10-17 — M8 item 1: Claude SDK implementation (archived)

- Implemented official CLI/SDK workers, guarded native permissions, durable receipts, checkout identity and no-replay recovery; 383/383 tests and standard checks passed. Native auth initially blocked; no personal credential extraction.
- [Original dependency justification, commands, fixtures and limitations](progress-m8-history.md#2026-10-17--m8-item-1-claude-sdk-implementation-authenticated-live-gate-blocked); later entries below resolve the gate.

## 2026-10-17 — M8 item 1 Slice A: setup-token compatibility (archived)

- Added narrow setup-token forwarding/classification with preserved provider precedence, vendor-policy caveat and five-scenario smoke; 392/392 tests, focused 61/61 and standard checks passed. Inert/no-model probes only; real auth initially absent.
- [Original commands, authentication ADR, blockers and evidence](progress-m8-history.md#2026-10-17--m8-item-1-slice-a-setup-token-compatibility-native-model-gate-blocked); no entitlement inferred.

## 2026-10-17 — M8 item 1 native gate completed (archived)

- Owner-authorized Claude 2.1.302/SDK 0.3.302 five-turn smoke passed: streamed read, same-ID resume, one-shot approval/independent denial and active cancellation. Fixed observed skill/plugin/effort/stream differences; 400/400 tests and standard checks passed.
- [Original commands, native receipts, prior failure chain, token cleanup and limits](progress-m8-history.md#2026-10-17--m8-item-1-native-gate-completed); no future usage authorization, entitlement or full matrix claim.

## 2026-10-17 — M8 item 2: OpenCode v2 native adapter (archived)

- Official client/native 2.0.29, private authenticated loopback host, permissions/resume/stream/cancel and engine integration verified with five authorized prompts plus no-model/browser fixtures. Default 421/421, focused 21/21 and standard checks passed; no OS sandbox or complete matrix claim.
- [Original commands, dependency justification, ADR, diagnostics and evidence](progress-m8-history.md#2026-10-17--m8-item-2-opencode-v2-native-adapter); no future usage authorization; next was M8 item 3.

## 2026-10-17 — M8 item 3: Pi/Codex capability revisit (archived)

- Codex 0.163.0 feature pagination now fails closed across all pages; native sleep mapping and shared unsupported-control diagnostics/UI corrected. No-model capabilities/browser fixtures verified; default 423/423, fixtures 3/3 and standard checks passed, with no paid turn or login.
- [Original files, commands, regressions, screenshots and limits](progress-m8-history.md#2026-10-17--m8-item-3-picodex-capability-revisit); Pi 1.3.0 unchanged; next was M8 item 4.

## 2026-10-17 — M8 item 4: harness installed/auth state and diagnostics (archived)

- Added Harness setup states, harness-reported versions and actionable auth/model diagnostics; shared absolute-PATH resolution fixed planted-executable launches. Default 427/427, fixtures 3/3, standard checks, four-native zero-prompt discovery and desktop/mobile fixture UI passed.
- [Original files, commands, regression evidence and limitations](progress-m8-history.md#2026-10-17--m8-item-4-harness-installedauth-state-and-diagnostics); no login/token/dependency/ADR change; next was M8 item 5.

## 2026-10-17 — M8 item 5: four harnesses as read-only workers (archived)

- All four native read-only workers passed with confirmed model/thinking; Codex readers and `settings_verified` added. Default 432/432 and standard checks passed; first Pi receipt retains unexplained personal metadata writes and no PASS.
- [Original files, authorizations, commands, failures and limitations](progress-m8-history.md#2026-10-17--m8-item-5-four-harnesses-as-read-only-workers); next was M8 item 6.

## 2026-10-17 — M8 item 6: Lead support and tested worker fallbacks (archived)

- Codex alone implements Lead; native scoped invocation/denial passed, Pi/Claude/OpenCode coordinator refusal and inert fallback 3/3 verified. Default 435/435 and standard checks passed; no all-four Lead claim.
- [Original files, authorizations, commands, failures and limitations](progress-m8-history.md#2026-10-17--m8-item-6-lead-support-and-tested-worker-fallbacks); next was M8 item 7.

## 2026-10-17 — M8 item 7: harness config/session/credential isolation (archived)

- Fixed environment credential/preload leakage and Claude successor lease disposal; nine failing-before/passing-after regressions, default 444/444 and standard checks passed. Actual four-native zero-prompt isolation preserved seven watched roots and 10 existing process identities; no broad OS/cloud-entitlement claim.
- [Original files, commands, ADR, native evidence and limitations](progress-m8-history.md#2026-10-17--m8-item-7-harness-configsessioncredential-isolation); next was M8 item 8; historical Pi writes remain unattributed.

## 2026-10-17 — M8 item 8: smoke matrix recorded; native completion BLOCKED (archived)

- Recorded the seven-check matrix and actual four-harness zero-prompt discovery/refusals; default 444/444 and standard checks passed. Owner chose spending HOLD; native streaming/lifecycle/denial/writer gates remained open.
- [Original authorization decision, exact commands, evidence and limitations](progress-m8-history.md#2026-10-17--m8-item-8-smoke-matrix-recorded-native-completion-blocked); no box checked, M9 untouched.

## 2026-10-17 — Desktop development readiness (no milestone development)

- Verified pinned Node 26.7.0 / pnpm 11.22.0, Git 2.56.0; installed locked dependencies with `mise x -- pnpm install --frozen-lockfile` (offline metadata incomplete). No manifest, lockfile, pin or application-code changes.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **444/444**, `mise x -- pnpm test:fixtures`, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production. Tests/smoke require loopback permission outside the tool sandbox; interrupted the restricted run. [Test log](/tmp/metatron-desktop-tests-unrestricted.log).
- Zero-prompt native discovery/refusals PASS: Codex 0.163.0, Claude 2.1.302, Pi 1.3.0, OpenCode **2.0.32** (previous receipt 2.0.29; paid compatibility unverified). [Desktop receipt](/tmp/metatron-desktop-harnesses-20261017.json); disposable Codex/Claude/Pi homes require auth, OpenCode entitlement unknown; checked personal-config metadata unchanged.
- Origin main matches HEAD `be65ee6`; pre-existing `prompt.md` deletion untouched. No existing desktop app-data directory: laptop tasks/profiles/app-owned authentication are not migrated. No model turns, global configuration changes, ADR or milestone boxes checked.
- Ready for fixture-based development: `mise x -- pnpm dev` → http://127.0.0.1:4317. Next remains **M8 item 8**, with the existing spending HOLD and separate native integration approval requirement intact.

## 2026-10-18 — M8 item 8: cost-free smoke runner preparation; native HOLD

- `scripts/live-workers.ts`/`live-leads.ts` now retain ordered streaming; Pi `--verify-cancel` adds one cancellation turn, Codex `--verify-lifecycle` adds completed same-thread follow-up/cancel. At most two/three turns respectively with authorized opt-in; zero without `--allow-live`. Shared `native-smoke-evidence.ts` enforces text → stop → native interruption → owned exit, no replay and redacted failure retention.
- [Inert protocol runner evidence](evidence/m8-smoke-runner-fixtures.json): Pi reader/cancel, Codex reader and Lead lifecycle PASS; two completed-before-stop targets correctly fail with retained state/no retry. Initial throwaway Lead fixture roster selector failed; corrected only the fixture hook. Four permanent ordered-evidence regressions.
- [Actual four-harness zero-prompt preflight](evidence/m8-smoke-runner-preflight.json), both lifecycle flags set: Codex 0.163.0 / Claude 2.1.302 / Pi 1.3.0 / OpenCode 2.0.32. Fresh Codex/Claude/Pi require auth; OpenCode unknown. Owner checkout and checked personal-config metadata unchanged; catalog/refusal proof only.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **448/448**, focused evidence **4/4**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production. Receipt invariants and exact-environment-secret exclusion passed.
- README/matrix/recon/handoff updated. No adapter authority, dependency, toolchain, spec or ADR change; zero native model turns/logins/integration, no checkbox changed, M9 untouched. Native worker gateway-denial probes remain uninstrumented; native writer/candidate/review/integration proof remains absent. Existing `prompt.md` deletion untouched.
- Moved item 2 verbatim to the existing M8 history with a five-line summary here to retain the progress size bound. Removed this continuation's throwaway probes/owned scratch state after evidence preservation; older test-fixture debt untouched.
- Exact next remains **M8 item 8**: `mise current`, then [matrix prerequisites](adapter-smoke-matrix.md#blockers-and-exact-continuation). Obtain fresh scoped spending/native auth before missing live checks; candidate review and a separate explicit integration approval must precede apply.


## 2026-10-18 — M8 item 8: cross-assignment gateway preparation; spending HOLD

- Owner chose **Continue cost-free preparation**. `live-workers.ts --verify-gateway-denial` adds one foreign-task override attempt inside its reader turn; `native-smoke-evidence.ts` binds successful assignment → one server `INVALID_INPUT` → result to the same task/attempt/session, with unchanged foreign task/no dispatch. Seven regressions added. Archived old item 3 verbatim in existing M8 history to keep this file bounded.
- [Inert proof](evidence/m8-gateway-scope-fixtures.json): Pi/Claude/OpenCode positive probes PASS; three valid readers claiming an unobserved denial correctly exit 1, retain state and do not retry. [Actual no-prompt preflight](evidence/m8-gateway-scope-preflight.json): Pi/Claude auth required, OpenCode 2.0.32 unknown/requested DeepSeek unavailable; zero prompts, no control run, owner checkout and checked personal metadata unchanged. Own scratch evidence preserved before ownership-checked cleanup.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **455/455**, focused `mise x -- node --test tests/native-smoke-evidence.test.ts` **11/11**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production.
- Schema/scope rejection is **not worker-to-Lead role denial**; absent Lead tools were not exposed or replaced with a weaker native PASS. Native client pre-validation remains untested. No adapter policy, dependency, toolchain, spec or ADR change, native model turn, login, writer/integration approval or milestone check-off; M9 untouched. README/matrix/recon/handoff updated.
- Exact next remains **M8 item 8**: `mise current`, then [matrix prerequisites](adapter-smoke-matrix.md#blockers-and-exact-continuation). Native checks stay blocked until fresh scoped spending/auth approval; native writer/candidate/review evidence and separate post-review integration approval remain missing.

## 2026-10-18 — M8 item 8: approval-held writer/reviewer preparation

- Added `scripts/live-writer.ts` / `pnpm test:live:writer`: Pi writer plus distinct read-only Reviewer, exact README/candidate checks, effective-fresh independent context and isolated tested preview. Both spend/disposable-write gates required for at most two future turns; default zero-turn discovery. Atomic fresh default database claim prevents replay; native success/failure retained for owner GUI inspection. No approve/apply path.
- [Inert lifecycle/HTTP proof](evidence/m8-writer-held-fixtures.json): held preview passes; incorrect edits, requested changes and reviewer mutation stop before preview, either gate alone dispatches nothing, existing DB/integration option refuse without child spawn. Initial requested-vs-effective context check and throwaway diff-field mistake corrected without policy relaxation. [Actual Pi 1.3.0 preflight](evidence/m8-writer-preflight.json): auth required, zero attempts/sessions; owner checkout and checked personal metadata unchanged.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **455/455**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod. No native turn/login/Write/integration/check-off or new ADR; M9 untouched. Next **M8 item 8**: `mise current`, [matrix prerequisites](adapter-smoke-matrix.md#blockers-and-exact-continuation), fresh native auth/spend/write authorization, then separate post-review integration approval. Archived item 4 verbatim in M8 history; own inert scratch removed after verification.

## 2026-10-18 — M8 item 8: native Codex Lead lifecycle

- Owner authorized exactly three Codex `gpt-6-luna` / low Lead turns, no retries/workers/source writes/integration. Owner completed native browser login in the intentional app-owned home; no personal credential file was opened or copied.
- [Auth history](evidence/m8-codex-auth-preflight.json) retains initial false discovery after owner confirmation and final `authenticated:true`/selection available after exact native login. No prompt while false; the initial mismatch's cause is unproven.
- Native PASS: `mise x -- env XDG_DATA_HOME=/tmp/metatron-m8-auth-sjdG2wvR pnpm test:live:leads --allow-live --verify-lifecycle --model gpt-6-luna --thinking low --output /tmp/metatron-m8-auth-sjdG2wvR/codex-lead-lifecycle-native.json`; [receipt](evidence/m8-codex-lead-lifecycle-native.json), Codex 0.163.0, three submitted turns, all checks true.
- Proof: streamed nonce/settings/gateway `POLICY_DENIED`, completed same-thread/predecessor-linked follow-up, text → stop → native interruption → owned exit 0 with `CANCELLED`/no success report. Fixture HEAD/status and checked personal metadata unchanged; successful fixture/per-run DB removed, app-owned login retained under `/tmp`.
- README/matrix/recon/handoff/todo updated without checking a box; archived completed M8 items 5–6 verbatim in existing M8 history to keep progress bounded. No app code, dependency, toolchain, spec or new ADR; no tests added or new Pi/Claude/OpenCode prompts.
- PASS: `mise x -- pnpm lint`; throwaway `mise x -- node --input-type=module -e …` receipt/auth/order invariants, byte-identical native receipt, 26 matrix links, exact-environment-secret exclusion across nine artifacts, unchanged milestone boxes and bounded progress. Typecheck/default tests/fixtures/build not rerun (no application code changed); other live harness turns intentionally omitted (not authorized).
- Next **M8 item 8**: three-turn allowance exhausted; Pi streaming/cancellation, three native worker role-denial observations and writer/review/integration remain open. Resume `mise current`, [matrix prerequisites](adapter-smoke-matrix.md#blockers-and-exact-continuation); fresh auth/spend/write scope needed, integration only after actual review and separate approval. M9 untouched.


## 2026-10-18 — M8 item 8: Pi reader passed; strict cancellation held

- Owner completed app-owned Pi OAuth login, then explicitly authorized two `openai/gpt-6-luna` / low read-only turns, no retries/writes/integration. [Preflights](evidence/m8-pi-oauth-preflight.json): installed login's native status uses provider `openai`/OAuth; my first `openai-codex` query was the wrong identifier. No credential-file contents read/copied by the observer.
- Ran `mise x -- env XDG_DATA_HOME=/tmp/metatron-m8-auth-sjdG2wvR pnpm test:live:workers --allow-live --harness pi --model openai/gpt-6-luna --thinking low --verify-cancel --output /tmp/metatron-m8-auth-sjdG2wvR/pi-reader-cancel-native.json`: **exit 1**, two prompts. [Unchanged native receipt](evidence/m8-pi-reader-cancel-native.json): reader streamed correct nonce/settings, completed/exited 0 with unchanged worktree; overall cancellation gate remains failed.
- [Native ordering analysis](evidence/m8-pi-cancellation-analysis.json): result 111 → text 114 → stop 116 → `native_error` 122 → interruption 124 → exit 126; task `CANCELLED`. Native assistant stop is `aborted`; only stop-reason/error-presence metadata inspected. Failed native DB/fixture/worktrees retained, no replay, fixture/checked personal metadata unchanged.
- `pi.ts`/`pi-events.ts` distinguish explicit requested aborts from unexpected aborts and genuine provider/transport errors; usage/interruption retained. Updated inert RPC sequence and engine/mapper regressions: both failed before, passed after. [Actual engine/Git/inert-subprocess smoke](evidence/m8-pi-requested-abort-fixture.json) PASS, zero native turns; early-result check unchanged, original native failure not rewritten.
- README/matrix/recon/handoff/checklist updated; archived M8 item 7 and original matrix entry verbatim into existing M8 history to retain size bound. No authority, dependency, toolchain, spec or new ADR change; no other live harness prompt, native writer/review/integration or milestone check-off.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **456/456**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` dev/prod; initial lint assertion wrapping failed and was corrected. Receipt/order/retention checks, 34 matrix links and exact-environment-secret exclusion across 11 artifacts passed. Native retry/other live harness turns intentionally omitted (not authorized).
- Next **M8 item 8**: strict native Pi cancellation remains open after the fixture-only fix; both Codex/Pi allowances exhausted. Resume `mise current`, [matrix prerequisites](adapter-smoke-matrix.md#blockers-and-exact-continuation); fresh scope needed before another turn, native worker role-denial and writer/review/integration still open, integration only after actual review and separate approval. M9 untouched.

