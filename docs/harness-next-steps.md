# Harness integration: verified findings and next steps

Date: 2026-10-17. Scope: review of [report.md](../report.md), not implementation or authorization for model spending.

**Implementation update:** Slice A/M8 item 1 passed [owner-token native Claude validation](evidence/m8-claude-native-live.json); subsequent owner authorization also completed [M8 item 2 native OpenCode validation](evidence/m8-opencode-native-live.json). See the chronological [reconnaissance](adapter-recon.md) for failures, fixes and limits. This review remains pre-implementation rationale, not vendor permission or model-spending authorization. [M8 item 3](adapter-recon.md#m8-item-3--picodex-capability-revisit-2026-10-17) then rechecked Pi/Codex and [M8 item 4](adapter-recon.md#m8-item-4--installedauth-state-and-actionable-diagnostics-2026-10-17) added installed/auth state diagnostics; [M8 item 5](adapter-recon.md#m8-item-5--four-harness-read-only-workers-2026-10-17) then ran all four harnesses as live read-only workers; the current next checklist item is **M8 item 6: each harness as Lead through the scoped gateway**. Slice B is not a new prerequisite: diagnostics/version work belongs at item 4, observed lifecycle/compatibility issues at items 3/8 and existing M9 gates; other recommendations stay deferred unless a scheduled gate needs them.

## 1. Recommendation

**Keep the existing native adapters. Finish M8 item 1 by resolving Claude authentication policy, making detection truthful for the selected route, and obtaining real native evidence. Do not rebuild the adapters or adopt ACP to solve this blocker.**

The original report identifies real limitations, but overstates several conclusions. In particular, technical support for a subscription token is not proof that Anthropic authorizes every SDK product to use subscription authentication. Nor are stderr persistence, malformed-frame tolerance, or version floors automatically safe transfers from Superset.

At review time, the first incomplete item was [M8 item 1](../todo.md#M8---complete-the-remaining-harnesses-spec-5-133). Its native evidence gaps motivated Slice A below; those gaps are now covered by the linked native receipt. This review itself did not check off a milestone; the later implementation/verification did. No OpenCode or Pi implementation was included in Slice A.

## 2. Evidence and limits

Reviewed the current milestone, relevant spec/ADR, Claude launch/discovery/event/process code, Pi transport/deadline/cancellation code, approval callbacks, live smoke script, installed SDK declarations/manifest, and load-bearing Superset source. Used the code graph with exact-path coverage checks and direct source verification. Two independent read-only research slices covered Superset and Pi; no concurrent coding occurred.

Observed locally:

| Check | Result |
| --- | --- |
| `mise current`; pinned `node --version` and `pnpm --version` | Node 26.7.0; pnpm 11.22.0 |
| `mise x -- claude --version`; `mise x -- pi --version` | Claude Code 2.1.302; Pi 1.3.0 |
| Installed SDK package and manifest | SDK 0.3.302; bundled CLI manifest version 2.1.302 |
| `mise x -- pnpm test:live:claude --output /tmp/metatron-report-verification-20261017.json` | Exit 0, `PROBE_ONLY`; native SDK control/catalog handshake succeeded; **zero model prompts** |
| Same Claude probe receipt | `installed: true`, `authenticated: false` under the current app policy; disposable checkout/config checks passed and fixture removed |
| `mise x -- claude auth status --help`; `mise x -- claude setup-token --help` | JSON status supported; setup-token explicitly requires a Claude subscription |
| Isolated Pi RPC `clear_queue`, `abort`, `get_session_stats` | All returned `success: true`; idle abort has no `data`; zero-message stats reported zero tokens/cost and omitted `contextUsage`; process exited 0 |

Pi probe used a disposable `PI_CODING_AGENT_DIR`, XDG directories, offline mode, no session, tools, extensions, MCP, skills, templates, themes, or context files. No prompt was sent. The first attempt timed out after relocating XDG paths; the successful attempt explicitly retained the installed `MISE_DATA_DIR`. Tool lookup relocation is the suspected cause, not a proven harness failure. The timed-out subprocess was killed, temporary directories removed, and a final process search found no matching probe process.

The Claude receipt is currently in `/tmp`, not a durable repository artifact. This review did **not** recheck the owner's personal account/plan, read credential files, generate a token, log in, attach to personal sessions, run paid turns, or rerun the previously reported blocked paid gate. Previous 383/383 test results remain historical evidence from [progress.md](progress.md), not a fresh test result. No application behavior changed; no tests/build/lint were run for this investigation.

## 3. Verification of the original suggestions

| Original suggestion | Verdict | Corrected decision / evidence |
| --- | --- | --- |
| Keep direct Claude SDK and Pi RPC | **Keep.** | Matches spec §5 and existing policy controls. Superset also retains a direct SDK implementation. The claim that direct SDK is the *only possible* safe architecture is not established; no architecture change is needed here. |
| Claude cannot use the configured subscription/token routes through our adapter | **Verified exclusion; intentional policy, not just an accidental predicate bug.** | `claude-options.ts:51–84` omits OAuth/bearer tokens and relocates config; `claude.ts:136–149` admits explicit API-key/Bedrock/Vertex/Foundry routes. The [existing ADR](adr/2026-10-17-claude-worker-permissions.md) deliberately chose that policy. Change it explicitly if another route is approved. |
| `apiKeySource !== "none"` rejects every cloud provider | **Incorrect if read that broadly.** | That check belongs only to the first-party API-key branch. Bedrock/Vertex/Foundry have separate branches. SDK `apiKeySource: "none"` means no API key, not no authentication. The classifier still needs expansion if more routes are selected. |
| `setup-token` is the clearly approved, zero-billing SDK solution | **Technical mechanism verified; blanket policy/cost conclusion not verified.** | Official CLI docs support subscription tokens for scripts/CI. SDK overview/quickstart retain the third-party-product restriction. No explicit personal-use exemption was found in those pages. Subscription quotas and possible extra usage also make “zero billing” too strong. See §4. |
| Use `claude auth status` / `AccountInfo` for classification | **Keep with conditions.** | Probe the **same executable, curated environment, and app config** as the worker, not the personal shell profile. `AccountInfo` exposes provider/source/subscription metadata. A configured route or status result does not prove a model is entitled or a future request will succeed. |
| Add absolute executable resolution and a catalogue | **Partly redundant.** | `claude-process.ts:26–46` already selects an executable from absolute PATH entries, checks execution access, and resolves its real path. Add version/launch diagnostics in the existing adapter first; no new generic catalogue is required to unblock Claude. Pi's default launcher still invokes `pi` by name. |
| Gate Claude on SDK manifest equality, Pi on pi-acp's v0.81.0 floor | **Do not adopt as stated.** | Manifest 2.1.302 identifies the bundled/tested CLI, not a demonstrated external-binary compatibility boundary. Superset's 2.1.226 floor is for its ACP integration. A pi-acp README floor does not establish the minimum for our Pi RPC flags/events or even the same package lineage. Record versions and use evidence-backed capability requirements. |
| Replace the 180-second wall caps | **Problem verified; replacement needs state semantics.** | `claude-turn.ts:192–196` and `pi.ts:312–316` impose fixed turn deadlines. Claude's includes time awaiting owner approval. Silence is not proof of failure; an event-idle timer alone can still kill legitimate thinking/tools. Define waiting/active/silent behavior before changing the timer. |
| Persist a bounded stderr tail | **Diagnostics need improvement; persistence changes privacy policy.** | Both adapters intentionally discard stderr. Superset's inspected ACP path retains/emits a raw 4,000-character tail, not a verified sanitized one. File mode 0600 and truncation do not remove credentials or source content. Prefer structured failure codes, exit evidence, and safe hints first. |
| Remove the extra Claude launch / cache account discovery | **Verified extra launch; defer optimization.** | `claude.ts:232–284` probes, stops, launches the real session, then **revalidates its metadata** before prompting. The report underplays that final check. Do not replace auth/final configuration validation with a TTL cache. If measured latency warrants it, validate the real launch before releasing the prompt. |
| Kill app-owned process groups | **Useful hardening, not a one-line complete fix.** | Both adapters currently signal direct children. Claude and normal Pi close already escalate; Pi protocol/deadline paths directly send TERM. Own the group at launch, handle parent-exit/descendant-survival cases, and preserve trustworthy stop/recovery evidence. No escaped descendant was demonstrated in this review. |
| Skip malformed Pi stdout like Superset | **Reject blanket tolerance.** | Pi reserves stdout for protocol JSON. Unknown valid event types are different from corrupt framing or invalid critical responses. Suppressing a lost permission/completion/control frame can create ambiguous state. Keep fail-closed behavior unless a specific harmless noise format is demonstrated. |
| Capture richer Claude usage and Pi session stats | **Verified opportunity; not just extra assignments.** | SDK result fields include estimated cumulative `total_cost_usd` and `modelUsage`; current mapper keeps root input/output only. Installed Pi docs explicitly include native `contextUsage`. Common usage schema currently has only token samples/source. Define totals vs deltas, resume baselines, absence, and consumers first. |
| Render richer approval metadata | **Supported, lower priority.** | Installed SDK has title/description/defaultToNo/suppressAlwaysAllowRule. Current app deliberately exposes redacted generic text and only one-shot choices. Sanitize/bound metadata, keep approval non-default, and never convert suggestions into persistent rules. |
| Add Pi resume/session-map behavior | **Defer; keep accurate capability reporting.** | Native Pi supports session controls, but app policy uses fresh successor worktrees/checkpoints. A map does not authorize cross-worktree resume. No native resume feature is needed to unblock Claude. |

Source anchors: [Claude adapter](../src/server/adapters/claude.ts), [options and callbacks](../src/server/adapters/claude-options.ts), [process ownership/resolution](../src/server/adapters/claude-process.ts), [turn lifecycle](../src/server/adapters/claude-turn.ts), [Claude event mapping](../src/server/adapters/claude-events.ts), [Pi adapter](../src/server/adapters/pi.ts), [Pi transport](../src/server/adapters/pi-rpc.ts), [common event schema](../src/server/adapters/contract.ts).

## 4. Claude authentication: separate mechanism from permission

### What is established

- [CLI authentication documentation](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token) describes `claude setup-token`, a subscription token supplied as `CLAUDE_CODE_OAUTH_TOKEN`, with model-request-only scope. It does not require extracting an existing personal credential file. Creating and supplying it is still handling a secret.
- [SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) documents API keys and cloud-provider routes and states: “Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK.” The [overview](https://code.claude.com/docs/en/agent-sdk/overview) repeats this.
- Those facts do not prove that a local personal integration is forbidden, nor establish an explicit exemption. Superset using a mechanism is evidence of implementation, not vendor approval for Metatron.
- The current app's isolated config means a successful personal `claude auth status` would not establish the worker's credentials. Conversely, the app reporting false does not prove the owner has no valid Claude account.
- [Credential precedence](https://code.claude.com/docs/en/authentication#authentication-precedence) is more than API-key vs OAuth: provider selection and bearer tokens can outrank the key, and a key outranks setup-token in noninteractive use. Report the effective route without exposing credential values; do not silently remove keys to force a subscription.

### Decision to make before implementation/spending

For the current personal-use goal, **evaluate owner-supplied setup-token first rather than requiring separate API billing merely because the first adapter selected it**. Record the intended usage, applicable vendor guidance/approval, quota/cost consequences, and secret delivery in an ADR. Do not label that route unconditionally SDK-product-approved based on the CLI page alone. If distributing a product that offers subscription login, obtain the approval the SDK docs require or use an explicitly documented API/provider route.

| Route | Next action | Tradeoff |
| --- | --- | --- |
| Owner-supplied `CLAUDE_CODE_OAUTH_TOKEN` | Resolve permitted usage; if selected, narrowly forward it and recognize the observed first-party token metadata | Preserves app config/session isolation and can use subscription allowance; long-lived secret, quota limits, and SDK-product policy caveat remain |
| Owner login in app-owned `CLAUDE_CONFIG_DIR` | Consider only if selected token flow is unsuitable; CLI owns login, no credential copying | Separate credentials/settings/history in app config; more persistent login material and the same subscription-policy question |
| API key or already-approved supported cloud route | Retain support; use only with owner awareness/authorization of provider charges | Explicit SDK documentation; separate/provider billing, not an automatic replacement for the owner's intended subscription |
| Ambient personal config / extracted personal tokens | Do not use as a shortcut | Shares personal state or bypasses supported ownership; unnecessary for this plan |

A route classifier should distinguish **absent**, **present but unverified**, **explicitly rejected**, and **unsupported by app policy** in diagnostics. Keep the existing `authenticated: "unknown"` behavior for a configured but untested route. Existing profile/native-run consumers already allow unknown and reject false; do not weaken that gate or treat any nonempty token as proven auth. Metadata failures stay unknown with an actionable diagnostic, not invented entitlement.

The report also lists additional provider variables. Verify only the selected route's installed contract and forward its minimum required variables. Adding Claude Platform on AWS, arbitrary gateways, or every current cloud variant is not required for this fix.

## 5. Ordered implementation plan

### Slice A — next session: Claude authentication and M8 item 1 evidence only

1. **Settle the route, not the architecture.** Use §4 to choose a permitted route and obtain owner authorization before any billable turn. Record an ADR only if changing settled authentication/authority/privacy policy. Do not generate or paste secrets into agent chat/logs.
2. **Implement the narrow environment/classification change if needed.** Work in existing `claude-options.ts` and `claude.ts`; align safe diagnostics and `scripts/live-claude.ts`. A supported API route needs no OAuth expansion. A selected token route must be recognized from the actual child environment/metadata, not a host-only signal. Preserve final no-prompt validation and all permission hooks.
3. **Exercise route boundaries with existing fixture conventions.** Cover selected route, absent route, conflicting credentials/effective precedence, rejected metadata, and init failure. Assert no model submission when not allowed, and no secret in returned diagnostics. Update affected contract tests rather than loosening profile validation. Inspect references with the language server before changing exported interfaces.
4. **Run no-model discovery in disposable app state.** Confirm chosen executable/version, selected route, catalog/effort, and clean shutdown. A token in the shell is insufficient if the curated worker env drops it. Do not mark `authenticated: true` or item 1 complete from this probe.
5. **Run authorized native validation with fresh output and discovered settings.** Use the existing smoke command below. Resolve actual failures without lowering identity, permission, or recovery checks.
6. **Close only observed evidence gaps.** Current live script reads, resumes, then denies a native Write and cancels during that callback. It does not perform a successful native approved write or an independent active-generation cancellation scenario. Add/execute those minimal disposable scenarios where necessary to substantiate claimed approval/cancellation support; do not call fixture UI evidence a native result. The later M8 matrix still owns gateway/worker/Lead/four-harness integration coverage.
7. **Record exact outcomes.** Keep M8 item 1 unchecked if any required native validation remains absent. Update recon/progress/README and the item note only to the extent proven. Do not advance to OpenCode in this session by default.

Acceptance for Slice A:

- Selected auth route reaches the actual SDK process; effective route and limitations are visible without secrets. No implicit switch to paid API billing or personal credential extraction.
- Native streaming and authoritative completion observed; requested model and effort are validated against actual init/stream evidence, not just submitted options.
- Same-checkout clean-session resume retains native identity; interrupted/cross-checkout resume remains refused.
- Native permission callbacks behave as claimed; no write before approval, denial prevents the write, one-shot approval does not broaden later access, stale grants cannot replay. Reuse existing durable receipt tests; verify native runtime separately.
- Active cancellation produces owned exit/interruption evidence, never success inferred from silence/exit alone, and no automatic replay.
- Fixture checkout and personal config metadata remain unchanged except for explicitly approved disposable worker changes; no personal sessions touched.

Commands after implementation, not results claimed by this review:

```sh
mise x -- pnpm typecheck
mise x -- pnpm lint
mise x -- pnpm test
mise x -- pnpm test:fixtures
mise x -- pnpm build
mise x -- pnpm smoke

# No model prompt. Use a new path each time.
mise x -- pnpm test:live:claude \
  --output /tmp/m8-claude-selected-route-probe.json

# Only after route selection and spending authorization.
# sonnet/low were in this review's catalog; rediscover before use.
mise x -- pnpm test:live:claude --allow-live \
  --model sonnet --thinking low \
  --output /tmp/m8-claude-selected-route-live.json
```

If the route prerequisite is unavailable, finish reachable classification/diagnostic work, document the precise blocker and owner command, and retain the unchecked gate. Do not treat this as permission to substitute a raw model API or skip to another milestone.

### Slice B — subsequent focused hardening, not prerequisites to every Claude probe

Order by demonstrated failures; fix a particular issue in Slice A only if it actually blocks that gate.

| Priority | Work | Acceptance gate |
| --- | --- | --- |
| 1 | Structured launch/auth/exit diagnostics in existing adapters | Distinguish missing binary, startup timeout, denied auth, unknown provider failure, and uncertain shutdown where native evidence supports it; emit safe next steps. No raw stderr/credentials automatically enter journal, inbox, or browser. Raw diagnostic retention requires an explicit privacy decision, sanitization/retention design, and adversarial secret examples. |
| 2 | Turn deadline semantics | A progressing turn is not canceled merely at 180 seconds. Pending owner consent cannot expire as apparent model inactivity; legitimately silent thinking/tools are not classified crashed. Keep bounded startup/control/stop operations, explicit owner stop, and recovery without replay. Use controlled time and actual lifecycle smoke, not a three-minute test sleep. |
| 3 | Owned-group shutdown and bounded error paths | A disposable child/grandchild fixture, including ignored TERM and parent-exits-first cases, is terminated without touching unrelated processes. Every cancel/deadline/protocol-error path reaches bounded escalation or a durable uncertain-stop outcome. A process group is cleanup scope, not an OS sandbox or protection against descendants deliberately escaping the group. |
| 4 | Version/protocol compatibility diagnostics | Record actual binary, CLI/SDK versions and handshake/capability failures. Reject only a known unsupported combination/required capability with safe owner guidance; do not auto-upgrade tools or import Superset's global install command. Preserve strict handling of corrupt critical frames. |
| 5 | Usage/context accounting and approval presentation | Typed persisted semantics before UI claims. Prove cumulative totals aren't double-counted across results/resume; estimates aren't invoices or remaining balance. Pi context usage can be absent/null after compaction. Metadata rendering remains bounded/redacted and one-shot; browser proof required for changed UI. |
| 6 | Startup optimization, only if measured | If removing the preliminary Claude launch, validate actual-launch auth/model/effort before input release and keep failure cleanup/manifest safety. Cache version/catalog hints only where harmless; not stale auth or effective permissions. |

Installed SDK `sdk.d.ts:5803–5813` specifically warns that cost/model totals are cumulative and can continue from resumed transcripts; crash results can be zeroed. Installed Pi `docs/rpc-commands.md:526–567` documents session totals and an optional current-context estimate, including null tokens/percent immediately after compaction. These edge cases make usage work more than simply forwarding fields. The existing common schema carries input/output samples only; adding fields does not by itself implement hard dollar budgets.

### Resume the existing milestone sequence

Items 1–2 have now been implemented and natively verified in their subsequent authorized work, using the installed official Claude SDK and OpenCode v2 client/server, not a v1 example. Proceed to the scheduled **M8 item 3 Pi/Codex capability revisit**, then installed/auth diagnostics, worker/Lead checks and the four-harness matrix in checklist order. No Pi implementation was bundled into either adapter slice.

Defer Claude live steering/multi-turn queues, Pi resume changes, shell/background-task support, generalized adapter catalogue infrastructure, and account identity collection unless a current acceptance criterion needs them. Do not grow credential or personal-data storage solely to mirror Superset.

## 6. Superset evidence worth retaining

Paths below are relative to `/home/phagmaier/Code/superset`; these are inspected local sources, not a claim about an unspecified upstream HEAD.

- `packages/host-service/src/chat-v3/acpCatalogue.ts:18–29,58–68`: Claude ACP minimum 2.1.226, bypass mode default, deliberately ungated Pi entry.
- `packages/host-service/src/chat-v3/agentCli.ts:39–99,113–128`: wrapper/PATH resolution, bounded cached version probe, actionable catalogue checks.
- `packages/host-service/src/chat-v3/agentEnv.ts:37–58`: terminal-like environment and removal of `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` outside sandbox. Keep CLI-owned login/profile selection as a principle, **not** wholesale environment inheritance or billing-route mutation.
- `packages/host-service/src/chat-v3/acpHarnesses.ts:18–68`: external ACP adapter launch and account attribution; not proof that Metatron needs email/org collection.
- `packages/chat-runtime/src/harness/claude/claudeAdapter.ts`: direct SDK implementation also exists; this does not establish why both paths are retained.
- `packages/chat-runtime/src/harness/acp/acpAdapter.ts:758–760,2096–2120`: bounded raw stderr capture/output. Do not describe it as verified redaction.
- `packages/chat-runtime/src/harness/acp/rpcClient/rpcClient.ts:22–42,90–103,228–240`: owned detached group, shutdown escalation, skipping unparseable ACP lines. Do not generalize to safe recovery from arbitrary Pi protocol corruption.
- `LICENSE.md` and root package license identify Elastic License 2.0. Study independently and assess terms before reusing code. ELv2 is not a categorical “copying forbidden” rule; this plan requires no copied Superset implementation.

The report's external pi-acp session-map/background-shell details were not independently audited from that package's implementation here. They are unnecessary to the immediate plan. Pi's stats recommendation is independently corroborated by installed native docs and the official command reference, not by assuming ACP fields are native fields.

## 7. Official references

1. [Claude SDK overview and product-auth restriction](https://code.claude.com/docs/en/agent-sdk/overview).
2. [Claude SDK quickstart and supported API/provider setup](https://code.claude.com/docs/en/agent-sdk/quickstart).
3. [Claude authentication, precedence, config directories, and setup-token](https://code.claude.com/docs/en/authentication).
4. [Claude SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript); installed 0.3.302 declarations are the version-specific source for fields used above.
5. [Pi RPC command reference](https://pi.dev/docs/latest/rpc-commands), independently checked against the installed 1.3.0 distribution's bundled docs.

**Exact next task:** “Continue M8 item 3 only: revisit the installed Pi and Codex SDK/protocol capabilities, verify real version differences and surface unavailable controls accurately. Preserve Claude/OpenCode authentication, native policy, durable approvals, checkout isolation and no-replay boundaries. Keep later GUI diagnostics, worker/Lead and four-harness gates in todo.md order; do not bundle all Slice B hardening.”
