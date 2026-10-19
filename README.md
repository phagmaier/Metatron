# Local Agent Orchestrator

A local GUI for one Arch Linux / Omarchy user to coordinate native **Codex, Claude Code, OpenCode and Pi** coding sessions. A Codex Lead assigns bounded work; the engine persists tasks, reports, approvals and recovery decisions. Writers use separate Git worktrees, and you review and approve local integration.

**Status:** the `beta` tag marks the first beta implementation baseline; M9 is 9/9, with **owner release sign-off pending**. Read the [beta scope, known issues and release checklist](docs/releases/beta.md). [Active development](backlog.md) now follows focused issues; the [original beta plan](todo.md) retains live acceptance evidence. FAKE demos are labelled scripted playback. Local state stays on your machine; native model requests use your configured providers and may cost money.

## Start locally

Prerequisites: Git, mise, a browser and the normal POSIX shell (`sh`). Run from this repository's root:

```sh
mise current
mise install node@26.7.0 pnpm@11.22.0
mise x -- pnpm install --frozen-lockfile
mise x -- pnpm dev
```

Open **http://127.0.0.1:4317**. Stop with Ctrl-C; pnpm may print `ELIFECYCLE` for that intentional interruption. `EADDRINUSE` means another process occupies the port; stop your other instance from its terminal before retrying. Frontend edits reload; backend edits require a restart.

Use the `.mise.toml` pins for every Node/pnpm command. Node 26.7.0 reports `lts: false`; the project currently retains that pin. Setup was [verified on Omarchy 4.0.5](docs/startup-verification.md) using the existing dependency cache, with no additional OS/global packages. A clean-OS download/install has not been verified.

For the built GUI:

```sh
mise x -- pnpm build
mise x -- pnpm start
```

Both modes use `$XDG_DATA_HOME/local-agent-orchestrator/state.sqlite`, defaulting to `~/.local/share/local-agent-orchestrator/state.sqlite`. Run one app/demo process per database. To select separate data, use `mise x -- env XDG_DATA_HOME=/absolute/path/outside/managed/repos pnpm dev`. Put XDG overrides **after** mise so its tool lookup stays unchanged. No database service, SQLite CLI or container runtime is required.

<a id="m2-fake-orchestration-demonstration"></a>

## Try the GUI without model costs

Stop the app above, then create a separate demo home:

```sh
lao_demo_home=$(mktemp -d /tmp/lao-onboarding.XXXXXX)
mise x -- env XDG_DATA_HOME="$lao_demo_home" pnpm demo:m2
mise x -- env XDG_DATA_HOME="$lao_demo_home" pnpm dev
```

At the same URL, select the saved **M2 · fake orchestration** run. Inspect its Lead conversation, task board, **View report**, **Needs You** and session events. One scripted worker succeeds and another fails into `RETRY_DECISION`. No native CLI, credentials, provider call or real worker worktree is involved. The command prints the retained disposable Git fixture and database paths. Restart with the same demo home to inspect persisted history; seeding again never replays that run.

## Configure a native run

1. Make the desired harness CLIs available through absolute `PATH` entries in the launching shell. You need Codex for a Lead and at least one chosen worker harness; all four are optional for starting the GUI.
2. Open **Harness setup → Check harnesses**. Follow each card's **Next step** for app-owned login/provider setup, then check again. Discovery sends no model prompt; **Available** or a listed model does not prove provider entitlement. Restart after changing PATH or credential environment. See [authentication and controls](docs/usage.md#harness-setup).
3. In **Agent profiles**, save a Codex `coordinator` Lead and your worker profiles using **Discover profile settings**. Follow the [configuration example](docs/configuration-example.md) for roles, permissions, reusable workflows and smaller limits.
4. Under **Projects and new runs**, enter a clean disposable repository's absolute root, **Check repository**, then **Open clean project**. It needs a committed HEAD on a branch. Keep app data outside managed repositories.
5. Under **Start a run from a saved team**, choose your saved team, review its mode/budgets, enter a small objective and start. A native Lead turn can incur costs even in Chat/Plan. Supervised mode waits for owner assignment; Autonomous (bounded) dispatches within its caps.
6. Respond in **Needs You**, inspect reports and request independent review. After a passing review, prepare an integration preview, inspect its diff/checks, **Approve**, **Review apply plan**, then **Confirm apply**. Approval alone changes no destination branch.

