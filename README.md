# Local Agent Orchestrator

This is the working repo for a **single-user, local-first multi-agent coding-harness orchestrator** targeting Arch Linux / Omarchy. Design docs and implementation live here side by side.

The application runs native **Codex, Claude Code, OpenCode and Pi** sessions under a small deterministic task coordinator, with reusable roles/teams/workflows, a Lead agent, isolated Git worktrees, structured reports, human intervention, review, session/context lifecycle management and a simple React GUI.

## Files

| File | Purpose |
|---|---|
| `spec.md` | Full agreed beta scope, architecture, data model, execution policies, adapter contracts, Git/review design, UI, safety and acceptance tests. **Main product source of truth.** |
| `todo.md` | Ordered, testable milestones M0-M9 with agent-checkable task boxes and release gates. Each header lists its relevant `spec.md` sections — read only those. |
| `AGENTS.md` | Standing instructions for AI coding agents building this application. Read this first. |
| `README.md` | Navigation and getting-started instructions (this file; rewritten for the real codebase during M0). |
| `docs/progress.md` | Per-milestone evidence log (created during M0). |
| `docs/adapter-recon.md` | Installed harness versions and chosen interfaces (created during M0). |

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

## Technology intentions

Backend: Node.js + TypeScript; UI: React + TypeScript; persistence: SQLite; coordination: native harness adapters and a session-scoped orchestration tool gateway (prefer MCP); version control: local Git. No extra infrastructure necessary to start.

Exact library versions and adapter capabilities must be verified against **the machine on which the app will run** before implementation. The spec lists current official interface starting points, not a frozen dependency lockfile.

## Definition of progress

The first truly useful vertical slice is a GUI that shows a Lead assigning work to a real worker in a disposable Git worktree and receiving a durable report. It is more important to reach that milestone safely than to create every screen and abstraction up front.

The project is not ready to use merely because these starter documents exist. Progress is verified through the M0-M9 checklists and the end-to-end scenarios in `spec.md`.
