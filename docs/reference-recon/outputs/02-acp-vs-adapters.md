# ACP versus native adapters — M8/M3 reference reconnaissance

Reference SHA: `491ca53f4cd1d6a4ed06735cfd98a39a12480d67`, recorded with `git -C /home/phagmaier/Code/superset rev-parse HEAD`. Read-only study; no Superset code copied. License identification: `S/LICENSE.md:1`.

**Evidence paths:** `S/` expands to `/home/phagmaier/Code/superset/`; `M/` expands to `/home/phagmaier/Code/metatron/`. Every citation below is a local path and original line number. Estimates and proposed tests are engineering judgments, not measured results.

Started with Q3 in `M/docs/reference-recon/outputs/00-INDEX.md:49` and the requested ACP filename inventory. All specifically requested filenames and UI directories exist at this SHA; the exact paths read are listed below. Historical documents point at absent `packages/host-service/docs/acp-sessions.md`, `packages/session-protocol/`, and `plans/acp-session-follow-ups.md` (`S/plans/done/20260710-session-harness-acp.md:3`, `S/plans/done/20260710-session-harness-acp.md:36`); these pointers were checked against the tracked tree and filesystem, not treated as current implementation.

Method: Superset is not indexed in codebase-memory; search/coverage calls returned “project not found or not indexed,” so findings use direct absolute-path source reads. Metatron evidence-path coverage reported no recorded issue; only spec §5 and §13.3 content was read. Context7 and the official [session setup](https://agentclientprotocol.com/protocol/v1/session-setup) and [tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls) pages were consulted for protocol orientation; they establish no installed-harness compatibility here. No harness process, live test, install, or application test suite was run.

### Finding 1 — Use a gated hybrid for M8

- **Question:** Should metatron replace all four native adapters with ACP?
- **Their mechanism:** Superset registers direct Claude SDK and Codex app-server adapters alongside ACP factories, so its runtime already accommodates both integration styles. Its older comparison reports 3,012 versus 4,428 added non-UI production lines for ACP versus a direct SDK design, but excludes tests, packaging and other infrastructure and describes different development snapshots. Its host-client unification plan addresses mobile/relay transport, while the ACP process itself uses local stdio; that product architecture is outside this recommendation.
- **Evidence:** `S/packages/host-service/src/chat-v3/mount.ts:54`, `S/packages/host-service/src/chat-v3/mount.ts:99`; `S/apps/mobile/plans/acp-vs-claude-sdk.html:304`, `S/apps/mobile/plans/acp-vs-claude-sdk.html:409`, `S/apps/mobile/plans/acp-vs-claude-sdk.html:424`; `S/plans/done/acp-host-client-unification.md:36`; `S/packages/chat-runtime/src/harness/acp/rpcClient/rpcClient.ts:37`.
- **What metatron does today:** M8 specifies Claude SDK and OpenCode SDK/server (`M/todo.md:150`); working Pi RPC and Codex app-server paths are documented in `M/docs/adapter-recon.md:120`, `M/docs/adapter-recon.md:129`, `M/docs/adapter-recon.md:135`.
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M8) — **gated hybrid**: retain Codex app-server and Pi RPC, implement Claude with the official Agent SDK, and first timebox an OpenCode ACP proof. Use OpenCode ACP only if the installed v2 binary passes Findings 9–10; otherwise retain the documented v2 client/private-server plan. This is a proposal for a later ADR/checklist decision; no design file is changed here.
- **Cost if adopted:** Estimate **42–64 hours**: ACP proof 6–8h, Claude adapter 16–24h, OpenCode ACP adapter 12–20h, shared M8 integration/regression/diagnostics 8–12h. If the proof fails, substitute 20–32h for OpenCode v2 client/server work: **50–76h**, including the failed proof. An all-four ACP replacement is provisionally 64–104h, with greatest risk in re-proving existing policy and recovery behavior. These are alternative totals; later findings describe included work, not additive charges. Guardrails: `M/AGENTS.md:95`–`102`, especially policy denial, crash recovery and native-session identity.
- **Unverified:** Actual delivery time, vendor compatibility and savings. The historical 47% LOC difference is not an M8 time-saving forecast.

