# Retain unfunded workflow children without exempting their launches

Date: 2026-10-17 · Status: accepted for M7 item 6

## Context

The scheduler already commits a worker launch for every ordinary queued assignment and charges each spawned attempt durably. Workflow stages enqueue their children in one transaction. When a stage exceeded the remaining launch budget, the first refusal rolled back every child assignment, leaving the entire stage in Backlog. This prevented even the affordable prefix from progressing and provided no per-child queue evidence. Concurrency caps must continue to count individual workers and actively executing Lead turns, never workflow cards (spec §§7.3–7.5).

## Decision

- Keep the common scheduler, global reader/writer/total reservations and existing ordinary-assignment budget refusal. Every child, including synthesis and retries, uses the same attempt/launch accounting. Failed, interrupted, cancelled or recovered attempts remain charged.
- Prepare all eligible stage inputs and dispatch intents atomically. Fund as many children as the ordinary launch budget permits. Remaining children keep `QUEUED` task state with a `blocked` dispatch, `blockedReason: "launch_budget"`, a visible diagnostic and no attempt or execution reservation.
- Migration v9 adds the typed block reason. Its SQLite constraint permits this reason only on a blocked dispatch with no attempt ID. Older mutation results default the new field to null, preserving idempotent replay without rewriting history.
- Before normal scheduling, admit eligible budget holds in priority/FIFO order if unspent capacity becomes available. Cancelling an unstarted, committed dispatch frees that commitment; releasing a live slot or stopping a spawned attempt never refunds a launch. Admission preserves dispatch generation, owner assignment and pin, rechecks run/mode/human/stage gates, journals the change and does not create an attempt.
- Only explicitly budget-held, unlaunched generations are eligible. Repository/policy blocks and ambiguous recovery never become automatic retries. Paused, stopped, Chat/Plan and human-blocked work remains held.

## Consequences

A workflow may spend its remaining budget on readers and lack a launch for synthesis. Its pending child remains inspectable and the workflow is blocked, not a fabricated partial result. Once all launches are spent, the owner needs a new run with a sufficient budget; no automatic limit increase is introduced. Cancelling only unfunded holds frees no commitment. Existing native execution, worktree safety, authorization and recovery guarantees are unchanged.

## Verification

`mise x -- node --test tests/workflow-scheduling.test.ts tests/workflow-slots.test.ts` covers per-child caps alongside ordinary work and Lead, budget retention, synthesis, priority/FIFO, owner overrides, cancellation versus spent attempts, explicit retry charging, pause/Chat/human/repository holds, rollback, v8 migration and restart. The [FAKE runtime smoke](../evidence/m7-workflow-budgets-smoke.json) observed a one-agent global cap across three workflows and Lead turns, one cancellation-funded admission, and unchanged dispatch/attempt identities after restart. [Browser evidence](../evidence/m7-workflow-budgets-child.png) shows the retained queued child and actionable reason. Native cost-bearing turns remain a later gate.
