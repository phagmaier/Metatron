# M6: per-assignment context policies and session lineage

## Context

Spec §6.3 defines three context policies. `auto`, the default, reuses the native session when continuing or revising the same task or after a human unblock, and starts fresh for unrelated work. `fresh` always starts a new native session with a handoff. `resume` takes an explicit session and, if it is unavailable, asks for authorization of a fresh fallback with a generated checkpoint. Session IDs must never be silently attached to a different project or worktree. Spec §10.2 prefers native resume after a safe recovery decision.

Before this item, every worker session started `fresh` and nothing linked a successor to its predecessor. The Lead already resumed its own Codex thread. Nothing allowed a `WAITING_HUMAN` task to continue once its blockers were resolved. The installed Pi 1.3.0 keeps native session files (`--session`, `switch_session`), but this adapter does not reopen them, and every native attempt gets a new worktree path.

## Decision

- **Policy per assignment.** Owner assignment, the Lead's `assign_task` (now `lao-tools/4`) and recovery retries accept `contextPolicy` (`auto` by default) and `resumeSessionId`, which `resume` requires and the other policies reject. Migration 7 stores both on the dispatch. Rows queued before this change read `fresh`, which was their behaviour when queued.
- **Lineage.** Continuing work has one predecessor: the task's latest earlier attempt or, for a revision's first attempt, its source task's latest attempt. Unrelated work has none, so it cannot reach another task's session.
- **Resume gate.** A session resumes only when all of these hold:
  - It is the same task's session, not a review or a revision.
  - The adapter can reopen sessions across attempts. FAKE can, in simulation; Pi, Codex workers, Claude Code and OpenCode cannot yet.
  - The profile and harness are unchanged.
  - The checkout path is unchanged.
  - The session ended cleanly: it is `exited` or `idle`, with no recovery flag, no crashed, disconnected or recovery-required cause, and only confirmed stops.
  - Its native ID is not recorded for another run or checkout.
- **Outcomes by policy.**
  - `auto` resumes when the gate passes, and otherwise starts fresh with the reason recorded.
  - `fresh` always starts fresh.
  - An explicit `resume` that fails the gate is refused at assignment, so nothing is queued and a recovery decision rolls back. The refusal tells the owner or Lead to assign `fresh`; that is the authorization. If facts change before launch, the executor fails the attempt before any session exists, leaving a retry decision.
- **Checkpoint.** A fresh successor of the same task gets an artifact the app builds from records only. It holds the attempt status and cause, the session and transcript reference, the latest structured result, progress notes, owner requests and responses, and the captured changed paths. It is appended to the context packet. It is not a transcript and grants no permission.
- **Links.** Each session records `context` (effective policy, reason, predecessor attempt and session, checkpoint artifact) and `transcriptPath`, and a `context.planned` event is journaled. Pi reports its app-owned `pi-sessions/<attempt>` directory. Lead sessions link the thread they resume.
- **Continuing after a human wait.** The owner's assignment of a `WAITING_HUMAN` task is the explicit continuation required by spec §9.3. It rechecks every blocker, unfinished attempts, dependencies and budgets. The Lead cannot continue it, and replies alone never do.

## Consequences

No real harness worker resumes yet. Pi successors always start fresh with a checkpoint in a new worktree, so uncommitted work from the earlier attempt stays only in its retained checkout. Reopening Pi sessions in their original worktree belongs to M8's adapter revisit and smoke step #4. FAKE resume is a labelled simulation. Older sessions have no context and show as "recorded before context policies". The GUI shows the policy choice, lineage and transcript path.
