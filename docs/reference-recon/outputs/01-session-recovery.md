# Session failure and restart reconnaissance

Reference: `/home/phagmaier/Code/superset`, commit `491ca53f4cd1d6a4ed06735cfd98a39a12480d67`, obtained with `git -C /home/phagmaier/Code/superset rev-parse HEAD`. License: `LICENSE.md:1` (Elastic License 2.0). Source study only; no implementation copied.

All reference citations below are relative to that absolute reference root; `metatron/...` citations are relative to `/home/phagmaier/Code`. Reads used absolute paths. All 25 Q2 paths, all 14 explicitly named files, all nine files under SessionStore, and the discovered local-db schema were verified present in HEAD and on disk: **42 distinct paths; none missing**. This is a source audit, not an executed recovery demonstration; no tests, builds, native harness calls, or services were run. Superset was not indexed; graph discovery/coverage reported that limitation, so findings use direct source reads.

Findings are ranked by M6 impact. “Today” describes metatron's supplied contract/checklist, not an implementation audit: recovery/stop/context-policy items remain unchecked at `metatron/todo.md:124`–`128`. Costs are implementation estimates, not measured Superset effort.

### Finding 1 — Automatic resume is not an ambiguity decision
- **Question:** Is there an equivalent to “never auto-rerun ambiguous mutating work”?
- **Their mechanism:** The desktop pane automatically calls the resume mutation for a supported dead-session candidate; only launch failure produces a retry banner. The host atomically changes a candidate's end reason to `resumed` before launching, then records the successor terminal afterward; launch exceptions restore candidacy. That deduplicates claims but is not an operation-result journal: a crash between launch and successor recording leaves an uncertainty window (inference from ordering, not a reproduced failure). Resume supplies an empty prompt and the native session ID, or starts fresh only for an `Attached` candidate whose harness store definitely lacks a conversation; this does not itself prove native tools cannot repeat effects. Separately, sandbox startup auto-resumes up to eight recently ended candidates within five minutes, expressly because that product's sandbox stop preserves disk but destroys processes; that cloud-specific behavior is not a local correctness requirement.
- **Evidence:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/components/TerminalAgentAutoResume/TerminalAgentAutoResume.tsx:125`–`161`; `packages/host-service/src/terminal-agents/persistence.ts:282`–`310`; `packages/host-service/src/trpc/router/terminal-agents/terminal-agents.ts:128`–`165`, `:254`–`280`; `packages/host-service/src/serve.ts:158`–`164`.
- **What metatron does today:** Spec §10.2 explicitly requires durable intent, causal IDs, idempotency and a safe recovery decision before resume/fresh attempts (`metatron/spec.md:503`–`510`); M6 recovery/reconciliation remain unchecked (`metatron/todo.md:125`–`127`).
- **Gap or confirmation:** conflict
- **Verdict:** reject + reason: automatic relaunch cannot establish whether an ambiguous mutation already succeeded. Keep metatron's explicit `RECOVERY_REQUIRED`/`RETRY_DECISION` barrier; reuse only the idea of an atomic claim after that decision.
- **Cost if adopted:** 0 hours for the rejected auto-resume behavior; estimated 1–2 days for decision-gated recovery with crash injection. Touches the no-ambiguous-rerun and correct-repository/session guardrails (`metatron/AGENTS.md:99`, `:101`).
- **Unverified:** A repository-wide exactly-once guarantee, native harness replay semantics, and actual behavior when the host dies during the launch/recording window are **UNVERIFIED**. No proof of duplicate mutations is claimed.

### Finding 2 — Turn outcome, session lifetime and process exit differ
- **Question:** How do they distinguish clean completion, a failed turn and an agent/process ending?
- **Their mechanism:** Lifecycle normalization separates `Start`, `Stop`, `PermissionRequest`, `Failed`, `Attached` and `Detached`; the shared status mapper turns `Stop` into `review`, not authoritative task success. Claude's managed hooks include `StopFailure`; Pi checks its last assistant's error stop reason, and OpenCode reports `session.error` as `Failed` when transitioning out of busy. These converge on generic failure: the inspected hook payload/binding does not persist a separate auth-versus-quota-versus-rate-limit reason enum. Moreover, `Interrupt` normalizes to `Stop`, Pi emits `Stop` on session shutdown, and the status-clear escape hatch writes `Stop`, so even that signal is unsuitable as a metatron DONE predicate. PTY exit separately records code/signal in memory and broadcasts them while persisting terminal `exited`; deliberately disposing a live terminal can broadcast zero code/signal, which also cannot mean task success.
- **Evidence:** `packages/host-service/src/events/map-event-type.ts:15`–`21`, `:47`–`96`; `packages/shared/src/agent-status.ts:22`–`36`; `packages/agent-setup/src/agent-wrappers-claude-codex-opencode.ts:77`–`91`; `packages/agent-setup/templates/pi-extension.template.ts:93`–`106`; `packages/agent-setup/templates/opencode-plugin.template.js:138`–`150`; `packages/host-service/src/trpc/router/notifications/notifications.ts:38`–`52`; `packages/host-service/src/terminal-agents/store.ts:458`–`475`; `packages/host-service/src/terminal/terminal.ts:3432`–`3483`, `:2805`–`2823`.
- **What metatron does today:** Spec §10.1 lists auth/quota, denied permission, clean exit without completion and cancellation separately; §10.2 requires authoritative harness events plus Git state (`metatron/spec.md:491`–`510`). M6 failure-state/fault tests are unchecked (`metatron/todo.md:125`, `:128`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M6): maintain independent process/session/task outcomes; record typed failure causes when the adapter provides them, otherwise unknown. Require completion evidence and Git checks before DONE.
- **Cost if adopted:** Estimated 1–2 days including fixtures for clean exit without completion, cancellation and auth/quota failures. Touches no-ambiguous-rerun and affected-task-only blocking (`metatron/AGENTS.md:99`–`100`); transition/fault tests are required by `metatron/AGENTS.md:61`.
- **Unverified:** Reliable auth/quota differentiation across all four terminal harnesses, especially Codex failure coverage, is **UNVERIFIED**. Generic `Failed` is confirmed; complete cross-harness error classification is not.

### Finding 3 — Durable identities are richer than durable process outcomes
- **Question:** What survives restart, and what is rebuilt?
- **Their mechanism:** Host SQLite persists terminal ID, origin workspace, status, title, timestamps and dispose intent; bindings persist harness identity, native session ID, definition ID, latest lifecycle type/time, end reason/time, transcript path and successor terminal ID. Workspace rows persist worktree path, branch and head SHA; startup sweeps defunct bindings and hydrates the in-process binding map from SQLite. Native-session lookup combines the binding, workspace and current account/config environment with harness-specific stores for Claude, Codex, OpenCode and Pi, returning unknown when a store cannot be inspected. By contrast, SessionStore's process handles, alive flag, code/signal, terminal modes/colors and replay ring normally live in daemon memory, and host-side runtime objects are reconstructed through daemon observation/attach. The inspected terminal/binding tables contain no exit-code/signal columns: exit broadcasts and daemon memory therefore are not a durable exit ledger, and daemon exit deletes its session entry immediately. The older local-db migrations only add a persistence setting—migration 0011 is a no-op and the current setting is deprecated—so they must not be mistaken for the current host session schema.
- **Evidence:** `packages/host-service/src/db/schema.ts:15`–`84`, `:231`–`265`; `packages/host-service/src/app.ts:225`–`238`; `packages/host-service/src/terminal-agents/store.ts:135`–`150`; `packages/host-service/src/terminal-agents/harness-session-ref.ts:20`–`50`; `packages/host-service/src/terminal-agents/harness-sessions/index.ts:16`–`46`; `packages/pty-daemon/src/SessionStore/SessionStore.ts:8`–`36`; `packages/pty-daemon/src/Server/Server.ts:609`–`651`; `packages/local-db/drizzle/0011_add_terminal_persistence.sql:1`–`4`; `packages/local-db/drizzle/0012_add_persist_terminal.sql:1`; `packages/local-db/src/schema/schema.ts:213`–`217`.
- **What metatron does today:** Spec §10.2 requires attempts/intents before mutation, native IDs, recorded exits and reconciliation; §10.3 requires WAL, migrations and transactions (`metatron/spec.md:503`–`514`). M6 restart/context-history work remains unchecked (`metatron/todo.md:126`–`127`).
- **Gap or confirmation:** gap
- **Verdict:** adopt now (M6): persist stable identities and cancellation/attempt evidence, derive current liveness; retain metatron's stronger durable exit and operation journal. Preserve old attempts instead of treating an updatable latest binding as complete history.
- **Cost if adopted:** Estimated 1–2 days, overlapping Findings 1 and 6. Touches no-ambiguous-rerun and correct-session/repository guardrails (`metatron/AGENTS.md:99`, `:101`).
- **Unverified:** Exit evidence persisted by other Superset subsystems is **UNVERIFIED**; the negative claim is limited to these terminal/binding tables and handlers. Metatron's existing implementation/schema was not audited.

### Finding 4 — Reattach to a live terminal without sending its command again
- **Question:** How does a host restart recover a native process that never stopped?
- **Their mechanism:** The daemon supervisor locates surviving PTYs, while terminal reconstruction either lists-and-adopts explicitly or handles an already-existing daemon session by listing its live ID, PID and dimensions. An adopted terminal sets `initialCommandQueued` immediately, and subsequent initial-command delivery is guarded by that flag, preventing this specific command from firing again. Terminal IDs are checked against workspace ownership before attachment, and reconstructing the native reference uses the binding's workspace/session association. The renderer launch orchestrator has idempotency maps, but those maps are process-local and its terminal adapter returns no native session ID, so that launcher is not the durable reconciliation authority.
- **Evidence:** `packages/host-service/src/terminal/terminal.ts:3014`–`3065`, `:3143`–`3199`, `:3325`–`3327`, `:2525`–`2529`; `packages/host-service/src/terminal-agents/harness-session-ref.ts:20`–`50`; `apps/desktop/src/renderer/lib/agent-session-orchestrator/agent-session-orchestrator.ts:16`–`17`, `:103`–`112`, `:168`–`176`; `apps/desktop/src/renderer/lib/agent-session-orchestrator/adapters/terminal-adapter.ts:267`–`270`.
- **What metatron does today:** Spec §10.2 requires matching process/native session/attempt/worktree evidence and idempotent operations (`metatron/spec.md:504`–`508`); M6 reconciliation and context-policy items are unchecked (`metatron/todo.md:126`–`127`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M6): make observation/attachment distinct from submission, prohibit input replay during reconnect, and validate the native ID against the same attempt and repository. Do not infer that an attachable process completed its task.
- **Cost if adopted:** Estimated 4–8 hours plus an attach-without-second-submit fixture. Touches no-ambiguous-rerun, correct-session/repository and one-writer guardrails (`metatron/AGENTS.md:96`, `:99`, `:101`).
- **Unverified:** This flag does not prove exactly-once initial-command delivery after daemon death or renderer restart; those cases remain **UNVERIFIED**. A new shell's existence is not evidence that an old mutation was unperformed.

### Finding 5 — Disconnect stays uncertain until observations converge
- **Question:** How do they avoid treating a socket interruption or slow daemon as a process crash?
- **Their mechanism:** Daemon disconnect closes terminal WebSockets and clears host runtime objects so clients reconnect, while a delayed sweep probes surviving daemon session IDs before ending bindings. The sweep captures each original native session ID and checks it again before writing, protecting a replacement session from a stale probe. Its bounded policy is five probes separated by two seconds; if none answers, it marks the original bindings ended as `terminal-exited`, which is an inference from timeout rather than a recorded process exit. Separately, periodic missing-session reconciliation gives new rows a sixty-second spawn grace, requires matching observations across passes, and transactionally rechecks row generation/liveness before marking bindings. The supplied SIGKILL test confirms raw socket close within a deadline after daemon death; it does not launch a mutating worker or verify durable task recovery.
- **Evidence:** `packages/host-service/src/terminal/terminal.ts:734`–`775`; `packages/host-service/src/terminal-agents/daemon-loss-sweep.ts:7`–`8`, `:37`–`93`; `packages/host-service/src/terminal/reaper/reaper.ts:46`–`75`, `:190`–`203`, `:310`–`328`; `packages/host-service/src/terminal/lifecycle/lifecycle.ts:55`–`69`; `packages/pty-daemon/test/signal-recovery.test.ts:87`–`118`.
- **What metatron does today:** Spec §10.1 distinguishes latency, disconnect with child alive and crash; §10.2 forbids diagnosing crash from absent tokens and demands a decision for ambiguity (`metatron/spec.md:491`–`506`). M6 disconnect/crash/restart tests remain unchecked (`metatron/todo.md:128`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M6): use bounded probes and generation/session checks. On probe exhaustion retain unknown/disconnected or recovery-required state; do not convert timeout into authority to rerun work.
- **Cost if adopted:** Estimated 1 day for bounded reconciliation and race fixtures. Touches no-ambiguous-rerun and correct-session/repository guardrails (`metatron/AGENTS.md:99`, `:101`).
- **Unverified:** Whether all OS descendants actually die when the daemon disappears is **UNVERIFIED**. The timeout policy and SIGKILL socket test do not establish that.

### Finding 6 — Persist stop intent before attempting the kill
- **Question:** How does an explicit stop survive failure or restart without resurrecting work or killing unrelated sessions?
- **Their mechanism:** Terminal disposal first persists `disposeRequestedAt`, then serializes lifecycle operations; only confirmed close changes the terminal row to `disposed`. Missing-session reconciliation treats pending stop intent as disposed rather than recoverable, while the reaper retries killing a still-live session with that intent. Binding end reasons distinguish deliberate disposal, clean detach, terminal loss and consumed resume; a thirty-second “death gasp” heuristic can upgrade a recent detach after PTY death, but deliberate disposal is protected from ordinary resume candidacy. At host level, stopping clears respawn bookkeeping before signaling, signals only an owned child, and removes a manifest only if its PID still matches. The PTY shutdown sweep skips another running host and uses the socket-reported daemon PID rather than trusting a recyclable manifest PID.
- **Evidence:** `packages/host-service/src/terminal/terminal.ts:2724`–`2744`, `:2801`–`2809`; `packages/host-service/src/terminal/reaper/reaper.ts:68`–`85`, `:344`–`377`; `packages/host-service/src/terminal-agents/persistence.ts:68`–`75`, `:106`–`129`; `apps/desktop/src/main/lib/host-service-coordinator.ts:478`–`520`; `apps/desktop/src/main/lib/stop-pty-daemons.ts:81`–`99`.
- **What metatron does today:** Spec §9.3 separates pause scheduling, selected-run cancellation and emergency termination of app-owned groups, preserves work and forbids killing manual sessions (`metatron/spec.md:479`–`485`). The next unchecked item is M6 pause/stop/emergency stop (`metatron/todo.md:124`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M6): journal stop intent before cancel/kill, revoke dispatch and respawn first, scope termination to proven ownership, and reconcile interrupted stops. Keep pause scheduling separate; do not import the timed-detach heuristic as authoritative completion/retry policy.
- **Cost if adopted:** Estimated 1–2 days with failed-kill/restart and unrelated-manual-process fixtures. Touches no-ambiguous-rerun, affected-task-only blocking and one-writer guardrails (`metatron/AGENTS.md:96`, `:99`–`100`).
- **Unverified:** Complete containment of descendants and equivalence of Superset's stop-all UI to metatron's selected-run stop are **UNVERIFIED**. Startup `sweepDefunct` backfills both exited/disposed terminal rows as `terminal-exited` when an end stamp is missing (`packages/host-service/src/terminal-agents/persistence.ts:530`–`554`); do not assume every historical disposal preserves intent perfectly.

### Finding 7 — A vanished worktree blocks reconstruction, not necessarily an existing PTY
- **Question:** What happens when a session's worktree folder has vanished?
- **Their mechanism:** Workspace queries retain the database row and derive `worktreeExists` from disk; the workspace page switches to a missing-worktree screen with refresh, browse and owner-initiated deletion controls. Terminal reconstruction returns `WORKTREE_GONE`, and Git path resolution returns a typed missing-worktree error rather than recreating the checkout. Permission-inaccessible paths are classified separately from missing ones. An already cached terminal returns before the worktree-path check, so this code does not establish that a live PTY is stopped immediately when its directory vanishes. A missing folder is also different from a deleted workspace database row: the binding sweep deletes bindings with missing/workspace-less terminal records, and the reaper targets workspace-less live terminals.
- **Evidence:** `packages/host-service/src/trpc/router/workspace/workspace.ts:23`–`37`; `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/page.tsx:130`–`147`; `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx:37`–`45`, `:65`–`103`; `packages/host-service/src/terminal/terminal.ts:3024`–`3065`; `packages/host-service/src/trpc/router/git/utils/resolve-worktree.ts:26`–`38`; `packages/host-service/src/terminal-agents/persistence.ts:503`–`527`; `packages/host-service/src/terminal/reaper/reaper.ts:84`–`85`.
- **What metatron does today:** Spec §§9.3/10.2 require worktree/session revalidation, Git-state reconciliation and preservation until authorized cleanup (`metatron/spec.md:485`, `:506`–`509`); M6 restart reconciliation remains unchecked (`metatron/todo.md:126`).
- **Gap or confirmation:** gap
- **Verdict:** adopt now (M6): report missing/inaccessible/replaced worktree evidence, block new submissions or resume until resolved, retain attempt/native-session links, and require an explicit recovery choice. Path existence alone cannot establish the correct Git checkout.
- **Cost if adopted:** Estimated 4–8 hours plus vanished/replaced/inaccessible worktree fixtures. Touches correct-session/repository, one-writer, dirty-checkout and no-ambiguous-rerun guardrails (`metatron/AGENTS.md:96`, `:98`–`99`, `:101`).
- **Unverified:** A background policy that immediately kills every live agent after external directory deletion, and comprehensive Git-identity validation during Superset adoption, are **UNVERIFIED**.

### Finding 8 — Supervision repairs infrastructure, not task truth
- **Question:** What startup health, ownership and retry checks prevent stale or duplicate infrastructure?
- **Their mechanism:** The desktop coordinator probes a manifest endpoint before adopting; its spawn critical section uses an exclusive lock and rechecks adoption under that lock before spawning. Reaping an unhealthy manifest holder additionally checks boot age, command identity and process-start timing before signaling it. The daemon supervisor separates PID liveness from socket reachability, keeps a live-but-unresponsive daemon as unknown/unreachable rather than routinely killing its shells, and opens its in-memory crash circuit after more than three unexpected exits within sixty seconds. Host shutdown watches its Electron parent and bounds connection drain/disposal, while spawned host-service currently uses an attached child lifecycle. The older version-pin plan's app-version adoption rule and lifecycle document's claim that adoption was removed disagree with current `tryAdopt`; use executable source rather than those historical descriptions.
- **Evidence:** `apps/desktop/src/main/lib/host-service-coordinator.ts:790`–`891`, `:961`–`967`, `:1431`–`1467`; `apps/desktop/src/main/lib/host-service-lock.ts:88`–`102`, `:122`–`141`; `packages/host-service/src/daemon/DaemonSupervisor.ts:230`–`239`, `:641`–`691`, `:1008`–`1075`, `:1352`–`1386`; `apps/desktop/src/main/host-service/index.ts:63`–`87`; `apps/desktop/src/main/host-service/shutdown.ts:75`–`128`; `apps/desktop/plans/done/20260507-host-service-bundled-version-pin.md:60`–`68`; `apps/desktop/docs/HOST_SERVICE_LIFECYCLE.md:63`–`72`.
- **What metatron does today:** Spec §10.2 requires supervised processes and recorded exits; M6 requires bounded retry choice and restart reconciliation (`metatron/spec.md:505`–`508`; `metatron/todo.md:125`–`126`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M6): apply bounded health/identity observations, serialized recovery and retry budgets within the existing local engine. An infrastructure restart must not imply a worker re-submit or task success.
- **Cost if adopted:** Estimated 4–8 hours for supervision policy and fixture integration, overlapping Findings 4–6. Touches no-ambiguous-rerun and correct-session/repository guardrails (`metatron/AGENTS.md:99`, `:101`).
- **Unverified:** Durability of crash budgets across host restart is **UNVERIFIED**; the inspected maps are memory-only. Full desktop/host/PTY process splitting is not proposed for M6. Required org/API auth and optional relay are Superset deployment concerns, not evidence metatron needs them (`apps/desktop/src/main/host-service/env.ts:6`–`16`).

### Finding 9 — Handoff snapshots preserve live descriptors, not a rebooted agent
- **Question:** Is SessionStore's disk snapshot a general crash/restart checkpoint?
- **Their mechanism:** Normal SessionStore and replay retention are in-memory; its on-disk serialization is a transient predecessor-to-successor upgrade handoff. The snapshot contains session IDs, PTY-process PIDs and launch metadata, descriptor indices, replay bytes and terminal mode/color state, excludes exited sessions, and is written through a private temporary file followed by rename. The successor reconstructs sessions using inherited live PTY descriptors; failure closes only successor copies and leaves the predecessor serving. This preserves terminal ownership during a controlled binary swap, not an operation journal that could decide whether an agent's last filesystem mutation completed.
- **Evidence:** `packages/pty-daemon/src/SessionStore/SessionStore.ts:13`–`36`; `packages/pty-daemon/src/SessionStore/snapshot.ts:2`–`23`, `:40`–`63`, `:80`–`105`, `:108`–`136`; `packages/pty-daemon/src/Server/Server.ts:155`–`211`, `:215`–`221`.
- **What metatron does today:** Spec §10.2 defines evidence-based recovery and preservation, not transparent daemon upgrade (`metatron/spec.md:503`–`510`); unchecked M6 scope concerns stop/reconciliation/context policies (`metatron/todo.md:124`–`128`).
- **Gap or confirmation:** gap
- **Verdict:** defer to Future backlog
- **Cost if adopted:** Estimated 3–5 days plus native descriptor-handoff testing; no M6 need established. Touches no-ambiguous-rerun, one-writer and correct-session/repository guardrails (`metatron/AGENTS.md:96`, `:99`, `:101`).
- **Unverified:** Recovery after reboot or abrupt loss of all descriptor holders using this snapshot alone is **UNVERIFIED**; source demonstrates controlled handoff, not that guarantee.

## Five-line summary

1. `Stop` means review/idle evidence, `Failed` means reported turn failure; neither proves task success or a precise auth/quota cause (`packages/shared/src/agent-status.ts:22`; `packages/host-service/src/events/map-event-type.ts:79`).
2. SQLite retains identities, latest lifecycle and stop/resume metadata; ordinary PTY handles/replay and exact exit outcome are not a durable terminal ledger (`packages/host-service/src/db/schema.ts:15`; `packages/pty-daemon/src/SessionStore/SessionStore.ts:27`; `packages/pty-daemon/src/Server/Server.ts:641`).
3. Reattach recovers a surviving process and suppresses its initial command; failed observation still needs an ambiguity decision (`packages/host-service/src/terminal/terminal.ts:3171`, `:3325`; `metatron/spec.md:506`).
4. Superset's automatic native-session relaunch is not metatron's no-ambiguous-rerun rule; preserve the owner recovery barrier (`apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/components/TerminalAgentAutoResume/TerminalAgentAutoResume.tsx:125`; `metatron/spec.md:506`).
5. A vanished worktree blocks reconstruction and exposes owner recovery UI; adopt that diagnosis, durable stop intent and bounded probes for M6 (`packages/host-service/src/terminal/terminal.ts:3054`; `packages/host-service/src/terminal/terminal.ts:2728`; `packages/host-service/src/terminal-agents/daemon-loss-sweep.ts:62`).

## Files read

Metatron inputs (only numbered/excerpted scope where stated):

- `/home/phagmaier/Code/metatron/AGENTS.md`
- `/home/phagmaier/Code/metatron/todo.md` — M6, lines 116–130; heading discovery only elsewhere.
- `/home/phagmaier/Code/metatron/spec.md` — §§9–10, lines 456–514; heading discovery only elsewhere.
- `/home/phagmaier/Code/metatron/docs/progress.md` — tail only.
- `/home/phagmaier/Code/metatron/docs/reference-recon/outputs/00-INDEX.md` — starting Q2 inventory.
- `/home/phagmaier/.codex/skills/codebase-memory/SKILL.md` — exploration instructions.

Reference files below were read in full or in targeted numbered excerpts; paths are relative to `/home/phagmaier/Code/superset`:

- `LICENSE.md`
- `apps/desktop/docs/HOST_SERVICE_LIFECYCLE.md`
- `apps/desktop/plans/20260109-2313-terminal-runtime-abstraction-rewrite.md`
- `apps/desktop/plans/20260405-quit-tray-lifecycle.md`
- `apps/desktop/plans/20260507-1659-agent-lifecycle-hooks-terminal-binding.md`
- `apps/desktop/plans/done/20260507-host-service-bundled-version-pin.md`
- `apps/desktop/plans/done/20260510-host-service-recovery.md`
- `apps/desktop/src/main/host-service/env.ts`
- `apps/desktop/src/main/host-service/index.ts`
- `apps/desktop/src/main/host-service/shutdown.ts`
- `apps/desktop/src/main/lib/host-service-coordinator.ts`
- `apps/desktop/src/main/lib/host-service-lock.ts`
- `apps/desktop/src/main/lib/host-service-manifest.ts`
- `apps/desktop/src/main/lib/stop-pty-daemons.ts`
- `apps/desktop/src/main/lib/terminal/session.ts`
- `apps/desktop/src/main/terminal-host/session.ts`
- `apps/desktop/src/renderer/lib/agent-session-orchestrator/adapters/terminal-adapter.ts`
- `apps/desktop/src/renderer/lib/agent-session-orchestrator/agent-session-orchestrator.ts`
- `apps/desktop/src/renderer/lib/agent-session-orchestrator/types.ts`
- `apps/desktop/src/renderer/lib/terminal/launch-command.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/components/TerminalAgentAutoResume/TerminalAgentAutoResume.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/page.tsx`
- `packages/agent-setup/src/agent-wrappers-claude-codex-opencode.ts`
- `packages/agent-setup/templates/opencode-plugin.template.js`
- `packages/agent-setup/templates/pi-extension.template.ts`
- `packages/host-service/DAEMON_SUPERVISION.md`
- `packages/host-service/drizzle/0002_add_terminal_sessions.sql`
- `packages/host-service/drizzle/0006_ambitious_princess_powerful.sql`
- `packages/host-service/drizzle/0010_reflective_cerebro.sql`
- `packages/host-service/drizzle/0017_nappy_satana.sql`
- `packages/host-service/drizzle/0021_heal_orphaned_terminal_session_workspace_refs.sql`
- `packages/host-service/drizzle/0033_binding_resumed_into.sql`
- `packages/host-service/drizzle/0036_binding_transcript_path.sql`
- `packages/host-service/src/app.ts`
- `packages/host-service/src/daemon/DaemonSupervisor.ts`
- `packages/host-service/src/daemon/manifest.ts`
- `packages/host-service/src/daemon/probe.ts`
- `packages/host-service/src/daemon/singleton.ts`
- `packages/host-service/src/db/db.ts`
- `packages/host-service/src/db/schema.ts`
- `packages/host-service/src/events/event-bus.ts`
- `packages/host-service/src/events/map-event-type.ts`
- `packages/host-service/src/runtime/path-state/path-state.ts`
- `packages/host-service/src/serve.ts`
- `packages/host-service/src/terminal-agents/daemon-loss-sweep.ts`
- `packages/host-service/src/terminal-agents/harness-session-ref.ts`
- `packages/host-service/src/terminal-agents/harness-sessions/index.ts`
- `packages/host-service/src/terminal-agents/persistence.ts`
- `packages/host-service/src/terminal-agents/store.ts`
- `packages/host-service/src/terminal-agents/types.ts`
- `packages/host-service/src/terminal/lifecycle/lifecycle.ts`
- `packages/host-service/src/terminal/reaper/reaper.ts`
- `packages/host-service/src/terminal/terminal.ts`
- `packages/host-service/src/trpc/router/agents/agents.ts`
- `packages/host-service/src/trpc/router/git/utils/resolve-worktree.ts`
- `packages/host-service/src/trpc/router/notifications/fan-out-agent-lifecycle.ts`
- `packages/host-service/src/trpc/router/notifications/notifications.ts`
- `packages/host-service/src/trpc/router/terminal-agents/terminal-agents.ts`
- `packages/host-service/src/trpc/router/workspace/workspace.ts`
- `packages/local-db/drizzle/0011_add_terminal_persistence.sql`
- `packages/local-db/drizzle/0012_add_persist_terminal.sql`
- `packages/local-db/drizzle/0046_drop_dead_persist_terminal_column.sql`
- `packages/local-db/drizzle/0047_restore_persist_terminal_column.sql`
- `packages/local-db/src/schema/schema.ts`
- `packages/pty-daemon/src/Pty/Pty.ts`
- `packages/pty-daemon/src/Server/Server.ts`
- `packages/pty-daemon/src/SessionStore/SessionStore.test.ts`
- `packages/pty-daemon/src/SessionStore/SessionStore.ts`
- `packages/pty-daemon/src/SessionStore/TerminalColors/TerminalColors.differential.test.ts`
- `packages/pty-daemon/src/SessionStore/TerminalColors/TerminalColors.test.ts`
- `packages/pty-daemon/src/SessionStore/TerminalColors/TerminalColors.ts`
- `packages/pty-daemon/src/SessionStore/TerminalColors/index.ts`
- `packages/pty-daemon/src/SessionStore/index.ts`
- `packages/pty-daemon/src/SessionStore/snapshot.test.ts`
- `packages/pty-daemon/src/SessionStore/snapshot.ts`
- `packages/pty-daemon/test/signal-recovery.test.ts`
- `packages/shared/src/agent-status.ts`

Search-only discovery also inspected matches under `packages/host-service/src/**`, `packages/host-service/drizzle/*.sql`, `packages/agent-setup/**`, `packages/shared/src/agent*` and desktop renderer terminal hooks. Test-name/search matches were navigation evidence only; no unexecuted test is reported as passed.

