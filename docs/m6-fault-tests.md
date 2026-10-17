# M6 item 12: deterministic fault-test gate

All cases use FakeAdapter, committed SQLite fixtures or local protocol subprocesses in disposable Git repositories. No model/provider is contacted. Protocol subprocesses exercise our adapter boundary; they do not verify a live native harness. Browser rendering and live native behavior remain M9 and M8 gates respectively.

| Fault or intervention | Automated evidence | Required outcome |
| --- | --- | --- |
| Delayed tool without tokens | [runtime-faults.test.ts](../tests/runtime-faults.test.ts), delayed-tool case | Session stays busy with its reservation while an unrelated worker finishes; dependent work waits. Pause and HTTP inspection preserve the live session. Releasing the tool permits authoritative completion. |
| Delayed approval and explicit denial | [fake-adapter.test.ts](../tests/fake-adapter.test.ts), delayed-approval case; [human-waits.test.ts](../tests/human-waits.test.ts), permission wait | An unrelated result, steer or stale approval cannot advance the pending request. Denial cannot execute the following tool. Persisted permission waits recover without native resume. This is simulated permission behavior; owner-driven native approval remains unsupported. |
| Hard quota exhausted | [provider-failures.test.ts](../tests/provider-failures.test.ts), confirmed-failure matrix; [recovery-decisions.test.ts](../tests/recovery-decisions.test.ts), launch-budget case | Completing a provider blocker cannot bypass the independent launch cap. Refused decisions roll back and do not launch. |
| Ambiguous disconnect, crash, clean exit or stream end without completion | [runtime-faults.test.ts](../tests/runtime-faults.test.ts), four fault cases | Keep distinct recovery causes and native event/exit evidence, retain unfinished files and session IDs, and start nothing on app restart or recheck. An explicit owner decision starts one successor in a different worktree; replaying its key and restarting do not duplicate it. |
| Missing, inaccessible or same-path-replaced checkout with a surviving worker | [restart-reconciliation.test.ts](../tests/restart-reconciliation.test.ts), surviving-worker matrix; [recovery-decisions.test.ts](../tests/recovery-decisions.test.ts), same-path Git checkout | Observe worker PID/identity, native session and unfinished tool evidence independently of the folder. Capture and unaccepted recovery are refused. Recheck and a second restart cannot launch, signal, relink or delete; the worker and original unfinished file survive. |
| Repository identity changed, stale facts or reused PID | [recovery-decisions.test.ts](../tests/recovery-decisions.test.ts), stale/repository cases; [restart-reconciliation.test.ts](../tests/restart-reconciliation.test.ts), reused-PID case | Refuse changed or unaccepted facts atomically; existence of the same path/PID cannot confer the prior identity. |
| Pending, failed or uncertain stop | [stops.test.ts](../tests/stops.test.ts), pending-crash and failed/uncertain cases | Intent is durable before signalling. Reopening API views leaves history intact. Restart keeps failed/uncertain outcomes, converts unconfirmed pending intent to uncertainty and never signals or submits again. Only supported process/session evidence confirms termination. |
| Auth, rate limit, credits or usage limit confirmed | [provider-failures.test.ts](../tests/provider-failures.test.ts), four confirmed-failure cases | Exactly one evidence-linked blocker survives full app restart and owner deferral/completion. No automatic continuation; hard budgets remain enforced. Ambiguous shutdown keeps recovery with a notice. |
| Unknown, unavailable, partial or zero usage; legacy untyped errors | [provider-failures.test.ts](../tests/provider-failures.test.ts), usage/legacy/restart cases | Missing usage stays unavailable, partial samples remain partial, and zero tokens or a legacy error code cannot establish exhaustion. Restart neither reclassifies nor resubmits. |
| Worker help, independent work and owner continuation | [worker-help.test.ts](../tests/worker-help.test.ts), blocking-help case | Other readers/writers finish. A deferred request and unfinished file survive restart. An answer alone does not continue work. An explicit owner assignment runs once in a new worktree, retaining the original changes; another restart does not replay it. |

The runtime-fault cases add a held-tool interleaving and four failure/restart/recovery paths. Existing stop, help, provider and reconciliation suites were extended to exercise their remaining restart combinations. No production behavior, capability claim or design decision changed.

Run the focused gate and minimal demonstration:

```sh
mise x -- node --test tests/runtime-faults.test.ts tests/fake-adapter.test.ts tests/human-waits.test.ts tests/restart-reconciliation.test.ts tests/recovery-decisions.test.ts tests/stops.test.ts tests/provider-failures.test.ts tests/worker-help.test.ts
```

Run repository checks:

```sh
mise x -- pnpm test
mise x -- pnpm typecheck
mise x -- pnpm lint
mise x -- pnpm test:fixtures
mise x -- pnpm build
mise x -- pnpm smoke
git diff --check
```

Recorded results: [full test suite](evidence/m6-fault-tests.txt), [checks](evidence/m6-fault-checks.txt), [mutation audit](evidence/m6-fault-mutations.txt). The mutation audit temporarily removes individual safety checks and requires assertion failures, then restores every source file. Initial targeted runs exposed test-fixture setup mistakes (unsupported MCP endpoint and a shared tool gate); both were corrected before the final checks.

M6's automated fake/protocol gate passed. Live cost-bearing smoke calls are intentionally omitted; M8 must verify native classifications, cancellation and continuation, and M9 must verify visible statuses and the remaining acceptance matrix. The beta remains incomplete.
