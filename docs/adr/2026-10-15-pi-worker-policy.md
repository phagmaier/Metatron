# M3 Pi worker execution policy

## Context

Pi 1.3.0 RPC supports native sessions, model/thinking discovery, file tools and abort. Built-in tools do not provide a general permission callback. Pi may write settings even during CLI startup. Reusing the personal agent directory would mix app configuration and sessions with the owner's native sessions.

## Decision

Use the installed Pi subprocess with `PI_CODING_AGENT_DIR` and session storage under app data. Keep authentication inside Pi: inherited provider environment variables or an owner-configured app-owned Pi login. Never copy or extract personal credentials. Disable discovered extensions, MCP, skills, context files and prompt templates; load only the explicit app policy extension.

M3 exposes read/grep/find/ls to readers, plus edit/write to writers. Shell and delegation tools remain disabled. The native tool-call hook checks canonical paths, sensitive names and symlinks before file operations; startup refuses prompts unless the policy extension registers its handshake command. These controls reduce accidental access; they are not an OS sandbox and do not prevent external processes from racing filesystem checks.

Every native attempt gets a unique app-owned Git branch/worktree and durable creation intent. Retain all worktrees, including partial creations, on failure/restart; never automatically replay or clean them. Capture Git status, staged/unstaged statistics, ignored/untracked paths and `diff --check` separately from the model's report.

M3 native workers are owner-directed, start in Supervised mode, and count against the existing scheduler caps. The native Lead/tool gateway remains M4. A completed turn requires `agent_settled` and a successful final assistant stop reason; process exit alone is never success.

## Consequences

No dependency or toolchain changes are needed. Native model/thinking choices come from installed Pi RPC, with exact-selection verification. Tests inside the managed project are explicitly **not run** because M3 workers have no shell; engine Git checks are recorded separately. Resume, steering and interactive per-call permissions remain unsupported in this adapter, with diagnostics. Later milestones may add narrowly scoped test tools through the authorized gateway; they must preserve owner authority and permission enforcement.
