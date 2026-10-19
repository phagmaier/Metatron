# AGENTS.md - Instructions for AI Coding Agents

This file governs development of **Local Agent Orchestrator** (the application being built), not the behavior of its future user-configured agents. Product behavior and decisions live in [spec.md](./spec.md), with current capability limits in the [beta release note](./docs/releases/beta.md). Active work lives in [backlog.md](./backlog.md). [todo.md](./todo.md) preserves the completed beta implementation plan and its evidence.

## Mission

Maintain and improve a small, local-first orchestration GUI for one Arch/Omarchy user. It controls four **existing native coding harnesses** - Codex, Claude Code, OpenCode and Pi - rather than replacing their agent loops. The Lead coordinates configurable worker profiles and reusable static workflows; a deterministic local engine manages task state, budgets, Git isolation, approvals, events, and recovery. Preserve working beta behavior while evaluating focused improvements.

## Read this before touching code

1. Default context (do not bloat context): read this file, the tail of `docs/progress.md`, and the selected item in `backlog.md`. Do NOT re-read the full `spec.md` or beta history every turn.
2. Load only the spec sections and evidence relevant to that item. Prefer targeted `rg`/section reads over full-file reads; consult the current support matrix when changing a harness boundary.
3. Follow the owner's current task first; otherwise use the first unblocked **Now** item in `backlog.md`. Complete **one focused item only** unless the owner requests more. **Next/Later** items are candidates, not automatic implementation instructions. Historical “next task” notes in `todo.md`, progress, reconnaissance and audits do not select current work.
4. Inspect repo state, installed tools and versions. Do not assume any harness SDK signature is current.
5. Do not ask broad design questions that the spec has already answered. Make small implementation choices independently; record important deviations in `docs/adr/`.

## Engineering principles

- **Simple beats clever.** Prefer a single local Node process, React GUI, SQLite, TypeScript strict types, Git CLI and four small adapters. Do not introduce queues, distributed workers, Electron, Tauri, SaaS dependencies, or frameworks without clear benefit.
- **Vertical slices beat scaffolding.** Every behavior change must end with a running demonstration and relevant tests. Keep runnable behavior after each change. Do not create empty packages/directories to satisfy `spec.md` §3.2 before a selected item needs them.
- **Domain state beats transcripts.** Tasks, human requests, approvals, events and dependencies belong in persistence, not solely in a model's memory or Markdown report.
- **Policy beats prompts.** All tool/GUI actions must go through server-side validation and state transitions. A prompt saying "read-only" is insufficient to enforce a restriction.
- **Native harnesses only.** Never silently replace Codex with a raw OpenAI API call, Claude Code with plain Anthropic messages, etc. If a harness can't be controlled, report its actual limitation.
- **Capabilities, not assumptions.** Probe models, thinking levels, session controls, approval callbacks, auth state and cancellation per adapter. Do not claim all four have identical semantics.
- **Git data safety above convenience.** No automatic reset, stash, force checkout, force merge, deletion of user worktrees, or writes to the owner's main working tree. Test Git on temporary fixtures first.
- **Human retains final authority.** Autonomous delegation must stay bounded. Human overrides take precedence. Beta does not auto-merge into the user's working branch.
- **No hidden context explosion.** Role/task handoffs should be concise, cite referenced files, and preserve detailed logs separately.
- **Honest security claims.** Worktrees isolate working copies, **not** OS filesystem access. Do not label an agent securely read-only if only a system prompt asks it not to write.
- **YAGNI / no speculative generality.** Do not add abstractions, config options, or "future-proof" hooks beyond the selected item. Another harness adapter or workflow type does not by itself justify a plugin framework.
- **Small focused diffs.** One item at a time; no unrelated refactors or unsolicited features. Prefer editing an existing module over adding a new package.

## Repo, environment, and dependency rules

