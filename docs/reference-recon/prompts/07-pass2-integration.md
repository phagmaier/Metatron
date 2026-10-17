# Prompt 07 — pass-2 spec/todo/ADR integration (run LAST, after YOUR triage, in a scratch branch)

Triage completed on 2026-10-16: every ranked finding is marked adopt / defer / reject
in `docs/reference-recon/outputs/FINDINGS.md` §9. The ADOPTED list below is filled
from those final decisions, which supersede the merge's recommended verdicts.
Run in a scratch git branch or worktree of metatron so the result is a reviewable diff.

Copy everything below the line and paste to a fresh agent session
running in `/home/phagmaier/Code/metatron` (on the scratch branch/worktree).

---

CONTEXT
You are integrating TRIAGED reference findings into metatron
(/home/phagmaier/Code/metatron): Node/TS strict, SQLite, React+Vite, Git CLI, four native
harness adapters. Read /home/phagmaier/Code/metatron/AGENTS.md in full and follow it —
especially: one milestone at a time, small focused diffs, no unrelated refactors,
FakeAdapter + disposable Git fixtures by default, live harness calls only via explicit
opt-in smoke on a disposable repo.

ADOPTED FINDINGS (triaged 2026-10-16 — agent: ignore everything not listed here):
- FINDINGS.md Finding 5 — ADOPT for M6 recovery boundaries (spec §§9.3, 10.1–10.2).
  Distinguish missing, inaccessible and replaced worktrees; preserve task/attempt,
  native-session and process evidence; block unsafe submissions until an explicit
  recovery decision validates repository/worktree identity. Recheck observes facts,
  never resubmits work or automatically relinks/deletes a checkout. Include fixtures
  for same-path replacement and a surviving worker; a missing folder does not prove
  termination. Reference M9's existing visible recovery gate for path/reason/recheck.
- FINDINGS.md Finding 6 — ADOPT for the existing M6 stop item (spec §§9.3, 10.2).
  Persist and display pending-stop and failure/uncertain outcomes independently of
  navigation or view closure. Preserve history and distinguish inspect, close view
  and stop. Confirm termination only from supported process/session evidence; keep
  app-owned targeting and the existing emergency-stop limitations. Plan stop-failure
  and restart fixtures; reuse existing stop journaling rather than duplicating it.
- FINDINGS.md Finding 7 — ADOPT remaining M6 approval presentation gaps only
  (spec §§9.1, 10.2). Compare against completed M6 items 2 and 5 and
  `docs/adr/2026-10-16-native-permission-denials.md` before proposing changes.
  Expose truthful pending/answered/stale evidence where supported and explain
  unsupported native responses. Codex denial acknowledgement never grants or
  resumes; Pi per-tool approvals remain unsupported. Do not invent an Allow control,
  native continuation, or an expired domain status just to match a reference label.
  If already covered, acknowledge convergence and make no edit for this finding.
- FINDINGS.md Finding 9 — ADOPT for M6 blocker/failure handling
  (spec §§9.1, 10.1–10.2). Normalize confirmed auth, rate-limit and exhausted-credit
  reasons; distinguish unknown/unavailable usage and give the owner an actionable
  next step through the existing Needs You flow. Keep deterministic hard budgets
  independent; no credential management, inferred balance/reset time or automatic
  resumption. Plan FakeAdapter failure/restart cases now, native classification
  verification under M8, and visible exhaustion/recovery checks under M9's gate.

Integration scope: one focused M6 planning diff with references to the existing
M8/M9 verification gates where needed. Reuse or extend existing unchecked items;
do not duplicate completed work or reopen completed milestones. This prompt plans
the adopted changes only: do not implement code or run live probes/model turns.

Explicitly NOT adopted (do not implement, do not sneak in):
- Findings 1–4 — REJECT destructive cleanup shortcuts, automatic session replacement
  as task recovery, unrestricted defaults/heuristic denial and workspace grouping
  as a writer lease. Preserve existing safety invariants; no duplicate tasks.
- Finding 8 — DEFER ACP trial. Retain the M8 OpenCode SDK/server plan. Revisit only
  for a demonstrated limitation or measurable simplification; no ACP task or ADR.
- Findings 10–11 — DEFER external worktree import/relink, detached migration and
  PTY descriptor handoff. No Future backlog edits or ADRs for these in this pass.
- Everything else in FINDINGS.md; convergences produce no new implementation tasks.

REFERENCE (background only, read-only, never modify):
/home/phagmaier/Code/superset @ the SHA recorded in FINDINGS.md (Elastic License 2.0).
Do not copy code from it. If any code ends up copied, say so explicitly and note the ELv2
obligation in the ADR/progress entry.

HARD RULES
1. You MAY edit: `todo.md` (add UNCHECKED items under the correct milestone, or Future
   backlog if outside current scope — never check boxes), new files under `docs/adr/`
   (one page max each, only for choices changing authority, data safety, costs, core
   workflow, or settled spec behavior), `docs/progress.md` (append ≤15 lines, newest at
   bottom, never rewrite history), and `spec.md` ONLY where actual behavior changes
   (per spec §17 — everything else is ADR + code + tests).
2. You may NOT: check off todo items, rewrite history, add abstractions/config/dependencies
   beyond the adopted findings, touch harness global configs, or commit unless asked.
   No `sudo`, no global installs, no `pnpm add/remove` without the one-line justification
   in docs/progress.md. Run through mise shims; never system node.
3. Keep the diff milestone-sized and show it at the end (`git status --short`, `git diff --stat`).
4. Verify with the repo's own pipeline (e.g. `pnpm typecheck`, `pnpm lint`, `pnpm test`
   or documented equivalent) if any code-adjacent file changed; docs-only changes still
   get a `git diff --check`.

TASK
For each ADOPTED finding above:
a. Place it: which `todo.md` milestone gets the unchecked item (or Future backlog),
   with spec section reference.
b. If it changes authority, data safety, cost, or core workflow: draft the ADR
   (`docs/adr/YYYY-MM-DD-<slug>.md`, one page: context, decision, consequences).
c. If it changes behavior: make the minimal `spec.md` edit (cite §).
d. Append the ≤15-line `docs/progress.md` entry (done, commands + pass/fail,
   limitations, next step).

Confirmations (things metatron already does) produce NO edits — one line acknowledging them.

End with: files changed, verification commands + outcomes, new ADRs, exact next checklist
item and the resume command — per AGENTS.md completion report. Do not commit.
