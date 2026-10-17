# Superset reference reconnaissance — state and attention surface

Reference: `/home/phagmaier/Code/superset`, commit `491ca53f4cd1d6a4ed06735cfd98a39a12480d67`, recorded with `git -C /home/phagmaier/Code/superset rev-parse HEAD`. Working tree was clean during inspection. License: Elastic License 2.0 (`LICENSE.md:1`). Analysis only; no source copied.

Started with metatron’s `docs/reference-recon/outputs/00-INDEX.md` Q5. All 25 Q5 files, all four named plans, and the requested directories exist at this SHA; none of those requested paths were skipped. Inventoried and keyword-scanned all 783 tracked files under `usePaneRegistry/` (46,811 lines); inspected the relevant source sections below. Skimmed all 18 desktop `plans/done/` titles and examined the recovery, status-derivation, and API-key-storage plans. Plans describe intent/history; implemented source takes precedence.

Scope: metatron comparison uses only spec §§7/11, todo M2/M6/M9, AGENTS.md and the progress tail; it is **not a fresh audit of metatron implementation**. “Today” below means documented requirements/checklist state. Superset has no existing codebase-memory index; coverage checks returned “project not found or not indexed.” No index was created; findings use direct absolute-path source reads. Negative conclusions remain bounded, with gaps marked UNVERIFIED. Citations beginning with `apps/`, `packages/` or `LICENSE.md` refer to Superset; `spec.md`, `todo.md` and `AGENTS.md` refer to metatron. Costs are implementation estimates, excluding native-harness approval capabilities that metatron does not yet support.

### Finding 1 — Keep task, turn, session and process state separate
- **Question:** Does a quiet or ended process mean the task succeeded?
- **Their mechanism:** Superset stores task status through a task-status record and groups the task board by that status ID. Chat separately represents session states such as starting, awaiting input, offline and dead, and turn outcomes such as completed, failed and interrupted. Terminal session liveness and terminal-to-agent bindings are separate database records again. The transcript renders an interrupted turn differently from a failed turn; none of these schemas makes a pane or idle session a completed task. Metatron should preserve these distinctions in a task badge, runtime badge and attempt result rather than collapsing them into one status.
- **Evidence:** `packages/db/src/schema/schema.ts:144`, `packages/db/src/schema/schema.ts:213`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/tasks/components/TasksView/components/TasksBoardView/TasksBoardView.tsx:60`, `packages/chat/src/protocol/envelope.ts:5`, `packages/chat/src/protocol/envelope.ts:81`, `packages/host-service/src/db/schema.ts:15`, `packages/host-service/src/db/schema.ts:53`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/TurnGroupSection/components/TurnStatusRow/TurnStatusRow.tsx:10`.
- **What metatron does today:** spec §7.1 explicitly separates task and process lifecycles (`spec.md:343`, `spec.md:359`, `spec.md:361`); M2’s board/status/event surface is checked (`todo.md:56`); M6’s explicit recovery states remain unchecked (`todo.md:125`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M6)
- **Cost if adopted:** 4–8 hours to make the existing distinction visible and verify failure/interruption cases; touches the ambiguous-mutating-rerun and cross-repository-session guardrails (`AGENTS.md:99`, `AGENTS.md:101`).
- **Unverified:** UNVERIFIED: exhaustive Superset task-to-agent transition coupling; the inspected schemas and board establish separate representations, not a complete scheduler correctness proof.

### Finding 2 — Derive attention from durable facts; acknowledgement is separate
- **Question:** How do permission, failure, work and unread results reach a compact status surface?
- **Their mechanism:** A shared mapping converts Start, PermissionRequest, Failed and Stop events to working, permission, failed and review. Aggregation prioritizes permission above failed, working and review; the indicator uses distinct colors, pulsing for permission/failure, and labels available to tooltip consumers. The renderer derives terminal status from host bindings and only seen-gates review; looking at a permission prompt does not clear it. Bindings are read through a join requiring an active, workspace-owned terminal without a pending disposal or ended binding, while lifecycle/connection refreshes invalidate the query. Local persistence stores acknowledgement timestamps and manual unread marks rather than another authoritative agent-status map; metatron should apply the same separation to backend task/request facts and UI acknowledgement.
- **Evidence:** `packages/shared/src/agent-status.ts:4`, `packages/shared/src/agent-status.ts:22`, `apps/desktop/src/renderer/screens/main/components/StatusIndicator/StatusIndicator.tsx:8`, `apps/desktop/src/renderer/hooks/host-service/useTerminalAgentStatuses/deriveTerminalAgentStatus.ts:18`, `packages/host-service/src/terminal-agents/persistence.ts:409`, `apps/desktop/src/renderer/hooks/host-service/useTerminalAgentBindings/useTerminalAgentBindings.ts:42`, `apps/desktop/src/renderer/stores/v2-notifications/store.ts:69`, `apps/desktop/src/renderer/stores/v2-notifications/store.ts:108`.
- **What metatron does today:** precise persisted statuses and normalized summaries are required (`spec.md:359`, `spec.md:536`); Needs You with evidence/history is checked (`todo.md:119`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M6)
- **Cost if adopted:** 4–8 hours for a shared attention selector plus reload/acknowledgement checks; touches affected-task-only blocking (`AGENTS.md:100`).
- **Unverified:** UNVERIFIED: equivalent attention aggregation for chat sources; the inspected hook explicitly says they contribute no status (`apps/desktop/src/renderer/hooks/host-service/useV2NotificationStatus/useV2NotificationStatus.ts:34`). Superset’s Stop-derived “review” means unseen activity, not metatron’s verified AWAITING_REVIEW transition; keep metatron’s task semantics (`spec.md:354`, `spec.md:536`).

### Finding 3 — Approval cards preserve scope, evidence and expired history
- **Question:** What does “blocked / needs approval” actually show?
- **Their mechanism:** The shared run-state helper calls a permission event blocked, while the visual indicator calls it needs input. Chat approval cards distinguish pending, answered and stale requests, show command/action details, and retain a decision label or expired badge. Responses carry the approval ID and decision; available native options can be displayed directly, with allow-once styled as the primary choice when present. A question form uses a separate response surface, and answered requests lose the pending action controls. Adopt the visible request lifecycle and narrow grant emphasis only where the native adapter actually supports responding.
- **Evidence:** `packages/shared/src/agent-status.ts:40`, `apps/desktop/src/renderer/screens/main/components/StatusIndicator/StatusIndicator.tsx:9`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/ApprovalRow/ApprovalRow.tsx:62`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/ApprovalRow/ApprovalRow.tsx:103`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/ApprovalRow/ApprovalRow.tsx:123`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/ApprovalRow/components/OptionButtons/OptionButtons.tsx:18`, `packages/chat/src/protocol/commands.ts:63`.
- **What metatron does today:** Needs You is required by §11.2 (`spec.md:528`), with blocker-specific continuation (`spec.md:375`); M6 currently records Codex denial notifications only and explicitly lacks owner-driven native continuation (`todo.md:122`).
- **Gap or confirmation:** gap
- **Verdict:** adopt now (M6)
- **Cost if adopted:** 4–8 hours for honest pending/answered/expired and unsupported UI using existing requests; native continuation work is additional and capability-dependent. Touches affected-task-only blocking and authority boundaries (`AGENTS.md:97`, `AGENTS.md:100`).
- **Unverified:** UNVERIFIED: identical native approval semantics across all four metatron harnesses, or a Superset global human-action inbox. An “Allow” button must not be added to metatron’s denial-only path as though continuation already works (`todo.md:122`).

### Finding 4 — Auth and quota show uncertainty, not invented availability
- **Question:** How are auth-required and exhausted-quota conditions expressed?
- **Their mechanism:** Usage settings explicitly label expired sign-in, signed out and unavailable accounts, and offer a copyable terminal login command for supported expired accounts. ACP bootstrap errors containing “auth” receive terminal-login guidance and put the session into dead state; that path uses a string heuristic rather than a typed auth classification. The terminal usage popover currently enables account matching for Claude/Codex and distinguishes reading, API billing, login unverified, stale and unavailable data. Known usage windows show percentage, reset information and warning colors at 70/90 percent, while stale data is visually muted. These files demonstrate quota observability, not a dedicated exhausted-run transition or automatic resumption policy; metatron should show confirmed provider failures and unknown usage honestly, keep its hard budget independent, and put actionable auth/quota blockers in its existing request flow.
- **Evidence:** `apps/desktop/src/renderer/routes/_authenticated/settings/usage/components/UsageView/UsageView.tsx:218`, `apps/desktop/src/renderer/routes/_authenticated/settings/usage/components/UsageView/UsageView.tsx:293`, `packages/chat-runtime/src/harness/acp/acpAdapter.ts:909`, `packages/chat-runtime/src/harness/acp/acpAdapter.ts:2177`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AccountUsage/AccountUsage.tsx:33`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AccountUsage/AccountUsage.tsx:68`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AccountUsage/AccountUsage.tsx:144`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AccountUsage/utils/getAccountUsageState/getAccountUsageState.ts:47`.
- **What metatron does today:** hard operation limits remain mandatory without exact billing (`spec.md:394`); capability honesty is required (`spec.md:530`); quota-exhaustion tests and visible credit-exhaustion statuses are unchecked (`todo.md:128`, `todo.md:166`).
- **Gap or confirmation:** gap
- **Verdict:** adopt now (M6)
- **Cost if adopted:** 1–2 days for normalized, capability-aware auth/quota reasons, next-action text and fake exhaustion/recovery checks; touches hard caps and affected-task-only blocking (`AGENTS.md:97`, `AGENTS.md:100`).
- **Unverified:** UNVERIFIED: a Superset canonical quota-exhausted task state, guaranteed 100%-usage blocking, reset-triggered safe continuation, or a complete four-harness auth/quota matrix. Account switching/credential management is not proposed for metatron.

### Finding 5 — Recovery explanations help; automatic recovery is not an execution policy
- **Question:** What happens when a stored session still exists but its process cannot serve it?
- **Their mechanism:** ACP recovery presents different explanations for no conversation, stopped chat and conversation continued in a terminal, with start-new and optional resume actions. The surrounding component also automatically closes/replaces stopped or dead sessions, uses a bounded recovery counter and exponential delays, and later exposes manual recovery. A completed host-recovery plan documents a separate failure: a live PID was incorrectly treated as a serving process; it reports adding an endpoint health probe. Metatron should adopt explicit reason/evidence/action presentation and independent process-health confirmation, while preserving the owner’s retry decision for ambiguous work. Reject transferring automatic close-and-restart behavior into task execution.
- **Evidence:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/components/AcpRecovery/AcpRecovery.tsx:19`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/components/AcpRecovery/AcpRecovery.tsx:29`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/AcpChatPane.tsx:367`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/AcpChatPane.tsx:388`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/AcpChatPane.tsx:429`, `apps/desktop/plans/done/20260510-host-service-recovery.md:5`.
- **What metatron does today:** FAILED/INTERRUPTED lead to RETRY_DECISION (`spec.md:351`); recovery states and restart reconciliation remain unchecked (`todo.md:125`, `todo.md:126`).
- **Gap or confirmation:** conflict
- **Verdict:** adopt now (M6)
- **Cost if adopted:** 1–2 days for explicit recovery UI backed by reconciled evidence, without automatic retry of ambiguous mutations; touches the crashed/disconnected no-rerun guardrail (`AGENTS.md:99`).
- **Unverified:** UNVERIFIED: whether Superset’s automatic conversation recovery can replay mutating work; no safety equivalence is claimed. The host-health mechanism above is plan-reported, not independently traced to its implementation.

### Finding 6 — Persist view descriptors with workspace identity
- **Question:** What pane/layout model is actually shipped, and where is it stored?
- **Their mechanism:** Current pane types define a workspace with tabs, each tab containing a binary split tree whose leaves reference pane IDs and a pane record map. This differs from the earlier plans’ group-based and n-ary proposals. Desktop stores the center/right layouts in a localStorage-backed workspace-local collection, keyed by workspace ID inside an organization-specific storage key. The renderer subscribes to its pane store and directly updates that collection; the runtime store is scoped to the route’s workspace and avoids applying unresolved stale query rows during switching. Read-time sanitization drops malformed tabs and repairs active-tab selection; terminal/chat pane data holds runtime identity references rather than process objects.
- **Evidence:** `packages/panes/src/types.ts:9`, `packages/panes/src/types.ts:27`, `apps/desktop/plans/20260322-1545-v2-workspace-panes.md:98`, `apps/desktop/plans/20260322-2305-pane-layout-api-and-test-plan.md:158`, `apps/desktop/src/renderer/routes/_authenticated/providers/CollectionsProvider/collections.ts:155`, `apps/desktop/src/renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema.ts:126`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/useV2WorkspacePaneLayout.ts:40`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/useV2WorkspacePaneLayout.ts:103`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/useV2WorkspacePaneLayout.ts:129`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types.ts:23`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types.ts:80`.
- **What metatron does today:** §11 permits a simple tab/sidebar workspace and task detail drawer (`spec.md:525`, `spec.md:526`, `spec.md:532`); M9 must verify switching cannot attach sessions/worktrees to another repository (`todo.md:168`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M9)
- **Cost if adopted:** 4–8 hours for repository/run-scoped selection restore and stale-switch tests using metatron’s existing UI; no docking package required. Touches wrong-repository session reuse (`AGENTS.md:101`).
- **Unverified:** UNVERIFIED: metatron currently persists view selection, or Superset’s generic pane-data payloads are deeply validated. Adopt identity scoping and recoverable view state; do not use layout storage as task truth (`spec.md:536`).

