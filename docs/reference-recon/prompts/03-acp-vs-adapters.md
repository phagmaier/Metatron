# Prompt 03 — ACP vs bespoke adapters (M8)

Copy everything below the line and paste to a fresh agent session
running in `/home/phagmaier/Code/metatron`. Requires `outputs/00-INDEX.md` from Prompt 01.

---

CONTEXT — read before acting
You are doing read-only reference reconnaissance for metatron
(/home/phagmaier/Code/metatron): a local-first, single-user orchestrator driving four
NATIVE coding harnesses (Codex, Claude Code, OpenCode, Pi). Stack: Node/TS strict,
SQLite, React+Vite, Git worktrees, bound to 127.0.0.1.
Read /home/phagmaier/Code/metatron/AGENTS.md, the M8 (and M3) sections of
/home/phagmaier/Code/metatron/todo.md, metatron's docs/adapter-recon.md (baseline
capability claims to compare against), and ONLY spec.md sections 5 and 13.3.
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
   from general knowledge. In particular: for EACH of metatron's four harnesses (Codex,
   Claude Code, OpenCode, Pi), state whether ACP is supported, at what version, with
   evidence — or mark UNVERIFIED. Do not guess.
5. Do NOT propose cloud, mobile, relay, marketing, telemetry, or PR/remote-repo architecture.
   If Superset's ACP story relies on them, say so and move on.
6. Max 10 findings, ≤1 page each. Rank and drop the weakest if you exceed.
7. A finding is only "adopt" if it serves milestone M8 (or unblocks M3's Pi adapter note).
   Everything else is "defer to Future backlog" or "reject + reason".

TASK
Superset integrates harnesses through ACP (Agent Client Protocol). Metatron's spec assumes
bespoke per-harness adapters (M3 Pi RPC, M8 Claude Agent SDK + OpenCode SDK). Determine what
ACP buys, what it costs, and whether metatron should change course BEFORE writing two more
adapters.

Start from `docs/reference-recon/outputs/00-INDEX.md` Q3 file list
(`find /home/phagmaier/Code/superset -iname '*acp*'` locates the surface).
Known relevant files — find exact paths yourself, note any missing at this SHA:
- acpAdapter.ts, acpCatalogue.ts, acpHarnesses.ts, acp-smoke.ts, rpcClient.ts, acp-chat.ts
- acp-vs-claude-sdk.html  <- Superset's own ACP-vs-Claude-Agent-SDK decision doc: read closely
- acp-host-client-unification.md, acp-session-follow-ups.md, 20260710-session-harness-acp.md
- migration 0009_add_acp_sessions.sql
- apps/docs/content/docs/agents/claude-code.mdx, apps/docs/content/docs/agents/codex.mdx
- AcpChatPane/**, AcpRecovery/**, useAcpChatEnabled/**
- packages/chat-runtime/**, packages/chat/**

Required outputs:
1. What ACP provides that a bespoke adapter does not (typed session/event/abort/permission surface).
2. What Superset LOST or had to work around with ACP (approval callbacks? thinking levels?
   model selection? auth? resume?). Name the gaps explicitly. Flag any that contradict
   metatron's docs/adapter-recon.md claims.
3. Per-harness ACP support table (Codex / Claude Code / OpenCode / Pi): supported version
   + evidence, or UNVERIFIED.
4. Recommendation: adopt ACP, keep bespoke, or hybrid — with cost/risk in hours.
5. Concrete smoke tests metatron must run against its installed harnesses to confirm this.

OUTPUT FILE
/home/phagmaier/Code/metatron/docs/reference-recon/outputs/02-acp-vs-adapters.md
(create the dir; write ONLY this file).

FINDING FORMAT — use exactly this:
### Finding N — <short title>
- **Question:** ...
- **Their mechanism:** 2–6 sentences
- **Evidence:** path:line, path:line
- **What metatron does today:** spec §x / todo Mx item / docs/adapter-recon.md claim / "nothing"
- **Gap or confirmation:** confirmation (independent convergence) | gap | conflict
- **Verdict:** adopt now (M?) | defer to Future backlog | reject + reason
- **Cost if adopted:** hours/days, and which guardrail test in AGENTS.md it touches
- **Unverified:** anything you could not confirm from source

End with: a 5-line summary, and the list of files you read.
