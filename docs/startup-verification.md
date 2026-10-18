# M9 item 5: local startup verification

Verified on 2026-10-18 against the existing Omarchy installation, using the README commands from the application source repository. No system/global package install, desktop configuration change, personal harness login, credential copy or model turn was needed. [Results](evidence/m9-startup.json), [fresh-home harness diagnostics](evidence/m9-startup-harnesses.png), [missing harnesses](evidence/m9-startup-missing-harnesses.png).

| Prerequisite | Observed |
| --- | --- |
| OS | Omarchy 4.0.5, Arch-derived (`/etc/os-release`) |
| mise | 2026.10.12 |
| Node | 26.7.0 through mise, `lts: false`; built-in SQLite 3.53.4 |
| pnpm | 11.22.0 through mise |
| Git | 2.56.0 |
| Codex | `codex-cli 0.163.0` |
| Claude Code | `2.1.302 (Claude Code)` |
| OpenCode | `opencode v2.0.32` |
| Pi | 1.3.0 (`pi`, not the separately installed Oh My Pi executable) |

The Node/pnpm versions are the unchanged project pins. `mise install node@26.7.0 pnpm@11.22.0` passed, reporting **0 installed / 2 already installed**. `mise x -- pnpm install --frozen-lockfile` passed using the existing dependency tree and normal user store/cache. The README's old leading `/tmp` store/cache override was removed; it is unnecessary here and differs from the dependency tree's recorded store. No package or lockfile change resulted.

## Actual launch checks

These exercised the actual `pnpm dev` / `pnpm start` entrypoints on **127.0.0.1:4317**, in addition to the existing `pnpm smoke` helper. Fresh `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` directories were passed **after** `mise x -- env`, keeping mise's tool lookup intact and keeping test metadata away from the owner's app database. No source repository was opened as a managed project.

1. `mise x -- pnpm dev`: HTTP health, HTML, Vite client and entry module all returned 200. Playwright rendered the GUI with a connected journal and **No saved projects yet**. Socket inspection showed only `127.0.0.1:4317`.
2. While dev was running, `mise x -- pnpm start` in a separate fresh data home refused with `EADDRINUSE` and exit 1. The running app stayed available; no existing server was killed or reconfigured.
3. Ctrl-C stopped the dev server and released port 4317. pnpm returned exit 1 with its `ELIFECYCLE` interruption message; the socket was gone. This is recorded as an expected owner interruption, not a startup failure.
4. `mise x -- pnpm build`, then `mise x -- pnpm start`: HTTP health, HTML and built `/assets/…js` returned 200 without the Vite client. The GUI rendered, reopened the same scratch database and had zero managed projects/sessions. A foreign-Origin request for the local token returned 403. Socket inspection again showed only loopback.
5. **Harness setup → Check harnesses** completed against the actual installed harnesses with app-owned configuration and no model prompt. Ctrl-C then stopped production and released port 4317. Harness discovery children were disposed.
6. A separate fresh production launch with only Node and `sh` on PATH also served the GUI and health API. All four native discovery endpoints and GUI cards reported **Missing** with the executable name and restart/setup step; no session was created. Git was absent from this probe's PATH as well: it is needed to manage repositories, not to open the empty GUI. The first artificial probe omitted `sh` too and pnpm refused to launch a script (exit 254 / child ENOENT). Adding only the existing `/bin/sh` to the probe PATH corrected the test; no package was installed.

The health payload's legacy `milestone: "M4"` field is unchanged; it is not a beta-readiness declaration.

## Harness availability versus login

All four executables were found on absolute PATH entries and passed isolated `--version` probes. Probes forwarded no provider credential variables and redirected harness config plus XDG storage into their own scratch directories. Codex's version probe warned that helper aliases cannot be created under `/tmp`; it still exited 0. The app's no-prompt Codex discovery subsequently succeeded and reported the expected missing-login state.

| Harness | Fresh app-home GUI result | Meaning |
| --- | --- | --- |
| Codex | Login required; 8 models listed | Installed; owner must authenticate the app-owned Codex home before native work. |
| Claude Code | Login required (`AUTH_ABSENT`); 5 models listed | Installed; no admitted setup-token/API/cloud route was supplied. |
| OpenCode | Available; login unverified; 10 models listed | Catalog discovery passed; provider access remains unproven until a native turn. |
| Pi | Login required; 0 usable models | Installed; no usable provider credentials were supplied in this fresh app home. |

These login states are expected test outcomes, not missing binaries or blockers to starting the GUI/FAKE demos. No login was performed and no provider entitlement was claimed. The GUI's next-step instructions were left for the owner; this test did not alter personal configurations or active sessions. Missing/failed executable diagnostics and absolute-PATH enforcement also passed the focused automated tests.

## Scope and next step

Passed: `mise x -- pnpm typecheck`, `mise x -- pnpm lint` (245 files), `mise x -- pnpm test` (475/475), `mise x -- pnpm test:fixtures` (3/3), `mise x -- pnpm build`, `mise x -- pnpm smoke` (development and production), and `git diff --check`. Focused `harness-availability.test.ts` / `server.test.ts`: 15/15. The persisted startup databases all contained zero projects, runs, tasks, attempts and sessions after the checks. All test listeners/owned discovery children were stopped; scratch evidence/data remain at the paths in the receipt.

This verifies the existing machine and installed dependency tree, not a clean Arch installation, a network dependency download, or every vendor's installer/authentication flow. No separate SQLite daemon/CLI, compiler toolchain, container runtime or desktop launcher was required. Live model turns were intentionally omitted (cost). Existing adapter and security limitations remain in force; no toolchain, runtime, schema or ADR change was made.

M9 item 6 is next: verify that switching projects never attaches native sessions/worktrees to another repository. Resume with `mise current`, then that item in `todo.md`.