- Build only inside the **application's source repo**, not the external repositories that the future application will manage.
- Detect existing files and tooling before initializing or overwriting anything. Keep user data and working directories intact.
- Use TypeScript strict mode and the toolchain pinned in `.mise.toml` (currently `node 26.7.0`, `pnpm 11.22.0`). Node 26.7.0 is the retained beta pin, not LTS; target an LTS supported by dependencies when the owner approves a toolchain change. Always run through mise shims (`mise x -- <cmd>` or an active `mise` shell); never use system `/usr/bin/node` or bypass the pin. Do not change `.mise.toml` versions without an ADR and explicit owner approval.
- Package manager is `pnpm`, locked by `.mise.toml`. `pnpm install` is allowed; `pnpm add/remove` needs a one-line justification in `docs/progress.md` (why this dep, why not stdlib/existing dep). Never switch to npm/yarn/bun without an ADR and explicit approval.
- Install / permission protocol: `mise ls` and `mise current` are read-only and always allowed. `mise install` (user-scoped, no sudo) is allowed to satisfy the pinned `.mise.toml` only. NEVER run `sudo`, `pacman`, AUR helpers, `npm -g`, `pip --break-system-packages`, or any global/system install without explicit owner approval. Never modify `~/.config/mise`, `~/.codex`, `~/.claude`, Pi/OpenCode global config, or active personal sessions.
- If a required binary, version, or package cannot be installed under these rules (e.g. missing `codex`/`claude`/`opencode`/`pi`, missing system lib, blocked network): stop that subtask, mark it `BLOCKED` in `docs/progress.md` and/or `docs/adapter-recon.md` with the exact owner command to run (e.g. `mise install`, `mise use node@X`), then continue with `FakeAdapter`/fixtures. Do not invent a workaround, silently substitute a different tool, or claim the adapter works.
- Store app metadata outside managed repos under XDG-compliant paths. Do not modify `~/.codex`, `~/.claude`, Pi/OpenCode global config, or their active sessions as part of tests.
- Never log or commit credentials, OAuth tokens, secrets or environment dumps. Keep model provider authentication inside the native harness's supported flow.
- Bind local application/server to `127.0.0.1`. Protect local mutating API endpoints against cross-origin access.
- Use safe process-spawn argument arrays for Git/CLI commands; no string-concatenated shell commands from task input.
- Do not add GitHub/remote repository integration to beta.
- Once M0 establishes `pnpm test` / `pnpm typecheck` / `pnpm lint` (or documented equivalent), use those commands verbatim. Do not switch package managers, test runners, or bundlers without an ADR and explicit user approval.

## Code quality (anti-slop)

- TypeScript `strict: true`. No `any` or `as unknown as X` without a one-line justification. Validate all API/tool inputs with zod/JSON Schema; GUI must never directly mutate SQLite or invoke `git` from the browser.
- Prefer files under ~500 lines. Split by domain (`scheduler`, `git`, `adapters/*`) when a file grows, not by speculative layering.
- No dead code, commented-out code, bare `TODO`/`FIXME`, or unused exports/dependencies. A `TODO` is only allowed as `TODO(owner): <backlog ID and reason>` for explicitly deferred work.
- No redundant abstractions: no wrapper around a wrapper, no config flag used in exactly one place, no generic "manager/util" catch-alls.
- Handle errors exhaustively at boundaries (adapters, Git, SQLite): typed errors, recorded exit codes, no swallowed rejections. "No streamed tokens" is never proof of a crash — see `spec.md` §10.

## Comments

Comments explain *why*, not *what*. Required for: safety invariants (Git non-destructive defaults, policy enforcement), non-obvious state transitions, and adapter quirks that differ from docs. Otherwise prefer self-documenting names. No doc-comment on every function, no comment restating the code, no comment logs of what was changed (that belongs in `docs/progress.md`).

## Testing policy (avoid both under- and over-testing)

Always test: task/session state-transition tables, scheduler quotas and idempotency, lead-vs-worker policy denials, Git safety (dirty-root refusal, one-writer lock, secret-path filtering, conflict/drift handling), crash/disconnect/restart recovery with `RETRY_DECISION` (never auto-rerun ambiguous mutating work).
Do NOT test: trivial getters/setters, React rendering details, third-party SDK internals, or exact log strings. No snapshot tests for volatile output. No 100%-coverage gate; the selected item's acceptance criteria and the guardrail tests below are the gate. Documentation-only items need link/command checks and existing validation, not new runtime tests.
Conventions: one behavior per test; `FakeAdapter` + disposable Git fixtures for unit/integration by default; live harness calls only via an explicit opt-in smoke script on a disposable repo (`pnpm test:live`-style, never part of default `pnpm test`). Distinguish `passed` vs `intentionally omitted (cost)` in the session report.

## Work execution discipline

For each selected backlog item or owner-requested change:

