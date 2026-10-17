# Prompt 02 — session/process lifecycle + crash/restart reconciliation (M6)

Copy everything below the line and paste to a fresh agent session
running in `/home/phagmaier/Code/metatron`. Requires `outputs/00-INDEX.md` from Prompt 01.

---

CONTEXT — read before acting
You are doing read-only reference reconnaissance for metatron
(/home/phagmaier/Code/metatron): a local-first, single-user orchestrator driving four
NATIVE coding harnesses (Codex, Claude Code, OpenCode, Pi). Stack: Node/TS strict,
SQLite, React+Vite, Git worktrees, bound to 127.0.0.1.
Read /home/phagmaier/Code/metatron/AGENTS.md, the M6 section of
/home/phagmaier/Code/metatron/todo.md (its unchecked items), and ONLY spec.md sections 9 and 10.
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
   from general knowledge of how such systems "usually" work.
5. Do NOT propose cloud, mobile, relay, marketing, telemetry, or PR/remote-repo architecture.
   Metatron beta forbids those. If Superset relies on them, say so and move on.
6. Distinguish "they do X because they are a SaaS product" from "they do X because X is correct."
7. Max 10 findings, ≤1 page each. Rank and drop the weakest if you exceed.
8. A finding is only "adopt" if it serves milestone M6. Everything else is
   "defer to Future backlog" or "reject + reason".

TASK
Answer: how does Superset distinguish an agent that finished successfully from one that
crashed, disconnected, or hit auth/quota failure — and what does it persist so that after
an app restart it can reconcile native sessions, processes and worktrees WITHOUT re-running
ambiguous mutating work?

Start from `docs/reference-recon/outputs/00-INDEX.md` Q2 file list, then these paths
(verify each exists at this SHA; note and skip any that do not):
- apps/desktop/plans/done/20260510-host-service-recovery.md
- apps/desktop/plans/done/20260507-host-service-bundled-version-pin.md
- apps/desktop/plans/20260109-2313-terminal-runtime-abstraction-rewrite.md
- apps/desktop/plans/20260507-1659-agent-lifecycle-hooks-terminal-binding.md
- apps/desktop/src/main/lib/host-service-coordinator.ts
- apps/desktop/src/main/lib/host-service-lock.ts
- apps/desktop/src/main/host-service/index.ts, apps/desktop/src/main/host-service/env.ts,
  apps/desktop/src/main/host-service/shutdown.ts
- apps/desktop/src/main/lib/stop-pty-daemons.ts
- packages/pty-daemon/src/SessionStore/ (all files)
- packages/pty-daemon/test/signal-recovery.test.ts
- apps/desktop/src/renderer/lib/agent-session-orchestrator/agent-session-orchestrator.ts,
  apps/desktop/src/renderer/lib/agent-session-orchestrator/types.ts,
  apps/desktop/src/renderer/lib/agent-session-orchestrator/adapters/terminal-adapter.ts
- packages/local-db/** (find the schema/migrations yourself)

Also answer: what is persisted vs derived at startup? Is there anything equivalent to
metatron's "never auto-rerun ambiguous mutating work" rule? What happens to a session
whose worktree vanished?

OUTPUT FILE
/home/phagmaier/Code/metatron/docs/reference-recon/outputs/01-session-recovery.md
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
