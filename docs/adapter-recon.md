# Adapter reconnaissance — M0

Checked **2026-10-15** on this machine. These are interface findings, **not working adapters**. No model prompt, login, credential dump, configuration rewrite, global install or active-session operation was performed. Authentication/access entitlement is **unknown for all four**. Live smoke matrix spec §13.3 is intentionally omitted (cost; explicit authorization required).

## Machine and evidence

| Tool | Installed result | Probe |
|---|---|---|
| Node | 26.7.0; `process.release.lts` unset | `mise x -- node --version` |
| pnpm | 11.22.0 | `mise x -- pnpm --version` |
| Git | 2.55.0 | `git --version` |
| Codex | `codex-cli 0.162.1` | `codex --version` |
| Claude Code | `2.1.301 (Claude Code)` | `claude --version` |
| OpenCode | `opencode v2.0.29` | isolated `opencode --version` |
| Pi | 1.3.0; installed package `@earendil-works/pi-coding-agent` | `pi --version`, bundled package/docs |

`mise current` and `mise ls` confirmed both project pins are installed. The existing Git repo was initially on `main` at `477ad29` with staged `.mise.toml` and owner edits in `AGENTS.md`/`todo.md`; during the session the owner's baseline advanced to `f2c9478`. No agent commit/reset/stash occurred. `kickoff-prompt.md` was absent; the other starting docs were present and read in full.

The default OpenCode version probe failed attempting to open its global log; Pi help warned about attempting a settings lock. Both writes were blocked by the read-only sandbox. Subsequent probes redirected XDG directories and `PI_CODING_AGENT_DIR` to a newly allocated `/tmp/lao-m0-recon-*` directory and ran from there. They succeeded without those warnings. Codex help/schema generation warned that it could not create PATH aliases; schema generation nevertheless exited 0. `mise ls` emitted a blocked purgatory-state warning, but listed installed pins. No permissions were broadened to suppress these diagnostics.

Official documentation was fetched through Context7, then cross-checked against installed CLI help, Codex-generated schemas, Pi's installed docs/RPC, and published SDK declaration files. Published packages were fetched from the npm registry into scratch storage solely for declaration inspection, without installation or execution: Claude Agent SDK **0.3.301**, OpenCode legacy SDK **1.19.1**, OpenCode v2 client **2.0.29** (exact binary match; registry latest was 2.0.30).

## Capability evidence matrix

“Surface” means present in installed schemas, bundled docs or matching published declarations; behavior still needs an opt-in disposable-repo live test. No capability is advertised in the M0 UI.

| Capability | Codex 0.162.1 | Claude Agent SDK 0.3.301 | OpenCode v2.0.29 | Pi 1.3.0 |
|---|---|---|---|---|
| Model discovery | `model/list` surface | `supportedModels()` surface | `model.list` surface | `get_available_models` **passed**, 2 entries in isolated state |
| Reasoning | per-model efforts in protocol | `thinking` + `effort`; model dependent | model `variants`; no universal scale | `get_available_thinking_levels` **passed**, `off/high/max` for isolated default |
| Resume | `thread/resume` surface | `resume` option, native session ID | reuse persisted session ID; runtime unverified | `--session` / `switch_session` surface |
| Streaming | `item/agentMessage/delta`, `turn/completed` | async `query`, partial messages, result | async `event.subscribe`; no replay/reconnect | JSONL events; wait for `agent_settled` |
| Steering | `turn/steer` surface | streaming input; immediate delivery semantics unverified | prompt/inbox surfaces; immediate steer unverified | `steer` / `follow_up` surface |
| Cancel | `turn/interrupt` surface | `interrupt()` / abort controller | **`session.interrupt`**, not v1 `abort` | `abort` surface |
| Approvals | command/file/permissions requests in schema | `canUseTool` / hooks; not called for every tool | `permission.request.list`, `permission.reply` surface | no default per-tool permission callback; extension UI bridge available |
| Tool gateway | per-process MCP config surface | `mcpServers`, SDK MCP tools | MCP methods/config; private server validation pending | CLI built-in MCP; SDK needs explicit extension wiring |

