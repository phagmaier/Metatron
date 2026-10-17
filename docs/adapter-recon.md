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

Next live probe belongs to M3: explicitly authorized read task in a disposable worktree, model/thinking validation, native session ID, `agent_settled` outcome/error mapping, cancellation and resume. Never run `pi auth print-*` for reconnaissance. Later steering verification is recorded under M6 item 6 below.

### M3 verification — 2026-10-15

- Implemented installed Pi **1.3.0** subprocess RPC; retained the pinned Node/pnpm versions and added no dependencies. Verified current Context7 Pi docs against bundled `rpc.md`, `rpc-commands.md`, `json.md`, `extensions.md` and CLI help. A default-directory help invocation attempted a settings lock and was denied by the filesystem; subsequent probes/adapter launches use an app-owned `PI_CODING_AGENT_DIR`, avoiding personal settings/session writes.
- No-prompt probe PASS: discovery, exact `set_model`/thinking application, native session ID, explicit policy-extension handshake via `get_commands`, and clean process shutdown. Native discovery returned `deepseek/deepseek-flash` with off/low/high/max and `deepseek/deepseek-v4-pro` with off/high/max. This is an observation of this environment, not a hardcoded catalog or proof of entitlement.
- Opt-in live PASS: `mise x -- env XDG_DATA_HOME=/tmp/lao-m3-live-data pnpm test:live --allow-live --fixture '/tmp/lao-git-fixture-Ggrjs9/repo with spaces' --model deepseek/deepseek-flash --thinking off`. Reader read README.md; writer appended exactly one requested line in a separate worktree. Both yielded authoritative completion, recorded native IDs/PIDs, exited 0 and reached AWAITING_REVIEW. Owner checkout and checked personal-config metadata stayed unchanged. [Evidence](evidence/m3-live-summary.json), [GUI](evidence/m3-native-writer.png).
- Reader ID `01a1433b-8d86-71fa-96f8-341521c2caef`; writer ID `01a1433b-9f0f-75ba-9a72-abd8c4778c03`. Provider authentication succeeded through Pi's inherited environment; the app did not read, extract or copy native credentials. Capability discovery still reports auth unknown, since availability does not establish future entitlement.
- M3 policy: CLI tool allowlists plus an explicit app extension enforce path/symlink/sensitive-file checks; startup refuses prompts if the extension is absent. Shell, MCP and discovered resources are disabled. Native transcripts remain under app data; separate wire diagnostics retain only the latest 128 redacted event headers. See [ADR](adr/2026-10-15-pi-worker-policy.md). File checks are not kernel isolation.
- Default tests use protocol subprocess fixtures for auth/quota, cancellation of silent work, clean exit without completion, exact model/thinking validation and policy-extension failure. Active live cancellation/auth-failure/resume/steering turns were intentionally omitted (cost); no real auth/quota failure was induced. Resume/steering/tool gateway/per-call permission prompts are unsupported by this M3 adapter and advertised as such; native Lead remains M4.

### M4 verification — 2026-10-15 (Codex Lead, gateway)

