# Native permission notices under the current adapter policies

## Context

M6 item 5 connects native permission requests to Needs You. The implemented Codex adapter is a coordinator-only Lead with a verified read-only/no-network sandbox and `approvalPolicy: never`; granting a command, file, network or filesystem exception would bypass that policy. The Pi adapter advertises no native per-tool approval callback. Claude Code and OpenCode adapters are M8 work.

Codex 0.163.0's generated protocol schemas and [official app-server documentation](https://learn.chatgpt.com/docs/app-server#approvals) confirm distinct denial responses: command/file decisions, an empty granted permission subset, and declined MCP elicitation. Pi 1.3.0's installed RPC extension UI docs describe general dialogs, not a permission enforcement boundary.

## Decision

Preserve the current native policies. Unexpected Codex server requests during a Lead turn receive a denial immediately, with the original JSON-RPC ID. Permission-profile requests receive `{ permissions: {}, scope: "turn" }`; unknown methods receive an error. No acceptance, persistent grant, policy amendment or owner permission override is introduced.

Record the denial as a nonblocking HumanRequest plus an atomic `native_permission.denied` event, tied to the receiving app session, attempt, task and run. These are notices of an already-chosen denial, so they neither fabricate a native permission wait nor release its execution reservation. Owners can acknowledge or defer the notice. Generic replies remain stored evidence and send no native approval.

Persist only a fixed method category, decision and type-sensitive hash of the native request ID. Raw commands, paths, URLs and reasons stay in app-owned native transcripts because they may contain credentials. Session-scoped idempotency prevents duplicate notices; reuse with conflicting metadata fails closed. Denial selection is not proof of native receipt.

## Consequences

Needs You exposes native denial evidence without expanding Lead authority. Interactive native permission grants remain unsupported, and capability discovery says so explicitly. Pi has no permission callback to connect in its current configuration; no general extension dialog is mislabeled as a secure approval. Later adapters must expose their actual supported native permission semantics through the same inbox and enforce role/worktree policy before granting anything. This does not implement steering, stop-run controls or automatic native continuation/replay.
