# Superset Reference Index (read-only, Elastic License 2.0 — study, do NOT copy code)

## A. Top-level layout (`ls-tree --name-only HEAD apps/`, `packages/`)

apps/* (11): `apps/api`, `apps/desktop`, `apps/docs`, `apps/gate`, `apps/marketing`, `apps/mobile`, `apps/realtime`, `apps/relay`, `apps/review-host`, `apps/usercontent`, `apps/web`
packages/* (26): `agent-setup`, `auth`, `chat-runtime`, `chat-ui`, `chat`, `cli-framework`, `cli`, `cloud-client`, `db`, `email`, `host-client`, `host-service`, `i18n`, `local-db`, `macos-process-metrics`, `mcp`, `panes`, `port-scanner`, `pty-daemon`, `sandbox`, `sdk`, `shared`, `trpc`, `ui`, `workspace-client`, `workspace-fs`

apps/desktop/* (one level): `.github`, `docs`, `native`, `plans`, `scripts`, `src`, `vite`, `.storybook` + root files (`AGENTS.md`, `BUILDING.md`, `electron-builder.ts`, `electron.vite.config.ts`, `runtime-dependencies.ts`, `tsr.config.json`, etc.)
packages/* (one level, `src` unless noted): `agent-setup/src+templates`, `auth/src`, `chat-runtime/src+scripts`, `chat-ui/src`, `chat/src`, `cli-framework/src`, `cli/*(CLI_SPEC.md, cli.config.ts, demo)`, `cloud-client/src`, `db/src+drizzle`, `email/src`, `host-client/src`, `host-service/src+drizzle+docs`, `i18n/src+locales`, `local-db/src+drizzle`, `macos-process-metrics/(binding.gyp,index.js)`, `mcp/src+docs`, `panes/src`, `port-scanner/src`, `pty-daemon/src+test`, `sandbox/src+bundle`, `sdk/src+scripts`, `shared/src`, `trpc/src+test`, `ui/src`, `workspace-client/src`, `workspace-fs/src`

## B. `apps/desktop/plans/*.md` (47 files, sorted, filename only) + `done/*.md` (18)

Active: `20260107-1107-terminal-persistence-dx-hardening.md`, `20260108-2251-static-ports-json.md`, `20260109-2313-terminal-runtime-abstraction-rewrite.md`, `20260114-2050-workspace-scoped-tabs-state.md`, `20260123-mcp-layout-tools.md`, `20260306-2140-mixed-project-children-ordering.md`, `20260310-1530-v2-workspaces-sidebar-v2-cloud.md`, `20260313-1430-workspace-fs-trpc-migration.md`, `20260315-1200-workspace-fs-schema-followup.md`, `20260317-1500-tiptap-file-view-rendered-tab.md`, `20260318-1400-ux-polish-linear-style.md`, `20260319-1400-keep-chat-drafts.md`, `20260320-desktop-task-create-tiptap-plan.md`, `20260321-file-editor-state-management-plan.md`, `20260322-1545-v2-workspace-panes.md` [panes], `20260322-2305-pane-layout-api-and-test-plan.md` [panes], `20260322-2335-pane-layout-model-comparison.md` [panes], `20260405-quit-tray-lifecycle.md` [lifecycle], `20260409-tui-hotkey-forwarding.md`, `20260410-port-v2-hide-attach-to-v1.md`, `20260411-v1-terminal-resize-simplification.md`, `20260411-v2-preset-parity.md`, `20260412-file-editor-v2-feature-audit.md`, `20260412-file-editor-v2-implementation.md`, `20260413-1600-v2-review-tab.md` [review], `20260416-v2-pr-checkout-endpoint.md`, `20260417-1830-lsof-excessive-spawning-3372.md`, `20260420-1045-agent-driven-pr-flow.md`, `20260421-v2-main-workspace-creation.md` [workspace-creation], `20260422-2100-v1-to-v2-port.md`, `20260423-1226-v2-pane-persistence-across-workspace-switch.md` [panes], `20260429-v2-create-project-flow-audit.md`, `20260503-click-policy-centralization.md`, `20260505-agent-preset-import-learnings.md`, `20260505-hotkey-adaptive-toggle-smoke-test.md`, `20260507-1659-agent-lifecycle-hooks-terminal-binding.md` [lifecycle], `20260510-changes-sidebar-diffs-tree.md`, `20260523-2340-v2-diff-pane-pierre-followups.md` [review/diff-pane], `20260708-terminal-close-confirm.md`, `20260721-sidebar-header-reorg-notes.md`, `20260807-builtin-cli-preset.md`, `20260814-1500-github-star-nag.md`, `automations-onboarding.md`, `automations-ui-improvements.md`, `v1-create-scenario-analysis.md`, `v2-create-decisions-final.md`, `v2-workspace-init-status.md`. No active plan filename contains recovery/ACP/worktree.
Done: `20260106-1800-terminal-host-control-stream-sockets.md`, `20260114-1739-fix-file-pane-cross-workspace.md`, `20260412-keyboard-recorder-ctrl-binding-fix.md`, `20260415-v2-host-service-ai-branch-naming.md`, `20260415-v2-host-service-ai-branch-naming-test-plan.md`, `20260417-fix-api-key-storage-slot.md`, `20260425-1430-sidebar-remove-and-rerender.md`, `20260427-keyboard-layout-plan.md`, `20260428-keyboard-qa-plan.md`, `20260504-1200-v2-onboarding-flow.md`, `20260507-host-service-bundled-version-pin.md`, `20260510-host-service-recovery.md` [RECOVERY], `20260703-1507-derive-terminal-agent-status-from-host-binding.md`, `20260725-1947-sidebar-workspace-pinning.md`, `20260729-1500-agent-hooks-guard-and-per-agent-setting.md`, `CODE_EDITOR_MIGRATION_PLAN.md`, `ROUTING_REFACTOR_PLAN.md`, `SEMANTIC_SEARCH_PLAN.md`.

## C. `apps/docs/content/docs/agents/*.mdx` (2, present)

`claude-code.mdx`, `codex.mdx`. (No pi/opencode mdx at this SHA; agents dir has only these two.)

## D. Downstream file lists (all verified via `ls-tree -r --name-only HEAD`)

Q2 session/process lifecycle + crash/restart reconciliation (25):
packages/host-service/src/daemon/DaemonSupervisor.ts
packages/host-service/src/daemon/singleton.ts
packages/host-service/src/daemon/probe.ts
packages/host-service/src/daemon/manifest.ts
packages/host-service/DAEMON_SUPERVISION.md
packages/host-service/src/db/schema.ts
packages/host-service/src/db/db.ts
packages/host-service/drizzle/0002_add_terminal_sessions.sql
packages/host-service/drizzle/0021_heal_orphaned_terminal_session_workspace_refs.sql
packages/host-service/drizzle/0033_binding_resumed_into.sql
packages/pty-daemon/src/SessionStore/SessionStore.ts
packages/pty-daemon/src/SessionStore/snapshot.ts
packages/pty-daemon/src/SessionStore/index.ts
packages/pty-daemon/src/Server/Server.ts
packages/pty-daemon/src/Pty/Pty.ts
packages/local-db/drizzle/0011_add_terminal_persistence.sql
packages/local-db/drizzle/0012_add_persist_terminal.sql
apps/desktop/src/main/terminal-host/session.ts
apps/desktop/src/main/lib/terminal/session.ts
apps/desktop/src/renderer/lib/agent-session-orchestrator/agent-session-orchestrator.ts
apps/desktop/src/renderer/lib/agent-session-orchestrator/adapters/terminal-adapter.ts
apps/desktop/src/renderer/lib/agent-session-orchestrator/types.ts
apps/desktop/docs/HOST_SERVICE_LIFECYCLE.md
apps/desktop/plans/done/20260510-host-service-recovery.md
apps/desktop/plans/20260405-quit-tray-lifecycle.md

Q3 ACP vs bespoke adapters (25):
packages/chat-runtime/src/harness/acp/acpAdapter.ts
packages/chat-runtime/src/harness/acp/index.ts
packages/chat-runtime/src/harness/acp/wire.ts
packages/chat-runtime/src/harness/acp/rpcClient/rpcClient.ts
packages/chat-runtime/src/harness/acp/air/air.ts
packages/chat-runtime/src/harness/acp/imageBlocks/imageBlocks.ts
packages/chat-runtime/src/harness/acp/imageDimensions/imageDimensions.ts
packages/chat-runtime/src/harness/claude/claudeAdapter/claudeAdapter.ts
packages/chat-runtime/src/harness/codex/codexAdapter/codexAdapter.ts
packages/chat-runtime/src/harness/codex/codexAdapter/approvalDecisions/approvalDecisions.ts
packages/host-service/src/chat-v3/acpHarnesses.ts
packages/host-service/src/chat-v3/acpCatalogue.ts
packages/host-service/src/chat-v3/chatAgentBridge.ts
packages/host-service/drizzle/0009_add_acp_sessions.sql
packages/host-service/scripts/acp-smoke.ts
packages/trpc/src/lib/acp-chat.ts
packages/chat/src/core/bookkeeping/claude.ts
packages/chat/src/core/bookkeeping/codex.ts
apps/mobile/plans/acp-vs-claude-sdk.html
plans/done/20260710-session-harness-acp.md
plans/done/acp-host-client-unification.md
plans/done/acp-session-follow-ups.md
apps/docs/content/docs/agents/claude-code.mdx
apps/docs/content/docs/agents/codex.mdx
apps/desktop/src/renderer/hooks/useAcpChatEnabled/useAcpChatEnabled.ts

Q4 worktree/branch lifecycle (25):
apps/desktop/src/lib/trpc/routers/workspaces/utils/worktree.ts
apps/desktop/src/lib/trpc/routers/workspaces/utils/resolve-worktree-path.ts
apps/desktop/src/lib/trpc/routers/workspaces/procedures/external-worktree-import.test.ts
apps/desktop/src/lib/trpc/routers/workspaces/utils/select-external-worktrees-for-import.ts
apps/desktop/src/renderer/react-query/workspaces/useDeleteWorktree.ts
apps/desktop/src/renderer/react-query/workspaces/useOpenExternalWorktree.ts
apps/desktop/src/renderer/react-query/workspaces/useHandleOpenedWorktree.ts
apps/desktop/src/renderer/react-query/workspaces/useImportExternalWorktrees.ts
apps/desktop/src/renderer/react-query/workspaces/bootstrap-open-worktree.ts
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/project/$projectId/components/ExternalWorktreesBanner/ExternalWorktreesBanner.tsx
apps/desktop/src/lib/trpc/routers/changes/utils/worktree-status-caches.ts
apps/desktop/src/lib/trpc/routers/migration/utils/branch-detached-worktree/branch-detached-worktree.ts
apps/desktop/src/shared/types/worktree.ts
apps/desktop/src/shared/worktree-id.ts
packages/host-service/src/trpc/router/git/utils/resolve-worktree.ts
packages/host-service/src/trpc/router/workspace-creation/shared/add-branch-worktree.ts
packages/host-service/src/trpc/router/workspace-creation/shared/adopt-existing-worktree.ts
packages/host-service/src/trpc/router/workspace-creation/procedures/list-project-worktrees.ts
apps/desktop/plans/20260421-v2-main-workspace-creation.md
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/OrphanedBanner/OrphanedBanner.tsx
apps/desktop/src/renderer/components/NewWorkspaceModal/components/PromptGroup/utils/resolveOpenableWorktrees/resolveOpenableWorktrees.ts
apps/desktop/src/renderer/routes/_authenticated/settings/components/V2WorktreeLocationPicker/V2WorktreeLocationPicker.tsx
apps/desktop/src/screens/main/components/WorkspacesListView/WorkspaceRow/DeleteWorktreeDialog.tsx
apps/desktop/docs/WORKSPACE_DELETE_LIFECYCLE.md

Q5 failure/state GUI surface (25):
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/usePaneRegistry.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/index.ts
apps/desktop/plans/20260322-1545-v2-workspace-panes.md
apps/desktop/plans/20260413-1600-v2-review-tab.md
apps/desktop/src/lib/trpc/routers/index.ts
apps/desktop/src/lib/trpc/routers/pane-layout/pane-layout.ts
apps/desktop/src/lib/trpc/routers/workspaces/utils/workspace-creation.ts
packages/trpc/src/router/admin/admin.ts
packages/trpc/src/router/automation/automation.ts
apps/desktop/src/renderer/components/RendererErrorBoundary/RendererErrorBoundary.tsx
apps/desktop/src/renderer/components/DesktopNotices/DesktopNotices.tsx
apps/desktop/src/renderer/components/DesktopNotices/components/NoticeDialog/NoticeDialog.tsx
apps/desktop/src/renderer/hooks/useDesktopNotices/useDesktopNotices.ts
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceEmptyState/WorkspaceEmptyState.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/RightPaneArea/components/RightPaneEmptyState/RightPaneEmptyState.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/ConnectionNotice/ConnectionNotice.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/NoticeRow/NoticeRow.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/OrphanedBanner/OrphanedBanner.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/components/AcpRecovery/AcpRecovery.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/automations/components/RelayOfflineNotice/RelayOfflineNotice.tsx
apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/hooks/useBlockedDragNotice/useBlockedDragNotice.ts
apps/desktop/src/renderer/routes/_authenticated/settings/usage/components/UsageView/components/RestartSessionsDialog/RestartSessionsDialog.tsx
apps/desktop/src/renderer/routes/sign-in/hooks/useSessionRecovery/useSessionRecovery.ts
packages/trpc/src/lib/acp-chat.ts

---
Ref SHA: `491ca53f4cd1d6a4ed06735cfd98a39a12480d67` (`git -C /home/phagmaier/Code/superset rev-parse HEAD`). File counts: Q2=25, Q3=25, Q4=25, Q5=25. All paths verified to exist at ref SHA via `git ls-tree -r --name-only HEAD`.
