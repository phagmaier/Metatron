# Archived M2 progress entries

## 2026-10-15 — M2: fake orchestration loop (browser gate pending)

- Implemented 10/11 M2 items: canonical clean Git-root/common-directory/base validation; fake Lead proposals, bounded dispatch, saved reports/events and immutable team guidance. M3 was not started.
- Migration v2 adds dispatch/reservation history, writer/reader/total/Lead caps, one writer per path, priority/FIFO and launch budgets. Chat/Plan/worker/supervised-Lead/cross-run/owner-pin denials and restart without ambiguous replay are tested.
- GUI adds repository/run forms, controls, grouped board, conversation/session events and owner task/assignment/pause/cancel/report actions. Checks PASS: typecheck, lint, tests (56/56), test:fixtures (3/3), build, smoke (dev/prod), diff check; intermediate typing/fixture/drift-timing failures fixed.
- HTTP demo PASS via `mise x -- env XDG_DATA_HOME=/tmp/lao-m2-review-data pnpm demo:m2`; [README](../README.md#m2-fake-orchestration-demonstration), fixture `/tmp/lao-git-fixture-qadEm3/repo with spaces`. Browser execution was blocked by empty inventory/missing Superset; the UI gate remained unchecked (resolved in later entries).
- No new ADR/dependency/toolchain/spec/global-config changes; native calls intentionally omitted (cost), writer isolation simulated only. Next was the M2 UI success/failure exercise; baseline: `mise x -- pnpm test`; beta incomplete.

## 2026-10-15 — M2 browser gate recheck

- No further checklist items completed; M3 remains untouched. Updated `todo.md` with the current browser diagnostic.
- BLOCKED: `cua.getState()` returned empty app/browser inventories; `cua.createBrowserTab('iab', ...)` returned “Browser is not available: iab”; `command -v superset` found no CLI. Actual browser interaction is still unverified.
- Checks PASS: `mise x -- pnpm test` (56/56), `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `git diff --check`. Native live tests intentionally omitted (cost); no new dependencies or ADRs.
- Demo PASS: `mise x -- env XDG_DATA_HOME=/tmp/lao-m2-ui-verification-20261015 pnpm demo:m2` saved run `32d9d1f2-2319-499d-ad0c-4b984f04ebe2` with AWAITING_REVIEW + RETRY_DECISION; retained disposable fixture `/tmp/lao-git-fixture-b1S0d1/repo with spaces`.
- Demo launch reported EADDRINUSE on 127.0.0.1:4317. Existing listener was left untouched; read-only GET `/api/health` and `/` returned 200 and identified a running M2 development app. The new demo database is not claimed to be served by that listener.
- Exact next item remains the M2 UI success/failure exercise in [README](../README.md#m2-fake-orchestration-demonstration). Connect a browser for agent verification or perform those steps manually; after stopping the existing app, resume the prepared fixture with `mise x -- env XDG_DATA_HOME=/tmp/lao-m2-ui-verification-20261015 pnpm dev`.

## 2026-10-15 — M2 browser gate completed

- Owner connected Playwright MCP and started the development app. Completed M2's final unchecked item; updated `todo.md`/`README.md`, saved [reviewed screenshot](evidence/m2-browser-success-failure.png), and ignored generated `.playwright-mcp/` diagnostics. No application code changed; M3 remains untouched.
- Actual UI PASS on retained clean disposable fixture `/tmp/lao-git-fixture-lcs23p/repo with spaces`: project inspection/open → autonomous fake Lead → worker success/AWAITING_REVIEW → visible report/session events; second owner message → worker failure/RETRY_DECISION without retry. Run ID `e36a378f-bebb-4945-be37-df5992893424`; 4 saved sessions, 2 worker launches. Navigation/reload reloaded both task states and reconnected the journal.
- Additional UI PASS: supervised proposal stayed BACKLOG with zero launches; priority 7 and Fake Reader selection persisted through approval; pause disabled assignment, resume permitted approval; manual owner task cancellation preserved CANCELLED history. Chat/Plan replied with zero worker launches/tasks.
- Dirty fixture UI PASS: Check repository displayed DIRTY; Start fake run refused with an explicit error and preserved the probe file. Removed only our disposable probe after verifying its contents; the fixture is clean again.
- Checks PASS: `mise x -- pnpm test` (56/56, including server restart/reopen/no-replay), `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `git diff --check`. The owner's server was not restarted; browser reload was exercised directly. No live native calls (intentionally omitted, cost), dependency changes, new ADRs or blockers.
- Console: initial missing favicon 404 and expected dirty-start rejection only; final navigation had zero console errors. Screenshot path outside MCP roots was refused; saved and visually inspected the image under `docs/evidence/` instead.
- Next: M3's first item — safe Git subprocess wrapper with argv arrays, path/repository validation and base SHA capture. Resume: “Implement M3 only, starting with safe worktree isolation”; baseline: `mise x -- pnpm test`. Beta remains incomplete.