### Finding 2 — ACP support means different things for each harness

- **Question:** Which native harness/version actually has an evidence-backed ACP route?
- **Their mechanism:** Superset's catalogue distinguishes translator packages from a native ACP subcommand and records the confidence behind each CLI floor. The factory passes an explicit native executable path to each translator rather than silently accepting its bundled CLI. Package versions, catalogue admission floors and verified behavioral coverage are separate evidence.

  | Harness | ACP route and version evidence at this SHA | Metatron's last recorded version and compatibility |
  |---|---|---|
  | Codex | Configured through `@agentclientprotocol/codex-acp@2.1.0`; CLI floor **0.160.0**, explicitly conservative, not the earliest supported release; catalogue says translator drives app-server. `S/packages/host-service/src/chat-v3/acpCatalogue.ts:31`, `S/packages/host-service/package.json:79`. | **0.163.0** (`M/docs/adapter-recon.md:138`); this translator/CLI pair **UNVERIFIED**. Native ACP in the Codex binary **UNVERIFIED**. |
  | Claude Code | Configured through `@agentclientprotocol/claude-agent-acp@0.85.0`; **2.1.226** documented as checked for session/new modes/configOptions against **2.1.286**, not proof of the entire matrix. `S/packages/host-service/src/chat-v3/acpCatalogue.ts:20`, `S/packages/host-service/package.json:78`. | **2.1.301** (`M/docs/adapter-recon.md:138`); this translator/CLI pair **UNVERIFIED**. Native ACP in the Claude binary **UNVERIFIED**. |
  | OpenCode | Native `opencode acp`; **1.15.5** documented as verified for initialize/session/new/model options. `S/packages/host-service/src/chat-v3/acpCatalogue.ts:50`. | **v2.0.29** (`M/docs/adapter-recon.md:138`); ACP support on this major version **UNVERIFIED**. A numerically higher version does not establish this interface. |
  | Pi | Configured through `pi-acp@0.0.34`; **supported Pi version UNVERIFIED**: catalogue explicitly says no Pi installation was available, with an ungated 0.0.0 sentinel. `S/packages/host-service/src/chat-v3/acpCatalogue.ts:58`, `S/packages/host-service/package.json:104`. | **1.3.0**, installed identity `@earendil-works/pi-coding-agent` (`M/docs/adapter-recon.md:15`, `M/docs/adapter-recon.md:138`); translator compatibility and native ACP **UNVERIFIED**. |

