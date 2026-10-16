# Local Agent Orchestrator

This is the working repo for a **single-user, local-first multi-agent coding-harness orchestrator** targeting Arch Linux / Omarchy. Design docs and implementation live here side by side.

The planned application coordinates native **Codex, Claude Code, OpenCode and Pi** sessions. The implemented M2 slice adds a fake owner → Lead → worker → report loop, bounded scheduling, validated Git selection, and owner controls to the M1 persisted domain and event journal. Native adapters and real worktree creation follow in M3. The final M2 browser exercise is pending because this environment has no connected browser.

## Run the M2 app

Prerequisites: Git and mise with the existing `.mise.toml` pins installed (Node **26.7.0**, pnpm **11.22.0**). Use mise for every Node/pnpm command. The pinned Node release currently reports `lts: false`; it is retained as required by `AGENTS.md`. No global packages or harness configuration changes are needed.

```sh
mise current
mise x -- pnpm install --frozen-lockfile --store-dir /tmp/lao-pnpm-store --cache-dir /tmp/lao-pnpm-cache
mise x -- pnpm dev
```

Open **http://127.0.0.1:4317**. One Node process serves the health API and the React GUI through Vite middleware. Frontend edits reload through Vite; restart the command after backend edits. Stop with Ctrl-C. The install command above is the one verified in the restricted development environment; a fresh unrestricted checkout can also use `mise x -- pnpm install --frozen-lockfile` with pnpm's normal user cache/store. No global configuration is changed by either command.

For the built GUI:

```sh
mise x -- pnpm build
mise x -- pnpm start
```

`GET /api/health` returns:

```json
{"status":"ok","app":"Local Agent Orchestrator","milestone":"M2"}
```

## Checks and current coverage

```sh
mise x -- pnpm typecheck
mise x -- pnpm test
mise x -- pnpm lint
mise x -- pnpm build
mise x -- pnpm smoke
```

`smoke` starts and closes real development and production servers on temporary loopback ports, checking health, HTML, and every script entry. Run `build` first. `test:fixtures` runs only the disposable Git fixture checks. `format` applies Biome formatting and safe lint fixes to project code/configuration.

All default checks use temporary databases and no model tokens. Tests cover task/process transition matrices, atomic rollback (including process exit before commit), idempotency across reopen, causal event ordering, SSE reconnect/live delivery, session identity, recovery decisions, and API validation/token protection. FakeAdapter tests exercise permission waits, steering, cancellation, completion, quota failure, crashes, disconnects, and explicit resume. M2 tests also cover Git safety, queue reservations and launch caps, active Lead accounting, cross-run reader caps, simulated writer locks, mode/role denials, owner pins, pause/cancel, reports, and the complete HTTP loop. Native harness tests are intentionally omitted (cost); installed-version findings remain in [adapter reconnaissance](docs/adapter-recon.md).

Git fixture tests retain their M0 safety checks: each fixture is created under the OS temporary directory with a local commit and isolated Git configuration; cleanup happens only after verification and ownership checks succeed. Failed fixtures are retained. No important repository is used as a fixture.

## M2 fake orchestration demonstration

Stop any app using this database before seeding, then run from the repo:

```sh
mise x -- env XDG_DATA_HOME=/tmp/lao-m2-demo pnpm demo:m2
mise x -- env XDG_DATA_HOME=/tmp/lao-m2-demo pnpm dev
```

Open **http://127.0.0.1:4317**. The seed command initializes a disposable Git fixture and prints its path. It exercises the actual fake orchestration engine: an owner message prompts a saved fake Lead, the Lead proposes and assigns a scoped task, a fake worker returns a file-backed report, and a second worker deliberately fails. The selected run shows **AWAITING_REVIEW** and **RETRY_DECISION**, saved sessions, Lead conversation, budget usage, and ordered events. Choose **View report** on the successful task. The report explicitly identifies scripted playback; no repository files were read or edited by a worker and no native model was called.

Repeat the seed command to browse its existing run; an existing or partially seeded run is never replayed. Restart the server with the same data directory to verify preserved tasks, reports and session IDs. Use a new temporary data directory for a separate demonstration. Set `XDG_DATA_HOME` **inside** `mise x -- env`, as shown, so mise's own tool lookup directory stays unchanged. Keep the printed disposable fixture while browsing its project. `demo:fake` remains the legacy M1 persistence seed.

