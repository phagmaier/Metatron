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

## 2026-10-17 — M8 item 2: OpenCode v2 native adapter

- Dependency justification: exact `@opencode/client@2.0.29` matches installed OpenCode v2.0.29 and supplies the official typed native HTTP/session/event/permission client; stdlib fetch or the v1 SDK would duplicate or use the wrong protocol. No global install or toolchain change.
- Implemented `adapters/opencode*.ts` with private native v2 HTTP/SSE lifecycle and safe manifests; connected Engine/profile/team/worktree, recovery/stop evidence and generic native approvals. Extracted the existing Claude queue/file/checkout guards instead of duplicating them; Claude auth/hooks unchanged, no Pi source changes.
- Owner separately authorized the existing DeepSeek environment route and bounded native calls. PASS: `mise x -- pnpm test:live:opencode --allow-live --model deepseek/deepseek-flash --thinking low --output /tmp/m8-opencode-native-transient-stream-new.json`; [receipt](evidence/m8-opencode-native-live.json). Five prompts: read, same-ID resume, deny/cancel, approve once plus independent denial/stale refusal, active generation cancel with interrupt acknowledgement; native low model refs, owned exits 130, only approved disposable file changed.
- Final no-model PASS: `mise x -- pnpm test:live:opencode --output /tmp/m8-opencode-no-model-final-new.json`; [receipt](evidence/m8-opencode-discovery.json). Private Basic auth/PID/loopback, unauthenticated mutation 401, hostile project plugin never loaded, effective policy before prompts. Auth stays unknown; native authenticated GET is not Origin protection.
- Observed/fixed v2 readiness, prompt wake and stream differences: HTTP/catalog precedes plugin activation, `resume:false` only queues, transient text deltas are absent from generated V2Event. Earlier fresh read-only diagnostics retained at paths in [recon](adapter-recon.md#m8-item-2--native-opencode-validation-2026-10-17); one completed read consumed model execution before stream mapping was corrected. No ambiguous mutation replay.
- Two read-only reviews found/fixed fragmented password framing, canceled stream-start/late-read grants and double-release of a successor's lease. Four focused regressions plus native stream, identity, one-shot approval, recovery and HTTP integration cases pass; no coding workers shared this branch.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **421/421**, OpenCode-focused **21/21**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production. No additional Pi/Codex/Claude cost-bearing calls in this item.
- Actual scratch-browser approval/denial/reload [receipt](evidence/m8-opencode-ui-fixture.json) uses inert HTTP/SSE/Git fixtures, not native model/gateway proof. Stale controls absent; no browser exceptions observed, navigation/HMR aborted fetches. Actual mise-runtime exact-secret exclusion passed for all three evidence files; no credential values printed.
- Expanded the existing [OpenCode v2 ADR](adr/2026-10-15-opencode-v2-interface.md), README/recon/next-steps; checked only M8 item 2. Live steering/usage and native gateway/Lead/four-harness validation remain unclaimed, with no spec/toolchain changes. Safety is application policy, not an OS sandbox.
- Environment note: a permitted `mise x` invocation itself auto-purged old Claude **2.1.301** and `oh-my-pi` **18.11.1** installations/cache entries. No global config edits or manual-session attachment were performed; this is not proof about unrelated session health.
- Exact next **M8 item 3 only**: revisit installed Pi/Codex capabilities and surface unavailable controls accurately. Resume with `mise current`, the M8 header/recon and those adapters; retain later diagnostics, worker/Lead and matrix gates in checklist order. Slice B placement stays unchanged.

## 2026-10-17 — M8 item 3: Pi/Codex capability revisit

- Installed Codex **0.163.0** (M4 live Lead used 0.162.1) and Pi **1.3.0** (unchanged; oh-my-pi installs `omp`, not `pi`). Regenerated Codex schemas/types and re-read Pi RPC docs in scratch; no model turn, login, credential read, dependency or toolchain change.
- Real difference fixed in `codex.ts`: `experimentalFeature/list` is paginated; startup read one page, so a delegation feature enabled on a later page passed vacuously. Now reads every page and refuses unless all 14 disabled features are reported disabled. `codex-events.ts` maps the new native `sleep` tool item. Stale "Steering arrives with M6" diagnostic replaced by explicit unsupported controls (worker sessions, live steering; native `turn/steer` deliberately unused).
- `pi.ts`: discovery states unsupported per-call approvals, resume and coordinator sessions; stale "M3" refusal text removed. README no longer claims Pi lacks steering.
- New `src/shared/native-controls.ts`: per-harness live-input and assignment-resume availability with reasons (resume reasons moved from `context-policy.ts`). Adapters derive `supportsLiveSteer` from it; `worker-messages.ts` refuses unsupported harnesses before any native call; `worker-message-panel.tsx`/`context-panel.tsx` disable Send/Resume with the reason. Also fixes Claude/OpenCode sessions that offered a steering control which always ended `unsupported`.
- Regressions (each failed on the previous code): later-page enabled / unreported feature refuses Codex startup with no thread; busy Claude-shaped worker gets its harness reason with zero `steer` calls; `sleep` item mapping. Codex fixture now reports every flag and can page.
- PASS: `mise x -- pnpm typecheck`; `mise x -- pnpm lint`; `mise x -- pnpm test` **423/423**; `mise x -- pnpm test:fixtures` **3/3**; `mise x -- pnpm build`; `mise x -- pnpm smoke` development/production.
- Native no-model PASS through updated adapters, fresh disposable app dirs: [receipt](evidence/m8-pi-codex-capabilities.json) — Codex installed/auth false (fresh home)/8 models, Pi installed/auth unknown/2 models, personal-config metadata unchanged, zero surviving processes.
- Browser PASS (cached Playwright + `/usr/bin/chromium`; MCP Chrome absent, not installed), inert scripted session, desktop/390px: [readback](evidence/m8-pi-codex-controls-browser.json), [desktop](evidence/m8-pi-codex-controls-browser-desktop.png), [mobile](evidence/m8-pi-codex-controls-browser-mobile.png). Only console error: existing favicon 404.
- One interrupted local verification run (new test hung against swapped-in old code) left three disposable `/tmp/lao-*` fixtures; inspected and removed. The test now releases its held prompt in `finally`.
- Intentionally omitted (cost): native Codex Lead turn on 0.163.0 and all live Pi turns. Next **M8 item 4 only**: installed/missing/auth-required/available state with actionable diagnostics per harness. [Recon](adapter-recon.md#m8-item-3--picodex-capability-revisit-2026-10-17).

## 2026-10-17 — M8 item 4: harness installed/auth state and diagnostics

- New **Harness setup** panel (`harnesses-panel.tsx`, mounted in `main.tsx`; profile editor reuses its label/next step): Missing / Installed · not ready / Login required / Available / Discovery failed per harness, with harness-reported version and a concrete next step. `AdapterCapabilities` gains `version`/`nextStep`; `profiles.ts` derives `state` from the gates `validate()` uses. Native/team/Lead start refusals carry the next step.
- `adapters/availability.ts`: one absolute-PATH executable resolver (`NOT_INSTALLED`), shared by Claude/OpenCode (unchanged behavior) and now Pi/Codex, which spawned by bare name: an inert planted script showed the old Pi launcher ran a relative-PATH `<cwd>/planted/pi` and called it installed.
- Versions: Codex initialize user agent, Claude `initializationResult()`, OpenCode server info, Pi `pi --version` with app-owned agent dir. Verified no-model: Pi lists 0 models without provider keys → login required; OpenCode lists free models without keys → stays available/unknown.
- Semantics change: `installed` now means the executable was found; Codex feature-policy refusal and Claude init failure report installed-not-ready (auth unknown), and a failed Pi catalog drops partial models. Four existing assertions updated accordingly.
- Regressions: relative PATH never runs a planted executable and all four report missing (fails on the old Pi launcher); found-but-failing Pi/Codex are installed-not-ready; Pi/OpenCode zero-model and Codex logged-out next steps; harness versions; profile state table where only Available admits a profile.
- PASS: `mise x -- pnpm typecheck`; `mise x -- pnpm lint`; `mise x -- pnpm test` **427/427**; `mise x -- pnpm test:fixtures` **3/3**; `mise x -- pnpm build`; `mise x -- pnpm smoke` development/production.
- Native no-model PASS, real app + all four installed binaries, fresh disposable data: [receipt](evidence/m8-harness-availability.json) (ambient: Codex/Claude login required, OpenCode/Pi available; restricted PATH/keys: OpenCode missing, Pi login required). Zero prompts, personal config metadata unchanged, no surviving app-owned processes, credential exclusion passed. Browser PASS desktop/390px: [available](evidence/m8-harness-availability-desktop.png), [missing/login](evidence/m8-harness-availability-restricted-desktop.png), [mobile](evidence/m8-harness-availability-restricted-mobile.png).
- No dependency, spec, ADR or toolchain change; no login or token created. Next **M8 item 5**: all four harnesses as read-only workers with effective model/think settings (cost-bearing; needs owner authorization). [Recon](adapter-recon.md#m8-item-4--installedauth-state-and-actionable-diagnostics-2026-10-17).

## 2026-10-17 — M8 item 5: four harnesses as read-only workers

- Codex read-only workers: `codex.ts` accepts a fresh gateway-connected `read_only` thread (or the Lead), applies effort via `config.model_reasoning_effort` and refuses prompts unless the thread response reports that model and effort; `codex-events.ts` interrupts on `model/rerouted` and fails a blocked turn that still completes. Profiles/teams/native runs/worktrees admit Codex readers only; `Engine.adapters` and shared `harnessLabel` replace per-harness ternaries. [ADR](adr/2026-10-17-codex-read-only-workers.md).
- New `settings_verified` session event, emitted by all four adapters before a completed turn with the natively confirmed model/thinking and source. New opt-in `scripts/live-workers.ts` (`pnpm test:live:workers`); no dependencies added.
- Regressions: Codex reader end-to-end with read-only/never/effort config, writer refused before any run, effort mismatch refuses prompts, reroute → `RETRY_DECISION` with no result, reroute-then-complete maps to failed; `settings_verified` asserted for Pi/OpenCode/Codex engine runs and Claude init/hook proof; Codex reader accepted in a team. Updated three Codex-Lead-only permission assertions.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **432/432**. No-model Codex 0.163.0 probe confirmed `reasoningEffort` echo. Zero-prompt discovery for all four via the new script.
- Live PASS (owner-authorized, cheapest selections; [recon table](adapter-recon.md#m8-item-5--four-harness-read-only-workers-2026-10-17)): Pi deepseek-flash/off, OpenCode free opencode/deepseek-v4.1-flash-free/low, Codex gpt-6-luna/low, Claude haiku/low (`claude-haiku-5-5`). All reported the committed nonce, settings confirmed natively, no worktree/owner/personal-config change.
- First Pi attempt (low) completed natively, but my script crashed reading the journal (limit 2000 > 500 max); the receipt was rebuilt read-only from retained state, the script now pages, and an inert dry run preceded later paid turns. That receipt fails only on personal `~/.pi/agent` writes 34 s after the app's Pi exited (cwd = repo, not the worktree), most likely separate personal Pi use, not proven.
- My error: setting `XDG_DATA_HOME` before `mise x` made mise attempt tool installs into the disposable dir (~1 GB partial, removed). Default tests leave ~350 `/tmp/lao-*` fixtures per run (pre-existing debt). Claude token file deleted; owner's `/tmp/metatron-token-setup.*` dirs left for the owner.
- Next **M8 item 6 only**: each harness as Lead through the scoped gateway, or a precise limitation with tested fallback. App-owned Codex login lives at `/tmp/lao-m8-workers/local-agent-orchestrator/codex` (lost on reboot).

## 2026-10-17 — M8 item 6: Lead support and tested worker fallbacks

- Preserved the completed item 5 handoff as **99d7ad5**, pushed to `origin/main` after typecheck/lint, focused **9/9** and receipt credential checks; no remote divergence.
- Only Codex has a coordinator executor/policy. Pi/Claude/OpenCode return `UNSUPPORTED` for coordinator inputs; documented their exact application worker-only limits, not native SDK impossibility. Item 6 checked under its explicit limitation/fallback alternative.
- New `scripts/live-leads.ts` / `pnpm test:live:leads`: default actual four-harness discovery/refusals, zero prompts; [receipt](evidence/m8-lead-support-probe.json). Opt-in sends one Codex Lead turn and never launches a worker.
- Native PASS: `mise x -- env XDG_DATA_HOME=/tmp/lao-m8-workers pnpm test:live:leads --allow-live --model gpt-6-luna --thinking low --output docs/evidence/m8-lead-codex-native.json`; [receipt](evidence/m8-lead-codex-native.json): nonce read, scoped status/proposal tools, coordinator-assignment denial, verified settings, owned exit 0, unchanged checkout/checked personal metadata.
- `tests/lead-fallback.test.ts` **3/3** proves each saved Codex-Lead + worker fallback with real engine/gateway/Git and inert native transports: coordinator/profile refusal, isolated reader, one launch/wake-up, resumed Lead report consumption and role denial. Initial incidental worker `tools/list` handshake assertion failed; deleted, not re-pinned. Existing gateway/Lead **29/29** passed.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **435/435**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production; both new receipts passed JSON/outcome/exact-environment-secret exclusion.
- No new Pi/Claude/OpenCode model prompts, live cross-harness delegation or broad isolation claim. Claude currently has no supplied token. Successful probe repos/databases removed; app-owned Codex login retained. README/recon/next-steps/todo updated; no dependencies, toolchain, spec, authority-policy changes or new ADR.
- Next **M8 item 7 only**: verify global-config/manual-session/token isolation, retaining historical Pi metadata uncertainty. Resume: `mise current`, then the M8 checklist and [item 6 recon](adapter-recon.md#m8-item-6--lead-gateway-support-and-tested-fallbacks-2026-10-17); item 8's full matrix remains incomplete.

## 2026-10-17 — M8 item 7: harness config/session/credential isolation

- Chose isolation over extra Lead implementations. `adapters/environment.ts`, Codex/Pi/Pi-version now exclude unrelated tokens, personal-session selectors and preload hooks; Pi retains documented provider variables, Codex app-owned login only. Claude cloud auth now uses exact variables for explicitly enabled routes, not blanket prefixes.
- Fixed completed Claude disposal unlinking a successor's resume lease; release clears ownership before unlink. New `harness-isolation.test.ts` **3/3** and `claude-isolation.test.ts` **6/6** failed before and passed after; focused new/Claude/stop checks **65/65**.
- Native PASS: `mise x -- pnpm smoke:isolation --output /tmp/m8-isolation-native-first.json`; [receipt](evidence/m8-isolation-native.json). Two real app lifecycles/four installed binaries, inert auth only, zero prompts, app-owned config, intended-only canaries, no cross-harness file copies/preload/service contact; owned exits 0/0/0/130.
- Seven watched real config/auth/session roots unchanged by metadata, 10/10 pre-existing native process identities preserved, unrelated process/service canaries untouched. No real credentials/config/transcript contents read by observers or personal sessions attached; native cloud entitlement and every filesystem access unproven. Historical Pi writes remain unattributed.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **444/444**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production. New [privacy-boundary ADR](adr/2026-10-17-harness-environment-isolation.md), README/recon/checklist/next-steps updated; no dependencies, toolchain, spec, model or tool-authority changes.
- Two bounded read-only audits; no further material current-gate finding. Successful native scratch state and six ownership-checked failing-before fixtures removed; older temp-folder debt untouched. No paid model turns, UI changes, OS isolation or complete descendant-cleanup claim.
- Next **M8 item 8 only**: per-adapter `spec.md` §13.3 smoke matrix, including honest auth/cost/unsupported outcomes. Resume: `mise current`, the M8 checklist and [item 7 recon](adapter-recon.md#m8-item-7--config-session-and-credential-isolation-2026-10-17); beta remains incomplete.

## 2026-10-17 — M8 item 8: smoke matrix recorded; native completion BLOCKED

- Added [seven-check per-adapter matrix](adapter-smoke-matrix.md), separating fresh discovery, existing native receipts, unsupported controls and missing observations. Updated README/recon/handoff/todo; item 8 remains unchecked, M9 untouched.
- Started `mise current`: pinned Node 26.7.0 / pnpm 11.22.0. Fresh actual-app/four-native-adapter probe PASS: [catalogs/refusals receipt](evidence/m8-smoke-matrix-discovery.json); Codex 0.163.0, Claude 2.1.302, OpenCode 2.0.29, Pi 1.3.0. Zero prompts/attempts/sessions; six UNSUPPORTED refusals.
- Fresh home auth: Codex false, Claude AUTH_ABSENT, Pi/OpenCode unknown. Fixture HEAD/status and seven named personal-config metadata unchanged; no matching owned process at close/3 s. Successful scratch state/probe removed; no blanket isolation or entitlement claim.
- Owner selected **Keep new model turns blocked**. No new model/provider authentication, login, native Write or integration approval. Existing usage authorizations do not carry forward; Claude still needs a privately supplied approved route.
- Missing: retained Codex/Pi streaming, current Codex Lead resume/cancel (M4 used 0.162.1), Pi active cancellation, Pi/Claude/OpenCode native gateway-denial checks, and a native writer candidate independently reviewed and separately approved for integration. Direct native Write approval is not integration approval.
- PASS: `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **444/444**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke` development/production. No new permanent tests; existing fixtures are not native model evidence.
- Receipt invariants, 15 linked matrix files and exact-environment-secret exclusion across seven artifacts PASS; throwaway link checker initially misparsed an escaped literal, then was corrected. Older test `/tmp` retention debt remains untouched.
- Archived the original three Claude item-1 entries verbatim in [M8 history](progress-m8-history.md) with concise links here to keep progress under 200 lines. No app code, dependencies, toolchain, spec or ADR changes.
- Next remains **M8 item 8**, blocked by explicit spending HOLD and Claude auth prerequisite. Resume `mise current`, the matrix and latest recon; obtain new scoped authorization before missing native turns and separate integration approval after review.
