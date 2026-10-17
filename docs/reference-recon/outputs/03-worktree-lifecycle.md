# Q4 — Worktree lifecycle reconnaissance

Reference: `/home/phagmaier/Code/superset`, HEAD `491ca53f4cd1d6a4ed06735cfd98a39a12480d67`, obtained with `git -C /home/phagmaier/Code/superset rev-parse HEAD`. All 61 inspected reference files were checked byte-for-byte against that commit. License: Elastic License 2.0 (`LICENSE.md:1`); this report paraphrases mechanisms and copies no implementation.

Citation convention: reference paths below are relative to that absolute reference root; `metatron/…` means `/home/phagmaier/Code/metatron/…`. Reads used absolute filesystem paths. “Today” below describes the requested spec/checklist evidence, **not an independent audit of metatron implementation**. M3 and M5 are checked; M9 remains unchecked (`metatron/todo.md:68`, `metatron/todo.md:102`, `metatron/todo.md:163`). Costs are planning estimates, not measured work.

Method: started at `metatron/docs/reference-recon/outputs/00-INDEX.md` Q4. The graph project list did not contain Superset; coverage checks for every inspected source path returned “project not found or not indexed.” No index was created. Findings therefore use direct, line-numbered source inspection; negative conclusions are bounded to the cited paths and searched lifecycle scopes. No applications, harnesses, test suites, or mutating Git commands were run.

Requested-path verification at this SHA:
- Missing/skipped: `apps/desktop/src/lib/trpc/routers/workspaces/procedures/external-worktree-import.ts`; implementation is instead in `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create.ts:1127`.
- Missing/skipped: both requested `apps/desktop/plans/done/20260420-1045-agent-driven-pr-flow.md` and `apps/desktop/plans/done/20260421-v2-main-workspace-creation.md`. Same basenames exist directly under `apps/desktop/plans/`; these were read as historical plans. The former is explicitly proposed (`apps/desktop/plans/20260420-1045-agent-driven-pr-flow.md:3`); its remote PR mechanism is outside this task's adoption scope (`apps/desktop/plans/20260420-1045-agent-driven-pr-flow.md:9`). The latter describes cloud-backed main-workspace creation, not proof of current local behavior (`apps/desktop/plans/20260421-v2-main-workspace-creation.md:47`).
- Q4 index correction: `apps/desktop/src/screens/main/components/WorkspacesListView/WorkspaceRow/DeleteWorktreeDialog.tsx` is absent. Read the existing `apps/desktop/src/renderer/screens/main/components/WorkspacesListView/WorkspaceRow/DeleteWorktreeDialog.tsx` instead (`apps/desktop/src/renderer/screens/main/components/WorkspacesListView/WorkspaceRow/DeleteWorktreeDialog.tsx:28`).
- All other supplied files exist. Each requested directory contains its component/helper, index, and—in the detached helper directory—a test; all were inspected. Presence/absence was verified with `git cat-file -e <SHA>:<path>`; absent files necessarily have no source line to cite.

### Finding 1 — Tracking an imported worktree does not safely establish deletion ownership
- **Question:** How is ownership recorded, and can deleting a workspace delete a user's worktree?
- **Their mechanism:** Legacy SQLite separates worktrees from active workspaces, recording project, path, branch, base branch, and a `createdBySuperset` flag; import explicitly sets that flag false. However, the inspected legacy deletion procedures use membership in the tracked-path set as their external-worktree safety check, then remove the folder without consulting the provenance flag. Since the selected worktree itself contributes its path to that set, an ordinary imported record does not receive the preservation promised by the schema comment. Host-service workspaces instead hold project/path/branch/type and tombstone metadata, with no creation-provenance field in the inspected table. The external-import “preservation” test checks that files still exist without invoking a delete procedure, so it does not validate preservation.
- **Evidence:** `packages/local-db/src/schema/schema.ts:71`, `packages/local-db/src/schema/schema.ts:88`, `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create.ts:83`, `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create.ts:108`, `apps/desktop/src/lib/trpc/routers/workspaces/procedures/delete.ts:273`, `apps/desktop/src/lib/trpc/routers/workspaces/procedures/delete.ts:493`, `apps/desktop/src/lib/trpc/routers/workspaces/procedures/delete.ts:543`, `packages/host-service/src/db/schema.ts:231`, `apps/desktop/src/lib/trpc/routers/workspaces/procedures/external-worktree-import.test.ts:131`.
- **What metatron does today:** Spec §8.1 requires an app-owned manifest and repository IDs; §8.6 permits only verified, owner-confirmed app-owned cleanup. M3 marks path/ownership persistence complete (`metatron/spec.md:422`, `metatron/spec.md:452`, `metatron/todo.md:70`).
- **Gap or confirmation:** conflict
- **Verdict:** reject + tracking/import must never confer permission to delete a user-created worktree.
- **Cost if adopted:** No implementation proposed; 4–8 hours for an M9 provenance/deletion regression audit. Touches dirty-checkout preservation and one-writer guardrails (`metatron/AGENTS.md:96`, `metatron/AGENTS.md:98`).
- **Unverified:** Actual deletion was not executed. This is a source-supported reachable-path finding, not a reproduced data-loss incident; other deletion entry points are not certified.