1. Identify the problem, relevant spec sections, acceptance criteria and affected safety/data boundaries. Capture these in the active item before expanding implementation scope.
2. Write/adjust tests per **Testing policy** above (stateful/dangerous behavior first, before or alongside implementation). Do not pad with trivial tests to look thorough.
3. Keep changes focused; avoid unrelated refactors and unsolicited features.
4. Prefer mocks/FakeAdapter for development. Run real native harness calls only in disposable Git fixtures and with explicit awareness of token/credit cost.
5. Verify through typecheck, lint, tests and one minimal demonstration. Record actual commands and their outcomes.
6. Check off only verified work in `backlog.md`; append at most ~15 lines per item to `docs/progress.md` (done, commands + pass/fail, limitations, next step). Preserve the beta checklist and evidence as history. Link logs/artifacts, do not paste them.

Review tasks produce findings before fixes. Require locations, concrete evidence, severity, reproduction/verification and a minimal proposed change; distinguish demonstrated bugs from design hypotheses. A review may find no actionable bugs. Challenge architecture and product assumptions through focused experiments and spec §17 change control; a review finding does not authorize an unrelated rewrite.

## Docs and progress discipline

- `docs/progress.md`: append-only, concise, newest at bottom. Never rewrite history, never paste full logs/diffs. If it exceeds ~200 lines, summarize oldest milestones into 5 lines each.
- `docs/adr/YYYY-MM-DD-short-name.md`: one page max — context, decision, consequences. Record only choices that change authority, data safety, costs, core workflow, or settled spec behavior. Small implementation picks stay in `docs/progress.md`.
- `spec.md` changes only for actual design changes (per `spec.md` §17). Everything else is ADR + code + tests.
- `backlog.md` selects active development; `todo.md` is the historical beta plan. Keep current release scope/known issues in `docs/releases/beta.md` and commands in `docs/development.md`. Historical documents retain dated findings and link to current guidance; do not follow or rewrite their old execution instructions as today's plan.
- `docs/adapter-recon.md` (M0): installed versions, chosen interface per harness, auth expectations, gaps, smoke commands. No guesses.

If parallel coding agents are used to **build this project**, give them separate working branches/worktrees and non-overlapping scopes; integrate through review. Never let concurrent coding workers commit directly to the same branch.

## Behavior when an API or design detail is uncertain

- First verify official documentation **and the installed version** using a minimal harmless smoke test. SDK names, default flags, auth behavior and event names evolve.
- If the feature is not implemented on the installed harness, mark capability unsupported and show a diagnostic instead of faking it.
- Prefer the smallest alternative that preserves the intent. Record significant alternatives in `docs/adr/YYYY-MM-DD-short-name.md`.
- Ask the user only if the choice materially changes authority, data safety, privacy, costs, core workflow, or a previously agreed design. Otherwise proceed and document.
- On a bug or failed test, show evidence; do not hide it or silently skip validation.

## Guardrail tests that must not be compromised

- Chat/Plan: no worker dispatch or mutation of managed source repo.
- One writer per writable worktree; separate worktrees may change the same filenames safely until integration.
- Worker tool cannot invoke Lead-only scheduling/merge operations; Lead cannot exceed hard caps or finalize integration unaided.
- Dirty user checkout is never auto-reset/stashed; integration never force-overwrites it.
- A crashed/disconnected agent never causes ambiguous mutating work to rerun automatically.
- Human blocking requests suspend only affected tasks; unrelated work continues.
- Fresh context for unrelated tasks does not lose task state or reuse session IDs against the wrong repo.
- Workflow fan-out counts **individual active agents**, not just one workflow card.

## Completion and communication

At the end of each coding session provide a compact report:

- Backlog item or owner-requested scope completed (with concrete files changed).
- Commands/tests run and whether they passed; note any intentionally omitted live cost-bearing tests.
- New ADR(s), discovered adapter limitations and unresolved blockers.
- Exact next active item and a brief command to resume development.

**Do not** claim the beta is complete until the `spec.md` acceptance scenarios and four-harness smoke matrix pass or are explicitly documented as incomplete. No placeholder or FakeAdapter output should appear to the owner as though it were a live harness run.
The `beta` tag records a baseline; it does not sign off a release. Keep owner sign-off pending until the owner explicitly accepts the documented limits. Release publication, native spending and integration approval remain separate actions with their own existing authorization requirements.