### Finding 7 — Procedures validate runtime commands; layout writes remain local
- **Question:** Can the GUI mutate state directly, or only through validated procedures?
- **Their mechanism:** The answer depends on the state: layout updates are direct renderer collection writes, whereas inspected terminal/chat runtime actions invoke procedures. Chat routes apply command schemas, resolve workspace CWD server-side for creation, and pass approval decisions through a command layer that parses again, deduplicates by command ID and requires a live session. The desktop terminal route validates IDs and checks worktree usability before create/attach. Desktop router registration covers analytics, browser/history, downloads, screenshots, auth, updates, window, projects, workspaces, terminal, changes, filesystem, notifications, pane layout, permissions, plugins, ports/forwarding, metrics, menu, external actions, star prompts, settings, system, config, devices, dictation, UI state, ringtone, coordinator and keyboard layout. Registration is not proof of uniform validation: desktop publicProcedure adds error middleware, and the pane-layout response accepts an optional custom-typed result without a structural validator. Metatron should keep domain mutations behind its tested server transitions and restrict direct renderer writes to disposable view preferences.
- **Evidence:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/useV2WorkspacePaneLayout.ts:146`, `packages/chat-runtime/src/router/router/router.ts:77`, `packages/chat-runtime/src/router/router/router.ts:125`, `packages/chat-runtime/src/commands/commands/commands.ts:292`, `apps/desktop/src/lib/trpc/routers/terminal/terminal.ts:31`, `apps/desktop/src/lib/trpc/routers/terminal/terminal.ts:85`, `apps/desktop/src/lib/trpc/routers/terminal/terminal.ts:120`, `apps/desktop/src/lib/trpc/routers/index.ts:37`, `apps/desktop/src/lib/trpc/index.ts:79`, `apps/desktop/src/lib/trpc/routers/pane-layout/pane-layout.ts:35`.
- **What metatron does today:** arbitrary task transitions are forbidden and the board reflects backend truth (`spec.md:359`, `spec.md:536`); M2 validated assignment and policy checks are checked (`todo.md:53`, `todo.md:58`); M9 boundary audit remains unchecked (`todo.md:165`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M9)
- **Cost if adopted:** 0.5–1 day to audit mutation entry points and add only missing boundary checks; touches Chat/Plan, Lead/worker authority and hard-cap tests (`AGENTS.md:95`, `AGENTS.md:97`).
- **Unverified:** UNVERIFIED: every Superset mutation enforces authorization or legal domain transitions. Shape validation and command deduplication do not establish metatron’s policy guarantees.

### Finding 8 — Closing a view and stopping work need explicit semantics
- **Question:** Is a pane the session itself, and does closing it end the agent?
- **Their mechanism:** Pane ID and terminal ID are distinct: title subscriptions include both, and multiple pane stores can reference the same terminal. Closing a terminal pane probes whether a process is running and warns that closing will end it. After closure, another remaining view or explicit background intent causes release; otherwise the registry disposes the runtime and requests a terminal kill. The automatic close-driven kill path logs failure to the console, whereas an explicit kill action shows success/error toasts. Metatron should keep task history and runtime ownership independent of whether its drawer is open, with stop intent and any stop failure visible until reconciled.
- **Evidence:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/usePaneRegistry.tsx:194`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/usePaneRegistry.tsx:217`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/usePaneRegistry.tsx:390`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/usePaneRegistry.tsx:406`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/usePaneRegistry.tsx:424`, `packages/host-service/src/db/schema.ts:37`.
- **What metatron does today:** owner inspect/cancel must preserve workflow history (`spec.md:413`); pause/stop controls are required (`spec.md:525`); app-owned-process stop implementation is next unchecked M6 item (`todo.md:124`).
- **Gap or confirmation:** gap
- **Verdict:** adopt now (M6)
- **Cost if adopted:** 4–8 hours for distinct close/inspect/stop behavior and durable stop-error display; touches app ownership/authority and ambiguous-recovery tests (`todo.md:124`, `AGENTS.md:97`, `AGENTS.md:99`).
- **Unverified:** UNVERIFIED: all Superset pane kinds share terminal close semantics, or kill failures always become visible elsewhere. Reject using “pane disappeared” as confirmation that execution stopped.

### Finding 9 — Explain the failing layer and preserve the next action
- **Question:** How does the user distinguish renderer failure, a failed turn and missing worktree data?
- **Their mechanism:** The renderer error boundary presents an unexpected-error explanation, reload action and diagnostic text. Transcript notices render errors differently from informational notices, and the turn-status row separately labels failure and interruption. A missing-worktree screen says the record still exists, displays the path and offers refresh/navigation plus an explicit deletion intent; an orphaned-file banner distinguishes deleted-on-disk from deleted-with-unsaved-changes. Metatron can use the same small explanatory pattern—failed layer, known facts, affected task/session and safe next action—alongside its durable request history. A temporary toast or application reload should not stand in for task recovery.
- **Evidence:** `apps/desktop/src/renderer/components/RendererErrorBoundary/RendererErrorBoundary.tsx:50`, `apps/desktop/src/renderer/components/RendererErrorBoundary/RendererErrorBoundary.tsx:82`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/NoticeRow/NoticeRow.tsx:4`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/TurnGroupSection/components/TurnStatusRow/TurnStatusRow.tsx:10`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx:37`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx:65`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/OrphanedBanner/OrphanedBanner.tsx:8`.
- **What metatron does today:** one-glance next actions and replayable events are required (`spec.md:520`, `spec.md:532`); Needs You evidence/history is checked (`todo.md:119`); visible restart/conflict/credit failures remain an M9 gate (`todo.md:166`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M9)
- **Cost if adopted:** 4–8 hours for concise domain-aware failure text and safe navigation/recheck actions; touches non-destructive Git and no ambiguous rerun (`AGENTS.md:98`, `AGENTS.md:99`).
- **Unverified:** UNVERIFIED: Superset’s missing-worktree screen also exposes every still-running process, or refresh/reload is sufficient recovery. No automatic worktree deletion or renderer-triggered task replay is proposed.

### Finding 10 — Do not import a commercial workbench to solve attention
- **Question:** Which superficially relevant surfaces should metatron avoid?
- **Their mechanism:** DesktopNotices is a version-notice gate: blocking notices replace the app with an update page and softer notices become modals, backed by a version endpoint. It is not evidence of an agent blocker inbox; likewise the sidebar’s blocked-drag notice concerns sort/filter restrictions. The pane plans propose multiple workbench roots, cross-root dragging and advanced docking, and the review-tab plan targets remote pull-request checks/comments with an unchecked implementation checklist. Those plans explain Superset’s product scope, not correctness requirements for a single-user orchestration status surface. Avoid those product-scale systems, account-switch/restart UX and service-reporting machinery; a compact task detail, runtime status and existing Needs You inbox meet the relevant metatron requirements.
- **Evidence:** `apps/desktop/src/renderer/components/DesktopNotices/DesktopNotices.tsx:29`, `apps/desktop/src/renderer/hooks/useDesktopNotices/useDesktopNotices.ts:59`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/hooks/useBlockedDragNotice/useBlockedDragNotice.ts:8`, `apps/desktop/plans/20260322-2305-pane-layout-api-and-test-plan.md:19`, `apps/desktop/plans/20260413-1600-v2-review-tab.md:10`, `apps/desktop/plans/20260413-1600-v2-review-tab.md:33`, `apps/desktop/src/renderer/routes/_authenticated/settings/usage/components/UsageView/components/RestartSessionsDialog/RestartSessionsDialog.tsx:31`, `apps/desktop/src/lib/trpc/index.ts:49`.
- **What metatron does today:** minimal screens and a narrow sidebar/tab navigation are explicit (`spec.md:520`, `spec.md:525`, `spec.md:528`, `spec.md:532`); local reviewed integration remains the M9 goal (`todo.md:173`).
- **Gap or confirmation:** conflict
- **Verdict:** reject + reason: product-scale complexity outside M2/M6/M9’s simple local state surface. Do not propose cloud, mobile, relay, marketing, telemetry, or PR/remote-repository architecture.
- **Cost if adopted:** estimated multiple days for docking or version-notice infrastructure, with no necessary beta benefit; app-wide blocker gating could violate affected-task-only suspension (`AGENTS.md:100`). Rejection costs no implementation time.
- **Unverified:** UNVERIFIED: shipped review-tab parity from this plan alone; its unchecked checklist cannot establish implementation. No repository-wide claim that a unified blocker inbox is absent.

Validation: cited paths and line numbers resolve; requested-path existence checked against HEAD; reference status clean. Documentation-only session: no milestone checkboxes changed, no ADR created, and no cost-bearing live tests run. Next development item remains M6 stop controls (`todo.md:124`); resume separately with “Implement M6 item 7 only” and baseline `mise x -- pnpm test`.

## Five-line summary
1. Keep backend task outcomes, process/session health and unread attention separate; never infer completion from idle/exited (§7.1; `spec.md:359`, `spec.md:361`; Finding 1).
2. Derive attention from authoritative events and retain permission/failure evidence until resolved (Findings 2–3; `packages/shared/src/agent-status.ts:22`).
3. Show auth/quota unknowns explicitly; exhausted-run lifecycle coverage remains UNVERIFIED (Finding 4; `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AccountUsage/utils/getAccountUsageState/getAccountUsageState.ts:47`).
4. Preserve workspace identity and validate domain commands; direct renderer layout writes are a separate UI concern (Findings 6–7; `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/useV2WorkspacePaneLayout.ts:40`).
5. Keep owner-controlled retry/stop and a compact Needs You surface; reject automatic task restart and commercial workbench complexity (Findings 5, 8–10; `AGENTS.md:99`, `spec.md:520`).

## Files read

Metatron (read only): `AGENTS.md`; `todo.md` M2/M6/M9; `spec.md` §§7/11 only; `docs/progress.md` tail; `docs/reference-recon/outputs/00-INDEX.md`. Codebase-memory skill: `/home/phagmaier/.codex/skills/codebase-memory/SKILL.md`.

