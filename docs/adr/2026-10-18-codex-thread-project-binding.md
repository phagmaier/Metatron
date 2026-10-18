# Bind Codex threads to their original run and checkout

## Context

M9 item 6 verifies spec §6.3/§8.1: selecting another project must never attach its sessions or worktrees to the selected repository. The Lead lookup was run-scoped, but `CodexAdapter.resume` accepted a native thread ID without durable ownership validation. Two failing-before protocol tests reproduced foreign-run resume and resume after replacing `.git` at the original path. Claude/OpenCode already enforce their own checkout manifests; Pi does not support native resume.

## Decision

Before starting a Codex session, obtain the canonical Git checkout identity using the existing identity probe (root and Git-directory device/inode, common directory and branch/detached revision). After native startup configuration succeeds, exclusively create an app-owned binding under `codex-bindings/`, keyed by the SHA-256 of the native thread ID. Record its run, model, thinking, permission and checkout identity. Never overwrite an existing binding.

Resume must match that binding before any harness process launches. Lead turns may change task/attempt IDs within the same run; another run, checkout, model or permission cannot inherit the thread. Unknown, malformed or legacy bindings refuse explicitly. Do not infer ownership from the selected UI project, native thread existence, a path string, or a matching commit.

Project selection also remounts the new-run forms, clearing project-specific draft objectives and discovered selections. Current-run controls already remount by run ID. Existing work continues under its persisted run/task bindings; selection itself sends no mutation or launch.

## Consequences

- Existing pre-binding Codex Lead threads require a new run. Their records/transcripts/worktrees are retained; there is no automatic migration or replay. A partially written binding after a crash also refuses safely.
- No database migration, dependency, native API change, model call or credential copying. Same-run resume after adapter/app reconstruction remains supported and tested.
- Changing Git identity or branch refuses continuity. This is a local ownership check, not an OS sandbox, cross-process native lease, or race-proof filesystem containment. Existing crash/stop recovery rules remain in force.