### Finding 2 — Delete rechecks dirty state, then the UI can silently force past a race
- **Question:** What happens when the human deletes a dirty worktree or it becomes dirty during deletion?
- **Their mechanism:** The legacy dialog previews uncommitted/unpushed warnings and explicitly describes permanent disk deletion. Host cleanup archives first, then normally blocks uncommitted changes; indeterminate worker failures fail closed, while some ordinary Git-read errors continue into cleanup. Its renderer silently retries a dirty-state conflict with `force: true`, treating the earlier confirmation as sufficient. The removal worker defaults to double-force even when the outer destroy request was unforced; optional branch cleanup uses `branch -D`. Legacy removal instead renames the worktree to a sibling `.superset-delete-<UUID>`, prunes metadata, and launches background recursive deletion.
- **Evidence:** `apps/desktop/src/renderer/screens/main/components/WorkspacesListView/WorkspaceRow/DeleteWorktreeDialog.tsx:58`, `apps/desktop/src/renderer/screens/main/components/WorkspacesListView/WorkspaceRow/DeleteWorktreeDialog.tsx:89`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:295`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:305`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:326`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarDeleteDialog/hooks/useDestroyDialogState/useDestroyDialogState.ts:132`, `packages/host-service/src/workers/tasks/git.ts:360`, `packages/host-service/src/workers/tasks/git.ts:383`, `packages/host-service/src/workers/tasks/git.ts:421`, `apps/desktop/src/lib/trpc/routers/workspaces/utils/git.ts:817`.
- **What metatron does today:** M5 requires immediate human confirmation plus destination SHA/cleanliness revalidation and preserves blocked worktrees; spec prohibits overwriting local changes (`metatron/todo.md:110`, `metatron/todo.md:111`, `metatron/spec.md:451`).
- **Gap or confirmation:** conflict
- **Verdict:** reject + a new dirty state invalidates prior consent; never silently escalate destructive force or apply this deletion policy to user worktrees.
- **Cost if adopted:** No destructive adoption; 4–8 hours for M9 dirty-race/unknown-state fixtures. Touches dirty checkout preservation and ambiguous mutation recovery (`metatron/AGENTS.md:98`, `metatron/AGENTS.md:99`).
- **Unverified:** A filesystem write between server preflight and forced removal was not reproduced. No claim that every status error bypasses the check.

### Finding 3 — Startup automatically finishes tombstoned deletes under specific guards
- **Question:** Do crash leftovers get cleaned automatically, and under what guard?
- **Their mechanism:** Host startup invokes an archived-workspace reconciler outside sandbox run mode. It selects archived rows excluding soft-deleted projects, requires an existing path with no live workspace owner, checks folder birthtime against archive time and the checked-out branch against the recorded branch, then rechecks live ownership immediately before destruction. It resumes with no branch deletion, `force: false`, and best-effort teardown; dirty preflight failure unarchives the record. This outer “no force” does not disable the removal worker's default double-force, because destroy omits that option when calling removal. Thus this is automatic replay of a recorded delete intent, not a demonstrated general garbage collector for every untracked directory.
- **Evidence:** `packages/host-service/src/app.ts:377`, `packages/host-service/src/app.ts:386`, `packages/host-service/src/runtime/archived-workspace-reconcile.ts:21`, `packages/host-service/src/runtime/archived-workspace-reconcile.ts:43`, `packages/host-service/src/runtime/archived-workspace-reconcile.ts:56`, `packages/host-service/src/runtime/archived-workspace-reconcile.ts:68`, `packages/host-service/src/runtime/archived-workspace-reconcile.ts:91`, `packages/host-service/src/runtime/archived-workspace-reconcile.ts:126`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:397`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:572`, `packages/host-service/src/workers/tasks/git.ts:360`.
- **What metatron does today:** M3 includes crash-retention fixtures; §8.6 forbids garbage collection of active/unresolved work and requires owner confirmation. M9 includes restart exercise (`metatron/todo.md:71`, `metatron/spec.md:452`, `metatron/todo.md:166`).
- **Gap or confirmation:** conflict
- **Verdict:** reject + do not automatically resume ambiguous destructive work after a crash. Proposed M9 use is diagnostic reconciliation and a human decision, preserving files.
- **Cost if adopted:** 1–2 days for non-destructive reconciliation fixtures/UI proposal; no implementation authorized here. Touches crash/disconnect no-auto-rerun and one-writer guardrails (`metatron/AGENTS.md:99`, `metatron/AGENTS.md:96`).
- **Unverified:** Birthtime plus branch equality is not verified as a unique worktree identity. A repo-wide claim that no other orphan collector exists is UNVERIFIED; no sweep of arbitrary live worktree directories was established.

