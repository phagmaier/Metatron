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
