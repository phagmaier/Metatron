# Local Agent Orchestrator

This is the working repo for a **single-user, local-first multi-agent coding-harness orchestrator** targeting Arch Linux / Omarchy. Design docs and implementation live here side by side.

The application runs native **Codex, Claude Code, OpenCode and Pi** sessions under a small deterministic task coordinator, with reusable roles/teams/workflows, a Lead agent, isolated Git worktrees, structured reports, human intervention, review, session/context lifecycle management and a simple React GUI.

## Run the M0 app

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
{"status":"ok","app":"Local Agent Orchestrator","milestone":"M0"}
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

M0 provides the app title, actual API connection status, and a project-start placeholder. There are **no harness adapters, fake agent runs, project mutations, or persistent task data yet**. All checks are local and use no model tokens. Harnesses are optional for this shell; installed versions and interface gaps are in [adapter reconnaissance](docs/adapter-recon.md). The live four-harness acceptance matrix is still incomplete.

Tests cover the loopback bind, Host/Origin checks, refusal of cross-site requests and writes, malformed URL handling, and fixture cleanup/retention. Each fixture is created under the OS temporary directory with a local commit and isolated Git configuration; cleanup happens only after its verification callback succeeds and its ownership marker matches. Failed fixtures are retained and their location is printed. The tests deliberately exercise failure paths and then verify preservation before cleanup. No important repository is used as a fixture.

## Implementation layout and boundaries

- `src/server`: Node HTTP server; the sole listener binds `127.0.0.1:4317`.
- `src/web`: React page and styles; Vite bundles the production assets into `dist/web`.
- `src/shared`: Zod health contract shared by server and browser.
- `tests`: Node's built-in test runner and disposable Git helper.
- `scripts/smoke.ts`: development/production HTTP launch check.

M0 rejects foreign Host/Origin headers and cross-site browser requests, sends no permissive CORS headers, and accepts only GET/HEAD. **Before adding write endpoints in M1**, introduce a random per-process token or equivalent CSRF-safe local session, validate requests, and enforce authorization on the server. Worktrees will isolate working copies; they will not provide OS filesystem isolation. M1 will add SQLite persistence under XDG paths using the verified built-in `node:sqlite`; M0 does not open a persistent database.

Resume with: “Implement M1 only, starting with its domain schemas/types checklist item.” See [progress](docs/progress.md) for verified commands and [todo.md](todo.md) for milestone gates.

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

M0 uses Node HTTP + TypeScript, React + Vite, Zod, Biome and Node's built-in test runner. SQLite persistence, native harness adapters, the session-scoped orchestration tool gateway and local Git worktree coordination follow in later milestones. No extra infrastructure is required to start.

Exact library versions are pinned in `package.json` and `pnpm-lock.yaml`. Harness interfaces were checked against this machine for M0; live capabilities still require explicit opt-in validation. The spec's candidate interfaces are subject to version-specific findings in `docs/adapter-recon.md`.

## Definition of progress

The first truly useful vertical slice is a GUI that shows a Lead assigning work to a real worker in a disposable Git worktree and receiving a durable report. It is more important to reach that milestone safely than to create every screen and abstraction up front.

The project is not ready to use merely because these starter documents exist. Progress is verified through the M0-M9 checklists and the end-to-end scenarios in `spec.md`.