### Finding 4 — One workspace can launch multiple agents into the same checkout
- **Question:** Is a Superset worktree owned by one writable agent?
- **Their mechanism:** Workspace creation accepts an array of agent launches and dispatches them using the same workspace ID. Dispatch uses `Promise.all`; the agent entry point resolves that workspace and sends chat launches its stored worktree path. These inspected layers therefore associate the checkout with the workspace, not with an exclusive implementation attempt. The host schema also allows “local” workspaces that share the project's primary checkout.
- **Evidence:** `packages/host-service/src/trpc/router/workspaces/workspaces.ts:131`, `packages/host-service/src/trpc/router/workspaces/workspaces.ts:1343`, `packages/host-service/src/trpc/router/workspace-creation/shared/dispatch-agents.ts:25`, `packages/host-service/src/trpc/router/agents/agents.ts:777`, `packages/host-service/src/trpc/router/agents/agents.ts:817`, `packages/host-service/src/db/schema.ts:258`.
- **What metatron does today:** §8.2 requires one writable worktree per active implementation attempt; M3 marks lock-ownership fixtures complete (`metatron/spec.md:427`, `metatron/todo.md:71`).
- **Gap or confirmation:** conflict
- **Verdict:** reject + workspace-level grouping is insufficient authority for several writers; preserve attempt-level exclusive leases.
- **Cost if adopted:** No shared-writer adoption; 2–4 hours to include same-workspace dispatch in the M9 audit. Touches one-writer and individual-agent fan-out counting (`metatron/AGENTS.md:96`, `metatron/AGENTS.md:102`).
- **Unverified:** Whether deeper harness-specific launch paths enforce additional write restrictions is UNVERIFIED. Concurrent dispatch proves neither actual simultaneous file writes nor a secure read-only mode.