## Codex: select app-server over stdio

Installed `codex app-server --help` exposes `--listen stdio://` (default), `--stdio`, and schema/TypeScript generators; the command group is marked experimental. Generated **installed-version** schemas confirm `initialize`, `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt`, `model/list`, terminal `turn/completed`, deltas, and `item/{commandExecution,fileChange,permissions}/requestApproval` requests.

Use the initialize response then `initialized` notification before thread operations, persist thread/turn IDs, and normalize authoritative turn status. Query model efforts rather than mapping another harness's scale. Native CLI authentication remains native; no account/token inspection or app-server thread was started in M0. MCP configuration and tool restrictions must be applied to app-owned sessions; installed methods alone do not prove policy enforcement.

Sources: [official app-server guide](https://learn.chatgpt.com/docs/app-server), [official protocol source](https://github.com/openai/codex/tree/main/codex-rs/app-server), plus locally generated schema. Context7 initially mixed in `exec-server` examples; these are a different service and were not used as app-server handshake evidence.

Safe smoke (executed; output directory was temporary):

```sh
codex --version
codex app-server --help
scratch=$(mktemp -d /tmp/lao-codex-recon.XXXXXX)
codex app-server generate-json-schema --out "$scratch/schema"
```

Next live validation: on a disposable fixture, initialize stdio, discover model capabilities, start one bounded read task, capture terminal status, then test resume/interrupt and scoped MCP permissions. Requires explicit model-call authorization.

## Claude Code: select the official Agent SDK

Use `@anthropic-ai/claude-agent-sdk`, stable `query({ prompt, options })`; no lower-level Anthropic model API. Published 0.3.301 declarations contain `pathToClaudeCodeExecutable`, `resume`, `canUseTool`, `thinking`, `effort`, `supportedModels()`, `interrupt()`, hooks and MCP settings. Point to the installed native executable and verify compatibility rather than silently using a different bundled CLI. Stable `query` avoids obsolete/unstable preview-session helpers that appeared in indexed examples.

CLI 2.1.301 help corroborates stream JSON input/output, model, effort, resume and MCP configuration. `allowedTools` auto-approves tools and is **not an allowlist**; the permission callback can be bypassed by earlier allow rules. Block tools with the supported tool restriction/deny settings and test the resulting policy. Steer delivery is not declared immediate solely because streaming input exists.

Authentication remains a prerequisite: [official quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) documents API keys and supported provider flows and restricts offering subscription login in third-party products without approval. An installed logged-in CLI is not proof that this app has a supported SDK auth path. No credential files were read; no SDK process or query ran. **BLOCKED for live readiness**, not for M0: owner must choose/configure an approved SDK auth flow before the M8 opt-in test; no login/install command is run on their behalf.

Sources: [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript), [permissions](https://code.claude.com/docs/en/agent-sdk/permissions), [official SDK repository](https://github.com/anthropics/claude-agent-sdk-typescript). Safe scripted CLI smoke (executed):

```sh
claude --version
claude --help
```

Next SDK smoke, only after auth and cost approval: use `query` with explicit disposable cwd, installed executable, denied mutation/delegation tools, bounded turns, partial streaming, captured `session_id` and result; exercise resume and permission/cancel separately. SDK runtime compatibility remains unverified.

## OpenCode: select the v2 HTTP client and an app-owned private server

The installed binary is **v2.0.29**, not v1. The spec's old `@opencode-ai/sdk` / `createOpencodeClient` snippets and v1 Basic-password advice cannot be assumed compatible. Choose **`@opencode/client@2.0.29`**, `OpenCode.make({baseUrl, headers})`, verified against published declarations and [official v2 client documentation](https://opencode.ai/v2/docs/build/client). See [ADR](adr/2026-10-15-opencode-v2-interface.md).

Matching declarations expose `session.create/get/prompt/interrupt`, session inboxes, `model.list` and model variants, `permission.request.list` / `permission.reply`, MCP methods and event subscription. The CLI's `serve --help` identifies a v2 API/web server with `--hostname`, `--port`, `--stdio`, `--service`. V2 uses location-scoped APIs; persist native session IDs with their location. The event source is live-only: implement reconciliation/re-subscription rather than assuming replay. Cancellation is `interrupt`, not the v1 SDK's `abort`.

V2 ordinarily discovers/starts a shared user background service. Do **not** use default `Service.ensure()` / `Service.stop()` for app tests. M0 did not launch any OpenCode server. **Unverified prerequisite for M8:** verify a private-server launch, loopback bind and authenticated client contract; do not reuse or interrupt a personal service and do not assume v1's `OPENCODE_SERVER_PASSWORD` works. Provider credentials stay in OpenCode's supported auth flow, separate from HTTP client authentication. No model entitlement was checked.

Sources: [v2 CLI](https://opencode.ai/v2/docs/cli), [client](https://opencode.ai/v2/docs/build/client), [API](https://opencode.ai/v2/docs/api). Safe smoke (executed; no server/model starts):

```sh
scratch=$(mktemp -d /tmp/lao-opencode-recon.XXXXXX)
env XDG_DATA_HOME="$scratch/data" XDG_CACHE_HOME="$scratch/cache" \
  XDG_STATE_HOME="$scratch/state" XDG_CONFIG_HOME="$scratch/config" opencode --version
env XDG_DATA_HOME="$scratch/data" XDG_CACHE_HOME="$scratch/cache" \
  XDG_STATE_HOME="$scratch/state" XDG_CONFIG_HOME="$scratch/config" opencode serve --help
```

## Pi: select subprocess RPC

Installed package identity is `@earendil-works/pi-coding-agent@1.3.0`; do not assume older `@mariozechner/*` packages or the separately installed oh-my-pi fork. Its bundled docs match [official RPC docs](https://pi.dev/docs/latest/rpc) and [commands](https://pi.dev/docs/latest/rpc-commands). RPC uses LF-framed JSON records with request IDs, concurrent responses and separate session events. Closing stdin requests graceful shutdown.

The isolated no-prompt RPC probe returned success for `get_state` (not streaming, zero messages/pending messages), `get_available_models` (2 entries), and `get_available_thinking_levels` (`off/high/max`). These describe isolated defaults, **not the owner's authenticated model access**. `set_model` / `set_thinking_level` are model dependent. Use `--session` / session commands for same-task resume and `new_session` for fresh work.

The installed docs explicitly distinguish prompt acceptance from completion and `agent_end` from **`agent_settled`** (retries/queued work may follow). `steer`, `follow_up`, `abort`, and extension UI confirm/input responses exist; none was exercised during an active model turn. Built-in tools do not ask permission before every call. Use native tool restrictions plus a scoped tool gateway; extension UI is not a general permission enforcement mechanism. [MCP docs](https://pi.dev/docs/latest/mcp) describe CLI built-in MCP; in-process SDK use needs explicit MCP/codemode/tool-search extension wiring. RPC avoids that SDK loader work. Worktrees/cwd never imply OS isolation.

Safe scripted smoke (equivalent to the successful isolated probe; no prompt/credentials):

```sh
scratch=$(mktemp -d /tmp/lao-pi-recon.XXXXXX)
cd "$scratch"
printf '%s\n' '{"id":"state","type":"get_state"}' \
  '{"id":"models","type":"get_available_models"}' \
  '{"id":"thinking","type":"get_available_thinking_levels"}' |
  env PI_CODING_AGENT_DIR="$scratch/pi" PI_OFFLINE=1 PI_TELEMETRY=0 \
    XDG_DATA_HOME="$scratch/data" XDG_CACHE_HOME="$scratch/cache" \
    XDG_STATE_HOME="$scratch/state" XDG_CONFIG_HOME="$scratch/config" \
    pi --mode rpc --no-session --no-tools --no-extensions --no-mcp \
      --no-skills --no-prompt-templates --no-themes --no-context-files \
      --no-approve --offline
```

Next live probe belongs to M3: explicitly authorized read task in a disposable worktree, model/thinking validation, native session ID, `agent_settled` outcome/error mapping, cancellation and resume. Never run `pi auth print-*` for reconnaissance.
