# Superset vs. Metatron: Claude Code & Pi harness report

## 0. Method / evidence
...

## 1. Executive summary (TL;DR)
- 5-8 bullets.

Then the sections.

Let me write it. I'll be mindful to attribute: "Superset" claims with file paths; "ours" with paths; "SDK" claims with d.ts lines; "docs" claims with URLs.

Regarding the recommendation around auth, I want to be crisp:

Recommended path (if you want my opinion):
1. Primary: **`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`** — officially documented for automation + Agent SDK; uses your Pro subscription; no credential copying; app-owned config dir stays; revocable; no new billing. Requires: forward the env var, accept route in detection, ADR recording the policy decision and the "third-party offering" caveat.
2. Alternative: interactive login into app-owned config dir (`CLAUDE_CONFIG_DIR=... claude auth login`) — also fine; heavier UX; slightly more exposure (full login material in app dir vs a model-only token).
3. Keep API-key route supported for when/if you want strict policy compliance or CI use.
4. Avoid: silently using `~/.claude` (Superset's chat behavior) as the default for a product; and avoid leaving `routeConfigured`'s current logic (it will keep rejecting valid routes).

Also worth noting: whichever route, the fix to detection should use `claude auth status` (JSON, includes authMethod + configDirectory) and/or `AccountInfo` fields (subscriptionType/tokenSource), and the env allowlist must forward the documented vars. And `discover()`'s `authenticated` should be 'unknown' vs false based on valid signal.

Also flag: `ANTHROPIC_API_KEY` takes precedence over subscription login (docs) — so if a key is ever set in the app env, it silently overrides the subscription; detection should surface which route is active (Superset captures the same distinction via account capture and account profiles).

OK writing now. I also want a short "what this means for M8 item 1" — the prompt.md asked to finish validating M8 item 1 and the auth question. My report addresses exactly that. I'll close with concrete next-step options: (a) decision + probe; (b) then the live gate command; and note the probe I can propose (no-cost): run a no-prompt discovery with CLAUDE_CODE_OAUTH_TOKEN set after owner runs setup-token.

Also include the "issues" symptom mapping section.

One more thing: keep the report honest that Superset is ELv2 source-available → study, don't copy code. One line.

Now write.

I have everything I need. Here's the report.

---

# Superset vs. Metatron — Claude Code & Pi harness report

**Evidence tier:** I read `superset.md` (= `~/Code/superset/HOWTO.md`, identical bytes), spot-checked its load-bearing claims against the actual Superset source at the cited paths, read all of our `src/server/adapters/*` Claude/Pi code and orchestration call sites, and probed the installed toolchain read-only (`claude 2.1.302`, `cli 2.1.302`, SDK `0.3.302` declarations + manifest, `pi 1.3.0` + bundled RPC docs, `claude auth status`, `claude setup-token --help`). No credentials were read or copied, no model turns were run, nothing was modified. Superset is ELv2 — study it, don't copy code.

---

## 1. TL;DR

1. **The Claude live blocker is largely self-inflicted.** Your native Claude Code is logged in with a **Pro subscription** (`authMethod: claude.ai`, `apiProvider: firstParty`). Our adapter (a) refuses OAuth/token routes by a concrete bug in `routeConfigured()`, (b) doesn't forward the env vars for **any** officially supported subscription route, and (c) defaulted to "API key only" without considering `claude setup-token`/`CLAUDE_CODE_OAUTH_TOKEN`, which the official docs explicitly recommend for automation and the Agent SDK. Superset's own stance is the opposite: it *removes* ambient API keys so the CLI uses the machine's login.
2. **Our trust architecture is right; several glue details are wrong.** Direct SDK / direct Pi-RPC (no ACP) is the correct choice for a policy-enforcing orchestrator, and it mirrors Superset's own legacy Claude adapter and pi-acp's internals. What we're missing are Superset's **catalogue layer** (absolute CLI resolution, version floor + upgrade text, per-harness env contract), its **diagnostics** (stderr tail, actionable hints), its **process-group kill discipline**, and its **account metadata capture**.
3. **Likely friction sources besides auth:** the hard 180 s wall-clock turn caps in both adapters, discarded stderr (nothing to debug a failed live run with), the double CLI launch per Claude attempt, and a couple of Pi transport sharp edges.
4. **Cheap wins to take now:** use SDK result `total_cost_usd` + `modelUsage`, Pi `get_session_stats` (`contextUsage`), the rich `canUseTool` ask fields (`title`, `description`, `defaultToNo`, `suggestions`), the SDK `manifest.json` version pin, and `claude auth status` for truthful `authenticated` classification.
5. **What not to take:** `bypassPermissions` defaults, "remove API keys to force login" as a product policy, ungated Pi, first-option denial fallback, and ACP-for-uniformity (we have four known harnesses, not a marketplace).

---

## 2. What Superset actually does (verified, condensed)

### 2.1 Claude — two surfaces

**Chat (current, `claude-acp`):** host spawns `@agentclientprotocol/claude-agent-acp` (adapter 0.85.0) via `process.execPath` + `ELECTRON_RUN_AS_NODE=1`, env var `CLAUDE_CODE_EXECUTABLE=<resolved claude>`; the adapter wraps the **Claude Agent SDK** and speaks ACP over stdio. Ground truth in `packages/host-service/src/chat-v3/acpCatalogue.ts` (gate `>= 2.1.226`, upgrade text, `fullAccessModeId: "bypassPermissions"`) and `acpHarnesses.ts` (factory + account capture).

**Authentication:** `buildChatAgentEnv` (`agentEnv.ts`) gives the agent *the same env a terminal gets*, puts `~/.superset/bin` first on PATH, **removes `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`** outside sandbox, and lets the CLI use the machine's login. Account "switching" never touches credential stores — it records which `CLAUDE_CONFIG_DIR`/`CODEX_HOME` to inject; "the agent CLI itself keeps owning every login end to end" (`default-account.ts`). Account metadata (email/org) is captured for usage attribution only, from `.claude.json`/session logs.

**CLI resolution/versioning:** `agentCli.ts` prefers `~/.superset/bin/<binary>` (their wrapper), then PATH; runs `<cli> --version` (10 s timeout, 60 s cache); parses first `x.y.z`; enforces the catalogue floor with an actionable upgrade message.

**Legacy direct SDK adapter (`claude-code`)** — the closest analog to ours: one long-lived process with a **streaming-input `PromptQueue`** (multi-turn), `includePartialMessages: true`, `settingSources: []`, `permissionMode` = `bypassPermissions` default, `allowDangerouslySkipPermissions: true`, `canUseTool` used as an approval bridge that returns `{ behavior: "allow", updatedInput: pending.input }`. Two documented traps: `allowedTools` shadows `canUseTool`; accept must echo `updatedInput`.

**Terminal Claude:** hooks merged into `~/.claude/settings.json` (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`, `SubagentStart/Stop`, `PostToolUse(+Failure)`, `PermissionRequest`) → `notify.sh`; secondary profiles get the same hooks written into their own `settings.json`.

### 2.2 Pi

- **Chat:** `pi-acp` package spawns `pi --mode rpc` and bridges ACP↔RPC; keeps `~/.pi/pi-acp/session-map.json` so `session/load` reattaches; **no fs/terminal delegation**; **MCP params accepted but not wired**; reports `get_session_stats` → `contextUsage` as ACP `usage_update`; supports `/steering` and `/follow-up` (Pi's own modes); terminal auth via `pi-acp --terminal-login`; README declares **pi v0.81.0+ and Node 22+** — Superset's catalogue is deliberately **ungated** because they couldn't verify a floor.
- **Terminal Pi:** extension at `~/.pi/agent/extensions/superset-hooks.ts` (activate only with `SUPERSET_TERMINAL_ID`, no-op without `notify.sh`, skip when `ctx.hasUI === false`). Mapping: `session_start→SessionStart`, `before_agent_start→UserPromptSubmit`, `tool_execution_end→PostToolUse`, `agent_end→Stop/Failed` (uses `assistant.stopReason === "error"` + `errorMessage`), `session_end→SessionEnd`, `session_shutdown→Stop` (prevents stuck indicators on Ctrl+C). Payload carries **no session_id**.
- **Pi background shells:** the ACP adapter detects Pi's shell tool background tasks (`rawOutput.details = {shellId,status,pid?}`) and stops them by **process group**; the transport spawns `detached` and kills the whole group (`end stdin → 2 s → SIGKILL group`).

---

## 3. How we do it — side-by-side

### 3.1 Claude

| Dimension | Superset (`claude-acp` / legacy `claude-code`) | Metatron (`claude*.ts`) | Verdict |
|---|---|---|---|
| Integration | External adapter package over ACP; legacy: direct SDK query | Direct SDK `query()` + installed CLI (`pathToClaudeCodeExecutable`) | **Keep ours.** Direct SDK is the only way to get our PreToolUse/`canUseTool` policy + owned-process manifest resume. It's literally Superset's legacy shape. |
| Process lifetime | Long-lived; multi-turn streaming input, steering hooks | **One prompt per owned process**; resume = new process + `resume:` + clean manifest | Defensible for workers; costs multi-turn chat and steering. See §5.4. |
| Auth | Machine login; ambient keys removed; profile dirs injected on demand | App-owned `CLAUDE_CONFIG_DIR`; **API-key/Bedrock/Vertex/Foundry only**; `routeConfigured()` rejects `apiKeySource: "none"`; env allowlist omits token routes | **Wrong.** Fix per §4. |
| Isolation | Minimal (personal config by default), `settingSources: []` in legacy | Strong: curated env, app-owned config, `settingSources/plugins/skills/agents` empty, exact tool list, `strictMcpConfig` | **Keep ours.** Better than Superset for a policy-enforcing orchestrator. |
| Version gate | Catalogue floor 2.1.226 + upgrade message + wrapper-first resolution | None (PATH scan only; no `--version` probe, no floor) | **Adopt theirs** (the SDK ships `manifest.json` declaring the exact matching CLI = 2.1.302; better input than a hardcoded floor). |
| Permissions | `bypassPermissions` default; `canUseTool` as UI bridge (bypassable by native allow rules) | `permissionMode: "default"`, `permissionPrompts: "host"`, unconditional PreToolUse gate for **every** tool + one-shot owner consent for Edit/Write via `canUseTool`; `updatedInput` echoed; no `allowedTools` shadowing | **Ours is stronger.** Superset's doc §4.4 traps are already avoided. |
| Model/effort | Whatever the agent reports | Pre-validated against native catalog, drift-checked at `system:init`/`message_start` | Keep. |
| Resume | ACP `session/load`; fall back to new only on "not found" | `resume:` + app-owned manifest (run/task/model/effort/permission/checkout identity), clean-only | Keep ours; stricter and matches our recovery rules. |
| Usage/account | Captures account identity for attribution; usage history from session logs | `usage` events from result `input/output tokens` only; **ignores `total_cost_usd`, `modelUsage`, `permission_denials`, `num_turns`** | Easy upgrade (§5.8). |
| Diagnostics | Keeps **last 4,000 chars of stderr**, attaches to the failure notice; auth-aware hints naming the login command | **Discards all stderr**; redacted generic errors | **Adopt theirs** (bounded, app-owned, redacted). |
| Approvals UX | Renders native ask fields in an ApprovalRow | Generic “requests one-shot approval … tool input is redacted” text | Upgrade available (§5.7). |

### 3.2 Pi

| Dimension | Superset (`pi-acp`) | Metatron (`pi.ts`, `pi-rpc.ts`) | Verdict |
|---|---|---|---|
| Integration | ACP adapter package spawning `pi --mode rpc` | Direct `pi --mode rpc` + guard extension | **Keep ours** — no ACP tax; we already validate model/thinking via `get_state` and enforce policy in a native extension. |
| Resume | `session/load` via `session-map.json`; pi `--session <path|id>`, `--session-id`, `--fork`, RPC `switch_session` all exist | **Refused** (policy: successor gets a fresh worktree + checkpoint) | Keep the refusal, but record the capability + our per-attempt transcripts now; it’s a small change later (§5.9). |
| Usage/context | `get_session_stats` → real `contextUsage`, `tokens`, `cost` | Usage deltas from assistant `usage` only (partial by design) | Take `get_session_stats` for budget/context policies. |
| Background shells | Tracks `rawOutput.details {shellId,status,pid?}`; kills by process group | Shell tool disabled entirely | N/A today; copy the pattern if writers ever get shell. |
| Auth | User's Pi config / provider env | Inherited env (curated-ish: `GIT_*` + gateway vars stripped), app-owned `PI_CODING_AGENT_DIR` | Fine; note the deliberate asymmetry with Claude. |
| Version gate | Ungated catalogue (they had nothing to verify against) | None | Add a floor probe anyway (pi-acp README says v0.81.0+/Node 22+; we're on 1.3.0). Cheap insurance. |
| Lifecycle | Terminal hooks (not used for chat) | `agent_settled`-authoritative completion, `owner_message_delivered` correlation for steering | Keep; matches Pi's own docs. |
| Transport edges | `detached` spawn, group kill, malformed lines skipped + reported, exit flush 500 ms, tolerates missing `jsonrpc` | Not detached (no group kill); **one malformed JSON line kills the protocol session**; SIGTERM-only in `stopProtocol`; diagnostics = 128 bounded headers | Improve (§5.5–5.6). |

---

## 4. The headline: fix Claude authentication (M8 item 1 blocker)

### 4.1 Why we're blocked (two code defects + one policy choice)

1. **`routeConfigured()` rejects valid routes.** `src/server/adapters/claude.ts:136-149` requires `apiKeySource !== "none"`. The SDK declarations (0.3.302) say `apiKeySource: "none"` is exactly the value for *“claude.ai OAuth login, a bearer token, or a third-party cloud provider”*; only `'ANTHROPIC_API_KEY'`, `'apiKeyHelper'`, `'/login managed key'` are non-`none`. So a subscription login **cannot** pass, ever.
2. **The child env allowlist (`claude-options.ts:51-84`) forwards none of the supported subscription/token routes:** no `CLAUDE_CODE_OAUTH_TOKEN`, no `ANTHROPIC_AUTH_TOKEN`, no `CLAUDE_CODE_USE_ANTHROPIC_AWS`/`ANTHROPIC_AWS_WORKSPACE_ID`, no `ANTHROPIC_BEDROCK_BASE_URL`. Even if the owner configured one, the CLI wouldn't see it.
3. **Policy was chosen for API key only**, treating subscription login as categorically unavailable. The official docs' restriction is: *“Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products… use the API key methods.”* That targets **products offering claude.ai login to third parties**. A single-user local tool that consumes *the owner's own* subscription is a different thing — and the docs explicitly recommend **`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`** for automation and Agent SDK programs that can't sign in interactively. Superset goes further: it actively *removes* API keys so Claude chat uses the machine's login.

### 4.2 Officially supported routes today (installed CLI + current docs)

| Route | How | Cost/billing | Isolation | Notes |
|---|---|---|---|---|
| **A. API key (status quo)** | `ANTHROPIC_API_KEY` in app env | Separate Console billing | App-owned config | Sanctioned for distributed products. Owner has none configured. |
| **B. Long-lived subscription token** ⭐ | Owner runs `claude setup-token` once; app receives `CLAUDE_CODE_OAUTH_TOKEN` | Uses the **Pro subscription** | App-owned config | Explicitly documented for CI/automation and the Agent SDK; token makes model requests only; revocable. No credential copying. |
| **C. Interactive login into app dir** | `CLAUDE_CONFIG_DIR=<app dir> claude auth login` once (then app launches with that dir) | Pro subscription | App-owned config; CLI owns its credentials there | More friction; full login material lands in the app dir. Detection must accept `apiKeySource: "none"` + `subscriptionType`. |
| **D. Bedrock/Vertex/Foundry/AWS** | `CLAUDE_CODE_USE_*` + cloud creds | Cloud billing | App-owned config | No cloud creds on this machine. |
| **E. Superset-style machine login** | Launch against `~/.claude`, don't set config dir | Pro subscription | **None** (personal settings/history/sessions shared) | Most seamless, weakest isolation; as a *product* behavior it's the pattern the docs' restriction targets. |

**Recommendation (owner decision — it changes costs/privacy/authority, so it needs an ADR):** support **A + B first-class, keep C as the interactive fallback**, leave D as-is, and deliberately **not** do E by default. B is the zero-billing, no-copy path that preserves all our isolation guarantees and unblocks the live gate today. Also note the precedence trap the docs call out: if `ANTHROPIC_API_KEY` is ever present it **silently overrides** the subscription login, including non-interactive mode — so surface which route is actually active.

### 4.3 Exact changes needed (regardless of which route wins)

- Replace `routeConfigured(provider, source)` with a truthful classifier over `AccountInfo` (`apiProvider`, `apiKeySource`, `subscriptionType`, `tokenSource`) **and/or** `claude auth status` JSON (`loggedIn`, `authMethod: none|claude.ai|oauth_token|api_key|api_key_helper|third_party`, `configDirectory`, exit 0/1). Keep `authenticated: "unknown"` unless a route positively matches; only `false` when there is genuinely no credential path.
- Forward the chosen env vars in `claudeEnvironment()`; keep stripping everything else.
- Update `discover()` diagnostics, `profiles.ts` gating (`catalog.authenticated === false`), and `native-run.ts:29` consistently.
- Before any cost-bearing turn: run the **no-model probe** (`pnpm test:live:claude --output …`) with the chosen route and record observed `AccountInfo` fields; then the opt-in live gate per `prompt.md`.

---

## 5. What we're doing wrong or poorly (ranked)

1. **Claude auth detection/env (§4).** Highest impact; blocks an entire milestone.
2. **Hard 180 s wall-clock caps** (`claude-turn.ts:192`, `pi.ts:312`). Superset has per-RPC timeouts but **no per-turn wall clock**. A long legitimate worker turn → forced cancel → `interrupted without automatic replay` → recovery decision. This is a strong candidate for “we’ve been having issues.” Suggest: idle/watchdog on *time since last event* (or a much higher, configurable bound), keeping the engine stop path as the operator control.
3. **No Claude diagnostics.** `spawnClaude` does `child.stderr.resume()` → discarded. Superset keeps a 4 KB tail and appends it to the failure notice (and has auth-aware hints). When auth is fixed, the first live failure (login prompt, org policy, proxy) will be invisible to you. Add a bounded ring buffer written to an app-owned `claude-sessions/<id>.diag` (0600), redaction rules unchanged; optionally an owner-visible hint derived from typed errors.
4. **Two CLI launches per attempt** (`claude.ts:232` probe → stop → `259` real launch). ~One extra SDK/CLI cold start per attempt, and a validation/launch race window. Options: validate on the real launch before pushing the prompt (accepting a possibly-empty transcript on failure), or cache `supportedModels()/accountInfo()` per CLI-version+config-dir (60 s TTL à la `agentCli.ts`) and drop the probe for repeat attempts.
5. **Process-group kill gaps.** Superset spawns `detached` and kills the whole group; we spawn non-detached and signal only the direct child (both adapters). The SDK CLI and Pi can spawn children (rg, shells if ever enabled); on cancel/SIGKILL those can leak. Cheap fix: `detached: true` + `process.kill(-pid, sig)` with the same bounded escalation.
6. **Pi transport sharp edges.** `stopProtocol` kills SIGTERM-only; **a single malformed stdout line tears down the session** (Superset skips the line and reports a notice); `PiRpc` has no stderr tail either (only 128 header records). Also `abort`/`clear_queue` failing closes the owned process — sensible, but the **abort-on-idle** response shape is unverified; confirm it before relying on cancel near settlement.
7. **We ignore the SDK’s rich ask metadata.** `canUseTool` options in 0.3.302 include `title`, `displayName`, `description`, `defaultToNo`, `suppressAlwaysAllowRule`, `decisionReason`, `matchedAskRule`, `suggestions`, `blockedPath`, plus `toolUseID`/`agentID`/`requestId`. Our Needs You card shows a generic sentence. Rendering `title`/`description` and honoring `defaultToNo`/SuppressAlwaysAllow is free truthfulness and better UX. (We already use `agentID`, `requestId` correctly — verified.)
8. **Usage/cost left on the table.** SDK result carries `total_cost_usd`, `modelUsage` (the “correct field for token/cost accounting”), `permission_denials`, `num_turns`. Pi has `get_session_stats` (`tokens`, `cost`, real `contextUsage`). Our budget/context features currently see only partial token counts.
9. **No CLI version floors.** Superset refuses sub-2.1.226 with an upgrade command; the SDK ships `manifest.json` (`version: 2.1.302`, per-platform checksums). Gate on the installed `claude --version` vs the SDK manifest, and add a Pi floor (pi-acp README says v0.81.0+/Node 22+; you're on 1.3.0). This converts the classic “mystery incompatibility” into an actionable message.
10. **Pi resume is refused (fine) but nothing records the capability.** You already keep per-attempt transcripts (`pi-sessions/<attemptId>`) and could persist `--session-id` for a future `switch_session`/`--session` resume; Superset demonstrates the mechanics. Keep the policy, note the path in the recon doc.
11. **Minor:** unified diagnostics asymmetry (Claude: none / Pi: headers only), `PiRpc.close()` vs Superset’s exit-flush discipline (ours is fine), and the discovery launcher writes a `discovery-sessions` dir — harmless but worth one line of documentation.

---

## 6. What to take from Superset (ranked, with where it fits)

| # | Take | Why / where |
|---|---|---|
| 1 | **Catalogue/launch layer**: per-harness row = binary, args, adapter, executable env var, `minVersion`, upgrade text, default mode; resolve to **absolute command** (wrapper-first then PATH); probe `--version` with cache + timeout; fail with an actionable message | New `adapters/catalogue.ts` (M8 revisit). Fixes PATH/mise-shim surprises and version drift; SDK `manifest.json` supplies the expected CLI version. |
| 2 | **“Same env as a terminal” + account profiles** principle: never touch credential stores; inject only the profile dir; let each CLI own its login; capture account identity for attribution, never secrets | Auth design (§4). Directly transferable to our app-owned `CLAUDE_CONFIG_DIR` / `PI_CODING_AGENT_DIR`. |
| 3 | **Bounded stderr tail + hint-bearing notices** (auth-aware messages naming the login command) | Diagnostics (§5.3/5.6). Biggest debuggability win for the live gate. |
| 4 | **Process-group lifecycle**: `detached` spawn, end stdin → 2 s → SIGKILL group; tolerate unknown/malformed frames with a notice instead of killing the stream | Both adapters (§5.5/5.6). |
| 5 | **Versioned lifecycle events** (`SessionStart/UserPromptSubmit/PostToolUse/Stop/StopFailure/PermissionRequest`) — for us the mapping is already RPC/SDK events, but adopt their *failure* event semantics (`StopFailure` distinct from `Stop`) | Our `session_error` vs `turn_completed: failed` already mirrors this; keep. |
| 6 | **Prompt queue + steering contract** (`canSteer`, queue-until-ready, turn accounting) | Needed only if you later want multi-turn Claude workers or owner Q&A on a live session (§5.4). |
| 7 | **Ask-field rendering** (title/description/defaultToNo/suppressAlwaysAllow) | Needs You card upgrade (§5.7). |
| 8 | **Usage/context capture** (`total_cost_usd`, `modelUsage`; Pi `get_session_stats` contextUsage/cost) | Budget holds + context policies (§5.8). |
| 9 | **Pi session-map pattern** (persist session file/id mapping for `session/load`) | Future Pi resume, if the engine ever retains worktrees (§5.10). |
| 10 | **Process-group background-task tracking** (`shellId/status/pid`, stop by group) | Only if Pi writers ever get shell. |

## 7. What NOT to copy

- **`bypassPermissions` as the default chat mode** — their doc itself flags that native allow rules can bypass `canUseTool`; our hook+ask design is the fix, not the problem.
- **Removing ambient API keys to force machine-login** as a *product* policy — whether it's acceptable depends on your distribution intent; it's the pattern the docs' restriction targets.
- **Ungated Pi** — they admit they had nothing to verify against; we can afford a floor probe.
- **Generic decline fallback** (first option / label search) and any “permission transport as enforcement” assumption.
- **ACP adoption for uniformity** — Superset keeps direct adapters alongside ACP for exactly our reasons (policy callbacks, owned processes). Our four adapters are known quantities; ACP would trade control for a plugin marketplace we don't need.

---

## 8. If you share the exact symptoms, here's my hypothesis map

| Symptom you may be seeing | Likely cause | Fix location |
|---|---|---|
| Claude workers “BLOCKED — configure ANTHROPIC_API_KEY…” every time | §4 defects | `claude.ts` `routeConfigured`, `claude-options.ts` env |
| Task ends `interrupted without automatic replay` / requires RETRY_DECISION mid-run | 180 s wall-clock cap | `claude-turn.ts:192`, `pi.ts:312` |
| Live run fails with a generic redacted error and nothing else to go on | stderr discarded | `claude-process.ts:22`, `pi-rpc.ts:94` |
| “Claude native session is already owned or requires recovery” after a crash/kill | stale lock file by design | `claude.ts:185-194` (recovery decision path — working as intended) |
| Pi session dies after odd output | malformed-line `stopProtocol` | `pi-rpc.ts:86-89` |
| Stop/help on Pi closes the process | `cancel` failure path | `pi.ts:391-394` (verify `abort`-while-idle semantics first) |

---

## 9. Suggested next steps

**You asked for feedback only, so nothing was changed.** When you exit plan mode, the natural sequence is:

1. **Owner decision + ADR**: auth policy (A+B+C above), then the small `routeConfigured`/env/detection patch and a **zero-cost no-prompt probe** with the chosen route.
2. Run the M8 item 1 live gate with fresh discovery (`mise x -- pnpm test:live:claude --allow-live …`) and fix whatever it reveals *without* weakening the receipt/staleness/resume guarantees.
3. Fold the ranked §5 items into the M8 “adapter revisit” checklist — I'd order: diagnostics → deadline semantics → process groups → version gates → usage fields → ask metadata.

If you tell me the concrete symptoms you've been hitting (and whether any beyond the auth block are Claude vs Pi), I can turn this into a precise, ordered implementation plan — either here in chat or written to your plan directory.
