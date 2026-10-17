# Local Agent Orchestrator - Ordered Implementation Checklist

Execution owner: coding agents under the human project owner  
Source of truth: [spec.md](./spec.md)  
Agent operating rules: [AGENTS.md](./AGENTS.md)

**How to use this file**

- Work in order, **one vertical slice at a time**. Do not implement the whole product in one unreviewed pass. Complete **one milestone per session** unless the owner explicitly asks for more.
- Each milestone header lists its relevant `spec.md` sections. Read only those sections plus this milestone (see `AGENTS.md` context rules). Do not re-read the full spec each turn.
- Check `[x]` only for completed, tested work. If a task is partly done, leave it unchecked and add a short note directly below it.
- Every milestone ends with a runnable demonstration and tests. Append at most ~15 lines per milestone to `docs/progress.md` (created during M0); do not claim a milestone is complete without evidence.
- `spec.md` defines product behavior. If real APIs force a different solution, record an ADR and update the affected spec section rather than quietly dropping requirements.
- Prioritize safe changes on a **disposable test repository**. Never use an important real codebase for early integration tests.
- Live model calls cost tokens/credits; use FakeAdapter for most tests and only deliberate live smoke tests when needed.
- Build a minimal browser GUI early; don't wait until the backend is "complete."

## M0 - Repository preparation and adapter reconnaissance [spec §0, 3, 5, 8, 10, 13]

- [x] Read `spec.md` (especially sections 0, 3, 4, 5, 8, 10, 13) and `AGENTS.md`; make a one-paragraph scope summary in `docs/progress.md`.
- [x] Inspect the development machine via mise shims only (`mise current`, `mise ls`, `mise x -- node --version`, `mise x -- pnpm --version`, `git --version`) and availability/versions of `codex`, `claude`, `opencode`, and `pi`; **do not install or modify global configurations automatically**. If `.mise.toml` pins are not installed, run `mise install` (user-scoped only); anything needing `sudo`/global install becomes a `BLOCKED` note, not a workaround.
- [x] Verify official current SDK/protocol docs and installed API surfaces; create `docs/adapter-recon.md` with per-harness version, interface choice, model/thinking handling, authentication assumptions, feature flags, known unknowns, and smoke commands.
- [x] Choose a lightweight repository layout (single package vs small workspace). Record any substantive deviation from `spec.md` as ADR.
- [x] Set up TypeScript strict mode, package scripts, formatting/linting, testing framework, React + Vite (or equivalent simple local bundler), and a minimal server.
- [x] Configure local server to bind `127.0.0.1`, not public interfaces, with basic Origin/CSRF protection plan and clear local start command.
- [x] Create disposable Git fixture generator and a script that verifies a temporary repo is cleaned up only after all fixture tests succeed.
- [x] Establish a baseline `pnpm test` / `pnpm typecheck` / `pnpm lint` (or documented equivalent) pipeline.
- [x] Write `README.md` for the actual codebase (setup, start, prerequisites, current coverage). Replace the starter-pack navigation text once the real start command exists.
- [x] Create `docs/progress.md` with M0 verification output and immediate next step.

**M0 gate:** UI serves a simple project-start placeholder locally; tests and typechecking run; adapter reconnaissance is documented, not guessed.

## M1 - Persisted domain and FakeAdapter [spec §2, 3, 10, 12, 13.1-13.2]

- [x] Define schemas/types for Project, Run, RoleTemplate, AgentProfile, TeamPreset, WorkflowTemplate, Task, Attempt, Session, Event, HumanRequest, Review, IntegrationCandidate, Artifact.
- [x] Define exact task and session state-transition tables; keep task status distinct from process state.
- [x] Add SQLite database setup, migrations, WAL, foreign keys, and durable filesystem locations using XDG conventions.
- [x] Add storage APIs and transactions for create/update run, task, attempt, event, human request, and session.
- [x] Add an append-only event journal with timestamps, causal IDs, event sequence IDs, and replay/query support.
- [x] Add typed service/API input validation and one idempotency primitive for mutating operations.
- [x] Define `HarnessAdapter` and capability discovery types without hardcoding unsupported model/think levels.
- [x] Build `FakeAdapter` with deterministic event playback, prompts, completion, cancellation, steering, permission requests, crash, disconnect, and resume simulations.
- [x] Build a tiny local event stream for UI consumers with reconnect/replay from last event ID.
- [x] Unit-test valid/invalid task transitions, persistence/reopen, idempotent mutations, and event ordering.
- [x] Wire GUI to list projects/runs/tasks from API (seeded or fake data okay).

