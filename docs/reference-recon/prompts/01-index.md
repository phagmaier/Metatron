# Prompt 01 — Superset index (run first, alone)

Copy everything below the line and paste to a fresh agent session
running in `/home/phagmaier/Code/metatron`.

---

CONTEXT
You are doing read-only reference reconnaissance for metatron
(/home/phagmaier/Code/metatron): a local-first, single-user orchestrator driving four
NATIVE coding harnesses (Codex, Claude Code, OpenCode, Pi). Stack: Node/TS strict,
SQLite, React+Vite, Git worktrees, bound to 127.0.0.1.
Read /home/phagmaier/Code/metatron/AGENTS.md. Do not read all of spec.md.

REFERENCE — read-only, never modify
/home/phagmaier/Code/superset (superset-sh/superset, TypeScript monorepo, ~12.6k files).
Commercial product under Elastic License 2.0: study it, do NOT copy code.
Record the commit SHA from `git -C /home/phagmaier/Code/superset rev-parse HEAD`.
Read it only via absolute paths. Never write to it.

HARD RULES
1. Read-only on the reference. Do not write outside the single OUTPUT FILE below.
2. NEVER modify todo.md, spec.md, AGENTS.md, README.md, package.json, src/**, tests/**,
   or ANY existing file in metatron. Markdown output only — no .ts/.js/.json.
3. If a path below does not exist at this SHA, note it and move on. Do not guess.

TASK — build a 1-page index, not a map of everything
Produce ONLY:

A. Top level layout: `apps/*` and `packages/*` directory names, one line each
   (get via `git -C /home/phagmaier/Code/superset ls-tree -d --name-only HEAD apps packages`
   and one level deeper for the dirs that matter: apps/desktop, packages/*).

B. Titles of `apps/desktop/plans/*.md` and `apps/desktop/plans/done/*.md`
   (filenames only, sorted). Mark any about recovery, lifecycle, worktree, ACP, review.

C. Titles of `apps/docs/content/docs/agents/*.mdx` if present.

D. A file list for each of these four downstream questions (paths only, ~25 each,
   verified to exist via `git -C /home/phagmaier/Code/superset ls-tree -r --name-only HEAD`):
   Q2 session/process lifecycle + crash/restart reconciliation (host-service, pty-daemon,
      SessionStore, agent-session-orchestrator, local-db, recovery plans).
   Q3 ACP vs bespoke adapters (any path with 'acp' in the name, chat-runtime, chat,
      acp-vs-claude-sdk.html, 0009_add_acp_sessions.sql, agents docs).
   Q4 worktree/branch lifecycle (worktree.ts, resolve-worktree-path, external-worktree-import,
      useDeleteWorktree/useOpenExternalWorktree/useHandleOpenedWorktree, WorkspaceMissingWorktreeState,
      ExternalWorktreesBanner, worktree-status-caches, branch-detached-worktree, workspace creation plans).
   Q5 failure/state GUI surface (usePaneRegistry, v2-workspace-panes plans, v2-review-tab plan,
      trpc routers list, error/notice/blocked-state components).

OUTPUT FILE
/home/phagmaier/Code/metatron/docs/reference-recon/outputs/00-INDEX.md (create the dir;
write ONLY this file). End with the ref SHA and the count of files listed per question.