- Interface: installed **Codex 0.162.1 `codex app-server --listen stdio://`** (LF-delimited JSON-RPC, `initialize` → `initialized` → `thread/start|resume` → `turn/start`, authoritative `turn/completed`, `turn/interrupt`). This is not `exec-server`; the owner's desktop app runs its own app-server/exec-server and a personal `~/.codex` daemon (started 15:32, before this session), which were never contacted. Schemas regenerated from the installed binary (stable and `--experimental`); `dynamicTools` is experimental-only, so the gateway uses MCP.
- No-model probes PASS: an isolated `CODEX_HOME` writes `state/logs/goals/memories/queue` SQLite stores even without a turn, so the adapter always uses `<app data>/codex` and verifies `initialize.codexHome`. `account/read` there returns `account: null` until the owner logs in natively. `model/list` returned `gpt-6.1-sol` (default) and others with efforts `low…max`; `ultra` is described as "automatic task delegation" and is not offered for a Lead. All 14 `--disable` features (multi-agent, apps, plugins, hooks, worktrees, memories, browser/computer use, …) were accepted and confirmed disabled via `experimentalFeature/list`.
- `thread/start` with `config.mcp_servers.lao = {url, bearer_token_env_var}` connected Codex's MCP client (`codex-mcp-client` 0.162.1, protocol `2025-06-18`, two connections, no GET/SSE, per-connection JSON-RPC ids, also `resources/list`) to a stateless loopback server: `runtimeStatus: connected`, `authStatus: bearerToken`. The response confirmed `sandbox: {type: readOnly, networkAccess: false}`, `approvalPolicy: never`.
- Read-only sandbox PASS via `command/exec` (no model) on a disposable fixture: `head README.md` succeeded; append/`touch` failed with `Read-only file system` (bwrap at `/usr/bin/bwrap`); README SHA-256 and `git status` unchanged; a live loopback listener reachable unsandboxed was unreachable from the sandbox. Reads outside the repository are not confined.
- Pi 1.3.0: `--no-extensions` also drops built-in MCP; `--no-extensions --extension builtin:mcp --extension <guard>` connected only the guard-registered `lao` server (initialize/initialized/tools/list with bearer header) and ignored an untrusted project `.pi/mcp.json` under `--no-approve`.
- Default tests use a Codex app-server protocol fixture and the Pi RPC fixture, talking real HTTP MCP to the app gateway. See [ADR](adr/2026-10-15-lead-gateway.md).
- Live PASS (2026-10-16, owner-authorized, disposable fixture; [evidence](evidence/m4-live-summary.json), [GUI](evidence/m4-codex-lead.png)): app-owned `CODEX_HOME` logged in by the owner via `codex login --device-auth`. **Run 1** exposed that Codex refuses non-read-only MCP tools under `approvalPolicy: never` ("MCP tool call requires approval"), so the adapter now sets `default_tools_approval_mode = "approve"` for the `lao` server only; the installed binary accepted it without a model turn. Run 1 also verified owner stop on a resumed thread (`turn/interrupt` → task CANCELLED, attempt cancelled). **Run 2** (gpt-6.1-sol/low Lead, deepseek/deepseek-flash/off Pi Reader): Chat/Plan used only `get_run_status`, dispatched nothing, fixture unchanged; Autonomous called `get_run_status → propose_task → assign_task` (deliberate coordinator assignment → `POLICY_DENIED`) `→ assign_task`; Pi called `read_assignment → submit_result`; one wake-up resumed thread `01a14389-efd9-7cb2-bf29-d712cac3a152` and called `read_report`; all three native sessions exited 0. The owner checkout and checked personal-config metadata stayed unchanged. No token was journaled.
## M6 item 5 verification — 2026-10-16