- **Evidence:** Table citations; executable injection: `S/packages/host-service/src/chat-v3/acpHarnesses.ts:87`; version checking: `S/packages/host-service/src/chat-v3/agentCli.ts:115`; translator dependency versions: `S/bun.lock:1430`, `S/bun.lock:1432`, `S/bun.lock:5634`, `S/bun.lock:7438`.
- **What metatron does today:** Native capability surfaces, with observed versus unverified behavior distinguished (`M/docs/adapter-recon.md:25`); M8 requires installed-version verification (`M/todo.md:152`).
- **Gap or confirmation:** gap
- **Verdict:** adopt now (M8) — record CLI, translator, underlying SDK and negotiated ACP versions independently. Pi's catalogue entry does not unblock or supersede M3's working RPC adapter.
- **Cost if adopted:** 2–3h within the proof budget; touches fresh-context/native-ID guardrail `M/AGENTS.md:101`.
- **Unverified:** Negotiated ACP version for **each of the four installed pairs**. Superset requests version 2 and tests fallback to 1 with fakes; that proves neither version on these native binaries (`S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:772`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.test.ts:743`). Pi's translator resolves ACP SDK 0.26.0, versus 1.5.1 for the Claude/Codex translators; those package versions are not negotiated protocol versions (`S/bun.lock:1430`, `S/bun.lock:1434`, `S/bun.lock:7438`). No claim of minimum upstream support beyond the catalogue's stated evidence.

### Finding 3 — Permission vocabulary is useful; permission enforcement remains native

- **Question:** Does ACP supply the approval/policy layer metatron needs?
- **Their mechanism:** ACP permission requests carry tool context and selectable option IDs, and Superset parks the request until an answer or cancellation. However, its catalogue selects unrestricted defaults for Claude/Codex, and its handshake declines client filesystem/terminal ownership so agents use their own native tools. Its generic accept/decline translation uses label/ID matching and falls back to the first offered option, which can fail to express denial if no rejection matches. The historical comparison additionally reports serialized Claude permission callbacks despite parallel tool use; that observation concerns translator 0.56.0.
- **Evidence:** `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:1836`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:1921`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:2024`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:2127`; `S/packages/host-service/src/chat-v3/acpCatalogue.ts:28`, `S/packages/host-service/src/chat-v3/acpCatalogue.ts:39`; `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:783`; `S/apps/mobile/plans/acp-vs-claude-sdk.html:1047`.
- **What metatron does today:** Claude callbacks are not called for every tool; Pi has no general per-tool callback (`M/docs/adapter-recon.md:35`, `M/docs/adapter-recon.md:61`, `M/docs/adapter-recon.md:141`). Pi policy uses native restrictions plus an explicit guard extension (`M/docs/adapter-recon.md:124`); Codex Lead uses read-only sandboxing and scoped MCP policy (`M/docs/adapter-recon.md:131`, `M/docs/adapter-recon.md:135`).
- **Gap or confirmation:** conflict
- **Verdict:** reject + reason — Superset's access defaults and heuristic denial fallback conflict with metatron's policy requirements. Preserve native restrictions and server authorization; use validated, explicitly advertised rejection options or fail closed. ACP supplies a common callback transport, not evidence of interception before every mutation.
- **Cost if adopted:** Rejecting these defaults costs no migration; correct M8 approval integration is an estimated 4–6h within adapter/regression budgets. Touches Chat/Plan no-mutation, worker privilege denials and affected-task-only suspension (`M/AGENTS.md:95`, `M/AGENTS.md:97`, `M/AGENTS.md:100`).
- **Unverified:** Full callback coverage and parallel-prompt behavior in current translators. This does **not** contradict the baseline's cautious native claims; adopting unrestricted defaults would contradict its established policy behavior.

### Finding 4 — ACP saves repeated wire/event work, not the adapter boundary

- **Question:** What does ACP provide beyond four individually implemented integrations?
- **Their mechanism:** Superset shares one JSONL JSON-RPC client for request correlation, notifications, agent requests, process exit and disposal. A common session/event vocabulary maps prompt content, streamed text/thoughts, tool patches, plans, permission replies and cancellation into its own typed runtime. This avoids repeating native event interpretation for every supported ACP implementation, but still needs a transport adapter and runtime validation. Current source contains Zod views and v1/v2 handling, so the old document's incomplete-validation warning must be read as historical context; the current client still starts with unchecked JSON and accepts a failed prompt-response parse as a completed turn unless the stop reason is cancelled.
- **Evidence:** `S/packages/chat-runtime/src/harness/acp/rpcClient/rpcClient.ts:153`, `S/packages/chat-runtime/src/harness/acp/rpcClient/rpcClient.ts:228`; `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:535`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:930`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:1065`; `S/packages/chat-runtime/src/harness/acp/wire.ts:31`, `S/packages/chat-runtime/src/harness/acp/wire.ts:103`; `S/packages/chat-runtime/src/harness/types.ts:23`; `S/apps/mobile/plans/acp-vs-claude-sdk.html:2131`.
- **What metatron does today:** Already specifies a common typed adapter/event contract and authoritative completion (`M/spec.md:234`, `M/spec.md:287`); validation at boundaries is required (`M/AGENTS.md:49`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M8) — if OpenCode ACP passes the proof, place a small independently written ACP mapping behind the existing contract. Validate supported responses and terminal reasons; malformed/unknown completion cannot establish success. A common protocol does not justify replacing metatron's state model or creating a plugin framework.
- **Cost if adopted:** 4–6h of the 12–20h OpenCode ACP estimate; touches crash/disconnect handling and correct session identity (`M/AGENTS.md:99`, `M/AGENTS.md:101`).
- **Unverified:** How much native-event translation OpenCode ACP actually removes; no benchmark was run. Typed transport and clean exit alone do not establish completed work.

### Finding 5 — Models, thinking and steering remain capability-specific

- **Question:** Would ACP preserve the controls claimed in adapter-recon?
- **Their mechanism:** Superset reads select-type config options supplied by the agent and uses different mode/config methods across its supported protocol versions. It waits for selection requests to settle, but converts rejection into a settled promise, permits prompting after a timeout, and ignores an unavailable requested start model; a fixture explicitly expects that silent non-selection. Steering is a separately advertised `_session/steering` extension, not inferred from text streaming. These are concrete gaps between a uniform control panel and confirmed native settings.
- **Evidence:** `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:590`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:632`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:647`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:1744`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:1791`; `S/packages/chat-runtime/src/harness/acp/acpAdapter.test.ts:2057`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.test.ts:3017`; `S/packages/chat-runtime/src/harness/acp/wire.ts:65`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:804`.
- **What metatron does today:** Distinct native reasoning scales and uncertain steering semantics (`M/docs/adapter-recon.md:29`); Pi exact model/thinking verification and later queued-versus-delivered steering tracking (`M/docs/adapter-recon.md:121`, `M/docs/adapter-recon.md:146`). Unsupported selections must be diagnosed (`M/todo.md:74`, `M/spec.md:272`).
- **Gap or confirmation:** conflict
- **Verdict:** adopt now (M8) — discover native options through ACP where supplied, but require acknowledgement/effective-state confirmation before prompts; reject unsupported choices and treat timeout as unconfirmed. Preserve each harness's thinking IDs and steering delivery semantics. Do not copy Superset's selection fallback.
- **Cost if adopted:** 3–5h within adapter/proof budgets; permission-mode confirmation also touches Chat/Plan no-mutation, and steering/session correlation touches `M/AGENTS.md:95`, `M/AGENTS.md:101`.
- **Unverified:** Current ACP exposure of Codex efforts, Claude thinking/effort, OpenCode v2 variants or Pi 1.3.0 levels. Superset does not disprove the native capability matrix; its fallback behavior would regress metatron's documented exact-selection behavior.

### Finding 6 — ACP is not an authentication workaround

- **Question:** Does changing Claude to ACP remove the M8 authentication prerequisite?
- **Their mechanism:** Superset's Claude ACP package depends on Claude Agent SDK 0.3.286, so ACP adds a translator over the SDK rather than demonstrating an independent auth implementation. Its smoke removes ambient Anthropic keys; normal launch builds a terminal-derived environment and ordinarily removes those keys too, while auth errors ask the user to log in natively. Public Claude/Codex documentation describes plan/API-key terminal usage and bypass flags, which does not establish an approved SDK authentication route for metatron.
- **Evidence:** `S/bun.lock:1430`; `S/packages/host-service/scripts/acp-smoke.ts:14`; `S/packages/host-service/src/chat-v3/agentEnv.ts:39`, `S/packages/host-service/src/chat-v3/agentEnv.ts:55`; `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:2177`; `S/apps/docs/content/docs/agents/claude-code.mdx:8`, `S/apps/docs/content/docs/agents/codex.mdx:8`.
- **What metatron does today:** Claude SDK 0.3.301 declarations inspected; live auth path explicitly blocked pending an approved flow (`M/docs/adapter-recon.md:59`, `M/docs/adapter-recon.md:63`). Per-process native auth without credential extraction is required (`M/spec.md:228`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** reject + reason — switching to ACP as an auth bypass is unsupported by this evidence. Keep the Claude prerequisite and actionable auth-required status. Superset's PostHog rollout checks and mobile/relay transport are product dependencies to leave out (`S/packages/trpc/src/lib/acp-chat.ts:4`, `S/apps/desktop/src/renderer/hooks/useAcpChatEnabled/useAcpChatEnabled.ts:7`, `S/plans/done/acp-host-client-unification.md:36`).
- **Cost if adopted:** 0h for the rejected migration; allow 2–4h inside the Claude estimate for auth diagnostics/probes after the owner supplies a supported flow. Touches fresh-session ownership (`M/AGENTS.md:101`) and M8's no-global-config/no-token-copy requirement (`M/todo.md:156`).
- **Unverified:** Whether the owner's authentication is supported/entitled for Claude SDK or any ACP translator. This session reads no credentials and establishes no entitlement.

### Finding 7 — Resume restores context; recovery still needs an engine decision

- **Question:** Can ACP replace metatron's durable recovery semantics?
- **Their mechanism:** The old ACP migration stores a public/native session binding, cwd and stop reason, while its associated plan describes whole-transcript replay into a bounded 5,000-frame ring and lost in-flight interactions. Current ACP code loads a native session and creates a new one on a recognized missing-session error; other load errors remain fatal. The desktop automatically attempts to replace stopped/dead chat sessions up to three times, while withholding recovery when the conversation continued in a terminal. That source proves context reopening behavior, not automatic replay of an earlier mutating prompt.
- **Evidence:** `S/packages/host-service/drizzle/0009_add_acp_sessions.sql:1`; `S/plans/done/20260710-session-harness-acp.md:61`, `S/plans/done/20260710-session-harness-acp.md:82`; `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:810`; `S/packages/chat-runtime/src/harness/acp/acpAdapter.test.ts:3491`; `S/apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/AcpChatPane.tsx:367`, `S/apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/AcpChatPane.tsx:429`.
- **What metatron does today:** Engine owns native ID mapping (`M/spec.md:270`); native resume surfaces differ, and Pi's adapter still claims no native resume (`M/docs/adapter-recon.md:31`, `M/docs/adapter-recon.md:150`). Ambiguous mutating work requires recovery testing without automatic rerun (`M/AGENTS.md:61`, `M/AGENTS.md:99`).
- **Gap or confirmation:** gap
- **Verdict:** reject + reason — automatic chat resurrection/missing-session replacement is insufficient for task recovery. Keep engine-owned `RETRY_DECISION`, verify repo/cwd/native-ID binding, distinguish completed-context load from work resumption, and expose missing history instead of silently continuing a task in a new session.
- **Cost if adopted:** Rejecting automatic task recovery costs no rewrite; allow 4–6h within M8 regression for load/crash/corrupt-ID cases. Touches `M/AGENTS.md:99` and `M/AGENTS.md:101`.
- **Unverified:** Current on-disk history completeness across every ACP harness. Historical ring/cursor limits are documented historical gaps, not an assertion that today's whole chat runtime still has those exact limits; the July plan's linked current-runtime document is absent.

### Finding 8 — Native detail and tool-gateway policy do not become portable automatically

- **Question:** What fidelity does metatron lose or still have to implement?
- **Their mechanism:** The historical ACP-versus-SDK document explicitly records dropped Claude subagent prose, task dependencies/ownership and workflow/goal detail, against translator 0.56.0 and source-inspected Codex ACP 1.1.2. Current source has since added v2 subagent handling and the negotiated JetBrains AIR extension, so “ACP has no subagent support” would overstate that history. It still uses harness-specific metadata/readers, and its usage-update handler uses cost presence for cycle tracking rather than emitting metatron-style usage accounting. Its ACP new/load/fork requests supply empty MCP server arrays, leaving metatron's session-scoped gateway integration unproven.
- **Evidence:** `S/apps/mobile/plans/acp-vs-claude-sdk.html:2352`, `S/apps/mobile/plans/acp-vs-claude-sdk.html:2388`, `S/apps/mobile/plans/acp-vs-claude-sdk.html:2418`, `S/apps/mobile/plans/acp-vs-claude-sdk.html:2454`; `S/packages/chat-runtime/src/harness/acp/air/air.ts:3`; `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:1015`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:1042`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:711`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.ts:815`; `S/packages/chat/src/core/bookkeeping/claude.ts:30`, `S/packages/chat/src/core/bookkeeping/codex.ts:21`; `S/packages/chat/src/protocol/items.ts:171`.
- **What metatron does today:** Common usage event plus raw diagnostics (`M/spec.md:257`, `M/spec.md:289`); scoped Lead/worker MCP tool sets (`M/spec.md:283`), proven Codex/Pi gateway behavior (`M/docs/adapter-recon.md:131`, `M/docs/adapter-recon.md:133`, `M/docs/adapter-recon.md:135`).
- **Gap or confirmation:** gap
- **Verdict:** reject + reason — treating ACP as a portable orchestration/task/budget layer would discard necessary semantics. Keep engine-owned tasks and quotas, disable uncontrolled native delegation, and prove gateway authorization separately. Rich AIR/subagent display is defer to Future backlog; it does not serve the current adapter gate.
- **Cost if adopted:** 0h for rich display now; allow 4–6h inside adapter/regression budgets for scoped MCP and truthful usage/unsupported reporting. Touches Lead/worker hard caps and individual-agent fan-out (`M/AGENTS.md:97`, `M/AGENTS.md:102`).
- **Unverified:** Current translator preservation of every historical loss, cross-harness AIR parity, usage accuracy and HTTP MCP/auth capabilities on installed OpenCode v2. A standardized permission surface does not prove the tool gateway works.

### Finding 9 — Run a versioned interface smoke before selecting OpenCode's transport

- **Question:** What concrete compatibility checks must precede M8 adapter work?
- **Their mechanism:** Superset's checked-in smoke launches Claude ACP in a temporary directory, asks for PONG, observes terminal status and disposes the process. That demonstrates the intended smoke shape but contains no all-four capability/policy matrix. The following is a proposed metatron probe sequence, not a script run or added in this session.

  | Probe | Concrete procedure and passing evidence |
  |---|---|
  | Installed interface, no model turn | Through `mise x --`, record CLI versions/help using disposable cwd and app-owned XDG/harness state; use the baseline's isolated OpenCode/Pi pattern. Confirm v2 OpenCode actually exposes `acp` before launching it. For translators, record package/SDK versions and point executable overrides at the installed native binaries (Finding 2). Capture initialize protocol/capabilities/auth-method metadata without secrets, then dispose. |
  | Session and read task, explicit live opt-in | In a disposable Git fixture, create a session with absolute cwd; record native/public IDs and selected model. Ask to summarize README without edits; capture text/tool events and authoritative terminal reason, exit code and unchanged fixture hash/status. Empty output or process exit alone fails to establish completion. |
  | Actual model/thinking behavior | Compare offered ACP options with the native discovery baseline; set one supported pair and confirm effective returned state before a bounded read turn. Ask for an invalid model/level; require an unsupported diagnostic. Fixture-inject a rejected/timed-out mode/model setting; require no prompt dispatch under unconfirmed settings. |
  | Completed-session load | Dispose and recreate only the owned process, load the captured ID at the same fixture cwd if advertised, and ask a short follow-up proving context. Missing/load-unsupported cases must report that limitation; repeat with a second fixture to reject cross-repo ID reuse. Check steering separately only when advertised; distinguish acceptance from observed delivery. |

- **Evidence:** `S/packages/host-service/scripts/acp-smoke.ts:12`, `S/packages/host-service/scripts/acp-smoke.ts:31`; `S/packages/chat-runtime/src/harness/acp/acpAdapter.test.ts:2057`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.test.ts:3017`; `M/spec.md:575`; isolation precedents `M/docs/adapter-recon.md:19`, `M/docs/adapter-recon.md:84`, `M/docs/adapter-recon.md:103`.
- **What metatron does today:** Explicit opt-in live fixture script exists by M3 (`M/todo.md:79`); M8 must record the four-harness matrix (`M/todo.md:157`).
- **Gap or confirmation:** gap
- **Verdict:** adopt now (M8) — test OpenCode ACP first; run the same behavioral matrix against Codex app-server, Pi RPC and Claude SDK, and against any candidate replacement before claiming parity. An absent/incompatible surface is an unavailable capability, not a reason to substitute a model API.
- **Cost if adopted:** 4–5h of the 6–8h proof budget; live model credits additional and unestimated. Touches session identity and no source mutation (`M/AGENTS.md:95`, `M/AGENTS.md:101`).
- **Unverified:** All proposed probe results. Live turns intentionally omitted (cost and this session's read-only/single-output scope); no installed versions were re-probed.

### Finding 10 — Gate adoption on policy, cancellation and crash tests

- **Question:** What safety tests prevent ACP convenience from weakening metatron?
- **Their mechanism:** Superset has deterministic cases for permission-option replies, turn cancellation and failed session loads, and its archived follow-up plan distinguishes fake boundary tests from authenticated native tests. Metatron needs the corresponding tests against its own authorization, Git ownership and recovery state. These are proposed acceptance checks using disposable data, never the owner checkout or personal sessions.

  | Probe | Concrete procedure and passing evidence |
  |---|---|
  | Approvals and affected-task suspension | Request a harmless guarded write to fixture `approval.txt`; deny once and verify no change, then separately approve a permitted fixture write. Repeat cancel-before-answer, duplicate/unknown option ID and a fixture with no advertised reject option; require fail-closed behavior. While one worker awaits approval, an unrelated task continues. |
  | Cancel, quiet execution and crash | Cancel during a bounded read/tool operation and while awaiting permission; require interrupted terminal state and stale callbacks. Kill only an app-owned writer after it edits a disposable marker but before completion acknowledgement; restart the app and require `RETRY_DECISION`, retained worktree, no prompt resend and no duplicate marker. Cover exit 0 without terminal status and malformed stop reasons with fixtures. |
  | Scoped gateway, caps and read-only policy | Connect a run-scoped loopback MCP endpoint with native restrictions; verify an allowed worker report and denial of Lead-only scheduling. Repeat as Lead with one permitted bounded dispatch and an over-cap denial. In Chat/Plan deny write/dispatch; reject sensitive-file and escaping-symlink access. Prove second-writer/dirty-owner refusal; native child agents must be disabled or counted. |
  | Auth failure, ownership and integration | Test missing auth and simulated quota failure without dumping secrets; report auth-required/error, never available from version/model list alone. Verify personal config/session metadata unchanged and only owned PIDs stopped. Let one writer change a disposable file, review the candidate and integrate only after explicit approval; preserve the owner's checkout throughout. |

- **Evidence:** `S/packages/chat-runtime/src/harness/acp/acpAdapter.test.ts:916`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.test.ts:3491`, `S/packages/chat-runtime/src/harness/acp/acpAdapter.test.ts:3539`; `S/plans/done/acp-session-follow-ups.md:126`, `S/plans/done/acp-session-follow-ups.md:139`; `M/spec.md:581`, `M/spec.md:585`; `M/AGENTS.md:61`, `M/AGENTS.md:95`.
- **What metatron does today:** Guardrail tests and FakeAdapter/disposable-fixture conventions are mandatory (`M/AGENTS.md:61`, `M/AGENTS.md:63`, `M/AGENTS.md:95`–`102`); M8 requires both worker and Lead checks (`M/todo.md:154`).
- **Gap or confirmation:** confirmation (independent convergence)
- **Verdict:** adopt now (M8) — make these the transport-selection gate; record unsupported native permissions/Lead support honestly instead of weakening the engine to make the matrix appear complete.
- **Cost if adopted:** 2–3h of proof for blocking risks, plus the 8–12h shared M8 regression allocation in Finding 1; do not add these twice. Touches all guardrails `M/AGENTS.md:95`–`102`.
- **Unverified:** Every new native result; auth/quota failure simulation and deterministic protocol tests do not prove actual entitlement or live failure behavior.

## Five-line summary

1. Recommend a gated hybrid: keep Codex/Pi native paths and Claude SDK; prove installed OpenCode ACP before selecting its M8 transport (Finding 1).
2. ACP buys shared session/event/cancel/permission vocabulary, while native restrictions, auth, effective thinking/model settings and tool-gateway policy still need per-harness proof (Findings 3–6, 8).
3. Codex/Claude use translators; OpenCode 1.15.5 has documented native ACP checks; Pi's compatible version and all four installed ACP pairs remain UNVERIFIED (Finding 2).
4. Reject unrestricted defaults, heuristic denial, unconfirmed configuration and automatic task recovery; historical fidelity losses must not be presented as current universal limits (Findings 3–8).
5. Budget 42–64h for gated M8 hybrid work, or 50–76h with OpenCode v2-server fallback; these are unmeasured estimates and no live tests were executed (Findings 1, 9–10).

## Files read

Targeted excerpts/search matches were used for large source files and the lockfile; this list does not imply every line of every listed file was read. The HTML decision document's semantic sections, including its comparison and provenance caveats, were inspected.

**Metatron — `/home/phagmaier/Code/metatron/`:**

- `AGENTS.md`
- `todo.md` — M3 and M8, plus heading lookup
- `spec.md` — §5 and §13.3 only
- `docs/adapter-recon.md`
- `docs/reference-recon/outputs/00-INDEX.md`

**Superset — `/home/phagmaier/Code/superset/`:**

- `LICENSE.md`
- `apps/desktop/src/renderer/hooks/useAcpChatEnabled/useAcpChatEnabled.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/AcpChatPane.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ChatPane/components/AcpChatPane/components/AcpRecovery/AcpRecovery.tsx`
- `apps/docs/content/docs/agents/claude-code.mdx`
- `apps/docs/content/docs/agents/codex.mdx`
- `apps/mobile/plans/acp-vs-claude-sdk.html`
- `bun.lock`
- `packages/chat-runtime/package.json`
- `packages/chat-runtime/src/harness/acp/acpAdapter.test.ts`
- `packages/chat-runtime/src/harness/acp/acpAdapter.ts`
- `packages/chat-runtime/src/harness/acp/air/air.ts`
- `packages/chat-runtime/src/harness/acp/index.ts`
- `packages/chat-runtime/src/harness/acp/rpcClient/rpcClient.ts`
- `packages/chat-runtime/src/harness/acp/wire.ts`
- `packages/chat-runtime/src/harness/claude/claudeAdapter/claudeAdapter.ts`
- `packages/chat-runtime/src/harness/codex/codexAdapter/approvalDecisions/approvalDecisions.ts`
- `packages/chat-runtime/src/harness/codex/codexAdapter/codexAdapter.ts`
- `packages/chat-runtime/src/harness/types.ts`
- `packages/chat/src/core/bookkeeping/claude.ts`
- `packages/chat/src/core/bookkeeping/codex.ts`
- `packages/chat/src/protocol/items.ts`
- `packages/host-service/drizzle/0009_add_acp_sessions.sql`
- `packages/host-service/package.json`
- `packages/host-service/scripts/acp-smoke.ts`
- `packages/host-service/src/chat-v3/acpCatalogue.ts`
- `packages/host-service/src/chat-v3/acpHarnesses.test.ts`
- `packages/host-service/src/chat-v3/acpHarnesses.ts`
- `packages/host-service/src/chat-v3/agentCli.test.ts`
- `packages/host-service/src/chat-v3/agentCli.ts`
- `packages/host-service/src/chat-v3/agentEnv.ts`
- `packages/host-service/src/chat-v3/chatAgentBridge.test.ts`
- `packages/host-service/src/chat-v3/chatAgentBridge.ts`
- `packages/host-service/src/chat-v3/mount.ts`
- `packages/trpc/src/lib/acp-chat.ts`
- `plans/done/20260710-session-harness-acp.md`
- `plans/done/acp-host-client-unification.md`
- `plans/done/acp-session-follow-ups.md`

**Skill instructions:**

- `/home/phagmaier/.codex/skills/codebase-memory/SKILL.md`
- `/home/phagmaier/.agents/skills/context7-mcp/SKILL.md`