The lists below distinguish targeted source/plan reading from broad automated scans. Superset paths are relative to the absolute reference root `/home/phagmaier/Code/superset/`. No live harness calls, tests, builds, installs or reference modifications were performed.

<details>
<summary>Targeted source and plan reads, including bounded skims (69 files)</summary>

- `LICENSE.md`
- `apps/desktop/plans/20260322-1545-v2-workspace-panes.md`
- `apps/desktop/plans/20260322-2305-pane-layout-api-and-test-plan.md`
- `apps/desktop/plans/20260322-2335-pane-layout-model-comparison.md`
- `apps/desktop/plans/20260413-1600-v2-review-tab.md`
- `apps/desktop/plans/done/20260417-fix-api-key-storage-slot.md`
- `apps/desktop/plans/done/20260510-host-service-recovery.md`
- `apps/desktop/plans/done/20260703-1507-derive-terminal-agent-status-from-host-binding.md`
- `apps/desktop/src/lib/trpc/index.ts`
- `apps/desktop/src/lib/trpc/routers/index.ts`
- `apps/desktop/src/lib/trpc/routers/pane-layout/pane-layout.ts`
- `apps/desktop/src/lib/trpc/routers/terminal/terminal.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/workspace-creation.ts`
- `apps/desktop/src/renderer/components/DesktopNotices/DesktopNotices.tsx`
- `apps/desktop/src/renderer/components/DesktopNotices/components/NoticeDialog/NoticeDialog.tsx`
- `apps/desktop/src/renderer/components/RendererErrorBoundary/RendererErrorBoundary.tsx`
- `apps/desktop/src/renderer/hooks/host-service/useHostUsageQuota/useHostUsageQuota.ts`
- `apps/desktop/src/renderer/hooks/host-service/useTerminalAgentBindings/useTerminalAgentBindings.ts`
- `apps/desktop/src/renderer/hooks/host-service/useTerminalAgentStatuses/deriveTerminalAgentStatus.ts`
- `apps/desktop/src/renderer/hooks/host-service/useTerminalAgentStatuses/useTerminalAgentStatuses.ts`
- `apps/desktop/src/renderer/hooks/host-service/useV2NotificationStatus/useV2NotificationStatus.ts`
- `apps/desktop/src/renderer/hooks/useDesktopNotices/useDesktopNotices.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/automations/components/RelayOfflineNotice/RelayOfflineNotice.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/hooks/useBlockedDragNotice/useBlockedDragNotice.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/tasks/components/TasksView/components/TasksBoardView/TasksBoardView.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/RightPaneArea/components/RightPaneEmptyState/RightPaneEmptyState.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/V2NotificationStatusIndicator/V2NotificationStatusIndicator.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceEmptyState/WorkspaceEmptyState.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AccountUsage/AccountUsage.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/AccountUsage/utils/getAccountUsageState/getAccountUsageState.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/AcpChatPane.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/components/AcpRecovery/AcpRecovery.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/ConnectionNotice/ConnectionNotice.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/SessionView/SessionView.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/ApprovalRow/ApprovalRow.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/ApprovalRow/components/OptionButtons/OptionButtons.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/NoticeRow/NoticeRow.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/TurnGroupSection/TurnGroupSection.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatSession/components/Transcript/components/TurnGroupSection/components/TurnStatusRow/TurnStatusRow.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/OrphanedBanner/OrphanedBanner.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/TerminalPane.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/index.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/usePaneRegistry.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/useV2WorkspacePaneLayout.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types.ts`
- `apps/desktop/src/renderer/routes/_authenticated/providers/CollectionsProvider/collections.ts`
- `apps/desktop/src/renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema.ts`
- `apps/desktop/src/renderer/routes/_authenticated/settings/usage/components/UsageView/UsageView.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/settings/usage/components/UsageView/components/RestartSessionsDialog/RestartSessionsDialog.tsx`
- `apps/desktop/src/renderer/routes/sign-in/hooks/useSessionRecovery/useSessionRecovery.ts`
- `apps/desktop/src/renderer/screens/main/components/StatusIndicator/StatusIndicator.tsx`
- `apps/desktop/src/renderer/stores/v2-notifications/store.ts`
- `apps/desktop/src/shared/tabs-types.ts`
- `packages/chat-runtime/src/commands/commands/commands.ts`
- `packages/chat-runtime/src/harness/acp/acpAdapter.ts`
- `packages/chat-runtime/src/router/router/router.ts`
- `packages/chat/src/protocol/commands.ts`
- `packages/chat/src/protocol/envelope.ts`
- `packages/db/src/schema/schema.ts`
- `packages/db/src/seed-default-statuses.ts`
- `packages/host-service/src/chat-v3/mount.ts`
- `packages/host-service/src/db/schema.ts`
- `packages/host-service/src/terminal-agents/persistence.ts`
- `packages/panes/src/types.ts`
- `packages/shared/src/agent-status.ts`
- `packages/trpc/src/lib/acp-chat.ts`
- `packages/trpc/src/router/admin/admin.ts`
- `packages/trpc/src/router/automation/automation.ts`

</details>

<details>
<summary>All usePaneRegistry files inventoried and content-scanned (783 files; targeted semantic reads are listed above)</summary>

Every entry below is relative to `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/` under the absolute Superset root. The scan covered each file, including tests and barrel exports; it does not establish exhaustive runtime behavior.

