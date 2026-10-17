Continue **M8 item 1 only** in `/home/phagmaier/Code/metatron`: finish validating the Claude Code adapter. Do not advance to OpenCode or other M8 items.

## First: use my reference document

I have documented in detail how another orchestrator connects to and controls **Claude Code and Pi**. If I have not attached it or supplied its location, ask me to provide it—with credentials/token values redacted, but preserving commands, environment-variable names and version information.

Use its Claude sections to compare:
- Authentication and process startup.
- Official SDK versus CLI transport.
- Configuration/session isolation.
- Streaming, native session IDs and resume.
- Permission callbacks and cancellation.

The document is reference material, not proof that every technique is supported or appropriate here. Pi details are comparison context; changing Pi is outside this task.

## Current state

The Claude implementation already exists. **Do not rebuild it from scratch.**

Last verified:
- Installed Claude Code **2.1.302**.
- Official Agent SDK pinned to **0.3.302**.
- **383/383 tests passed**, including 52 Claude regressions.
- Typecheck, lint, fixtures, build and development/production smoke checks passed.
- Real SDK/CLI no-model discovery succeeded.
- Browser approval/denial/reload checks passed using an explicitly scripted fixture—not a live Claude model.

Relevant files:
- `src/server/adapters/claude*.ts` — SDK integration, configuration, streaming, permissions, process ownership and resume.
- `src/server/orchestration/native-approvals.ts` — durable owner decisions and live callback delivery.
- `src/web/needs-you-panel.tsx` — one-shot approval controls.
- `scripts/live-claude.ts` — opt-in native verification.
- `docs/adr/2026-10-17-claude-worker-permissions.md`
- The M8 sections of `docs/progress.md` and `docs/adapter-recon.md`.
- `docs/evidence/m8-claude-{probe,blocked,ui}.json`.

## The unresolved authentication question

The current adapter uses isolated app-owned Claude configuration and restricts authentication to API-key/cloud-provider environment routes. Those routes were absent, so the live smoke exited **2**, recorded **BLOCKED**, and submitted zero model prompts.

**That observation does not establish that existing native Claude authentication cannot be supported.** Investigate whether the limitation comes from our adapter’s restrictions, a documented SDK limitation, or applicable authentication/usage rules.

Compare the reference document with current official documentation, the installed CLI/SDK, and our implementation—especially environment/configuration handling in `claude-options.ts` and `routeConfigured()` in `claude.ts`.

Do not require separate API billing solely because the previous agent selected that approach. Explain supported authentication options and any material cost/privacy tradeoff before changing authentication policy or starting cost-bearing calls. Do not copy credentials or attach to personal sessions to bypass the blocker. Keep the official Agent SDK requirement; propose any necessary departure rather than silently substituting another interface.

## Finish the live gate

Once an approved authentication route is available and any cost is authorized, run the disposable native smoke with freshly discovered model/effort settings and a new output path:

```sh
mise x -- pnpm test:live:claude --allow-live \
  --model sonnet --thinking low \
  --output /tmp/m8-claude-live-evidence.json
```

Validate actual native streaming, effective model/effort, session ID/same-checkout resume, permission callbacks and active cancellation. Fix demonstrated integration failures without weakening safety checks.

Preserve the existing guarantees: receipt-journal failure still requests cancellation; stale approvals never replay; clean process exit alone is not completion; cross-checkout resume remains refused.

Finish with a concise report separating native observations from fixture evidence. Check off **M8 item 1 only if its remaining validation succeeds**. Otherwise retain the unchecked item and document the precise prerequisite, supported options and exact owner action required.
