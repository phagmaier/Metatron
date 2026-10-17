# Prompt 04 — worktree/branch lifecycle + stranded workspaces (M3/M5/M9)

Copy everything below the line and paste to a fresh agent session
running in `/home/phagmaier/Code/metatron`. Requires `outputs/00-INDEX.md` from Prompt 01.

---

CONTEXT — read before acting
You are doing read-only reference reconnaissance for metatron
(/home/phagmaier/Code/metatron): a local-first, single-user orchestrator driving four
NATIVE coding harnesses (Codex, Claude Code, OpenCode, Pi). Stack: Node/TS strict,
SQLite, React+Vite, Git worktrees, bound to 127.0.0.1.
Read /home/phagmaier/Code/metatron/AGENTS.md, the M3/M5/M9 sections of
/home/phagmaier/Code/metatron/todo.md, and ONLY spec.md sections 5 and 8.
Do not read all of spec.md.

Metatron's non-negotiables: never auto-reset or auto-stash a user checkout;
never force-overwrite; never delete a user's worktree; one writer per writable worktree.

REFERENCE — read-only, never modify
/home/phagmaier/Code/superset (superset-sh/superset, TypeScript monorepo).
Commercial product under Elastic License 2.0: study it, do NOT copy code.
Record the commit SHA from `git -C /home/phagmaier/Code/superset rev-parse HEAD`.
Read it only via absolute paths. Never write to it.

HARD RULES
1. Read-only on the reference. Write ONLY the single OUTPUT FILE below.
2. NEVER modify todo.md, spec.md, AGENTS.md, README.md, package.json, src/**, tests/**,
   or ANY existing metatron file. If you think one should change, write the proposal
   as text in your output. Do not apply it. Markdown only.
3. Every claim needs `path:line` evidence. Quote at most 3 lines. No citation = no finding.
4. If you cannot confirm something from source, mark it `UNVERIFIED`. Never fill a gap
   from general knowledge.
5. Do NOT propose cloud, mobile, relay, marketing, telemetry, or PR/remote-repo architecture.
   If Superset's worktree story relies on them, say so and move on.
6. Max 10 findings, ≤1 page each. Rank and drop the weakest if you exceed.
7. A finding is only "adopt" if it serves M3, M5 or M9. Everything else is
   "defer to Future backlog" or "reject + reason".

TASK
How does Superset create, name, track, and clean up git worktrees per agent workspace —
and what does it do when a worktree is missing, moved, deleted by the user, or left over
after a crash?

Start from `docs/reference-recon/outputs/00-INDEX.md` Q4 file list, then these paths
(verify each exists at this SHA; note and skip any that do not):
- apps/desktop/src/lib/trpc/routers/workspaces/utils/worktree.ts
- apps/desktop/src/lib/trpc/routers/workspaces/utils/resolve-worktree-path.ts
- apps/desktop/src/lib/trpc/routers/workspaces/utils/select-external-worktrees-for-import.ts
- apps/desktop/src/lib/trpc/routers/workspaces/procedures/external-worktree-import.ts
- apps/desktop/src/renderer/react-query/workspaces/useDeleteWorktree.ts,
  useOpenExternalWorktree.ts, useHandleOpenedWorktree.ts, bootstrap-open-worktree.ts
- apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/ (all files)
- apps/desktop/src/renderer/routes/_authenticated/_dashboard/project/$projectId/components/ExternalWorktreesBanner/ (all files)
- apps/desktop/src/lib/trpc/routers/changes/utils/worktree-status-caches.ts
- apps/desktop/src/lib/trpc/routers/migration/utils/branch-detached-worktree/ (all files)
- apps/desktop/plans/done/20260420-1045-agent-driven-pr-flow.md
- apps/desktop/plans/done/20260421-v2-main-workspace-creation.md

Required: naming/path scheme; how ownership is recorded; how a dirty or detached branch is
handled; what happens on user-initiated worktree deletion; what "missing worktree" state looks
like and how the human recovers; whether they ever clean up orphaned worktrees automatically,
and under what guard. Call out anything that would violate metatron's non-negotiables above.

OUTPUT FILE
/home/phagmaier/Code/metatron/docs/reference-recon/outputs/03-worktree-lifecycle.md
(create the dir; write ONLY this file).

FINDING FORMAT — use exactly this:
### Finding N — <short title>
- **Question:** ...
- **Their mechanism:** 2–6 sentences
- **Evidence:** path:line, path:line
- **What metatron does today:** spec §x / todo Mx item / "nothing"
- **Gap or confirmation:** confirmation (independent convergence) | gap | conflict
- **Verdict:** adopt now (M?) | defer to Future backlog | reject + reason
- **Cost if adopted:** hours/days, and which guardrail test in AGENTS.md it touches
- **Unverified:** anything you could not confirm from source

End with: a 5-line summary, and the list of files you read.