```text
components/AccountUsage/AccountUsage.tsx
components/AccountUsage/components/UsageProgressRing/UsageProgressRing.tsx
components/AccountUsage/components/UsageProgressRing/index.ts
components/AccountUsage/index.ts
components/AccountUsage/utils/getAccountUsageState/getAccountUsageState.test.ts
components/AccountUsage/utils/getAccountUsageState/getAccountUsageState.ts
components/AccountUsage/utils/getAccountUsageState/index.ts
components/AgentCommentComposer/AgentCommentComposer.tsx
components/AgentCommentComposer/index.ts
components/AgentTerminalPane/AgentTerminalPane.tsx
components/AgentTerminalPane/components/AgentSurfaceToggle/AgentSurfaceToggle.tsx
components/AgentTerminalPane/components/AgentSurfaceToggle/index.ts
components/AgentTerminalPane/hooks/useAgentSurface/index.ts
components/AgentTerminalPane/hooks/useAgentSurface/useAgentSurface.ts
components/AgentTerminalPane/hooks/useAgentSurfaceSwitch/index.ts
components/AgentTerminalPane/hooks/useAgentSurfaceSwitch/useAgentSurfaceSwitch.ts
components/AgentTerminalPane/index.ts
components/BrowserPane/BrowserPane.tsx
components/BrowserPane/browserRuntimeRegistry.test.ts
components/BrowserPane/browserRuntimeRegistry.ts
components/BrowserPane/components/BrowserErrorOverlay/BrowserErrorOverlay.tsx
components/BrowserPane/components/BrowserErrorOverlay/index.ts
components/BrowserPane/components/BrowserFindBar/BrowserFindBar.tsx
components/BrowserPane/components/BrowserFindBar/index.ts
components/BrowserPane/components/BrowserOverflowMenu/BrowserOverflowMenu.tsx
components/BrowserPane/components/BrowserOverflowMenu/index.ts
components/BrowserPane/components/BrowserPaneToolbar/BrowserPaneToolbar.tsx
components/BrowserPane/components/BrowserPaneToolbar/index.ts
components/BrowserPane/components/BrowserPaneToolbar/utils/replaceBrowserPane/index.ts
components/BrowserPane/components/BrowserPaneToolbar/utils/replaceBrowserPane/replaceBrowserPane.test.ts
components/BrowserPane/components/BrowserPaneToolbar/utils/replaceBrowserPane/replaceBrowserPane.ts
components/BrowserPane/components/BrowserTabFavicon/BrowserTabFavicon.tsx
components/BrowserPane/components/BrowserTabFavicon/index.ts
components/BrowserPane/components/BrowserToolbar/BrowserToolbar.tsx
components/BrowserPane/components/BrowserToolbar/components/UrlSuggestions/UrlSuggestions.tsx
components/BrowserPane/components/BrowserToolbar/components/UrlSuggestions/index.ts
components/BrowserPane/components/BrowserToolbar/hooks/useUrlAutocomplete/index.ts
components/BrowserPane/components/BrowserToolbar/hooks/useUrlAutocomplete/useUrlAutocomplete.ts
components/BrowserPane/components/BrowserToolbar/index.ts
components/BrowserPane/components/ChromeImportBanner/ChromeImportBanner.tsx
components/BrowserPane/components/ChromeImportBanner/index.ts
components/BrowserPane/components/ClearBrowsingDataDialog/ClearBrowsingDataDialog.tsx
components/BrowserPane/components/ClearBrowsingDataDialog/index.ts
components/BrowserPane/components/DesignModePopover/DesignModePopover.tsx
components/BrowserPane/components/DesignModePopover/index.ts
components/BrowserPane/components/DeviceToolbar/DeviceToolbar.tsx
components/BrowserPane/components/DeviceToolbar/index.ts
components/BrowserPane/components/DownloadsDialog/DownloadsDialog.tsx
components/BrowserPane/components/DownloadsDialog/index.ts
components/BrowserPane/components/HistoryDialog/HistoryDialog.tsx
components/BrowserPane/components/HistoryDialog/index.ts
components/BrowserPane/components/ScreenshotsDialog/ScreenshotsDialog.tsx
components/BrowserPane/components/ScreenshotsDialog/index.ts
components/BrowserPane/components/SignedInSitesSubmenu/SignedInSitesSubmenu.tsx
components/BrowserPane/components/SignedInSitesSubmenu/index.ts
components/BrowserPane/constants.ts
components/BrowserPane/designModePrompt.test.ts
components/BrowserPane/designModePrompt.ts
components/BrowserPane/designModeStore.ts
components/BrowserPane/deviceToolbarStore.ts
components/BrowserPane/findBarStore.ts
components/BrowserPane/hooks/useBrowserState/index.ts
components/BrowserPane/hooks/useBrowserState/useBrowserState.ts
components/BrowserPane/hooks/usePersistentWebview/index.ts
components/BrowserPane/hooks/usePersistentWebview/usePersistentWebview.ts
components/BrowserPane/index.ts
components/BrowserPane/sanitizeUrl.test.ts
components/BrowserPane/sanitizeUrl.ts
components/BrowserPane/writeDesignModeAttachments.ts
components/ChangesListPane/ChangesListPane.tsx
components/ChangesListPane/index.ts
components/ChatPane/ChatPane.tsx
components/ChatPane/components/AcpChatPane/AcpChatPane.tsx
components/ChatPane/components/AcpChatPane/components/AcpRecovery/AcpRecovery.tsx
components/ChatPane/components/AcpChatPane/components/AcpRecovery/index.ts
components/ChatPane/components/AcpChatPane/components/DraftChat/DraftChat.tsx
components/ChatPane/components/AcpChatPane/components/DraftChat/index.ts
components/ChatPane/components/AcpChatPane/index.ts
components/ChatPane/components/AcpChatPane/utils/createWhenReachable/createWhenReachable.test.ts
components/ChatPane/components/AcpChatPane/utils/createWhenReachable/createWhenReachable.ts
components/ChatPane/components/AcpChatPane/utils/createWhenReachable/index.ts
components/ChatPane/components/AcpChatPane/utils/sharedChatCreate/index.ts
components/ChatPane/components/AcpChatPane/utils/sharedChatCreate/sharedChatCreate.test.ts
components/ChatPane/components/AcpChatPane/utils/sharedChatCreate/sharedChatCreate.ts
components/ChatPane/hooks/useForkChat/index.ts
components/ChatPane/hooks/useForkChat/useForkChat.ts
components/ChatPane/hooks/useOpenChatLink/index.ts
components/ChatPane/hooks/useOpenChatLink/useOpenChatLink.ts
components/ChatPane/hooks/useOpenChatLink/utils/locatePath/index.ts
components/ChatPane/hooks/useOpenChatLink/utils/locatePath/locatePath.test.ts
components/ChatPane/hooks/useOpenChatLink/utils/locatePath/locatePath.ts
components/ChatPane/hooks/useOpenChatLink/utils/parseFileHref/index.ts
components/ChatPane/hooks/useOpenChatLink/utils/parseFileHref/parseFileHref.test.ts
components/ChatPane/hooks/useOpenChatLink/utils/parseFileHref/parseFileHref.ts
components/ChatPane/hooks/useOpenChatPage/index.ts
components/ChatPane/hooks/useOpenChatPage/useOpenChatPage.ts
components/ChatPane/index.ts
components/ChatPane/utils/savedChatMode/index.ts
components/ChatPane/utils/savedChatMode/savedChatMode.test.ts
components/ChatPane/utils/savedChatMode/savedChatMode.ts
components/ChatSession/components/ChatCodeBlock/ChatCodeBlock.test.tsx
components/ChatSession/components/ChatCodeBlock/ChatCodeBlock.tsx
components/ChatSession/components/ChatCodeBlock/components/FenceFilePath/FenceFilePath.tsx
components/ChatSession/components/ChatCodeBlock/components/FenceFilePath/index.ts
components/ChatSession/components/ChatCodeBlock/components/FenceLanguage/FenceLanguage.tsx
components/ChatSession/components/ChatCodeBlock/components/FenceLanguage/index.ts
components/ChatSession/components/ChatCodeBlock/components/WrapLinesButton/WrapLinesButton.tsx
components/ChatSession/components/ChatCodeBlock/components/WrapLinesButton/index.ts
components/ChatSession/components/ChatCodeBlock/constants.ts
components/ChatSession/components/ChatCodeBlock/index.ts
components/ChatSession/components/ChatCodeBlock/utils/fencedCode/fencedCode.test.ts
components/ChatSession/components/ChatCodeBlock/utils/fencedCode/fencedCode.ts
components/ChatSession/components/ChatCodeBlock/utils/fencedCode/index.ts
components/ChatSession/components/ChatCodeBlock/utils/languageDisplay/index.ts
components/ChatSession/components/ChatCodeBlock/utils/languageDisplay/languageDisplay.test.ts
components/ChatSession/components/ChatCodeBlock/utils/languageDisplay/languageDisplay.ts
components/ChatSession/components/ChatInlineCode/ChatInlineCode.test.tsx
components/ChatSession/components/ChatInlineCode/ChatInlineCode.tsx
components/ChatSession/components/ChatInlineCode/index.ts
components/ChatSession/components/ChatLink/ChatLink.tsx
components/ChatSession/components/ChatLink/components/LinkUnfurlIcon/LinkUnfurlIcon.tsx
components/ChatSession/components/ChatLink/components/LinkUnfurlIcon/index.ts
components/ChatSession/components/ChatLink/index.ts
components/ChatSession/components/Composer/Composer.tsx
components/ChatSession/components/Composer/components/ModePicker/ModePicker.tsx
components/ChatSession/components/Composer/components/ModePicker/index.ts
components/ChatSession/components/Composer/components/ModelPicker/ModelPicker.tsx
components/ChatSession/components/Composer/components/ModelPicker/components/EffortSliderCard/EffortSliderCard.tsx
components/ChatSession/components/Composer/components/ModelPicker/components/EffortSliderCard/index.ts
components/ChatSession/components/Composer/components/ModelPicker/components/ModelPanel/ModelPanel.tsx
components/ChatSession/components/Composer/components/ModelPicker/components/ModelPanel/index.ts
components/ChatSession/components/Composer/components/ModelPicker/hooks/useFavoriteModels/index.ts
components/ChatSession/components/Composer/components/ModelPicker/hooks/useFavoriteModels/useFavoriteModels.test.ts
components/ChatSession/components/Composer/components/ModelPicker/hooks/useFavoriteModels/useFavoriteModels.ts
components/ChatSession/components/Composer/components/ModelPicker/index.ts
components/ChatSession/components/Composer/components/ModelPicker/types.ts
components/ChatSession/components/Composer/components/QueuedPrompts/QueuedPrompts.tsx
components/ChatSession/components/Composer/components/QueuedPrompts/components/QueuePausedBar/QueuePausedBar.tsx
components/ChatSession/components/Composer/components/QueuedPrompts/components/QueuePausedBar/index.ts
components/ChatSession/components/Composer/components/QueuedPrompts/components/QueuedPromptRow/QueuedPromptRow.tsx
components/ChatSession/components/Composer/components/QueuedPrompts/components/QueuedPromptRow/index.ts
components/ChatSession/components/Composer/components/QueuedPrompts/index.ts
components/ChatSession/components/Composer/constants.ts
components/ChatSession/components/Composer/hooks/useAttachmentPreview/index.ts
components/ChatSession/components/Composer/hooks/useAttachmentPreview/useAttachmentPreview.test.tsx
components/ChatSession/components/Composer/hooks/useAttachmentPreview/useAttachmentPreview.tsx
components/ChatSession/components/Composer/hooks/useComposerDraft/index.ts
components/ChatSession/components/Composer/hooks/useComposerDraft/useComposerDraft.test.tsx
components/ChatSession/components/Composer/hooks/useComposerDraft/useComposerDraft.ts
components/ChatSession/components/Composer/hooks/useFooterTier/index.ts
components/ChatSession/components/Composer/hooks/useFooterTier/useFooterTier.ts
components/ChatSession/components/Composer/hooks/useFooterTier/utils/nextFooterTier/index.ts
components/ChatSession/components/Composer/hooks/useFooterTier/utils/nextFooterTier/nextFooterTier.test.ts
components/ChatSession/components/Composer/hooks/useFooterTier/utils/nextFooterTier/nextFooterTier.ts
components/ChatSession/components/Composer/hooks/useOptimisticSelections/index.ts
components/ChatSession/components/Composer/hooks/useOptimisticSelections/useOptimisticSelections.test.tsx
components/ChatSession/components/Composer/hooks/useOptimisticSelections/useOptimisticSelections.ts
components/ChatSession/components/Composer/hooks/useQueueActions/index.ts
components/ChatSession/components/Composer/hooks/useQueueActions/useQueueActions.ts
components/ChatSession/components/Composer/hooks/useUploadAttachments/index.ts
components/ChatSession/components/Composer/hooks/useUploadAttachments/useUploadAttachments.ts
components/ChatSession/components/Composer/index.ts
components/ChatSession/components/ConnectionNotice/ConnectionNotice.tsx
components/ChatSession/components/ConnectionNotice/index.ts
components/ChatSession/components/CopyButton/CopyButton.tsx
components/ChatSession/components/CopyButton/index.ts
components/ChatSession/components/MarkdownView/MarkdownView.test.tsx
components/ChatSession/components/MarkdownView/MarkdownView.tsx
components/ChatSession/components/MarkdownView/index.ts
components/ChatSession/components/MarkdownView/utils/pageLinksByBlock/index.ts
components/ChatSession/components/MarkdownView/utils/pageLinksByBlock/pageLinksByBlock.test.ts
components/ChatSession/components/MarkdownView/utils/pageLinksByBlock/pageLinksByBlock.ts
components/ChatSession/components/MarkdownView/utils/planMarkdown/index.ts
components/ChatSession/components/MarkdownView/utils/planMarkdown/planMarkdown.test.ts
components/ChatSession/components/MarkdownView/utils/planMarkdown/planMarkdown.ts
components/ChatSession/components/PageLinkCard/PageLinkCard.test.tsx
components/ChatSession/components/PageLinkCard/PageLinkCard.tsx
components/ChatSession/components/PageLinkCard/components/ChatPageCard/ChatPageCard.test.tsx
components/ChatSession/components/PageLinkCard/components/ChatPageCard/ChatPageCard.tsx
components/ChatSession/components/PageLinkCard/components/ChatPageCard/index.ts
components/ChatSession/components/PageLinkCard/index.ts
components/ChatSession/components/SessionHeader/SessionHeader.tsx
components/ChatSession/components/SessionHeader/index.ts
components/ChatSession/components/SessionView/SessionView.tsx
components/ChatSession/components/SessionView/hooks/useStableList/index.ts
components/ChatSession/components/SessionView/hooks/useStableList/useStableList.test.ts
components/ChatSession/components/SessionView/hooks/useStableList/useStableList.ts
components/ChatSession/components/SessionView/index.ts
components/ChatSession/components/Transcript/Transcript.tsx
components/ChatSession/components/Transcript/components/AgentMessageRow/AgentMessageRow.tsx
components/ChatSession/components/Transcript/components/AgentMessageRow/hooks/useBlockFading/index.ts
components/ChatSession/components/Transcript/components/AgentMessageRow/hooks/useBlockFading/useBlockFading.ts
components/ChatSession/components/Transcript/components/AgentMessageRow/hooks/usePacedText/index.ts
components/ChatSession/components/Transcript/components/AgentMessageRow/hooks/usePacedText/usePacedText.ts
components/ChatSession/components/Transcript/components/AgentMessageRow/index.ts
components/ChatSession/components/Transcript/components/AgentMessageRow/utils/revealEnd/index.ts
components/ChatSession/components/Transcript/components/AgentMessageRow/utils/revealEnd/revealEnd.test.ts
components/ChatSession/components/Transcript/components/AgentMessageRow/utils/revealEnd/revealEnd.ts
components/ChatSession/components/Transcript/components/ApprovalRow/ApprovalRow.tsx
components/ChatSession/components/Transcript/components/ApprovalRow/components/OptionButtons/OptionButtons.tsx
components/ChatSession/components/Transcript/components/ApprovalRow/components/OptionButtons/index.ts
components/ChatSession/components/Transcript/components/ApprovalRow/components/QuestionForm/QuestionForm.tsx
components/ChatSession/components/Transcript/components/ApprovalRow/components/QuestionForm/components/QuestionPage/QuestionPage.tsx
components/ChatSession/components/Transcript/components/ApprovalRow/components/QuestionForm/components/QuestionPage/index.ts
components/ChatSession/components/Transcript/components/ApprovalRow/components/QuestionForm/index.ts
components/ChatSession/components/Transcript/components/ApprovalRow/components/QuestionForm/utils/questionPages/index.ts
components/ChatSession/components/Transcript/components/ApprovalRow/components/QuestionForm/utils/questionPages/questionPages.test.ts
components/ChatSession/components/Transcript/components/ApprovalRow/components/QuestionForm/utils/questionPages/questionPages.ts
components/ChatSession/components/Transcript/components/ApprovalRow/index.ts
components/ChatSession/components/Transcript/components/ApprovalRow/utils/optionRole/index.ts
components/ChatSession/components/Transcript/components/ApprovalRow/utils/optionRole/optionRole.test.ts
components/ChatSession/components/Transcript/components/ApprovalRow/utils/optionRole/optionRole.ts
components/ChatSession/components/Transcript/components/AttachmentImage/AttachmentImage.test.tsx
components/ChatSession/components/Transcript/components/AttachmentImage/AttachmentImage.tsx
components/ChatSession/components/Transcript/components/AttachmentImage/components/LargeImageTile/LargeImageTile.tsx
components/ChatSession/components/Transcript/components/AttachmentImage/components/LargeImageTile/index.ts
components/ChatSession/components/Transcript/components/AttachmentImage/components/PreviewableImage/PreviewableImage.test.tsx
components/ChatSession/components/Transcript/components/AttachmentImage/components/PreviewableImage/PreviewableImage.tsx
components/ChatSession/components/Transcript/components/AttachmentImage/components/PreviewableImage/index.ts
components/ChatSession/components/Transcript/components/AttachmentImage/index.ts
components/ChatSession/components/Transcript/components/AttachmentRail/AttachmentRail.test.tsx
components/ChatSession/components/Transcript/components/AttachmentRail/AttachmentRail.tsx
components/ChatSession/components/Transcript/components/AttachmentRail/index.ts
components/ChatSession/components/Transcript/components/MessageTime/MessageTime.tsx
components/ChatSession/components/Transcript/components/MessageTime/index.ts
components/ChatSession/components/Transcript/components/NoticeRow/NoticeRow.tsx
components/ChatSession/components/Transcript/components/NoticeRow/index.ts
components/ChatSession/components/Transcript/components/PlanRow/PlanRow.tsx
components/ChatSession/components/Transcript/components/PlanRow/index.ts
components/ChatSession/components/Transcript/components/ReasoningRow/ReasoningRow.tsx
components/ChatSession/components/Transcript/components/ReasoningRow/index.ts
components/ChatSession/components/Transcript/components/ReasoningRow/utils/thoughtSummary/index.ts
components/ChatSession/components/Transcript/components/ReasoningRow/utils/thoughtSummary/thoughtSummary.test.ts
components/ChatSession/components/Transcript/components/ReasoningRow/utils/thoughtSummary/thoughtSummary.ts
components/ChatSession/components/Transcript/components/ToolCallRow/ToolCallRow.tsx
components/ChatSession/components/Transcript/components/ToolCallRow/components/FileChangePreview/FileChangePreview.test.tsx
components/ChatSession/components/Transcript/components/ToolCallRow/components/FileChangePreview/FileChangePreview.tsx
components/ChatSession/components/Transcript/components/ToolCallRow/components/FileChangePreview/index.ts
components/ChatSession/components/Transcript/components/ToolCallRow/components/FileChangeTitle/FileChangeTitle.test.tsx
components/ChatSession/components/Transcript/components/ToolCallRow/components/FileChangeTitle/FileChangeTitle.tsx
components/ChatSession/components/Transcript/components/ToolCallRow/components/FileChangeTitle/index.ts
components/ChatSession/components/Transcript/components/ToolCallRow/components/StatusWord/StatusWord.tsx
components/ChatSession/components/Transcript/components/ToolCallRow/components/StatusWord/index.ts
components/ChatSession/components/Transcript/components/ToolCallRow/index.ts
components/ChatSession/components/Transcript/components/ToolContentList/ToolContentList.tsx
components/ChatSession/components/Transcript/components/ToolContentList/components/DetailScroll/DetailScroll.tsx
components/ChatSession/components/Transcript/components/ToolContentList/components/DetailScroll/hooks/useScrollOverflowState/index.ts
components/ChatSession/components/Transcript/components/ToolContentList/components/DetailScroll/hooks/useScrollOverflowState/useScrollOverflowState.ts
components/ChatSession/components/Transcript/components/ToolContentList/components/DetailScroll/hooks/useStickyBottomScroll/index.ts
components/ChatSession/components/Transcript/components/ToolContentList/components/DetailScroll/hooks/useStickyBottomScroll/useStickyBottomScroll.ts
components/ChatSession/components/Transcript/components/ToolContentList/components/DetailScroll/index.ts
components/ChatSession/components/Transcript/components/ToolContentList/components/DiffContent/DiffContent.tsx
components/ChatSession/components/Transcript/components/ToolContentList/components/DiffContent/components/DiffCardHeader/DiffCardHeader.tsx
components/ChatSession/components/Transcript/components/ToolContentList/components/DiffContent/components/DiffCardHeader/index.ts
components/ChatSession/components/Transcript/components/ToolContentList/components/DiffContent/index.ts
components/ChatSession/components/Transcript/components/ToolContentList/components/TerminalContent/TerminalContent.tsx
components/ChatSession/components/Transcript/components/ToolContentList/components/TerminalContent/index.ts
components/ChatSession/components/Transcript/components/ToolContentList/components/TextContent/TextContent.tsx
components/ChatSession/components/Transcript/components/ToolContentList/components/TextContent/index.ts
components/ChatSession/components/Transcript/components/ToolContentList/index.ts
components/ChatSession/components/Transcript/components/TranscriptFindBar/TranscriptFindBar.test.tsx
components/ChatSession/components/Transcript/components/TranscriptFindBar/TranscriptFindBar.tsx
components/ChatSession/components/Transcript/components/TranscriptFindBar/components/FindButton/FindButton.tsx
components/ChatSession/components/Transcript/components/TranscriptFindBar/components/FindButton/index.ts
components/ChatSession/components/Transcript/components/TranscriptFindBar/index.ts
components/ChatSession/components/Transcript/components/TranscriptRowItem/TranscriptRowItem.tsx
components/ChatSession/components/Transcript/components/TranscriptRowItem/index.ts
components/ChatSession/components/Transcript/components/TruncateStart/TruncateStart.tsx
components/ChatSession/components/Transcript/components/TruncateStart/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/TurnGroupSection.tsx
components/ChatSession/components/Transcript/components/TurnGroupSection/components/ItemRow/ItemRow.tsx
components/ChatSession/components/Transcript/components/TurnGroupSection/components/ItemRow/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/components/RailStep/RailStep.tsx
components/ChatSession/components/Transcript/components/TurnGroupSection/components/RailStep/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/components/ToolRunRow/ToolRunRow.tsx
components/ChatSession/components/Transcript/components/TurnGroupSection/components/ToolRunRow/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/components/ToolRunRow/utils/dominantKind/dominantKind.test.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/components/ToolRunRow/utils/dominantKind/dominantKind.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/components/ToolRunRow/utils/dominantKind/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/components/ToolRunRow/utils/stepSummary/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/components/ToolRunRow/utils/stepSummary/stepSummary.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/components/TurnStatusRow/TurnStatusRow.tsx
components/ChatSession/components/Transcript/components/TurnGroupSection/components/TurnStatusRow/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/components/WorkingFor/WorkingFor.tsx
components/ChatSession/components/Transcript/components/TurnGroupSection/components/WorkingFor/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/utils/stepCounts/index.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/utils/stepCounts/stepCounts.test.ts
components/ChatSession/components/Transcript/components/TurnGroupSection/utils/stepCounts/stepCounts.ts
components/ChatSession/components/Transcript/components/UnknownItemRow/UnknownItemRow.tsx
components/ChatSession/components/Transcript/components/UnknownItemRow/index.ts
components/ChatSession/components/Transcript/components/UserMessageRow/UserMessageRow.test.tsx
components/ChatSession/components/Transcript/components/UserMessageRow/UserMessageRow.tsx
components/ChatSession/components/Transcript/components/UserMessageRow/components/PastedTextBlock/PastedTextBlock.tsx
components/ChatSession/components/Transcript/components/UserMessageRow/components/PastedTextBlock/index.ts
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/UserMessageText.test.tsx
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/UserMessageText.tsx
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/components/GithubWorkItemChip/GithubWorkItemChip.test.tsx
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/components/GithubWorkItemChip/GithubWorkItemChip.tsx
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/components/GithubWorkItemChip/components/GithubWorkItemCard/GithubWorkItemCard.tsx
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/components/GithubWorkItemChip/components/GithubWorkItemCard/index.ts
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/components/GithubWorkItemChip/index.ts
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/components/LinkPreviewChip/LinkPreviewChip.tsx
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/components/LinkPreviewChip/index.ts
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/index.ts
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/utils/textLinks/index.ts
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/utils/textLinks/textLinks.test.ts
components/ChatSession/components/Transcript/components/UserMessageRow/components/UserMessageText/utils/textLinks/textLinks.ts
components/ChatSession/components/Transcript/components/UserMessageRow/hooks/useFitsOneLine/index.ts
components/ChatSession/components/Transcript/components/UserMessageRow/hooks/useFitsOneLine/useFitsOneLine.ts
components/ChatSession/components/Transcript/components/UserMessageRow/index.ts
components/ChatSession/components/Transcript/hooks/useChatImageSource/index.ts
components/ChatSession/components/Transcript/hooks/useChatImageSource/useChatImageSource.ts
components/ChatSession/components/Transcript/hooks/useLoadOlderOnReach/index.ts
components/ChatSession/components/Transcript/hooks/useLoadOlderOnReach/useLoadOlderOnReach.ts
components/ChatSession/components/Transcript/hooks/useNearRows/index.ts
components/ChatSession/components/Transcript/hooks/useNearRows/useNearRows.ts
components/ChatSession/components/Transcript/hooks/useScrollAnchorKey/index.ts
components/ChatSession/components/Transcript/hooks/useScrollAnchorKey/useScrollAnchorKey.test.ts
components/ChatSession/components/Transcript/hooks/useScrollAnchorKey/useScrollAnchorKey.ts
components/ChatSession/components/Transcript/hooks/useScrollbarGutter/index.ts
components/ChatSession/components/Transcript/hooks/useScrollbarGutter/useScrollbarGutter.ts
components/ChatSession/components/Transcript/hooks/useTranscriptFind/hooks/useThrottledValue/index.ts
components/ChatSession/components/Transcript/hooks/useTranscriptFind/hooks/useThrottledValue/useThrottledValue.ts
components/ChatSession/components/Transcript/hooks/useTranscriptFind/index.ts
components/ChatSession/components/Transcript/hooks/useTranscriptFind/useTranscriptFind.test.tsx
components/ChatSession/components/Transcript/hooks/useTranscriptFind/useTranscriptFind.ts
components/ChatSession/components/Transcript/index.ts
components/ChatSession/components/Transcript/providers/ChatImageGalleryProvider/ChatImageGalleryProvider.test.tsx
components/ChatSession/components/Transcript/providers/ChatImageGalleryProvider/ChatImageGalleryProvider.tsx
components/ChatSession/components/Transcript/providers/ChatImageGalleryProvider/components/ChatImageGalleryOverlay/ChatImageGalleryOverlay.tsx
components/ChatSession/components/Transcript/providers/ChatImageGalleryProvider/components/ChatImageGalleryOverlay/components/PrefetchChatImage/PrefetchChatImage.tsx
components/ChatSession/components/Transcript/providers/ChatImageGalleryProvider/components/ChatImageGalleryOverlay/components/PrefetchChatImage/index.ts
components/ChatSession/components/Transcript/providers/ChatImageGalleryProvider/components/ChatImageGalleryOverlay/index.ts
components/ChatSession/components/Transcript/providers/ChatImageGalleryProvider/index.ts
components/ChatSession/components/Transcript/utils/copySourceText/copySourceText.ts
components/ChatSession/components/Transcript/utils/copySourceText/index.ts
components/ChatSession/components/Transcript/utils/diffPreview/diffPreview.test.ts
components/ChatSession/components/Transcript/utils/diffPreview/diffPreview.ts
components/ChatSession/components/Transcript/utils/diffPreview/index.ts
components/ChatSession/components/Transcript/utils/diffStats/diffStats.ts
components/ChatSession/components/Transcript/utils/diffStats/index.ts
components/ChatSession/components/Transcript/utils/fileChange/fileChange.test.ts
components/ChatSession/components/Transcript/utils/fileChange/fileChange.ts
components/ChatSession/components/Transcript/utils/fileChange/index.ts
components/ChatSession/components/Transcript/utils/galleryImages/galleryImages.test.ts
components/ChatSession/components/Transcript/utils/galleryImages/galleryImages.ts
components/ChatSession/components/Transcript/utils/galleryImages/index.ts
components/ChatSession/components/Transcript/utils/lastReplyKeys/index.ts
components/ChatSession/components/Transcript/utils/lastReplyKeys/lastReplyKeys.test.ts
components/ChatSession/components/Transcript/utils/lastReplyKeys/lastReplyKeys.ts
components/ChatSession/components/Transcript/utils/rowKind/index.ts
components/ChatSession/components/Transcript/utils/rowKind/rowKind.test.ts
components/ChatSession/components/Transcript/utils/rowKind/rowKind.ts
components/ChatSession/components/Transcript/utils/textMatches/index.ts
components/ChatSession/components/Transcript/utils/textMatches/textMatches.ts
components/ChatSession/components/Transcript/utils/toolKindIcon/index.ts
components/ChatSession/components/Transcript/utils/toolKindIcon/toolKindIcon.ts
components/ChatSession/components/Transcript/utils/toolTitle/index.ts
components/ChatSession/components/Transcript/utils/toolTitle/toolTitle.test.ts
components/ChatSession/components/Transcript/utils/toolTitle/toolTitle.ts
components/ChatSession/components/Transcript/utils/transcriptFind/index.ts
components/ChatSession/components/Transcript/utils/transcriptFind/transcriptFind.test.ts
components/ChatSession/components/Transcript/utils/transcriptFind/transcriptFind.ts
components/ChatSession/components/Transcript/utils/transcriptFind/utils/markdownText/index.ts
components/ChatSession/components/Transcript/utils/transcriptFind/utils/markdownText/markdownText.test.ts
components/ChatSession/components/Transcript/utils/transcriptFind/utils/markdownText/markdownText.ts
components/ChatSession/components/Transcript/utils/transcriptHighlights/index.ts
components/ChatSession/components/Transcript/utils/transcriptHighlights/transcriptHighlights.test.ts
components/ChatSession/components/Transcript/utils/transcriptHighlights/transcriptHighlights.ts
components/ChatSession/components/Transcript/utils/transcriptRows/index.ts
components/ChatSession/components/Transcript/utils/transcriptRows/transcriptRows.test.ts
components/ChatSession/components/Transcript/utils/transcriptRows/transcriptRows.ts
components/ChatSession/components/Transcript/utils/turnPageLinks/index.ts
components/ChatSession/components/Transcript/utils/turnPageLinks/turnPageLinks.test.ts
components/ChatSession/components/Transcript/utils/turnPageLinks/turnPageLinks.ts
components/ChatSession/constants.ts
components/ChatSession/hooks/useSessionClient/index.ts
components/ChatSession/hooks/useSessionClient/useSessionClient.ts
components/ChatSession/providers/ChatLinkProvider/ChatLinkProvider.tsx
components/ChatSession/providers/ChatLinkProvider/index.ts
components/ChatSession/providers/ChatPaneActionsProvider/ChatPaneActionsProvider.tsx
components/ChatSession/providers/ChatPaneActionsProvider/index.ts
components/ChatSession/types.ts
components/ChatSession/utils/attachmentTags/attachmentTags.test.ts
components/ChatSession/utils/attachmentTags/attachmentTags.ts
components/ChatSession/utils/attachmentTags/index.ts
components/ChatSession/utils/chatHandoffTranscript/chatHandoffTranscript.test.ts
components/ChatSession/utils/chatHandoffTranscript/chatHandoffTranscript.ts
components/ChatSession/utils/chatHandoffTranscript/index.ts
components/ChatSession/utils/commandChip/commandChip.test.ts
components/ChatSession/utils/commandChip/commandChip.ts
components/ChatSession/utils/commandChip/index.ts
components/ChatSession/utils/githubWorkItem/githubWorkItem.test.ts
components/ChatSession/utils/githubWorkItem/githubWorkItem.ts
components/ChatSession/utils/githubWorkItem/index.ts
components/ChatSession/utils/heldPromptQueue/heldPromptQueue.ts
components/ChatSession/utils/heldPromptQueue/index.ts
components/ChatSession/utils/isUnrestrictedMode/index.ts
components/ChatSession/utils/isUnrestrictedMode/isUnrestrictedMode.ts
components/ChatSession/utils/linkUnfurl/index.ts
components/ChatSession/utils/linkUnfurl/linkUnfurl.test.ts
components/ChatSession/utils/linkUnfurl/linkUnfurl.ts
components/ChatSession/utils/messageElements/index.ts
components/ChatSession/utils/messageElements/messageElements.test.ts
components/ChatSession/utils/messageElements/messageElements.ts
components/ChatSession/utils/pageLinks/index.ts
components/ChatSession/utils/pageLinks/pageLinks.test.ts
components/ChatSession/utils/pageLinks/pageLinks.ts
components/ChatSession/utils/pathText/index.ts
components/ChatSession/utils/pathText/pathText.test.ts
components/ChatSession/utils/pathText/pathText.ts
components/ChatSession/utils/promptHistory/index.ts
components/ChatSession/utils/promptHistory/promptHistory.test.ts
components/ChatSession/utils/promptHistory/promptHistory.ts
components/ChatSession/utils/railMessages/index.ts
components/ChatSession/utils/railMessages/railMessages.ts
components/ChatSession/utils/remarkLocalPathLinks/index.ts
components/ChatSession/utils/remarkLocalPathLinks/remarkLocalPathLinks.test.tsx
components/ChatSession/utils/remarkLocalPathLinks/remarkLocalPathLinks.ts
components/ChatSession/utils/supersetAppLink/index.ts
components/ChatSession/utils/supersetAppLink/supersetAppLink.test.ts
components/ChatSession/utils/supersetAppLink/supersetAppLink.ts
components/CommentPane/CommentPane.tsx
components/CommentPane/components/CommentPaneHeaderExtras/CommentPaneHeaderExtras.tsx
components/CommentPane/components/CommentPaneHeaderExtras/index.ts
components/CommentPane/components/CommentPaneTitle/CommentPaneTitle.tsx
components/CommentPane/components/CommentPaneTitle/index.ts
components/CommentPane/index.ts
components/DesktopPane/DesktopPane.tsx
components/DesktopPane/index.ts
components/DiffPane/DiffPane.tsx
components/DiffPane/components/BinaryDiffPreview/BinaryDiffPreview.tsx
components/DiffPane/components/BinaryDiffPreview/components/DiffSidePreview/DiffSidePreview.tsx
components/DiffPane/components/BinaryDiffPreview/components/DiffSidePreview/index.ts
components/DiffPane/components/BinaryDiffPreview/index.ts
components/DiffPane/components/BinaryDiffPreview/utils/createSnapshotDocument/createSnapshotDocument.test.ts
components/DiffPane/components/BinaryDiffPreview/utils/createSnapshotDocument/createSnapshotDocument.ts
components/DiffPane/components/BinaryDiffPreview/utils/createSnapshotDocument/index.ts
components/DiffPane/components/CommentThread/CommentThread.test.tsx
components/DiffPane/components/CommentThread/CommentThread.tsx
components/DiffPane/components/CommentThread/comment-thread.css
components/DiffPane/components/CommentThread/index.ts
components/DiffPane/components/DeferredDiffPlaceholder/DeferredDiffPlaceholder.tsx
components/DiffPane/components/DeferredDiffPlaceholder/index.ts
components/DiffPane/components/DiffHeaderMetadata/DiffHeaderMetadata.tsx
components/DiffPane/components/DiffHeaderMetadata/index.ts
components/DiffPane/components/DiffPaneHeaderExtras/DiffPaneHeaderExtras.tsx
components/DiffPane/components/DiffPaneHeaderExtras/components/DiffPanePRLink/DiffPanePRLink.tsx
components/DiffPane/components/DiffPaneHeaderExtras/components/DiffPanePRLink/index.ts
components/DiffPane/components/DiffPaneHeaderExtras/index.ts
components/DiffPane/components/DiffSectionLabel/DiffSectionLabel.tsx
components/DiffPane/components/DiffSectionLabel/index.ts
components/DiffPane/hooks/useDiffActiveSection/index.ts
components/DiffPane/hooks/useDiffActiveSection/useDiffActiveSection.ts
components/DiffPane/hooks/useDiffAnnotations/index.ts
components/DiffPane/hooks/useDiffAnnotations/useDiffAnnotations.ts
components/DiffPane/hooks/useDiffCodeViewItems/index.ts
components/DiffPane/hooks/useDiffCodeViewItems/parsePatchGroup/index.ts
components/DiffPane/hooks/useDiffCodeViewItems/parsePatchGroup/parsePatchGroup.test.ts
components/DiffPane/hooks/useDiffCodeViewItems/parsePatchGroup/parsePatchGroup.ts
components/DiffPane/hooks/useDiffCodeViewItems/useDiffCodeViewItems.test.tsx
components/DiffPane/hooks/useDiffCodeViewItems/useDiffCodeViewItems.ts
components/DiffPane/hooks/useDiffCodeViewScroll/index.ts
components/DiffPane/hooks/useDiffCodeViewScroll/shouldReassertScroll/index.ts
components/DiffPane/hooks/useDiffCodeViewScroll/shouldReassertScroll/shouldReassertScroll.test.ts
components/DiffPane/hooks/useDiffCodeViewScroll/shouldReassertScroll/shouldReassertScroll.ts
components/DiffPane/hooks/useDiffCodeViewScroll/shouldRestoreCachedScrollState/index.ts
components/DiffPane/hooks/useDiffCodeViewScroll/shouldRestoreCachedScrollState/shouldRestoreCachedScrollState.test.ts
components/DiffPane/hooks/useDiffCodeViewScroll/shouldRestoreCachedScrollState/shouldRestoreCachedScrollState.ts
components/DiffPane/hooks/useDiffCodeViewScroll/useDiffCodeViewScroll.ts
components/DiffPane/hooks/useDiffCodeViewTheme/diffCardUnsafeCss.ts
components/DiffPane/hooks/useDiffCodeViewTheme/index.ts
components/DiffPane/hooks/useDiffCodeViewTheme/useDiffCardCodeViewTheme.ts
components/DiffPane/hooks/useDiffCodeViewTheme/useDiffCodeViewTheme.ts
components/DiffPane/hooks/useDiffCommentComposer/index.ts
components/DiffPane/hooks/useDiffCommentComposer/useDiffCommentComposer.ts
components/DiffPane/hooks/useDiffCommentNavigation/buildOrderedThreads/buildOrderedThreads.test.ts
components/DiffPane/hooks/useDiffCommentNavigation/buildOrderedThreads/buildOrderedThreads.ts
components/DiffPane/hooks/useDiffCommentNavigation/buildOrderedThreads/index.ts
components/DiffPane/hooks/useDiffCommentNavigation/index.ts
components/DiffPane/hooks/useDiffCommentNavigation/useDiffCommentNavigation.ts
components/DiffPane/hooks/useDiffHeaderHover/index.ts
components/DiffPane/hooks/useDiffHeaderHover/useDiffHeaderHover.ts
components/DiffPane/hooks/useDiffPaneSearch/index.ts
components/DiffPane/hooks/useDiffPaneSearch/useDiffPaneSearch.ts
components/DiffPane/hooks/useDiffPaneSearch/utils/collectDiffSearchMatches/collectDiffSearchMatches.test.ts
components/DiffPane/hooks/useDiffPaneSearch/utils/collectDiffSearchMatches/collectDiffSearchMatches.ts
components/DiffPane/hooks/useDiffPaneSearch/utils/collectDiffSearchMatches/index.ts
components/DiffPane/index.ts
components/DiffPane/utils/createGetDiffInput/createGetDiffInput.ts
components/DiffPane/utils/createGetDiffInput/index.ts
components/DiffPane/utils/diffLoadingGuards/diffLoadingGuards.test.ts
components/DiffPane/utils/diffLoadingGuards/diffLoadingGuards.ts
components/DiffPane/utils/diffLoadingGuards/index.ts
components/DiffPane/utils/getCharacterOffsetAtClientX/getCharacterOffsetAtClientX.ts
components/DiffPane/utils/getCharacterOffsetAtClientX/index.ts
components/DiffPane/utils/gitDecorationColors/gitDecorationColors.ts
components/DiffPane/utils/gitDecorationColors/index.ts
components/DiffPane/utils/hashString/hashString.ts
components/DiffPane/utils/hashString/index.ts
components/FilePane/FilePane.tsx
components/FilePane/components/ErrorState/ErrorState.tsx
components/FilePane/components/ErrorState/index.ts
components/FilePane/components/ExternalChangeBanner/ExternalChangeBanner.tsx
components/FilePane/components/ExternalChangeBanner/index.ts
components/FilePane/components/FilePaneHeaderExtras/FilePaneHeaderExtras.tsx
components/FilePane/components/FilePaneHeaderExtras/index.ts
components/FilePane/components/FileViewToggle/FileViewToggle.tsx
components/FilePane/components/FileViewToggle/index.ts
components/FilePane/components/LoadingState/LoadingState.tsx
components/FilePane/components/LoadingState/index.ts
components/FilePane/components/OrphanedBanner/OrphanedBanner.tsx
components/FilePane/components/OrphanedBanner/index.ts
components/FilePane/components/SaveErrorBanner/SaveErrorBanner.tsx
components/FilePane/components/SaveErrorBanner/index.ts
components/FilePane/index.ts
components/FilePane/registry/allViews.ts
components/FilePane/registry/index.ts
components/FilePane/registry/resolveViews.ts
components/FilePane/registry/types.ts
components/FilePane/registry/utils/resolveActivePaneView/index.ts
components/FilePane/registry/utils/resolveActivePaneView/resolveActivePaneView.ts
components/FilePane/registry/views/BinaryWarningView/BinaryWarningView.tsx
components/FilePane/registry/views/BinaryWarningView/index.ts
components/FilePane/registry/views/CodeView/CodeView.tsx
components/FilePane/registry/views/CodeView/components/CodeEditor/CodeEditor.tsx
components/FilePane/registry/views/CodeView/components/CodeEditor/CodeEditorAdapter/CodeEditorAdapter.test.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/CodeEditorAdapter/CodeEditorAdapter.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/CodeEditorAdapter/index.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/constants.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/createCodeMirrorTheme/createCodeMirrorTheme.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/createCodeMirrorTheme/index.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/extensions/contourSelectionLayer/contourSelectionLayer.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/extensions/contourSelectionLayer/index.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/extensions/foldChevron/foldChevron.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/extensions/foldChevron/index.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/extensions/foldPlaceholder/foldPlaceholder.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/extensions/foldPlaceholder/index.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/extensions/selectionClassTogglePlugin/index.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/extensions/selectionClassTogglePlugin/selectionClassTogglePlugin.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/index.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/loadLanguageSupport/index.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/loadLanguageSupport/loadLanguageSupport.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/loadLanguageSupport/streamLanguages.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/syntax-highlighting/index.ts
components/FilePane/registry/views/CodeView/components/CodeEditor/syntax-highlighting/syntax-highlighting.ts
components/FilePane/registry/views/CodeView/hooks/usePendingFilePosition/index.ts
components/FilePane/registry/views/CodeView/hooks/usePendingFilePosition/usePendingFilePosition.test.tsx
components/FilePane/registry/views/CodeView/hooks/usePendingFilePosition/usePendingFilePosition.ts
components/FilePane/registry/views/CodeView/index.ts
components/FilePane/registry/views/ImageView/ImageView.tsx
components/FilePane/registry/views/ImageView/hooks/usePanZoom/index.ts
components/FilePane/registry/views/ImageView/hooks/usePanZoom/usePanZoom.ts
components/FilePane/registry/views/ImageView/index.ts
components/FilePane/registry/views/MarkdownPreviewView/MarkdownPreviewView.tsx
components/FilePane/registry/views/MarkdownPreviewView/index.ts
components/FilePane/registry/views/MarkdownPreviewView/splitFrontMatter.test.ts
components/FilePane/registry/views/MarkdownPreviewView/splitFrontMatter.ts
components/FilePane/registry/views/PdfView/PdfView.tsx
components/FilePane/registry/views/PdfView/index.ts
components/FilePane/registry/views/VideoView/VideoView.tsx
components/FilePane/registry/views/VideoView/index.ts
components/FilesTreePane/FilesTreePane.tsx
components/FilesTreePane/index.ts
components/MobilePane/MobilePane.tsx
components/MobilePane/components/CloudSimulator/CloudSimulator.tsx
components/MobilePane/components/CloudSimulator/components/RemoteSimulator/RemoteSimulator.tsx
components/MobilePane/components/CloudSimulator/components/RemoteSimulator/index.ts
components/MobilePane/components/CloudSimulator/components/RemoteSimulator/utils/sendOrientation/index.ts
components/MobilePane/components/CloudSimulator/components/RemoteSimulator/utils/sendOrientation/sendOrientation.ts
components/MobilePane/components/CloudSimulator/index.ts
components/MobilePane/components/DeviceControlButton/DeviceControlButton.tsx
components/MobilePane/components/DeviceControlButton/index.ts
components/MobilePane/components/DeviceView/DeviceView.tsx
components/MobilePane/components/DeviceView/components/DeviceActions/DeviceActions.tsx
components/MobilePane/components/DeviceView/components/DeviceActions/index.ts
components/MobilePane/components/DeviceView/components/DeviceControls/DeviceControls.tsx
components/MobilePane/components/DeviceView/components/DeviceControls/index.ts
components/MobilePane/components/DeviceView/components/LogsDrawer/LogsDrawer.tsx
components/MobilePane/components/DeviceView/components/LogsDrawer/components/LogLevelMenu/LogLevelMenu.tsx
components/MobilePane/components/DeviceView/components/LogsDrawer/components/LogLevelMenu/index.ts
components/MobilePane/components/DeviceView/components/LogsDrawer/components/LogRow/LogRow.tsx
components/MobilePane/components/DeviceView/components/LogsDrawer/components/LogRow/index.ts
components/MobilePane/components/DeviceView/components/LogsDrawer/hooks/useDeviceLogs/index.ts
components/MobilePane/components/DeviceView/components/LogsDrawer/hooks/useDeviceLogs/useDeviceLogs.ts
components/MobilePane/components/DeviceView/components/LogsDrawer/index.ts
components/MobilePane/components/DeviceView/components/LogsDrawer/utils/parseLogLine/index.ts
components/MobilePane/components/DeviceView/components/LogsDrawer/utils/parseLogLine/parseLogLine.test.ts
components/MobilePane/components/DeviceView/components/LogsDrawer/utils/parseLogLine/parseLogLine.ts
components/MobilePane/components/DeviceView/components/ToolsPanel/ToolsPanel.tsx
components/MobilePane/components/DeviceView/components/ToolsPanel/components/ActivitySection/ActivitySection.tsx
components/MobilePane/components/DeviceView/components/ToolsPanel/components/ActivitySection/index.ts
components/MobilePane/components/DeviceView/components/ToolsPanel/components/AppSection/AppSection.tsx
components/MobilePane/components/DeviceView/components/ToolsPanel/components/AppSection/index.ts
components/MobilePane/components/DeviceView/components/ToolsPanel/components/EventLogSection/EventLogSection.tsx
components/MobilePane/components/DeviceView/components/ToolsPanel/components/EventLogSection/index.ts
components/MobilePane/components/DeviceView/components/ToolsPanel/components/SettingRow/SettingRow.tsx
components/MobilePane/components/DeviceView/components/ToolsPanel/components/SettingRow/index.ts
components/MobilePane/components/DeviceView/components/ToolsPanel/components/SettingSelect/SettingSelect.tsx
components/MobilePane/components/DeviceView/components/ToolsPanel/components/SettingSelect/index.ts
components/MobilePane/components/DeviceView/components/ToolsPanel/components/SimulatorSection/SimulatorSection.tsx
components/MobilePane/components/DeviceView/components/ToolsPanel/components/SimulatorSection/index.ts
components/MobilePane/components/DeviceView/components/ToolsPanel/components/ToolsSection/ToolsSection.tsx
components/MobilePane/components/DeviceView/components/ToolsPanel/components/ToolsSection/index.ts
components/MobilePane/components/DeviceView/components/ToolsPanel/index.ts
components/MobilePane/components/DeviceView/index.ts
components/MobilePane/components/FloatingBar/FloatingBar.tsx
components/MobilePane/components/FloatingBar/index.ts
components/MobilePane/components/LocalDevices/LocalDevices.tsx
components/MobilePane/components/LocalDevices/components/DeviceActions/DeviceActions.tsx
components/MobilePane/components/LocalDevices/components/DeviceActions/index.ts
components/MobilePane/components/LocalDevices/components/DeviceControlButton/DeviceControlButton.tsx
components/MobilePane/components/LocalDevices/components/DeviceControlButton/index.ts
components/MobilePane/components/LocalDevices/components/DeviceControls/DeviceControls.tsx
components/MobilePane/components/LocalDevices/components/DeviceControls/index.ts
components/MobilePane/components/LocalDevices/components/DevicePicker/DevicePicker.tsx
components/MobilePane/components/LocalDevices/components/DevicePicker/index.ts
components/MobilePane/components/LocalDevices/components/DeviceSession/DeviceSession.tsx
components/MobilePane/components/LocalDevices/components/DeviceSession/index.ts
components/MobilePane/components/LocalDevices/components/FloatingBar/FloatingBar.tsx
components/MobilePane/components/LocalDevices/components/FloatingBar/index.ts
components/MobilePane/components/LocalDevices/components/LogsDrawer/LogsDrawer.tsx
components/MobilePane/components/LocalDevices/components/LogsDrawer/components/LogLevelMenu/LogLevelMenu.tsx
components/MobilePane/components/LocalDevices/components/LogsDrawer/components/LogLevelMenu/index.ts
components/MobilePane/components/LocalDevices/components/LogsDrawer/components/LogRow/LogRow.tsx
components/MobilePane/components/LocalDevices/components/LogsDrawer/components/LogRow/index.ts
components/MobilePane/components/LocalDevices/components/LogsDrawer/hooks/useDeviceLogs/index.ts
components/MobilePane/components/LocalDevices/components/LogsDrawer/hooks/useDeviceLogs/useDeviceLogs.ts
components/MobilePane/components/LocalDevices/components/LogsDrawer/index.ts
components/MobilePane/components/LocalDevices/components/LogsDrawer/utils/parseLogLine/index.ts
components/MobilePane/components/LocalDevices/components/LogsDrawer/utils/parseLogLine/parseLogLine.test.ts
components/MobilePane/components/LocalDevices/components/LogsDrawer/utils/parseLogLine/parseLogLine.ts
components/MobilePane/components/LocalDevices/components/PaneMessage/PaneMessage.tsx
components/MobilePane/components/LocalDevices/components/PaneMessage/index.ts
components/MobilePane/components/LocalDevices/components/ToolsPanel/ToolsPanel.tsx
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/ActivitySection/ActivitySection.tsx
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/ActivitySection/index.ts
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/AppSection/AppSection.tsx
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/AppSection/index.ts
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/EventLogSection/EventLogSection.tsx
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/EventLogSection/index.ts
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/SettingRow/SettingRow.tsx
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/SettingRow/index.ts
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/SettingSelect/SettingSelect.tsx
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/SettingSelect/index.ts
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/SimulatorSection/SimulatorSection.tsx
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/SimulatorSection/index.ts
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/ToolsSection/ToolsSection.tsx
components/MobilePane/components/LocalDevices/components/ToolsPanel/components/ToolsSection/index.ts
components/MobilePane/components/LocalDevices/components/ToolsPanel/index.ts
components/MobilePane/components/LocalDevices/index.ts
components/MobilePane/components/PaneMessage/PaneMessage.tsx
components/MobilePane/components/PaneMessage/index.ts
components/MobilePane/index.ts
components/PagePane/PagePane.tsx
components/PagePane/index.ts
components/PagePaneHeaderExtras/PagePaneHeaderExtras.tsx
components/PagePaneHeaderExtras/components/PageWatcherMenu/PageWatcherMenu.tsx
components/PagePaneHeaderExtras/components/PageWatcherMenu/components/PageWatcherPopover/PageWatcherPopover.test.tsx
components/PagePaneHeaderExtras/components/PageWatcherMenu/components/PageWatcherPopover/PageWatcherPopover.tsx
components/PagePaneHeaderExtras/components/PageWatcherMenu/components/PageWatcherPopover/index.ts
components/PagePaneHeaderExtras/components/PageWatcherMenu/index.ts
components/PagePaneHeaderExtras/components/PageWatcherMenu/utils/waitForPageAgent/index.ts
components/PagePaneHeaderExtras/components/PageWatcherMenu/utils/waitForPageAgent/waitForPageAgent.test.ts
components/PagePaneHeaderExtras/components/PageWatcherMenu/utils/waitForPageAgent/waitForPageAgent.ts
components/PagePaneHeaderExtras/index.ts
components/PagePaneTitle/PagePaneTitle.tsx
components/PagePaneTitle/index.ts
components/PagesListPane/PagesListPane.tsx
components/PagesListPane/components/PagesListCard/PagesListCard.tsx
components/PagesListPane/components/PagesListCard/index.ts
components/PagesListPane/index.ts
components/PullRequestPane/PullRequestPane.test.ts
components/PullRequestPane/PullRequestPane.tsx
components/PullRequestPane/components/PullRequestCommentCard/PullRequestCommentCard.test.tsx
components/PullRequestPane/components/PullRequestCommentCard/PullRequestCommentCard.tsx
components/PullRequestPane/components/PullRequestCommentCard/components/PullRequestCommentReply/PullRequestCommentReply.tsx
components/PullRequestPane/components/PullRequestCommentCard/components/PullRequestCommentReply/index.ts
components/PullRequestPane/components/PullRequestCommentCard/components/PullRequestThreadPath/PullRequestThreadPath.tsx
components/PullRequestPane/components/PullRequestCommentCard/components/PullRequestThreadPath/index.ts
components/PullRequestPane/components/PullRequestCommentCard/index.ts
components/PullRequestPane/components/PullRequestEvidence/PullRequestEvidence.stories.tsx
components/PullRequestPane/components/PullRequestEvidence/PullRequestEvidence.test.tsx
components/PullRequestPane/components/PullRequestEvidence/PullRequestEvidence.tsx
components/PullRequestPane/components/PullRequestEvidence/components/EvidencePageCard/EvidencePageCard.tsx
components/PullRequestPane/components/PullRequestEvidence/components/EvidencePageCard/index.ts
components/PullRequestPane/components/PullRequestEvidence/index.ts
components/PullRequestPane/components/PullRequestPaneHeaderExtras/PullRequestPaneHeaderExtras.tsx
components/PullRequestPane/components/PullRequestPaneHeaderExtras/index.ts
components/PullRequestPane/fixtures/checks.tsx
components/PullRequestPane/hooks/usePullRequestEvidence/index.ts
components/PullRequestPane/hooks/usePullRequestEvidence/usePullRequestEvidence.test.tsx
components/PullRequestPane/hooks/usePullRequestEvidence/usePullRequestEvidence.ts
components/PullRequestPane/hooks/usePullRequestPaneDetail/fixtures/checks.tsx
components/PullRequestPane/hooks/usePullRequestPaneDetail/index.ts
components/PullRequestPane/hooks/usePullRequestPaneDetail/usePullRequestPaneDetail.test.ts
components/PullRequestPane/hooks/usePullRequestPaneDetail/usePullRequestPaneDetail.ts
components/PullRequestPane/index.ts
components/PullRequestPane/utils/buildReviewThreadEntries/buildReviewThreadEntries.test.tsx
components/PullRequestPane/utils/buildReviewThreadEntries/buildReviewThreadEntries.tsx
components/PullRequestPane/utils/buildReviewThreadEntries/index.ts
components/ReviewPane/ReviewPane.tsx
components/ReviewPane/index.ts
components/SubagentPane/SubagentPane.tsx
components/SubagentPane/components/SubagentTranscriptRow/SubagentTranscriptRow.tsx
components/SubagentPane/components/SubagentTranscriptRow/index.ts
components/SubagentPane/index.ts
components/TerminalPane/TerminalPane.tsx
components/TerminalPane/components/TerminalAgentAutoResume/TerminalAgentAutoResume.tsx
components/TerminalPane/components/TerminalAgentAutoResume/index.ts
components/TerminalPane/components/TerminalCopiedIndicator/TerminalCopiedIndicator.tsx
components/TerminalPane/components/TerminalCopiedIndicator/index.ts
components/TerminalPane/components/TerminalNarrowedBanner/TerminalNarrowedBanner.tsx
components/TerminalPane/components/TerminalNarrowedBanner/index.ts
components/TerminalPane/components/TerminalPaneHeaderExtras/TerminalPaneHeaderExtras.tsx
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalConnectionIndicator/TerminalConnectionIndicator.tsx
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalConnectionIndicator/index.ts
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalIdCopyMenu/TerminalIdCopyMenu.tsx
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalIdCopyMenu/index.ts
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalPageWatchChip/TerminalPageWatchChip.tsx
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalPageWatchChip/index.ts
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalSessionHandoffMenu/TerminalSessionHandoffMenu.tsx
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalSessionHandoffMenu/index.ts
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalSessionHandoffMenu/resolveDefaultTargetConfigId.test.ts
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalSessionHandoffMenu/resolveDefaultTargetConfigId.ts
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalSubagentsMenu/TerminalSubagentsMenu.tsx
components/TerminalPane/components/TerminalPaneHeaderExtras/components/TerminalSubagentsMenu/index.ts
components/TerminalPane/components/TerminalPaneHeaderExtras/index.ts
components/TerminalPane/components/TerminalPaneIcon/TerminalPaneIcon.tsx
components/TerminalPane/components/TerminalPaneIcon/index.ts
components/TerminalPane/components/TerminalRichInput/TerminalRichInput.tsx
components/TerminalPane/components/TerminalRichInput/index.ts
components/TerminalPane/components/TerminalRichInput/prepareTerminalSubmission.test.ts
components/TerminalPane/components/TerminalRichInput/prepareTerminalSubmission.ts
components/TerminalPane/components/TerminalSessionDropdown/TerminalSessionDropdown.tsx
components/TerminalPane/components/TerminalSessionDropdown/TerminalSessionDropdown.utils.test.ts
components/TerminalPane/components/TerminalSessionDropdown/TerminalSessionDropdown.utils.ts
components/TerminalPane/components/TerminalSessionDropdown/components/RenameSessionDialog/RenameSessionDialog.tsx
components/TerminalPane/components/TerminalSessionDropdown/components/RenameSessionDialog/index.ts
components/TerminalPane/components/TerminalSessionDropdown/index.ts
components/TerminalPane/contextMenuLinkStore.ts
components/TerminalPane/hooks/useCopyOnSelect/copiedIndicatorStore.test.ts
components/TerminalPane/hooks/useCopyOnSelect/copiedIndicatorStore.ts
components/TerminalPane/hooks/useCopyOnSelect/copyOnSelect.test.ts
components/TerminalPane/hooks/useCopyOnSelect/copyOnSelect.ts
components/TerminalPane/hooks/useCopyOnSelect/index.ts
components/TerminalPane/hooks/useCopyOnSelect/useCopiedIndicator.ts
components/TerminalPane/hooks/useCopyOnSelect/useCopyOnSelect.ts
components/TerminalPane/hooks/useLinkHoverState/index.ts
components/TerminalPane/hooks/useLinkHoverState/useLinkHoverState.ts
components/TerminalPane/hooks/useTerminalInterruptClear/index.ts
components/TerminalPane/hooks/useTerminalInterruptClear/useTerminalInterruptClear.ts
components/TerminalPane/index.ts
components/TerminalPane/richInputOpenStore.ts
components/TerminalPane/utils.ts
hooks/useLinkClickHint/index.ts
hooks/useLinkClickHint/useLinkClickHint.ts
hooks/usePagePaneUi/index.ts
hooks/usePagePaneUi/usePagePaneUi.ts
hooks/useUndoableChatClose/components/ChatClosedToast/ChatClosedToast.tsx
hooks/useUndoableChatClose/components/ChatClosedToast/index.ts
hooks/useUndoableChatClose/index.ts
hooks/useUndoableChatClose/useUndoableChatClose.tsx
hooks/useUndoableChatClose/utils/closedChatBatches/closedChatBatches.test.ts
hooks/useUndoableChatClose/utils/closedChatBatches/closedChatBatches.ts
hooks/useUndoableChatClose/utils/closedChatBatches/index.ts
index.ts
usePaneRegistry.tsx
utils/openInActions/index.ts
utils/openInActions/openInActions.ts
utils/pagePaneLabel/index.ts
utils/pagePaneLabel/pagePaneLabel.test.ts
utils/pagePaneLabel/pagePaneLabel.ts
utils/replaceEndedTerminal/index.ts
utils/replaceEndedTerminal/replaceEndedTerminal.test.ts
utils/replaceEndedTerminal/replaceEndedTerminal.ts
utils/runTerminalLinkAction/index.ts
utils/runTerminalLinkAction/runTerminalLinkAction.test.ts
utils/runTerminalLinkAction/runTerminalLinkAction.ts
utils/uploadPastedFiles/index.ts
utils/uploadPastedFiles/uploadPastedFiles.test.ts
utils/uploadPastedFiles/uploadPastedFiles.ts
```