### Finding 5 — Missing folders remain visible as records with a recovery screen
- **Question:** What happens after a human moves or deletes a worktree outside Superset?
- **Their mechanism:** Host workspace reads preserve the SQLite row and compute `worktreeExists` from the stored filesystem path; absence is not record deletion. The page refetches on window focus and replaces workspace content with a missing-worktree screen when existence is false. That screen explains that terminals/file actions are unavailable, displays the path, and offers Delete workspace, Refresh, and Browse workspaces; it has no locate/relink control. Git API resolution separately returns a typed missing-path cause and distinguishes inaccessible paths as forbidden. Inference: moving the folder away from the stored path produces the same missing-path surface until metadata/path is reconciled; restoring the path and refreshing can clear that particular check.
- **Evidence:** `packages/host-service/src/trpc/router/workspace/workspace.ts:20`, `packages/host-service/src/trpc/router/workspace/workspace.ts:34`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/page.tsx:121`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx:37`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx:65`, `packages/host-service/src/trpc/router/git/utils/resolve-worktree.ts:26`, `packages/host-service/src/runtime/path-state/path-state.ts:20`.
- **What metatron does today:** §8.1 specifies repository/path validation; M9 requests restart with visible statuses and correct repository/worktree association. The requested spec/checklist excerpts do not specify a dedicated missing-folder screen (`metatron/spec.md:419`, `metatron/todo.md:166`, `metatron/todo.md:168`).
- **Gap or confirmation:** gap
- **Verdict:** adopt now (M9) — explicit missing/inaccessible diagnostics, retained task evidence, and a safe recheck action. Do not adopt destructive Delete semantics from Findings 1–3.
- **Cost if adopted:** 1 day for boundary diagnostics and disposable missing/moved/permission fixtures. Touches wrong-repository session prevention and no ambiguous automatic rerun (`metatron/AGENTS.md:101`, `metatron/AGENTS.md:99`).
- **Unverified:** End-to-end recovery after restoring a folder was not run. The existence boolean alone does not verify Git registration, branch identity, or candidate integrity; a same-path replacement can pass that check.

### Finding 6 — Root containment and primary-checkout protection are separate checks
- **Question:** How does deletion handle a missing main repository or partially removed worktree?
- **Their mechanism:** Host cleanup recognizes the primary checkout by either local workspace type or normalized path equality and skips teardown, worktree removal, and branch deletion for that case. If the project repository is missing, direct recursive worktree deletion requires canonical containment strictly beneath the project's managed root; outside-root paths are retained with a warning. After Git removal it checks both registration and remaining disk state: still-registered failure unarchives; an unregistered leftover gets a guarded direct-removal fallback. The containment helper resolves symlinks and accepts current and historical project folder forms. These guards protect fallback deletion, but normal Git removal is not subjected to that same managed-root gate.
- **Evidence:** `packages/host-service/src/trpc/router/workspace-cleanup/is-local-checkout-workspace.ts:49`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:353`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:470`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:510`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:565`, `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts:595`, `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-paths.ts:87`, `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-paths.ts:116`.
- **What metatron does today:** §8.1 requires an app ownership manifest; §8.6 limits cleanup to app-owned, verified work after owner confirmation. M9 explicitly audits dangerous paths (`metatron/spec.md:422`, `metatron/spec.md:452`, `metatron/todo.md:165`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M9) — add canonical containment, primary-checkout identity, and registry-versus-disk disagreement to the existing safety audit. Containment supplements provenance; do not adopt recursive deletion fallback.
- **Cost if adopted:** 4–8 hours for disposable path/symlink/missing-root/partial-removal fixtures. Touches dirty checkout preservation, one-writer isolation, and repository identity (`metatron/AGENTS.md:98`, `metatron/AGENTS.md:96`, `metatron/AGENTS.md:101`).
- **Unverified:** Current metatron coverage of these edge cases was not inspected. Containment is not proven race-free against concurrent filesystem replacement.

### Finding 7 — Branch-based paths, collision handling, and post-checkout verification
- **Question:** How are worktrees created and named?
- **Their mechanism:** Legacy resolution chooses project override, global base, then the documented default `~/.superset/worktrees`, appending project name and branch. Host creation uses the same broad base/project/branch scheme, sanitizes project folders, and suffixes colliding project names with eight project-ID characters; path resolution rejects branch traversal outside the project root. Automatically named branches use a prompt slug or friendly random name plus eight ID characters, optional prefix, and deduplication; typed/existing branches follow a separate planner. Creation uses argument arrays for existing-branch or new-`-b` worktrees; a post-checkout hook failure can be tolerated only after confirming the expected registered path/branch and a resolvable HEAD. Stored absolute paths remain distinct from later branch names; the naming helper documents keeping the directory unchanged.
- **Evidence:** `apps/desktop/src/lib/trpc/routers/workspaces/utils/resolve-worktree-path.ts:7`, `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-paths.ts:16`, `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-paths.ts:50`, `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-paths.ts:75`, `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-paths.ts:152`, `packages/host-service/src/trpc/router/workspaces/workspaces.ts:1069`, `packages/host-service/src/trpc/router/workspaces/workspaces.ts:1119`, `packages/host-service/src/trpc/router/workspace-creation/shared/add-branch-worktree.ts:20`, `packages/host-service/src/trpc/router/workspace-creation/shared/add-branch-worktree.ts:43`, `packages/host-service/src/trpc/router/workspace-creation/shared/sparse-checkout.ts:172`, `packages/host-service/src/trpc/router/workspace-creation/utils/ai-workspace-names.ts:519`.
- **What metatron does today:** M3 marks argv-safe creation, unique attempt-owned names under XDG data, and persisted ownership complete; §5.2 binds a session to an absolute attempt cwd (`metatron/todo.md:68`, `metatron/todo.md:70`, `metatron/spec.md:270`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M9) — verify collisions, path traversal, persisted path identity, and partial-success diagnostics against the existing M3 design. Keep metatron's XDG/attempt scheme; no AI naming subsystem is proposed.
- **Cost if adopted:** 4–8 hours for creation-boundary fixtures. Touches one-writer isolation and wrong-repository/session prevention (`metatron/AGENTS.md:96`, `metatron/AGENTS.md:101`).
- **Unverified:** Harmless versus harmful post-checkout hook side effects are not distinguished by the cited registration/HEAD test. No claim of whole-operation atomicity.

### Finding 8 — Orphans are discoverable/adoptable; stale registrations are pruned on create
- **Question:** What about untracked leftovers after creation crashes, moved worktrees, or renamed branches?
- **Their mechanism:** The host lists Git's porcelain records, preserves locked/prunable flags, filters prunable/branchless records from adoption lists, and identifies tracked trees by branch or normalized path. Creation automatically invokes `worktree prune` before non-local checkout creation; this is repository-wide metadata pruning, not demonstrated recursive collection of arbitrary leftover folders. A registered tree without a workspace row is treated as an adoption target, while a branch rename at the same path can update the existing row; a bare directory unknown to Git is outside these discovery paths. Explicit-path adoption reads the actual branch, but branch-only creation first returns an existing live DB row without checking whether its stored path still exists, so it is not a demonstrated move-repair flow. Failed persistence invokes a rollback that force-removes the specifically captured newly-created path; sparse-checkout failure has another force-removal rollback. Legacy deletion's sibling temporary directory is removed in a detached process, leaving failure/crash recovery of that temporary directory unestablished.
- **Evidence:** `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-list.ts:12`, `packages/host-service/src/trpc/router/workspace-creation/procedures/list-project-worktrees.ts:42`, `packages/host-service/src/trpc/router/workspaces/workspaces.ts:730`, `packages/host-service/src/trpc/router/workspace-creation/procedures/search-branches.ts:59`, `packages/host-service/src/trpc/router/workspace-creation/shared/adopt-existing-worktree.ts:161`, `packages/host-service/src/trpc/router/workspace-creation/procedures/adopt.ts:38`, `packages/host-service/src/trpc/router/workspaces/workspaces.ts:232`, `packages/host-service/src/trpc/router/workspaces/workspaces.ts:1136`, `packages/host-service/src/trpc/router/workspaces/workspaces.ts:1180`, `packages/host-service/src/trpc/router/workspaces/workspaces.ts:501`, `packages/host-service/src/trpc/router/workspace-creation/shared/sparse-checkout.ts:209`, `apps/desktop/src/lib/trpc/routers/workspaces/utils/git.ts:824`.
- **What metatron does today:** §8.1 requires a manifest keyed to repository IDs; M3 includes crash retention and M5 preserves unresolved work (`metatron/spec.md:422`, `metatron/todo.md:71`, `metatron/todo.md:111`).
- **Gap or confirmation:** gap
- **Verdict:** defer to Future backlog — general external import/re-adoption/move repair. Reject using absence of a DB row as cleanup authority or importing automatic forced rollback; M9 diagnostic reconciliation is scoped in Findings 3 and 5.
- **Cost if adopted:** 2–3 days for explicit human-directed import/relink with provenance and repository verification. Touches wrong-repository association, one-writer ownership, and crash retention (`metatron/AGENTS.md:101`, `metatron/AGENTS.md:96`, `metatron/AGENTS.md:99`).
- **Unverified:** An automatic move detector, generic orphan-folder sweep, and `.superset-delete-*` retry sweep are UNVERIFIED. Source establishes invocation of prune, not the outcome for every stale registration or Git expiry setting.

### Finding 9 — Detached migration preserves files but changes branch identity
- **Question:** How are detached HEAD and dirty checkouts handled outside deletion?
- **Their mechanism:** Legacy bulk-import selection skips the main checkout, bare trees, detached trees, and trees without a branch; the banner asks the human to import discovered closed trees. A separate migration endpoint handles detached trees by reading HEAD, selecting a free preferred/recovered branch with numeric suffixes, and issuing `switch --create` at the current commit; its fixture asserts an uncommitted file survives. Legacy branch-switch safety refuses tracked changes and untracked files, asking the human to resolve them rather than performing an automatic stash in that helper. These are different paths: import filtering does not perform detached recovery, and a checkout refusal is not proof that every new-worktree creation requires a clean root.
- **Evidence:** `apps/desktop/src/lib/trpc/routers/workspaces/utils/select-external-worktrees-for-import.ts:18`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/project/$projectId/components/ExternalWorktreesBanner/ExternalWorktreesBanner.tsx:24`, `apps/desktop/src/renderer/routes/_authenticated/_dashboard/project/$projectId/components/ExternalWorktreesBanner/ExternalWorktreesBanner.tsx:99`, `apps/desktop/src/lib/trpc/routers/migration/index.ts:136`, `apps/desktop/src/lib/trpc/routers/migration/utils/branch-detached-worktree/branch-detached-worktree.ts:8`, `apps/desktop/src/lib/trpc/routers/migration/utils/branch-detached-worktree/branch-detached-worktree.test.ts:35`, `apps/desktop/src/lib/trpc/routers/workspaces/utils/git.ts:1565`.
- **What metatron does today:** §8.1 defaults to a clean owner checkout; §8.3 permits a separate reviewer worktree at a candidate commit. M3 marks clean-root refusal complete (`metatron/spec.md:420`, `metatron/spec.md:431`, `metatron/todo.md:69`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** defer to Future backlog — detached external-worktree import/migration. Retain existing dirty-root refusal; do not require reviewer snapshots at candidate commits to acquire branches merely to resemble Superset.
- **Cost if adopted:** 1–2 days for an owner-directed recovery flow with dirty/detached fixtures. Touches dirty checkout preservation and stable repository/session association (`metatron/AGENTS.md:98`, `metatron/AGENTS.md:101`).
- **Unverified:** Migration UI confirmation and all callers' authorization are UNVERIFIED. The fixture was read, not executed; global absence of automatic stash/reset across Superset is not claimed.

## Five-line summary

1. Worktrees are workspace-associated paths under a configurable base/project/branch scheme; metatron should retain XDG attempt ownership (`packages/host-service/src/trpc/router/workspace-creation/shared/worktree-paths.ts:68`; `metatron/todo.md:70`).
2. Imported provenance exists in legacy storage but is not checked in the inspected deletion path; reject treating registration as ownership (`packages/local-db/src/schema/schema.ts:90`; `apps/desktop/src/lib/trpc/routers/workspaces/procedures/delete.ts:493`).
3. Missing folders retain records and surface Refresh/Delete/Browse; safe recheck and permission-aware errors fit M9 (`apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx:37`; `packages/host-service/src/trpc/router/git/utils/resolve-worktree.ts:26`).
4. Automatic startup cleanup resumes guarded archived deletes, while create prunes stale Git metadata; no general orphan-folder collector was established (`packages/host-service/src/runtime/archived-workspace-reconcile.ts:43`; `packages/host-service/src/trpc/router/workspaces/workspaces.ts:730`).
5. Reject silent force escalation, automatic destructive crash replay, and shared-writer assumptions; adopt only cited M9 safety checks and diagnostics (`apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarDeleteDialog/hooks/useDestroyDialogState/useDestroyDialogState.ts:142`; `packages/host-service/src/runtime/archived-workspace-reconcile.ts:68`; `packages/host-service/src/trpc/router/workspace-creation/shared/dispatch-agents.ts:31`).

## Files read

Reference files below were read in full or in targeted line-numbered excerpts; some supporting searches were scoped more broadly. All paths are under `/home/phagmaier/Code/superset/`:
- `LICENSE.md`
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/worktree.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/resolve-worktree-path.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/select-external-worktrees-for-import.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/git.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/utils/teardown.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/procedures/delete.ts`
- `apps/desktop/src/lib/trpc/routers/workspaces/procedures/external-worktree-import.test.ts`
- `apps/desktop/src/renderer/react-query/workspaces/useDeleteWorktree.ts`
- `apps/desktop/src/renderer/react-query/workspaces/useOpenExternalWorktree.ts`
- `apps/desktop/src/renderer/react-query/workspaces/useHandleOpenedWorktree.ts`
- `apps/desktop/src/renderer/react-query/workspaces/bootstrap-open-worktree.ts`
- `apps/desktop/src/renderer/react-query/workspaces/useImportExternalWorktrees.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/WorkspaceMissingWorktreeState.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceMissingWorktreeState/index.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/project/$projectId/components/ExternalWorktreesBanner/ExternalWorktreesBanner.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/project/$projectId/components/ExternalWorktreesBanner/index.ts`
- `apps/desktop/src/lib/trpc/routers/changes/utils/worktree-status-caches.ts`
- `apps/desktop/src/lib/trpc/routers/migration/utils/branch-detached-worktree/branch-detached-worktree.ts`
- `apps/desktop/src/lib/trpc/routers/migration/utils/branch-detached-worktree/branch-detached-worktree.test.ts`
- `apps/desktop/src/lib/trpc/routers/migration/utils/branch-detached-worktree/index.ts`
- `apps/desktop/src/lib/trpc/routers/migration/index.ts`
- `apps/desktop/src/shared/types/worktree.ts`
- `apps/desktop/src/shared/worktree-id.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/page.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/components/OrphanedBanner/OrphanedBanner.tsx`
- `apps/desktop/src/renderer/components/NewWorkspaceModal/components/PromptGroup/utils/resolveOpenableWorktrees/resolveOpenableWorktrees.ts`
- `apps/desktop/src/renderer/routes/_authenticated/settings/components/V2WorktreeLocationPicker/V2WorktreeLocationPicker.tsx`
- `apps/desktop/src/renderer/screens/main/components/WorkspacesListView/WorkspaceRow/DeleteWorktreeDialog.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarDeleteDialog/hooks/useDestroyDialogState/useDestroyDialogState.ts`
- `apps/desktop/src/main/dev-app-profile-sweep.ts`
- `apps/desktop/docs/WORKSPACE_DELETE_LIFECYCLE.md`
- `apps/desktop/plans/20260420-1045-agent-driven-pr-flow.md`
- `apps/desktop/plans/20260421-v2-main-workspace-creation.md`
- `packages/local-db/src/schema/schema.ts`
- `packages/host-service/src/db/schema.ts`
- `packages/host-service/src/app.ts`
- `packages/host-service/src/runtime/archived-workspace-reconcile.ts`
- `packages/host-service/src/runtime/path-state/path-state.ts`
- `packages/host-service/src/workers/tasks/git.ts`
- `packages/host-service/src/trpc/router/workspace-cleanup/workspace-cleanup.ts`
- `packages/host-service/src/trpc/router/workspace-cleanup/git-ops.ts`
- `packages/host-service/src/trpc/router/workspace-cleanup/is-local-checkout-workspace.ts`
- `packages/host-service/src/trpc/router/workspace-cleanup/remove-directory-tree.ts`
- `packages/host-service/src/trpc/router/workspaces/workspaces.ts`
- `packages/host-service/src/trpc/router/workspace/workspace.ts`
- `packages/host-service/src/trpc/router/agents/agents.ts`
- `packages/host-service/src/trpc/router/git/utils/resolve-worktree.ts`
- `packages/host-service/src/trpc/router/workspace-creation/shared/add-branch-worktree.ts`
- `packages/host-service/src/trpc/router/workspace-creation/shared/adopt-existing-worktree.ts`
- `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-paths.ts`
- `packages/host-service/src/trpc/router/workspace-creation/shared/worktree-list.ts`
- `packages/host-service/src/trpc/router/workspace-creation/shared/branch-search.ts`
- `packages/host-service/src/trpc/router/workspace-creation/shared/sparse-checkout.ts`
- `packages/host-service/src/trpc/router/workspace-creation/shared/require-independent-worktree.ts`
- `packages/host-service/src/trpc/router/workspace-creation/shared/dispatch-agents.ts`
- `packages/host-service/src/trpc/router/workspace-creation/procedures/adopt.ts`
- `packages/host-service/src/trpc/router/workspace-creation/procedures/list-project-worktrees.ts`
- `packages/host-service/src/trpc/router/workspace-creation/procedures/search-branches.ts`
- `packages/host-service/src/trpc/router/workspace-creation/utils/ai-workspace-names.ts`

Metatron scope (only the requested spec sections and milestone bodies; heading search also used):
- `/home/phagmaier/Code/metatron/AGENTS.md`
- `/home/phagmaier/Code/metatron/todo.md` — M3, M5, M9
- `/home/phagmaier/Code/metatron/spec.md` — §§5 and 8 only
- `/home/phagmaier/Code/metatron/docs/reference-recon/outputs/00-INDEX.md` — reconnaissance index, especially Q4

Operational skill instructions read:
- `/home/phagmaier/.codex/skills/codebase-memory/SKILL.md`
- `/home/phagmaier/.agents/skills/context7-mcp/SKILL.md` — documentation lookup was not applied to this source-review task.