The [usage guide](docs/usage.md) covers workflows, revisions, steering, pause/stop and recovery. Saved configuration changes affect future runs; existing runs retain their team snapshots.

## Supported controls and known limits

| Harness | Current application support | Important limits |
| --- | --- | --- |
| Codex | Lead, fresh read-only workers, completed Lead-thread resume | No writers, worker resume, live steering or interactive native permission grants. Reads are not confined to the worktree. |
| Claude Code | File-tool readers/writers, one-shot write approval, cancellation | No Lead or live steering. Clean same-checkout resume exists at the adapter boundary; engine reassignments use fresh worktrees/checkpoints. |
| OpenCode | File-tool readers/writers, one-shot write approval, cancellation | No Lead or live steering; same engine resume limit. A refused native file tool can end the turn. Successful 2.0.29 smoke receipts do not prove full 2.0.32 compatibility. |
| Pi | File-tool readers/writers, active steer/follow-up, cancellation | No Lead, native resume or per-call approval callback; permitted writes run under the saved writer policy. |

Only Pi has completed the full native writer → independent review → approved integration smoke. Claude/OpenCode have direct adapter write receipts; their complete writer integration paths have not been run live. [Evidence and precise coverage](docs/adapter-smoke-matrix.md).

Worker file tools do not include a shell for running tests. Declare test commands in the integration preview and inspect the actual results. There is no dedicated Refresh session button: use Pause worker → Recheck → Fresh + checkpoint → Retry. Legacy/unknown Codex Lead-thread bindings require a new run. There is no automatic merge, GitHub/remote-host integration, multi-user mode or dynamic workflow editor.

## Safety before real work

- **Worktrees separate working copies; they are not OS sandboxes.** Native permissions/path guards have limits, including filesystem races and Codex reads outside the checkout. Use trusted repositories. Owner-declared preview test commands execute with your user permissions.
- Dirty, moved or replaced checkouts block unsafe operations. The app never automatically resets, stashes, force-overwrites or deletes your worktrees. It refuses sparse/hidden index state and configured executable Git filters/merge drivers, including Git LFS; fix compatibility deliberately rather than bypassing the refusal.
- Repository authority includes the root and Git common directory's filesystem identity. After replacement, or for older runs without recorded identity, explicitly **Open clean project** and start a **new run**; reopening never transfers old approvals. See [legacy/replacement recovery](docs/usage.md#repository-identity-and-older-data).
- Native file approval and final integration approval are separate. Only your confirmed apply plan updates the chosen local branch. Review sensitive files yourself: path filtering cannot detect every secret embedded in ordinary source.
- Pause scheduling lets active turns finish. Stop run is terminal; emergency stop targets app-owned direct children and pauses dispatch. Descendants or earlier filesystem changes may remain. Inspect pending/failed/uncertain stop evidence; closing a view never stops work.
- A crash, disconnect or restart preserves work and asks for a recovery decision; ambiguous mutations never automatically replay. Inspect the retained checkout and session evidence before retrying. Budgets limit launches/concurrency, not exact provider spending.
- Keep the listener on `127.0.0.1`; Host/Origin/token checks protect local mutations. Harness homes/transcripts are app-owned, and personal harness logins are not copied. Reports, model text and test output can still contain sensitive data. Keep credentials out of source, chat and evidence.

Read the [safety audit](docs/security-audit.md) and [harness isolation decision](docs/adr/2026-10-17-harness-environment-isolation.md) for tested boundaries and remaining limits.

## Development and evidence

```sh
mise x -- pnpm typecheck
mise x -- pnpm lint
mise x -- pnpm test
mise x -- pnpm test:fixtures
mise x -- pnpm build
mise x -- pnpm smoke
```

These checks use disposable state and no model turns. `smoke` checks development and production HTTP/GUI assets; build first. [Development commands](docs/development.md) distinguish fixtures, zero-prompt native probes and opt-in cost-bearing tests.

Product decisions: [spec.md](spec.md). Active work: [backlog](backlog.md). Beta scope and release status: [release note](docs/releases/beta.md). Latest results: [progress](docs/progress.md). Coding-agent instructions: [AGENTS.md](AGENTS.md). [Development guide](docs/development.md#working-on-one-item) explains task selection, review and historical documents. GUI evidence: [status/recovery](docs/gui-status-checks.md) and [project switching](docs/project-switching-verification.md).