</details>

<details>
<summary>Completed-plan title skim (18 files; selected content reads are listed above)</summary>

- `apps/desktop/plans/done/20260106-1800-terminal-host-control-stream-sockets.md`
- `apps/desktop/plans/done/20260114-1739-fix-file-pane-cross-workspace.md`
- `apps/desktop/plans/done/20260412-keyboard-recorder-ctrl-binding-fix.md`
- `apps/desktop/plans/done/20260415-v2-host-service-ai-branch-naming-test-plan.md`
- `apps/desktop/plans/done/20260415-v2-host-service-ai-branch-naming.md`
- `apps/desktop/plans/done/20260417-fix-api-key-storage-slot.md`
- `apps/desktop/plans/done/20260425-1430-sidebar-remove-and-rerender.md`
- `apps/desktop/plans/done/20260427-keyboard-layout-plan.md`
- `apps/desktop/plans/done/20260428-keyboard-qa-plan.md`
- `apps/desktop/plans/done/20260504-1200-v2-onboarding-flow.md`
- `apps/desktop/plans/done/20260507-host-service-bundled-version-pin.md`
- `apps/desktop/plans/done/20260510-host-service-recovery.md`
- `apps/desktop/plans/done/20260703-1507-derive-terminal-agent-status-from-host-binding.md`
- `apps/desktop/plans/done/20260725-1947-sidebar-workspace-pinning.md`
- `apps/desktop/plans/done/20260729-1500-agent-hooks-guard-and-per-agent-setting.md`
- `apps/desktop/plans/done/CODE_EDITOR_MIGRATION_PLAN.md`
- `apps/desktop/plans/done/ROUTING_REFACTOR_PLAN.md`
- `apps/desktop/plans/done/SEMANTIC_SEARCH_PLAN.md`

</details>

Additional discovery sweeps: tracked router filenames under `apps/desktop/src/lib/trpc/routers/`; component filenames and attention/error/auth/quota literals under `apps/desktop/src/renderer/components/`; targeted symbol/literal searches leading to the source reads above. Exploratory missing guessed module paths were resolved to existing files before citation.