- Installed version probes: Codex 0.163.0; Pi 1.3.0; Claude Code 2.1.301; OpenCode v2.0.29. OpenCode's default probe failed opening its global log under the read-only sandbox; a fresh `/tmp` XDG data/config/cache/state probe succeeded. No global configuration or personal sessions were modified.
- `mise x -- codex app-server generate-json-schema --out <fresh /tmp directory>` passed. `CommandExecutionRequestApprovalResponse` and `FileChangeRequestApprovalResponse` use `decision: "decline"`. The installed legacy `ReviewDecision` differs from the previous implementation: denial is `{ "denied": { "rejection": "..." } }`, not the string `"denied"`; the code and fixture now use that structure. `PermissionsRequestApprovalResponse.permissions` permits an empty object (no network/filesystem grants), with turn scope; `McpServerElicitationRequestResponse` supports decline with null content. [Official protocol](https://learn.chatgpt.com/docs/app-server#approvals), Context7 `/openai/codex`, and the installed schemas establish the supported responses; the installed schemas govern legacy syntax.
- A fresh app-owned `CodexAdapter.discover()` probe initialized and read capabilities without a model turn. [Evidence](evidence/m6-native-permission-probe.json). Permission grants remain unsupported for the coordinator Lead; the diagnostic now distinguishes native denial notices in Needs You from interactive approval support. Sandbox, approval policy and scoped gateway authorization are unchanged.
- Pi's installed `docs/rpc-extension-ui.md` and Context7 `/earendil-works/pi` confirm general RPC dialog responses (`extension_ui_response` with matching ID, confirm/cancel/value); these are not native per-tool permission enforcement. Existing per-tool restrictions remain authoritative; the adapter still advertises permission prompts unsupported. No Pi approval or suspension is claimed. Claude/OpenCode permission callbacks remain unimplemented until their M8 adapters.
- Native permission turns are exercised with deterministic subprocess fixtures; paid/live harness approval turns are intentionally omitted (cost). No raw native command, requested permission payload or reason is copied into inbox/journal evidence. See [ADR](adr/2026-10-16-native-permission-denials.md).

## M6 item 6 verification — 2026-10-16

- Installed Pi remains 1.3.0. Context7 `/earendil-works/pi` and installed `docs/rpc-commands.md` agree: `steer` and `follow_up` return `data.disposition: queued|handled`; queued acceptance does not establish delivery. `steer` waits for a tool/input boundary; `follow_up` waits for current work to finish. `message_start` with a user message is documented in installed `docs/json.md`. [Official commands](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md).
- An offline, app-owned, no-session/no-tools probe queued both commands while idle, confirmed `pendingMessageCount=2`, cleared both with `clear_queue`, and confirmed zero pending inputs with no model turn: [evidence](evidence/m6-worker-message-probe.json). This is a protocol smoke, not live active-turn delivery verification; no global settings or personal sessions changed.
- `PiAdapter` now advertises steering and implements both native commands for an active prompt. Queue replies remain `queued` until an exact correlated user-message event; native `handled` confirms input-handler receipt. App-generated literal message prefixes prevent slash/skill/template expansion. Idle, settled, stopping and recovery sessions do not start a new prompt through this control.
- Pi docs warn that abort continues queued messages. Cancellation clears the queue before abort; failure to clear closes only this owned process with existing shutdown bounds. Behavioral fixtures verify ordering and the failure path. No new stop-run/emergency-stop control is included in this item.
- [Tests](evidence/m6-worker-message-tests.txt) and [browser demo/restart](evidence/m6-worker-message-demo.json) exercise direct steer/follow-up, matching delivery, early consumption, unsupported state, lost acknowledgements and no replay. Live cost-bearing message turns intentionally omitted. Codex worker execution is still unsupported; Claude/OpenCode workers remain M8. No native resume or cancel-and-restart fallback is claimed. [ADR](adr/2026-10-16-worker-messages.md).

## M6 item 10 — context policies (2026-10-16)

- Pi worker resume stays **unsupported** in this adapter: `startSession` refuses `contextPolicy: "resume"` and `resume()` throws. Installed Pi 1.3.0 documents `--session`/`switch_session`, but reopening one would need the earlier worktree, and every native attempt gets a new one. A successor starts fresh with an app-generated checkpoint. Each Pi session records its app-owned `pi-sessions/<attempt>` transcript directory. No new probe was run; this is a decision not to call Pi's resume surface, not a test of it.
- The Codex Lead keeps resuming its run thread (`thread/resume`, verified live in M4); successor Lead sessions now link their predecessor. Codex, Claude Code and OpenCode workers do not exist yet, so the same refusal applies to them. Real worker resume is covered by M8's adapter revisit and smoke step #4.

## M6 item 11 — provider failure evidence (2026-10-16)

- Installed versions rechecked: Codex 0.163.0, Pi 1.3.0; pinned Node/pnpm unchanged. Context7 `/openai/codex` and `/earendil-works/pi` fetched; a fresh `mise x -- codex app-server generate-json-schema --out <new /tmp directory>` passed without a model turn. Pi's bundled `docs/message-types.md`, `docs/json.md` and `docs/rpc-commands.md` were inspected; the adapter already disables native auto retry in its app-owned configuration.
- [Codex error protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/CodexErrorInfo.ts): exact `unauthorized` → auth; `rateLimitExceeded` or supported HTTP 429 fields → rate_limit; supported HTTP 401 → auth; `usageLimitExceeded` → usage_limit, **not exhausted credits**. `sessionBudgetExceeded`, other objects and permission-related 403 remain generic errors. Wrong thread/turn notifications and errors with `willRetry` are ignored.
- [Pi error contract](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md): assistant `stopReason: error` + narrow explicit native failure statements → auth/rate_limit/credits_exhausted/usage_limit. `aborted`, unavailable balance/usage and generic auth/credit words do not confirm failures. Native errors are redacted to fixed messages. Partial native token samples may be reported on failures; they do not establish account balance or total consumption.
- New typed `providerFailureKind` distinguishes confirmed adapter evidence from historical broad `auth`/`quota` codes. Safely ended failures use Needs You blockers; ambiguity retains recovery with an evidence notice. No automatic worker continuation or Lead wake-up across the hold. [ADR](adr/2026-10-16-provider-failures.md).
- Native auth/rate-limit/credit verification remains **unverified** until M8's opt-in disposable-repository smoke gates. Cost-bearing turns intentionally omitted; protocol fixtures and FAKE tests establish only app behavior. Pi text classification is intentionally narrow; unfamiliar errors stay generic. Existing preflight capability/login refusals remain setup diagnostics. M9 retains the visible exhaustion/recovery gate.

## M7 item 11 — live read-only workflow (2026-10-17)

- `mise x -- pi --version`: **1.3.0**. Fresh app-owned `PiAdapter.discover()` succeeded without a prompt; `deepseek/deepseek-flash` still advertises `off/low/high/max`, auth remains **unknown** until a turn succeeds. Context7 `/earendil-works/pi/v1.3.0` and bundled `docs/json.md`, `cli.md`, `environment-variables.md` agree on `agent_settled`, explicit extension/tool allowlists and app-owned settings/session directories. [Versioned completion contract](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/json.md), [CLI](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/cli.md).
- PASS: `mise x -- pnpm smoke:workflow --allow-live --model deepseek/deepseek-flash --thinking off --output docs/evidence/m7-workflow-pi-smoke.json` — 2 actual Pi readers + 1 synthesizer, each in a separate read-only worktree, native IDs recorded, authoritative completion and exit 0, no changed files. Three-reader template under one-active-agent cap; four-reader template denied; hard budget 3 launches. [Original reports, references, tool names and partial usage samples](evidence/m7-workflow-pi-smoke.json).
- Partial coverage was deliberate owner cancellation of an **unlaunched** reader, not an induced native failure/crash. Synthesis retained its failure-event reference, no invented attempt/report, and explicitly returned `partial` with observed file:line citations. One overlong synthesis submission was rejected and corrected in the same native turn; model report-length guidance is not enforcement, and the existing 2,000-character source excerpt/4,000-character structured-summary limits were unchanged.
- Restart retained report hashes, workflow outcomes and attempt identities/outcomes/decisions; no replay. Owner checkout and checked personal-config metadata stayed unchanged; app-owned temporary database/config/worktrees and marked fixture removed only after successful checks. No credential extraction/copy, personal session control, live Codex Lead, native review turn, permission approval or OS sandbox claim. M8's native auth/quota/crash/resume/four-harness gates remain unverified.

## M8 item 1 — Claude SDK worker implementation, 2026-10-17

- Installed CLI **2.1.302**; exact official Agent SDK **0.3.302**, whose registry manifest declares that CLI version. Verified current [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript), [permissions](https://code.claude.com/docs/en/agent-sdk/permissions), [sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [quickstart/auth restrictions](https://code.claude.com/docs/en/agent-sdk/quickstart) and installed declarations. The adapter uses stable `query` and the installed executable, not a raw model client or preview-session API.
- **Native no-model control PASS:** `mise x -- pnpm test:live:claude --output /tmp/m8-claude-probe-20261017a.json`; isolated SDK/CLI metadata handshake, catalog `default/opus/fable/sonnet/haiku`, per-model native efforts, clean fixture/HEAD and unchanged checked personal-config metadata. Zero model prompts; temporary app configuration/fixture removed. [Evidence](evidence/m8-claude-probe.json). Catalog and key-source metadata do not prove authentication/entitlement.
- Implemented root-only streaming and authoritative non-error result + actual owned-exit completion; exact model/effort checks; unconditional PreToolUse file/checkout guards and forced Edit/Write asks; one-shot `canUseTool` callbacks; strict worker-only MCP; bounded owned-child EOF/TERM/KILL; durable same-run/task/checkout/model/permission resume manifests. SDK HTTP MCP provenance is not mislabeled as in-process `"sdk"`: installed declarations distinguish dynamic/configured process servers.
- Owner approval uses authenticated `POST /api/native-approvals`; native waits persist in Needs You, unrelated work proceeds, decisions commit before callback delivery and never widen SDK permissions. Paused/Chat-Plan/other human blockers cannot gain approval. Failed receipts still request cancellation; stale/end/restart callbacks expire without replay. Codex coordinator denials stay notices; Pi semantics are unchanged. [ADR](adr/2026-10-17-claude-worker-permissions.md).
- **Fixture/UI PASS:** 52 Claude regressions; real engine/HTTP/Git, SDK-boundary fixtures and inert real subprocesses, including clean/nonzero/signal exits, model drift, parallel approvals, root/path replacement, recovery and journal rollback. Chromium Approve once/Deny once plus reload retained decisions; approved worker file produced one candidate, denied worker file remained unchanged, neither integrated, owner checkout unchanged and fixtures removed. [Runtime](evidence/m8-claude-ui.json), [receipt](evidence/m8-claude-approve-once.png). These are explicitly scripted, not Claude model runs.
- **BLOCKED authenticated live validation:** no supported API key/provider environment is configured. The opt-in command with `--allow-live --model sonnet --thinking low --output /tmp/m8-claude-blocked-20261017a.json` exited **2**, submitted zero prompts, verified safety invariants and removed unused fixtures: [evidence](evidence/m8-claude-blocked.json). No credential contents, OAuth tokens or personal sessions were inspected/copied/attached.
- Owner prerequisite: privately configure `ANTHROPIC_API_KEY` or an approved Bedrock/Vertex/Foundry environment, then run `mise x -- pnpm test:live:claude --allow-live --model sonnet --thinking low --output /tmp/m8-claude-live-evidence.json` with a new output path and fresh-discovered settings. Actual native streaming/effective model/effort, same-checkout resume, permission callbacks and active-turn cancellation are **not passed** until that cost-bearing run succeeds.
- Limits: no OS sandbox, shell, delegation, native Claude Lead or live steering. Engine assignments still create a fresh worktree and cannot resume a different checkout; auto continuation uses a checkpoint. Interrupted work never resumes or reruns automatically. Other M8 checklist items and the four-harness matrix remain untouched.