**M1 gate:** server restarts without losing fake tasks/sessions; UI presents persisted fake events; tests use no model tokens.

## M2 - First runnable end-to-end fake orchestration slice [spec §2, 3, 4, 7, 11, 12]

- [x] Create a project picker that validates absolute path, Git worktree cleanliness, repository identity and base SHA.
- [x] Implement run creation with selected mode and a lead profile (initially a fake lead if necessary).
- [x] Build backend command flow: owner message -> lead prompt -> proposed task -> validated assignment -> fake worker attempt -> report -> completion event.
- [x] Implement a basic scheduler with queue, atomic worker slot reservations, one active owner per writable worktree, and dispatch idempotency.
- [x] Add static simple presets (Backend Engineer, Reviewer, Reader, Synthesizer) in app-owned config or seed migration.
- [x] Render basic run workspace: Lead chat, task board, one worker status card, session event log/detail.
- [x] Add owner actions: create task manually, choose worker, change priority, pause scheduling, cancel task.
- [x] Enforce `chat_plan` mode in backend tool/operation policy: model cannot dispatch or mutate Git.
- [x] Reject a worker attempting to call a lead-only tool in policy/service unit tests.
- [x] Exercise fake success and fake failure via UI and persist task transitions.
  - Verified through connected Playwright MCP: success/report, failure requiring RETRY_DECISION, and reload/replay. Supervised approval, owner controls, Chat/Plan and dirty-checkout refusal also exercised; see `docs/progress.md` and `docs/evidence/m2-browser-success-failure.png`.
- [x] Record a GIF/screenshot or reproducible manual demo instructions in `docs/progress.md` (no need for elaborate design assets).

**M2 gate:** complete owner -> lead -> task -> worker -> result loop is visible and replayable in GUI, even before live harness integration.

## M3 - Git worktree isolation and one real worker [spec §5, 8, 10, 13.2-13.3]

- [x] Implement safe Git subprocess wrapper using argv arrays; path and repository validations; base SHA capture.
- [x] Require clean target checkout by default; never auto-stash, auto-reset or modify the original checkout during launch.
- [x] Create uniquely named app-owned branch/worktree per implementation attempt under XDG app data; persist path+ownership metadata.
- [x] Add Git fixture tests: same filename edited in two independent worktrees, clean/dirty repo detection, lock ownership, crash retention.
- [x] Implement Pi RPC adapter as the first **candidate** real adapter after confirming installed-version compatibility; if Codex is demonstrably simpler on machine, record an ADR and switch ordering.
- [x] Start a real harness in a disposable worktree with explicit cwd and isolated app session; collect native session ID, streaming events, errors and terminal status.
- [x] Implement supported model and thinking configuration; reject unsupported selections with diagnostics rather than silently substituting.
- [x] Make a read-only worker answer a harmless test repository question; then a writer modify a disposable file.
- [x] Map native completion, abort and auth/quota failures to correct internal state; do not equate process exit with task success.
- [x] Capture changed files, tracked/unstaged/untracked state, and test execution metadata on worker completion.
- [x] Confirm no temporary harness configuration overwrote the user's global settings or active personal sessions.
- [x] Add live adapter smoke script requiring explicit opt-in and disposable fixture path.

**M3 gate:** the first real native harness session edits **only a disposable worktree** and its events/state appear in the GUI.

## M4 - Live Lead and orchestration tools [spec §4, 5, 6]

