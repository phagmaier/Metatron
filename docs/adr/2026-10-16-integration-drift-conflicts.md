# M5: destination drift and merge conflicts in integration previews

## Context

Spec §8.6.3 and acceptance scenario F require detecting base drift and real merge conflicts, never silently choosing sides or letting the last writer win. Item 6 failed every preview whose destination had moved. Spec §7.1 places `BLOCKED_CONFLICT` after `READY_TO_INTEGRATE`, which owner approval (item 8) has not introduced yet.

## Decision

- **Drift is presented, then merged in isolation.** When the destination differs from the candidate base, the engine records how it moved before any Git mutation: merge base, whether the base is still an ancestor, commit count, the files changed on the destination (bounded) and the files both sides changed. It records this as a `destination` warning. A destination with no shared history fails with no worktree. Otherwise the integration worktree is created at the destination SHA and the candidate is merged with `--no-ff`, a fixed app identity and the preview's timestamp. `rerere`, autostash and signature verification are disabled for that command. The owner's branches and checkout are untouched.
- **Conflicts are recorded, never resolved.** A merge that leaves unmerged paths gives the preview the status `conflict` and records the paths. No tests run and no diff artifact is saved. The conflicted state stays in the retained worktree. A nonblocking, high-urgency `manual_check` "Needs you" request is written in the same transaction. The engine never aborts, resolves or retries the merge, and a later preview starts again in a new worktree.
- **Overlap is surfaced.** Files changed on both sides that Git merged cleanly produce an `overlap` warning (the preview can still pass). If a built-in `union` or a custom merge driver (`git check-attr --source` at the destination and the candidate) applies to an overlapping file, the merge could have hidden a conflict, so the preview fails for owner review.
- **The diff rule is generalised.** The integration may change only paths in the reviewed candidate. It must keep the candidate's exact content except in files the destination also changed. Secret-path and `git diff --check` checks are unchanged. With no drift this still means the result is exactly the candidate.
- **Task and candidate states are unchanged.** A conflict concerns one destination SHA, not the candidate itself, so it lives on the preview record. The `READY_TO_INTEGRATE → BLOCKED_CONFLICT` transition belongs to approval/application (items 8–9), which must require a passing preview against the current destination.

## Consequences

The owner sees why integration is unsafe and which files collide; a moved destination with separate changes now yields a testable merge preview. An agent-run, scoped conflict-resolution task in the integration worktree (spec §8.6.3) is **not** implemented: it needs writer attempts in integration worktrees and capture of a resolved merge as a new candidate, and no current checklist item schedules it. Until then the owner reconciles the destination or requests a revision and prepares a new preview. No dependency, toolchain, migration or spec change; earlier preview records read with empty drift/conflict fields.
