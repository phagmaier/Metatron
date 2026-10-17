# Reference recon — run order and instructions

Purpose: read-only reconnaissance of `/home/phagmaier/Code/superset`
(superset-sh/superset, Elastic License 2.0 — study, do NOT copy code)
to inform metatron's M6 / M8 / M3+M5+M9 work. Findings are proposals, not edits.

## Where to run

- cwd = `/home/phagmaier/Code/metatron` for every prompt below.
- That loads metatron's `AGENTS.md`, `spec.md`, `todo.md`.
- Do NOT run from `/home/phagmaier/Code` (no project context).
- Reference is read via absolute paths to `/home/phagmaier/Code/superset`. Never write there.

## Directory layout (this is the entire footprint)

```
docs/reference-recon/
  README.md            <- this file
  prompts/01-index.md  <- prompt files: copy-paste these to an agent, in order
  prompts/02-session-recovery.md
  prompts/03-acp-vs-adapters.md
  prompts/04-worktree-lifecycle.md
  prompts/05-state-surface.md
  prompts/06-merge-findings.md
  prompts/07-pass2-integration.md
  outputs/               <- agents write finding files here ONLY (created on first run)
```

Delete everything with `rm -rf docs/reference-recon` when done.

## Order to send

| # | File | What it does | When |
|---|------|--------------|------|
| 1 | `prompts/01-index.md` | 1-page index: superset layout + plans titles + file list per question | First, alone. Feeds 2–5. |
| 2 | `prompts/02-session-recovery.md` | Session/process lifecycle + crash/restart reconciliation (M6) | After 1. 2–5 are independent, can run in parallel. |
| 3 | `prompts/03-acp-vs-adapters.md` | ACP vs bespoke adapters (M8) | After 1, parallel-safe. |
| 4 | `prompts/04-worktree-lifecycle.md` | Worktree/branch lifecycle + stranded workspaces (M3/M5/M9) | After 1, parallel-safe. |
| 5 | `prompts/05-state-surface.md` | Failure surfacing + task/session GUI model (M2/M6/M9) | After 1, parallel-safe. |
| 6 | `prompts/06-merge-findings.md` | Ranked merge into `FINDINGS.md` + adopt/defer/reject | After 2–5. Then YOU triage. |
| 7 | `prompts/07-pass2-integration.md` | Spec/todo/ADR integration of adopted findings only | After your triage, in a scratch branch/worktree. |

## How to send each one

1. `cd /home/phagmaier/Code/metatron`
2. Open the prompt file, copy its entire contents.
3. Paste to a fresh agent session running in that cwd.
4. Each prompt is standalone — the agent needs nothing else from you.

## Rules baked into every prompt (do not override)

- Read-only on `/home/phagmaier/Code/superset`. Never write there.
- NEVER modify `todo.md`, `spec.md`, `AGENTS.md`, `README.md`, `package.json`, `src/**`, `tests/**`, or any existing metatron file. Prompts 1–6 write exactly one new markdown file under `docs/reference-recon/outputs/`. Proposals go in that file as text.
- Markdown only. No `.ts/.js/.json` — stray code files can break `tsc`/biome.
- Every claim needs `path:line` evidence (max 3 quoted lines). No citation = no finding.
- Unconfirmable = `UNVERIFIED`. Never fill gaps from general knowledge.
- No cloud / mobile / relay / marketing / telemetry / PR-remote proposals. Metatron beta forbids those.
- Max 10 findings per question, ≤1 page each.
- A finding is "adopt" only if it serves the named milestone. Else defer to Future backlog or reject with reason.
- Record the superset commit SHA (`git -C /home/phagmaier/Code/superset rev-parse HEAD`) in every output.

## After prompt 6

Read `docs/reference-recon/outputs/FINDINGS.md`, mark each finding adopt / defer / reject yourself (10 min). Then fill the adopted list into prompt 7 and run it in a scratch branch/worktree for the spec/todo/ADR diff.