- [x] Implement session-scoped tool gateway (prefer MCP) with separate lead and worker tool authorization.
- [x] Implement read-only lead tools: `get_run_status`, `list_tasks`, `get_worker_status`, `read_report`, etc.
- [x] Implement bounded lead mutation tools: `propose_task`, `assign_task`, `request_revision`, `escalate_issue`, and `request_human_input`.
- [x] Integrate Codex app-server as lead using the official stdio handshake/threads/turns; persist thread ID and stream results.
- [x] Verify Codex model/thinking selection, session resume, stopping, tool gateway invocation, and an intentional tool-policy denial in disposable environment.
  - Live: model verified in the thread response; effort is passed per turn (not echoed by Codex) and unsupported/delegating efforts are refused before launch. Stop was verified in live run 1, before the gateway approval fix, which doesn't affect cancellation.
- [x] Give Lead no source-modifying tools or writable project checkout in Chat/Plan; test that a prompt requesting mutation cannot change fixture file hashes.
  - Live mutation prompts (two runs) left the fixture hash and status unchanged. The model declined to attempt the write, so the OS-level refusal is evidenced by the `command/exec` sandbox probe.
- [x] Implement autonomous bounded delegation and supervised approval of proposed assignments, including owner overrides.
- [x] Add serialized event-driven Lead wake-up on task completion, failure and urgent issue; do not concurrently prompt same Lead session.
- [x] Enforce launch/revision/wake-up budget and prevent lead from bypassing with exposed native delegation mechanisms where possible.
- [x] Demonstrate one real Codex Lead + one real worker, first in Chat/Plan then Autonomous mode.

**M4 gate:** one live lead can use typed tools to assign one live worker, receive the structured report, and explain the outcome without mutating code itself.

## M5 - Review, candidate commits and local integration [spec §8, 13.2]

- [x] Implement deterministic candidate capture with tracked + explicitly allowed untracked files, secret-sensitive path filtering and blocked unsafe candidate state.
- [x] Persist candidate base/candidate commit SHAs and task/attempt linkage; test retry idempotency and missing report handling.
- [x] Add a `Reviewer` role with capability to inspect stable candidate snapshot **and surrounding repository**, not just diff text.
- [x] Run reviewer independently of implementing worker; collect actionable file/line findings, confidence/evidence and pass/change-request recommendation.
- [x] Support `CHANGES_REQUESTED` and safe revision assignment to implementer; preserve old review history.
- [x] Create separate isolated integration worktree; verify diff and `git diff --check`, targeted tests, destination base SHA.
- [x] Detect and correctly present overlapping-file merge conflict and destination branch drift; never silently overwrite.
- [x] Render review details + candidate diff + test summaries in GUI; owner can approve or decline.
- [x] Require explicit human confirmation immediately before applying to selected local branch and revalidate destination SHA/clean status.
- [x] Preserve task, diff, logs and worktree if approval denied or integration blocked.
- [x] Use Git fixture integration test for clean merge, conflict, dirty main, and successful approved integration.

**M5 gate:** demo implementation -> independent review -> human approval -> safe local integration, with no destructive action on an owner's dirty checkout.

## M6 - Human requests, steering, stop, and recovery [spec §9, 10]

- [x] Implement HumanRequest storage, blocker linkage, urgency and backend transition logic.
- [x] Add "Needs You" GUI with respond, decline, complete, defer controls and evidence/history.
- [x] Implement worker `request_human_action` and `report_issue` tool handling; unrelated workers continue while one is blocked.
- [x] Add dependency-based WAITING handling: downstream waits; unrelated tasks do not stop.
- [x] Integrate native permission prompts into the inbox where harness supports them; never auto-approve an unsafe request. Current scope: **Codex denial notifications only; Pi native per-tool approval callbacks are unsupported. Owner-driven native approval and continuation remain unimplemented.** See [capability limits](docs/adr/2026-10-16-native-permission-denials.md).
- [x] Add direct owner steer/follow-up message to a worker, with `delivered`, `queued`, and `unsupported` UX states.
- [x] Implement pause scheduling, stop selected run, and emergency stop of **app-owned processes only**. Extend existing stop journaling with durable pending-stop, failed and uncertain outcomes/history visible after navigation, view closure and restart; distinguish inspect, close view and stop. Confirm termination only from supported process/session evidence; retain existing emergency-stop limitations (Finding 6; spec §§9.3, 10.2; [recovery ADR](docs/adr/2026-10-16-recovery-evidence.md)).
  Note: emergency stop signals only the direct app-spawned Pi/Codex child, not a process group; descendants may remain. See [owner stops ADR](docs/adr/2026-10-16-owner-stops.md).