The following browser exercise is **pending**; no browser was available to the development agent. HTTP equivalents and built-asset checks passed.

1. In the saved run, inspect **Lead conversation**, **View report**, **Session event detail**, and the event journal. Review is distinct from integration or Done.
2. Send an owner message with worker simulation **Success**, then **Failure**, and observe new tasks/results without reloading.
3. Start a new **Supervised** run: its proposed task remains Backlog until **Assign / approve**. Choose a worker and simulation outcome on its card.
4. Start a **Chat/Plan** run: the fake Lead replies without proposing or dispatching a worker; the assignment button remains disabled. Backend tests also reject direct dispatch requests in this mode.
5. Add an owner task, set/save priority, and assign it. Pause scheduling immediately to hold queued work; resume to continue. Cancel a queued or running fake task and inspect its preserved history.
6. Use **Check repository** on the printed fixture. A dirty tracked, staged or untracked file must prevent opening/starting work; commit or clean changes manually. The app never resets/stashes them. Do not use this repo's dirty development checkout as a demo fixture.
7. Stop/restart the server and verify the same tasks, reports and events remain. Failed/disconnected work is never automatically retried; M6 will add recovery controls.

## State, API and safety boundaries

The database is `$XDG_DATA_HOME/local-agent-orchestrator/state.sqlite`, falling back to `~/.local/share/local-agent-orchestrator/state.sqlite`; report files are in its sibling `artifacts/` directory. SQLite migration v2 adds durable dispatches/reservations and converts M1's legacy mode names to the spec's `chat_plan` / `supervised` / `autonomous_bounded`. Run/team snapshots and historical events remain durable. WAL, foreign keys and full synchronous transactions are enabled. Run only one app or demo process against a database.

Opening a project validates its absolute canonical root, common Git directory, committed HEAD, branch and clean state. Starting a run captures a fresh base SHA; dispatch checks for dirtiness, identity changes and HEAD drift. Repository probes use argv arrays and read-only Git settings. App metadata must remain outside the managed repository. The scheduler uses priority plus FIFO ties, durable launch counts, global active-slot checks, and atomic simulated writer ownership. Active Lead turns consume total capacity; idle sessions do not. Pausing holds queued work while current fake turns finish. Owner assignments are pinned against Lead changes.

M2 executes **only FakeAdapter**. Writer reservation paths are simulations under app data, not real isolated worktrees. No tools write managed source. Saved profile harness/model fields are configuration, not claims of native availability. Real Git isolation/native execution is M3; scoped native tool transport is M4; review/integration is M5; interactive recovery is M6; reusable configuration/workflow CRUD is M7. The app is not an OS sandbox and the beta is incomplete.

Read APIs: `/api/projects`, `/api/runs?projectId=...`, `/api/tasks?runId=...`, `/api/attempts`, `/api/sessions`, `/api/presets`, `/api/dispatches`, `/api/reports?taskId=...`, `/api/human-requests`, `/api/events?after=0&limit=100&runId=...`, and `/api/events/stream`. SSE supports `Last-Event-ID` or an initial `after` cursor. The GUI retains the latest 200 received events; older history remains queryable.

`GET /api/local-session` provides the per-process CSRF token. Writes require `X-Local-Token`, `Idempotency-Key` and JSON. The GUI reuses an unconfirmed request's key when retried. Writes are `POST /api/projects/inspect`, `/api/projects`, `/api/runs`, `/api/runs/messages`, `/api/tasks`, `/api/tasks/assign`, `/api/tasks/cancel`, and `PATCH /api/runs` or `/api/tasks`. Run creation accepts project/title/initialPrompt/leadProfileId/mode/limits/scenario; worker outcomes are explicit `success`, `failure` or `disconnect` simulations. All UI commands use the same engine services as fake Lead/worker tools. Arbitrary task-status mutation is no longer exposed over HTTP.

## Implementation layout and boundaries

