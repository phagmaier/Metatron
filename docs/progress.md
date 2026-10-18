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

- PASS: `mise x -- pnpm typecheck`, `lint`, `test` **456/456**, `test:fixtures` **3/3**, `build`, `smoke` dev/prod, `smoke:workflow --fake --output <scratch>`, `env XDG_DATA_HOME=<scratch> pnpm demo:m2`.
- Flake hunt, no failure: 6 sequential full runs; 3 runs at `--test-concurrency=10` with 4 CPU burners (load ≈20/6 CPUs); 5 rounds of the 14 bounded-poll/fixed-sleep files at concurrency 14 with 8 burners; `--test-randomize` seeds 1/9137/424242; no orphaned fixture processes. No state-transition change was warranted.
- Fixed: every `pnpm test` leaked 223 dirs / 62 MiB into tmpfs `/tmp` (≈5000 dirs / 1.5 GB since boot), heading for ENOSPC failures. `tests/helpers/temp-root.ts` via `--test-global-setup` sets one `lao-test-run-*` `TMPDIR`, removed only after a passing run (failing runs keep it and print the path); 23 hardcoded `/tmp` test paths now use `tmpdir()`. After: 0 new dirs, 0 MiB, also under contention + random seed 777. README note updated. Existing leftovers not deleted.
- Housekeeping: progress.md exceeded 200 lines; M8 entries moved verbatim to [M8 history](progress-m8-history.md#progress-log-m8-entries-moved-verbatim-at-m9-start-2026-10-18) with a 5-line summary. [Evidence](evidence/m9-suite-stability.json).
- Residual risk: a few tests still wait with short bounded polls or fixed sleeps (e.g. `tests/lead.test.ts` 200×5 ms); stable under stress, left unchanged. No GUI automation exists; live cost-bearing tests intentionally omitted (not authorized).
- Next **M9 item 2**: acceptance scenarios A–G on disposable repos (`mise current`, then spec §13.4); live scenarios need fresh owner spend authorization.

## 2026-10-18 — M9 item 2: acceptance scenarios A–G (in progress)

- Added `scripts/acceptance*.ts` / `pnpm acceptance --scenario X (--fixtures | --allow-live …)`: the real app in its own process (so E can SIGKILL it), owner HTTP API only, fresh disposable repo, engine launch caps plus a driver turn cap, zero-prompt preflight, evidence per run. Live integrations wait for the owner in the GUI unless the owner launches with `--approve-disposable` (granted in chat after two GUI approvals; recorded per evidence).
- Rehearsals (scripted protocol subprocesses, labelled not live): A–G **PASS**. Fixture knobs: Codex delegated role, Pi `conflict` writer; Pi scripted behaviors keyed on gateway-bound sessions.
- Live, owner-authorized Codex `gpt-6-luna`/low Lead, Pi `openai/gpt-6-luna`/low writer/reviewer, OpenCode `opencode/deepseek-v4.1-flash-free`/low readers, 29/32 turns: **PASS** B (second run), D, E, F, G; **FAIL** A (writer edited but never submitted a report; my prompt demanded tests with shell disabled, corrected afterwards), C (OpenCode synthesizer: a refused native read ended the session as a protocol error; workflow `blocked`), first B (reviewer and revision could not see the owner's answer). Evidence: `docs/evidence/m9-acceptance-*-{rehearsal,live}.json`; C's live evidence is reconstructed from its retained DB after the driver waited ~20 min on an unrecognized `blocked` state (driver now fails fast; 5-min live waits).
- Product fixes, each with failing-before tests: owner **Pause worker** → `RETRY_DECISION`, reassign via recovery decision, Lead notified without a wake (`tests/owner-pause.test.ts`, [ADR](adr/2026-10-18-owner-pause.md)); owner API/GUI to save native Explore/Review templates (`tests/workflow-templates-api.test.ts`); an applied integration advances its own run's base so released dependents dispatch (`tests/integration-base.test.ts`, [ADR](adr/2026-10-18-integration-advances-run-base.md)); owner answers included in review/revision packets (`tests/owner-answers.test.ts`).
- PASS: `mise x -- pnpm typecheck`, `lint`, `test` **462/462**, `test:fixtures` **3/3**, `build`, `smoke`. No dependency/toolchain/spec change.
- Next: live reruns of A (≤5 turns) and C (≤6, after deciding the OpenCode refused-path behavior) need fresh spend authorization; then item 2 can be checked. Known limitation: reviews/revisions of candidates captured before a base advance still refuse.

## 2026-10-18 — M9 item 2 completed: live A and C reruns

- Owner authorized more spend. Live **PASS** A (3/5; writer prompt no longer demands tests with shell disabled) and C (6/6 with Pi `openai/gpt-6-luna`/low readers: 4 parallel at cap, synthesis with 21 file:line citations). Both used `--approve-disposable` (script approval on the driver's own fixture, recorded in evidence). Total live spend 43 turns.
- OpenCode refused-tool attempt **reverted**: reject-with-feedback (OpenCode v2 docs) let the refusal through, but 3/4 live OpenCode readers then failed with a redacted native stream error and one was interrupted ([evidence](evidence/m9-acceptance-C-live-2.json)). Restored the verified fatal behavior; open finding: the shared file policy refuses directory `read`s, which OpenCode models issue often. Needs a native protocol capture before changing.
- PASS: `mise x -- pnpm typecheck`, `lint`, `test` **462/462**, `test:fixtures` **3/3**, `build`, `smoke`. Item 2 checked.
- Next **M9 item 3**: permission-boundary/path/CSRF/log/secret/Git-default audit (`mise current`, then `todo.md`).

## 2026-10-18 — M9 item 3: permission and Git safety audit

- Completed item 3 only; [bounded audit](security-audit.md), [results](evidence/m9-security-audit.json). Checkout was clean at session start; all session edits remain uncommitted.
- Fixed Pi dangling-symlink writes by reusing `adapters/file-policy.ts`; centralized credential/config/private-key path filtering in `git/paths.ts`; removed raw shell commands from Codex lifecycle summaries.
- Fixed hidden-index clean-check bypass (`git/inspect.ts`, final `worktreeState`); `git/command.ts` refuses executable filters/custom merge drivers before each operation and enforces the text default merge driver. [Safety/compatibility ADR](adr/2026-10-18-git-checkout-safety.md): executable drivers (including LFS), sparse/hidden index entries are unsupported; no config/flag rewrite, cleanup, reset, stash or force update.
- Failing-before evidence: initial audit **0/5**, clean-filter **0/1**, custom-driver **0/1**; corrected first HTTP probe to use wire Host headers (Node Fetch discarded the forged header). Added 13 boundary tests across `security-audit`, `integration-drift`, `server`.
- PASS: `mise x -- pnpm typecheck`, `lint`, `test` **475/475**, `test:fixtures` **3/3**, `build`, `smoke` (development + production); final focused `mise x -- node --test --test-global-setup=tests/helpers/temp-root.ts tests/security-audit.test.ts tests/server.test.ts` **21/21**; `git diff --check`, changed-file credential-value exclusion and separate evidence JSON parsing (Biome excludes evidence). No dependencies/toolchain/spec changes.
- Native zero-prompt Pi 1.3.0 extension loader/guard registration and owned exit **PASS** ([receipt](evidence/m9-security-pi-startup.json)); earlier optional model-configured startup **BLOCKED** on a fresh unauthenticated catalog, retained with optional owner login command in the receipt. No personal credentials copied; live model turns intentionally omitted (cost). Existing A–G evidence unchanged.
- Limits: Codex reads remain outside worktree confinement; model/test output can contain sensitive text; no OS sandbox or race-proof containment; OpenCode refused-tool turn loss remains open. Next **M9 item 4**: exercise emergency stop, app restart, pending approval, conflict, credit exhaustion and context refresh with visible GUI statuses. Resume: `mise current`, then that item in `todo.md`.

## 2026-10-18 — M9 item 4: visible GUI recovery and blocker statuses

- Completed item 4 only. [GUI report/reproduction](gui-status-checks.md), [evidence + screenshots](evidence/m9-gui-status.json). `scripts/gui-status.ts`, `gui-status-stops.ts`, fixture-only Claude injection in `acceptance-app.ts`; no product runtime/dependency/schema/authority change or ADR.
- Production GUI/real engine + labelled fixtures PASS: emergency stop → paused/RETRY_DECISION/confirmed exit while manual sentinel survived; 4 SIGKILL/restarts without new attempts; pending approval across reload → expired/no controls on restart, separate one-shot acceptance with isolated write; unapplied README conflict/disabled approval; resolved credits stay WAITING_HUMAN; fresh successor/checkpoint/transcript lineage persists.
- Pending/failed/uncertain stop history survives navigation/restart; missing/inaccessible/replaced path/reason/recheck and unverified retry guard verified; original unfinished checkout preserved. Recovery/approval also inspected at 390px, no horizontal overflow.
- PASS: `mise current` (pins unchanged), `mise x -- pnpm typecheck`, `lint`, `test` **475/475**, `test:fixtures` **3/3**, `build`, `smoke` dev/prod; focused stop/restart/context/provider/conflict **35/35**; persisted evidence assertions and `git diff --check`. Fixture type/stdin-shutdown issues fixed; final start/quit exits cleanly. Browser selectors adjusted, no product failure found.
- Computer-use had no available browser; owner explicitly authorized Playwright fallback. Both fixture apps/manual sentinels stopped; data/worktrees retained, paths in evidence. Native cost-bearing tests intentionally omitted; no model calls.
- Limits: refresh uses Pause → Recheck → Fresh + checkpoint → Retry (no dedicated Refresh session button); worker native resume unsupported. GUI recovery PIDs were not_running; surviving-worker cases passed automated tests. Existing direct-child stop/no OS sandbox/OpenCode refused-tool limits unchanged; M9/beta incomplete.
- Next **M9 item 5**: test local Arch/Omarchy start instructions and CLI availability without unnecessary OS packages. Resume: `mise current`, then that item in `todo.md`.

## 2026-10-18 — M9 item 5: local Arch/Omarchy startup instructions

- Completed item 5 only; [startup report](startup-verification.md), [receipt/screenshots](evidence/m9-startup.json). Updated README's startup section: normal frozen install replaces stale `/tmp` store/cache override; exact pinned install, POSIX shell, PATH/login, XDG placement, occupied port and intentional Ctrl-C notes. No runtime/dependency/lockfile/toolchain/ADR change; prior M9 item 4 edits preserved.
- Omarchy 4.0.5, mise 2026.10.12, Node 26.7.0 (not LTS), pnpm 11.22.0, Git 2.56.0. `mise current`, `mise install node@26.7.0 pnpm@11.22.0` (0 tools installed), `mise x -- pnpm install --frozen-lockfile` PASS; no OS/global packages needed.
- Actual `mise x -- pnpm dev` / `build` / `start` PASS with isolated XDG after mise; HTTP/GUI/journal, built assets, 127.0.0.1:4317-only listener, occupied-port refusal and Ctrl-C release verified. Four zero-prompt CLI versions PASS: Codex 0.163.0, Claude 2.1.302, OpenCode 2.0.32, Pi 1.3.0; fresh GUI shows expected login-required or unverified-access diagnostics.
- Node+sh-only PATH starts production and reports all four harnesses Missing; empty-domain DBs verified. Initial artificial Node-only PATH failed because pnpm needed sh; probe corrected with existing `/bin/sh`, no installation. Codex temporary-home alias warning retained; version/discovery still passed.
- PASS: `mise x -- pnpm typecheck`, `lint`, `test` **475/475**, `test:fixtures` **3/3**, `build`, `smoke` dev/prod; focused availability/server **15/15**; evidence assertions and `git diff --check`. All test listeners/discovery children stopped; scratch receipts retained.
- Limits: existing dependency tree/cache reused, no clean-OS/network-download test; no login/credential copying or live model turns (intentionally omitted, cost). No new blockers; existing adapter/security limits unchanged. M9/beta incomplete.
- Next **M9 item 6**: verify project switching never attaches native sessions/worktrees to another repository. Resume: `mise current`, then that item in `todo.md`.