- [x] Implement explicit interrupted/crashed/disconnected/recovery-required states and bounded retry choice. Distinguish missing, inaccessible and replaced worktrees; retain task/attempt, native-session and process evidence, path and reason. Block unsafe submissions until an explicit recovery decision validates repository/worktree identity; recheck only observes facts, never resubmits, automatically relinks or deletes a checkout (Finding 5; spec §§9.3, 10.1–10.2).
  Note: retry is a fresh attempt in a new worktree only (native resume: context-policy item); restart reconciliation of live processes/worktrees is the next item. See [recovery decisions ADR](docs/adr/2026-10-16-recovery-decisions.md).
- [x] Restart reconciliation: reopen database, match native sessions/process state and worktrees, do not repeat ambiguous mutating tools. A missing folder does not prove worker termination, and existence at the same path does not prove checkout identity. Verify the path/reason/recheck presentation under [M9's existing visible recovery checks](#m9---beta-hardening-and-release-spec-134-15) (Finding 5; spec §§10.1–10.2).
  Note: startup observes each unobserved pending decision once (process boot/start identity, native session match, worktree Git state, unfinished native tools); nothing is replayed. Lead attempts are not reconciled. See [restart reconciliation ADR](docs/adr/2026-10-16-restart-reconciliation.md).
- [x] Add context policies auto/fresh/resume per assignment; preserve prior attempt and native transcript links.
  Note: only FAKE resumes (simulated); Pi successors start fresh with an app-generated checkpoint in a new worktree, and reopening Pi sessions is left to M8. The owner's assignment now continues a WAITING_HUMAN task once every blocker is resolved. See [context policies ADR](docs/adr/2026-10-16-context-policies.md).
- [x] Normalize confirmed auth failure, rate limiting and exhausted credits into the existing Needs You blocker flow with evidence, unknown/unavailable usage and an actionable owner next step. Keep deterministic hard budgets independent; no credential management, inferred balance/reset time or automatic resumption. Verify native classifications under [M8's adapter/smoke gates](#m8---complete-the-remaining-harnesses-spec-5-133) and visible exhaustion/recovery under M9's existing gate (Finding 9; spec §§9.1, 10.1–10.2).
- [x] Test fake delayed tool/approval, quota exhaustion, ambiguous disconnect, process crash, app restart, and user intervention. Use FakeAdapter + disposable Git fixtures for missing/inaccessible/same-path-replaced worktrees with a surviving worker; observation-only recheck and identity-gated recovery; pending/failed/uncertain stop across navigation and restart; confirmed auth/rate-limit/credit failures versus unknown/unavailable usage across restart, with no automatic resubmission/resumption (Findings 5, 6, 9; spec §§9.1, 9.3, 10.1–10.2). Native verification remains explicit opt-in smoke on disposable repos under M8; M9 checks visible outcomes.
  Note: [fault-test matrix and limitations](docs/m6-fault-tests.md); 258/258 tests and 10/10 mutation checks passed. Navigation checks use API view reads; visual verification remains M9.

**M6 gate:** a worker can request help, another can keep working, human responds, first safely continues; a restart retains outstanding work and unresolved Git changes.

## M7 - Reusable roles, profiles, teams, and workflows [spec §2, 4, 7]

- [x] Build CRUD/import-export for RoleTemplates separate from model/harness choice.
- [x] Build CRUD for named AgentProfiles with chosen harness/model/reasoning/permission class; validate from capability discovery.
- [x] Build reusable TeamPresets: Lead profile, worker pool, mode, resource budgets, available workflows; save immutable snapshot for each run.
- [x] Implement static sequential stage and bounded parallel -> synthesis execution templates with declared inputs and results.
- [x] Add reusable `Explore Subsystem` template: N complementary readers (entry points, data flow, dependencies, tests) then one synthesizer.
- [x] Ensure each workflow child consumes normal scheduling slots and attempt/launch budget; queued children don't vanish when over cap.
- [x] Persist per-reader evidence and synthesis references, including explicit partial failures, rather than discarding originals.
- [x] Render workflow as one expandable item with child stages/agents, logs, and reports.
- [x] Let owner run workflow manually and Lead invoke only a saved template with validated parameters.
- [x] Add simple `Review Implementation` workflow preset; optional multi-reader variant only if it stays within beta scope.
- [x] Exercise workflow with FakeAdapter and at least one real read-only harness; verify fan-out cap and partial reader failure.

**M7 gate:** user saves a team and Explore Subsystem workflow, starts them again in a new run, sees parallel child work and one grounded final report.

## M8 - Complete the remaining harnesses [spec §5, 13.3]

- [ ] Implement Claude Code adapter via official Agent SDK; validate auth with installed CLI, streaming, session ID/resume, model choice, hooks/permission prompts and cancellation.
  - Adapter, fixtures and no-model SDK/installed-CLI probe implemented; authenticated native streaming/model/resume/hooks/cancellation validation is **BLOCKED** on supported SDK authentication. See [current evidence and owner command](docs/adapter-recon.md#m8-item-1--claude-sdk-worker-implementation-2026-10-17); do not mark the item complete from scripted results.
- [ ] Implement OpenCode adapter via documented SDK/server; bind local server to loopback and protect it; validate session/prompt/events/abort/permissions.
- [ ] Revisit Pi and Codex adapter capabilities after discovering real SDK/version differences; surface unavailable controls accurately.
- [ ] Show installed/missing/auth-required/available state in GUI, with actionable diagnostics for each harness.
- [ ] Verify all four can act as **workers** on read-only task and make their chosen model/think settings effective where supported.
- [ ] Verify each harness can act as **Lead** using the scoped orchestration tool gateway; if a capability is unavailable, record precise limitation, test fallback and don't falsely claim all-four Lead support.
- [ ] Verify no global harness user config was rewritten, no manual session interrupted, no token silently copied between tools.
- [ ] Run documented per-adapter smoke matrix from `spec.md` section 13; record outputs and support matrix in docs.

**M8 gate:** official native implementations for four harnesses tested (or explicitly flagged unavailable with blocker), with no generic-model-API substitute.

## M9 - Beta hardening and release [spec §13.4, 15]

- [ ] Run `typecheck`, lint, unit/integration/e2e suites and fix flaky state transitions.
- [ ] Conduct complete acceptance scenarios A-G in `spec.md` section 13.4 on disposable test repositories; save pass/fail evidence.
- [ ] Audit permission boundaries, dangerous path handling, CSRF/Origin checks, sensitive log data, secret-path candidate filtering, and non-destructive Git defaults.
- [ ] Exercise engine emergency stop, app restart, pending approval, conflict, credit exhaustion, and context refresh with visible GUI statuses.
- [ ] Test local Arch/Omarchy start instructions (Node/pnpm or chosen package manager, Git, each CLI availability); avoid unnecessary OS packages.
- [ ] Verify project switching doesn't attach native sessions/worktrees to a different repository.
- [ ] Add concise onboarding README with screenshots only if useful, configuration example, known limitations, and safety notes.
- [ ] Ensure no unfinished milestone is marked checked, no placeholder mocks silently masquerade as live integrations, and no unsupported claims about full sandboxing.
- [ ] Write beta release checklist and known issues in `docs/progress.md`.

**M9 gate:** user can run the app locally, configure agents and reusable workflows, coordinate work, see blockers, inspect reviewed changes, and safely approve a local integration. Beta is ready for personal experimentation.

---

## Future backlog - deliberately OUT of beta

- [ ] Lead-authored runtime workflow graphs with bounded fan-out/depth and owner-visible policy.
- [ ] YOLO/high-budget preset allowing Lead-controlled dynamic agent provisioning (still with emergency stop and safety controls).
- [ ] Strong OS-level tool and filesystem sandboxing (bubblewrap/container) rather than prompt-only read-only assurances.
- [ ] Automated final integration policy if owner explicitly opts in; never silently enable.
- [ ] Adaptive context reset/compaction strategy based on observed cost, token usage and task results.
- [ ] Nested workflows, workflow GUI editor, richer notifications and optional desktop shell.
- [ ] Jujutsu, GitHub, remote hosts or multi-user features only if owner later requests them.
