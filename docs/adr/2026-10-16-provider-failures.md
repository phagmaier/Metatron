# Confirmed provider failures use the human blocker flow

## Context

M6 item 11 (spec §§9.1, 10.1–10.2) requires actionable provider failures without inferring exhaustion from missing usage. The old Pi and Codex mappers grouped limits as `quota`; Pi also classified any mention of auth/credit as a failure. Provider messages can contain secrets. A prequeued Lead wake-up could reopen its failed native thread.

## Decision

- Adapters mark confirmed runtime failures with a validated `providerFailureKind`: auth, rate_limit, credits_exhausted or usage_limit. Ordinary error codes, old journal entries and model text do not establish confirmation. Codex uses exact protocol variants and supported HTTP status fields; `usageLimitExceeded` establishes a usage limit, not exhausted credits. `sessionBudgetExceeded` stays separate from both provider credits and app hard budgets. Pi matches narrow explicit failure statements only in native assistant messages with `stopReason: error`; aborted messages and unavailable usage cannot establish a provider failure.
- Persist normalized error events before shutdown. Only an authoritative failed turn, ended session and successful checkout checks permit a blocking HumanRequest and WAITING_HUMAN. End the attempt, retain its worktree/session/transcript, then release the execution reservation. Uncertain shutdown, checkout problems, cancellation or restart preserve recovery/cancellation and produce a nonblocking evidence notice. A later success or a different final error supersedes earlier failure evidence.
- Finalize the request, metadata and causal event atomically and once per attempt. Requests link the source event and retain the last reported native input/output sample, with null meaning unavailable. Samples may be partial; no account balance, reset time, cost or complete usage total is inferred. Raw provider error text is never added to inbox/journal evidence.
- Hold already queued Lead turns under the same request. Automatic worker notifications cannot reopen a held Lead, including after the owner resolves its request. A new explicit owner turn is required; recovery decisions still take precedence. Worker replies never resume/redispatch; an explicit owner assignment rechecks existing dependencies, identity and budgets. Unrelated work continues.
- Reopening the database finalizes unprocessed confirmed failures as notices without assuming safe suspension, replaying tools or resubmitting a worker. Legacy broadly classified error codes are not upgraded to confirmed failures.

## Consequences

The existing request inbox and actions supply owner guidance and durable history. No credential management, automatic retry, budget relaxation, dependency, migration or toolchain change is introduced. New request metadata defaults to null for old records. Existing preflight capability/login refusals remain setup diagnostics; runtime normalization requires confirmed adapter evidence.

Context7 `/openai/codex` and `/earendil-works/pi`, Codex 0.163.0's generated schema and Pi 1.3.0's bundled message/RPC docs informed the mappings. [Codex protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/CodexErrorInfo.ts), [Pi message errors](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md). Narrow Pi text matching can leave unfamiliar errors unclassified. Protocol fixtures/FAKE tests do not verify real provider classifications; M8's opt-in native smoke gates and M9's visible exhaustion/recovery gate remain outstanding.
