# Prompt 06 — merge findings into FINDINGS.md (run after 02–05, then YOU triage)

Copy everything below the line and paste to a fresh agent session
running in `/home/phagmaier/Code/metatron`.

---

CONTEXT
You are merging read-only reference reconnaissance for metatron
(/home/phagmaier/Code/metatron) into one ranked verdict doc.
Read /home/phagmaier/Code/metatron/AGENTS.md only. Do not re-read spec.md in full.

INPUTS (read-only — do not modify):
- /home/phagmaier/Code/metatron/docs/reference-recon/outputs/00-INDEX.md
- /home/phagmaier/Code/metatron/docs/reference-recon/outputs/01-session-recovery.md
- /home/phagmaier/Code/metatron/docs/reference-recon/outputs/02-acp-vs-adapters.md
- /home/phagmaier/Code/metatron/docs/reference-recon/outputs/03-worktree-lifecycle.md
- /home/phagmaier/Code/metatron/docs/reference-recon/outputs/04-state-surface.md

REFERENCE (for citation checks only, read-only, never modify):
/home/phagmaier/Code/superset (Elastic License 2.0 — study, do NOT copy code).

HARD RULES
1. Write ONLY the single OUTPUT FILE below. NEVER modify todo.md, spec.md, AGENTS.md,
   README.md, package.json, src/**, tests/**, or any other existing file. Markdown only.
2. Do not invent findings. Every ranked finding must trace to one of the five inputs
   (cite which). Drop duplicates, contradictions to resolve, and findings without
   `path:line` evidence. Keep at most 12 total, ranked by (correctness risk first,
   then cost ascending).
3. No cloud / mobile / relay / marketing / telemetry / PR-remote proposals.
4. Findings that confirm metatron's existing design produce NO edit — list under
   Convergences with one line each.

TASK — write the merge doc with exactly these sections:

1. Scope & method — what was read, what was deliberately NOT read, date, ref SHA.
2. Reference snapshot — superset-sh/superset @ <sha>, license: Elastic License 2.0
   (source-available, not OSI) — study, don't copy.
3. Ranked findings — each: one paragraph + source file + verdict
   (adopt-now with milestone / defer to Future backlog / reject + reason) + cost.
4. Convergences — independent agreements that validate metatron's design (no action).
5. ADR candidates — only items changing authority, data safety, cost, or core workflow
   (the ACP decision qualifies if recommended). Name the file
   `docs/adr/YYYY-MM-DD-<slug>.md` that a later pass should write.
6. Explicit rejections with reasons — so this is not re-litigated next session.
7. Unverified — claims needing a live smoke test on metatron's installed harnesses
   (disposable fixture only, per AGENTS.md).
8. Provenance — "designs informed by superset-sh/superset@<sha>, ELv2, no code copied."

OUTPUT FILE
/home/phagmaier/Code/metatron/docs/reference-recon/outputs/FINDINGS.md
(write ONLY this file). End with: the 3 highest-value adoptions and the single
highest-risk proposal to reject.
