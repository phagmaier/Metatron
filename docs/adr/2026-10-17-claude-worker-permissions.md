# Claude SDK workers: app-owned sessions and one-shot file permissions

Date: 2026-10-17. Scope: M8 item 1 only.

## Context

Claude Code 2.1.302 is installed. Official Agent SDK 0.3.302 declares that exact CLI version. Native `canUseTool` is not an unconditional policy hook: earlier native allow rules can bypass it. Existing Codex coordinator denials are notifications, not permission grants. M8 needs real worker permission callbacks without relaxing that policy or generic human-wait recovery.

The [official quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) documents API-key/approved provider authentication and restricts offering personal subscription login without approval. A personal CLI login is not SDK entitlement. No supported API/provider authentication is configured in this environment.

## Decision

- Use only the official SDK `query` with the installed executable, app-owned `CLAUDE_CONFIG_DIR` and native transcript/session state. Disable discovered settings, plugins, skills and agents; submit literal client-composed task context. Inherit only approved API/provider environment and basic process settings, never personal OAuth/session selectors or arbitrary Git/Node overlays. Configured account metadata means authentication **unknown**, not validated entitlement; absent configuration means **false**.
- Offer worker file tools only: Read/Grep/Glob, plus Edit/Write for writers, and the five scoped worker MCP methods when a gateway is configured. No shell, delegation, Lead tools, integration or wider permissions. An unconditional PreToolUse hook verifies initialized native identity, original checkout/Git identity and file policy. Edit/Write force a native ask even if a native rule would otherwise auto-allow. Recheck identity and file policy after awaiting consent. These are application guards, **not an OS sandbox**.
- Persist a blocking permission request, then retain its exact callback in memory. Only the authenticated, CSRF/Origin-protected owner endpoint can answer approve/deny once for the same live session, task and attempt. Paused/Chat-Plan/otherwise blocked work cannot gain approval. Generic inbox replies cannot answer this callback or resume its native execution.
- Commit owner intent before delivery. Consume the callback once; an adapter receipt is not proof the tool executed. Callback or durable-receipt failures request cancellation even if journaling fails; retain ambiguous work for explicit recovery. Cancellation/session end/restart expires undelivered callbacks. Never replay a grant or widen SDK permissions.
- Success requires validated root-session events, an authoritative successful non-error native result and a real clean owned-process exit. EOF, then bounded TERM/KILL, targets only the child this adapter started. A clean exit alone is not completion; the executor waits for the full event stream.
- Native resume requires a durable clean app-owned manifest for the same run/task, model/effort/permission and canonical checkout/Git inode/branch identity. Interrupted work cannot resume or replay. Engine assignments still create fresh worktrees, so cross-assignment native resume is refused and auto continuation uses a checkpoint. Steering and Claude Lead execution remain unsupported.

## Consequences and verification

Codex denial notices and Pi controls are unchanged. Default regressions use deterministic SDK-boundary fixtures, real inert subprocesses, HTTP and disposable Git repositories. The real CLI/SDK no-model control/catalog probe passed with isolated configuration and zero model prompts; the opt-in smoke exits 2 without submitting a model when supported authentication is absent. Actual Chromium approval/denial/reload checks used an explicitly scripted fixture, not a Claude model.

Authenticated native streaming, effective model/effort, same-checkout resume, permission callbacks and active-turn cancellation remain **BLOCKED**, not passed. The owner must privately configure a supported SDK API/provider environment, then run the explicit cost-bearing smoke in README. M8 item 1 stays unchecked until that gate is observed; no four-harness or beta completion is claimed.
