# Development and verification

Use the pinned mise toolchain from the repository root. Read [AGENTS.md](../AGENTS.md), the tail of [progress.md](progress.md), and only the current first incomplete milestone in [todo.md](../todo.md) plus its named spec sections. Complete one item/milestone within the owner's requested scope.

## Default checks — no model turns

```sh
mise x -- pnpm typecheck
mise x -- pnpm lint
mise x -- pnpm test
mise x -- pnpm test:fixtures
mise x -- pnpm build
mise x -- pnpm smoke
```

`test` uses Node's test runner, FakeAdapter/protocol fixtures and disposable databases/Git repositories. It covers transition/policy boundaries, quotas/idempotency, worktree safety, review/integration and recovery without automatic replay. It creates a private `lao-test-run-*` temporary root: passing runs remove it; failing runs retain it and print the path. `test:fixtures` checks fixture ownership/safety separately. Tests do not modify personal harness settings or active sessions.

`smoke` starts and closes real development and production servers on temporary loopback ports, checking health, HTML and script assets. Build first. Automated default checks do not drive a browser; [GUI verification](gui-status-checks.md) records separate browser QA. `pnpm format` applies Biome formatting/safe fixes to project code and configuration.

Two additional rehearsals exercise real engine paths with explicitly simulated execution. Choose new evidence paths; runners refuse overwrites:

```sh
mise x -- pnpm smoke:workflow --fake --output /tmp/lao-workflow-rehearsal.json
mise x -- pnpm acceptance --scenario A --fixtures --output /tmp/lao-acceptance-A-rehearsal.json
```

Acceptance supports scenarios A–G, each on a fresh disposable repo with the app in its own process and owner HTTP API. `--fixtures` uses scripted protocol subprocesses, not live models. The [M9 checklist](../todo.md) links retained live and rehearsal outcomes, including earlier failures. [README demo](../README.md#try-the-gui-without-model-costs) provides a browsable FAKE run; `demo:fake` is the older persistence-only seed.

## Native probes and opt-in costs

The `test:live*` names are separate scripts, never part of `pnpm test`. The newer runners below default to native discovery/control checks without a model prompt; the older **`test:live` and `test:live:lead` require `--allow-live`** and a marked disposable fixture (or `test:live --create-fixture` solely to create one). CLI presence/catalogs alone cannot prove model access.

| Command | Purpose / consent |
| --- | --- |
| `pnpm test:live:claude` | Claude discovery; `--allow-live` enables the guarded five-turn direct adapter smoke. |
| `pnpm test:live:opencode` | OpenCode discovery; `--allow-live` enables its direct adapter smoke. |
| `pnpm test:live:workers --harness <harness> --model <model> --thinking <level>` | Reader preflight; `--allow-live` spends a native worker turn. Extra verification flags can add turns. |
| `pnpm test:live:leads --model <model> --thinking <level>` | Support/refusal preflight; `--allow-live` runs Codex; `--verify-lifecycle` can raise it to three turns. |
| `pnpm test:live:writer --model <model> --thinking <level>` | Pi writer/reviewer preflight. Both `--allow-live --allow-disposable-write` enable two turns; integration preview is held for owner approval. |
| `pnpm smoke:worker-catalog --harness <harness> --model <model> --thinking <level>` | Zero-prompt native worker tool-catalog/policy-denial probe. |
| `pnpm smoke:isolation` | Zero-prompt native config/environment isolation check using inert credentials. |

Run these through `mise x --`, select fresh app-owned data where supported, and give a new `--output /absolute/path.json`. Put XDG overrides after mise and launch each command from your normal shell: an already-overridden `XDG_DATA_HOME` also redirects a nested mise invocation's tool lookup. Use **Check harnesses** and the runner's diagnostics to select current models/efforts and set up supported authentication. [Exact native repeat commands, evidence and gaps](adapter-smoke-matrix.md#safe-repeat-commands--no-new-model-prompts); [version/interface findings](adapter-recon.md).

With explicit usage/cost authorization, `pnpm acceptance --scenario <A-G> --allow-live --lead <harness:model:thinking> --writer <harness:model:thinking> --reader <harness:model:thinking> --output <new-path>` runs bounded live scenarios on disposable repos. It stops for owner integration approval at `http://127.0.0.1:4318`; `--approve-disposable` explicitly authorizes the driver to approve only its own fixture. Never treat that flag as approval for a user's working branch. Failures retain state and evidence; no model turn is automatically replayed.

## Implementation map

| Path | Responsibility |
| --- | --- |
| `src/server/main.ts`, `app.ts`, `api.ts` | Loopback listener, GUI assets and validated owner API |
| `src/shared/` | Strict schemas, domain state tables, reusable role/team/workflow contracts |
| `src/server/storage/` | SQLite, event/idempotency journal, scheduling and durable domain state |
| `src/server/orchestration/`, `gateway/` | Engine, owner commands, Lead/worker execution and scoped MCP tools |
| `src/server/adapters/` | Four native harness adapters, capability/event translation, file/environment policy; labelled FakeAdapter |
| `src/server/git/` | Safe argv commands, checkout identity, worktrees, candidate capture, preview/apply |
| `src/web/` | React GUI; Vite production assets go to `dist/web` |
| `tests/`, `scripts/` | Disposable fixtures, regression tests, rehearsals and explicit native smokes |

The runtime uses one Node HTTP process, built-in `node:sqlite`, TypeScript, React/Vite, Zod, Biome and Git CLI. Adapter transports use the installed Pi RPC, Codex app-server, official Claude Agent SDK and OpenCode v2 client. See [spec.md](../spec.md) for agreed scope and [ADRs](adr/) for significant deviations. No remote repository integration or OS-level sandbox is implemented.