- `src/server`: Node HTTP server; the sole listener binds `127.0.0.1:4317`.
- `src/web`: React page and styles; Vite bundles the production assets into `dist/web`.
- `src/shared/domain`: strict Zod schemas/types for all M1 entities, input contracts, and task/session transition tables.
- `src/server/storage`: SQLite migration, transactional services, append-only journal, idempotency, conservative restart recovery.
- `src/server/adapters`: capability/event contracts and FakeAdapter; no native adapter is implemented yet.
- `src/server/orchestration`: owner commands, session-scoped policy checks, fake Lead/worker execution and durable reports.
- `src/server/git/inspect.ts`: non-mutating Git repository inspection; real worktree management remains M3 scope.
- `src/server/storage/scheduling.ts`: transactional queue, resource reservations and simulated writer ownership.
- `tests`: Node's built-in test runner and disposable Git helper.
- `scripts/smoke.ts`: development/production HTTP launch check.
- `scripts/demo-m2.ts`: opt-in fake orchestration demonstration on a disposable Git fixture.

The server rejects foreign Host/Origin headers and cross-site browser requests, sends no permissive CORS headers, and requires its random per-process token on writes. Worktrees will isolate working copies; they will not provide OS filesystem isolation. Fake playback never implies that a native harness or policy sandbox was exercised.

Next, complete the pending M2 browser exercise above before proceeding to M3. See [progress](docs/progress.md) for verified commands and [todo.md](todo.md) for milestone gates.

## Files

| File | Purpose |
|---|---|
| `spec.md` | Full agreed beta scope, architecture, data model, execution policies, adapter contracts, Git/review design, UI, safety and acceptance tests. **Main product source of truth.** |
| `todo.md` | Ordered, testable milestones M0-M9 with agent-checkable task boxes and release gates. Each header lists its relevant `spec.md` sections — read only those. |
| `AGENTS.md` | Standing instructions for AI coding agents building this application. Read this first. |
| `README.md` | Verified setup, start, checks, coverage and safety boundaries. |
| `docs/progress.md` | Per-milestone verification evidence and exact next action. |
| `docs/adapter-recon.md` | Installed harness versions, selected native interfaces and unverified capabilities. |
| `docs/adr/` | Runtime/SQLite and OpenCode v2 interface decisions. |

## How to begin (for agents and owner)

1. Read `AGENTS.md`, then the tail of `docs/progress.md` (if present), then the first incomplete milestone in `todo.md`.
2. Load only the `spec.md` sections listed in that milestone's header.
3. Complete **one milestone at a time** in dependency order. Review each milestone's demo before pushing onward.

## Working agreement

- The app is **personal software**, not an open platform or cloud service.
- One project run has one coordinating **Lead/Godhead** agent; workers are named profiles composed of a role + selected native harness + model + supported thinking level.
- Lead is a coordinator, not normally a code author. Human owner can supervise, directly assign work, steer, interrupt and approve integrations.
- Saved team and workflow templates are reusable. A workflow may fan out to multiple readers and synthesize results; individual reader instances still count against budgets.
- Beta's default execution is bounded autonomous scheduling. Chat/Plan and supervised modes are available.
- Git worktrees separate concurrent code changes; only an explicitly approved integration updates the chosen local branch. Worktrees are **not security sandboxes**.
- Authoritative state is kept by the app, not hidden in an LLM conversation; fresh sessions are normal for unrelated tasks.
- Features such as lead-authored dynamic workflows, YOLO scaling, automatic merges and GitHub integrations are intentionally after beta.

## Technology

M2 uses Node HTTP + TypeScript, built-in `node:sqlite`, React + Vite, Zod, Biome and Node's built-in test runner. Native harness adapters, the session-scoped orchestration tool gateway and local Git worktree coordination follow in later milestones. No dependencies were added for M1 or M2.

Exact library versions are pinned in `package.json` and `pnpm-lock.yaml`. Harness interfaces were checked against this machine for M0; live capabilities still require explicit opt-in validation. The spec's candidate interfaces are subject to version-specific findings in `docs/adapter-recon.md`.

## Definition of progress

The first truly useful vertical slice is a GUI that shows a Lead assigning work to a real worker in a disposable Git worktree and receiving a durable report. It is more important to reach that milestone safely than to create every screen and abstraction up front.

The project is not ready to use merely because these starter documents exist. Progress is verified through the M0-M9 checklists and the end-to-end scenarios in `spec.md`.
