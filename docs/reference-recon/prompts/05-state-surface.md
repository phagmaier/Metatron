# Prompt 05 — failure surfacing + task/session GUI model (M2/M6/M9)

Copy everything below the line and paste to a fresh agent session
running in `/home/phagmaier/Code/metatron`. Requires `outputs/00-INDEX.md` from Prompt 01.

---

CONTEXT — read before acting
You are doing read-only reference reconnaissance for metatron
(/home/phagmaier/Code/metatron): a local-first, single-user orchestrator driving four
NATIVE coding harnesses (Codex, Claude Code, OpenCode, Pi). Stack: Node/TS strict,
SQLite, React+Vite, Git worktrees, bound to 127.0.0.1.
Read /home/phagmaier/Code/metatron/AGENTS.md, the M2/M6/M9 sections of
/home/phagmaier/Code/metatron/todo.md, and ONLY spec.md sections 7 and 11.
Do not read all of spec.md.

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
   Note explicitly anything metatron should AVOID as product-scale complexity rather than
   correctness.
6. Max 10 findings, ≤1 page each. Rank and drop the weakest if you exceed.
7. A finding is only "adopt" if it serves M2, M6 or M9. Everything else is
   "defer to Future backlog" or "reject + reason".

TASK
How does Superset present agent state, failures and things needing human attention — and how
does it model panes/tasks/sessions in the GUI? Metatron needs a simple but honest state surface.

Start from `docs/reference-recon/outputs/00-INDEX.md` Q5 file list, then these paths
(verify each exists at this SHA; note and skip any that do not):
- apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/ (all files)
- apps/desktop/plans/20260322-1545-v2-workspace-panes.md
- apps/desktop/plans/20260322-2305-pane-layout-api-and-test-plan.md
- apps/desktop/plans/20260322-2335-pane-layout-model-comparison.md
- apps/desktop/plans/20260413-1600-v2-review-tab.md
- apps/desktop/plans/done/ (skim titles; read any about errors/notices/blocked states)
- apps/desktop/src/lib/trpc/routers/ (router list + how mutations are validated)
- apps/desktop/src/renderer/components/ (skim for blocked/approval/auth/quota/notice UI)

Required: how they express "agent is blocked / needs approval / auth required / quota
exhausted"; how a run/task state is kept distinct from process state; how panes and layouts
are persisted; whether the GUI can mutate state directly or only through validated procedures.

OUTPUT FILE
/home/phagmaier/Code/metatron/docs/reference-recon/outputs/04-state-surface.md
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
