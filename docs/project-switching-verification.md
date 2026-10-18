# M9 item 6: project-switching isolation

2026-10-18: **PASS** with the production GUI, real engine/SQLite/Git and deterministic Codex/Pi protocol subprocesses. Claude/OpenCode resume boundaries use their existing SDK/HTTP fixtures. No native model/provider call was submitted. [Results and retained fixture locations](evidence/m9-project-switching.json).

Two defects were reproduced and fixed:

- Codex Lead resume had no persisted run/checkout binding. Both new regression tests failed before the fix: foreign-run resume and same-path replacement of `.git` were accepted. It now checks the original run, model, permission and canonical checkout identity before launching a native process. Valid same-run successor turns still resume after reconstruction. Unknown IDs refuse. [Compatibility decision](adr/2026-10-18-codex-thread-project-binding.md).
- New-run objectives written in project A remained in the forms after selecting B. The project forms now remount on selection, resetting fake/team/Lead/worker drafts and discovery selections. Existing run message/task controls already reset by run ID.

| Check | Result |
| --- | --- |
| A and B active in the same engine | Separate Codex threads per run; each Lead resumes only its own thread. Both Pi writers edit `README.md` in separate app-owned worktrees with the correct repository/base/manifest. Both owner roots remain clean at their original commits. |
| Return to A after restart | Session and attempt records retained; no automatic attempt. The explicit A message adds one Lead turn on A's thread; B's session records and all worktree manifests stay unchanged. |
| Foreign resume | A's session cannot be assigned to a task in B. Direct Codex, Claude and OpenCode adapter checks refuse a foreign run or checkout. Pi remains explicitly unsupported for native resume. |
| GUI A → B → A | Six switches show only selected-run sessions, with no mutation or additional attempt. All four new-run drafts and the current-run message clear on switching. A fixture Pi reader started from B submits B's project ID and starts fresh; a later A message is absent from B. |
| Empty project, reload and app restart | Opening C hides all previous sessions/run actions. Reload defaults to the first project; selecting B restores B's own persisted sessions. App restart and further GUI navigation add no attempts or session changes. |
| Narrow layout | Project/run controls remain usable at 390px without horizontal overflow. |

Screenshots: [A](evidence/m9-project-switch-A.png), [B](evidence/m9-project-switch-B.png), [empty C](evidence/m9-project-switch-empty.png), [390px](evidence/m9-project-switch-mobile.png), [after restart](evidence/m9-project-switch-restart.png). Fixture names/objectives explicitly state that no model tokens are used; the normal native execution badge describes the injected adapter route, not live harness evidence.

## Reproduce

```sh
mise current
mise x -- pnpm build
mise x -- node scripts/project-switching.ts
```

Open the printed loopback URL. Select A/B, inspect the run sessions and tasks, and draft new objectives before switching. `status` saves an observation; `restart` reopens the same database and prints the new ephemeral port; `quit` stops the app and retains the disposable roots/worktrees/metadata. The noninteractive demonstration is `mise x -- node scripts/project-switching.ts <<< quit` in Bash.

Regression command:

```sh
mise x -- node --test --test-global-setup=tests/helpers/temp-root.ts tests/project-switching.test.ts tests/codex-isolation.test.ts tests/context-policy.test.ts tests/lead.test.ts tests/claude.test.ts tests/opencode.test.ts
```

Standard validation passed: `mise x -- pnpm typecheck`, `lint`, `test` **478/478**, `test:fixtures` **3/3**, `build`, and `smoke` development/production. The browser check used owner-authorized Playwright because computer-use exposed no browser. Corrected QA fixture setup (`Backend Engineer`, the actual role name), an over-specific browser label selector, and a run-list assertion after intentionally adding a B run; these were verification-driver failures, separate from the two product defects above. The interactive fixture's stdin is explicitly closed/paused so `quit` exits without EOF.

Limits: no paid native rerun, no OS filesystem sandbox, no race-proof identity check, and no migration of legacy Codex bindings. Codex reads remain outside worktree confinement; worker native resume remains unsupported in the engine. Existing OpenCode refused-tool and direct-child stopping constraints are unchanged. M9 and beta remain incomplete; next is M9 item 7, onboarding README/configuration/known limitations/safety notes.
