# M5: revision handoff and parent reconciliation

## Context

M5 item 5 completes the M4 revision stub: it left the source task in `CHANGES_REQUESTED`, created a child, and never reconciled the parent. A native child also started at the run base instead of the candidate it was meant to revise. Spec §8.5 permits a fresh attempt with an explicit handoff and requires preserved review history and bounded revision cycles.

## Decision

- Retain revision children and every prior attempt, candidate, report, review and worktree. Engine-owned task fields record the source task, immutable source candidate and latest revision. Generic task CRUD cannot supply them. JSON defaults preserve existing records without a SQL migration; journal-only M4 links remain readable. Ordinary task parents are not revision ancestry.
- A revision inherits the implementer's profile and permission class. Owner pins carry forward. Supervised Lead requests remain proposals until the owner assigns a worker; direct owner requests can queue immediately. Chat/Plan and worker scheduling denials remain enforced. Each request consumes a cycle in the explicit revision lineage, including cancelled children, and each attempt consumes the normal launch budget. Invalid requests roll back creation, links, transitions and events together.
- Native revisions use fresh harness context and a separate app-owned worktree at the recorded source candidate. Revalidate its create-only branch, repository identity and run base before creating the worktree. A saved reference artifact holds the bounded handoff: original objective/criteria, feedback, previous result and findings. Task cards show the objective/feedback. No source checkout or earlier worktree is overwritten.
- Capture a cumulative candidate against the original run base. The private index retains prior captured additions without requiring the worker to redeclare them; new additions still need declaration and all existing path/secret/HEAD checks apply. A revision that reverts the entire implementation can produce a new empty-tree-diff candidate for review.
- Successful completion and parent reconciliation share one transaction. After authoritative completion, shutdown and Git checks, a writer must have a new persisted candidate; only then can waiting ancestors move `CHANGES_REQUESTED → AWAITING_REVIEW`. Failed, interrupted or recovered children keep parents waiting for an explicit child retry. Cancelling an implementation stops its current revision and completion never revives a cancelled parent. After cancelling a child, the owner may explicitly request another bounded revision from the last successful source.
- Review requests on the original task select the current revision candidate. Reviewer packets contain the original objective and revision feedback, excluding implementer handoff reports. Report reads include revision history. Owner API/GUI controls expose feedback and the current revision. No revision or recommendation grants integration authority.
- Startup may reconcile already completed, durable revision results, including journal-only children. It never launches an attempt or adopts an ambiguous/unrecorded candidate. Repeated reconciliation is idempotent.

## Consequences

The original task remains the stable entry point while child IDs preserve execution history. New revised candidates require independent review; old reviews stay attached to their original candidates. Future integration must resolve the current implementation rather than selecting an older candidate by the original task ID. Native session resumption and interrupted-work steering remain M6; isolated integration and final owner approval remain subsequent M5 items. No dependency, toolchain or spec change.
