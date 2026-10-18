# M8 item 8 — per-adapter smoke matrix

**Status: BLOCKED / incomplete.** The owner's **Keep new model turns blocked** decision remains in force. No new model prompts, login, native write approvals or integration approvals were issued. Cost-free runner preparation is verified below; M8 item 8 stays unchecked and M9 has not started.

Scope: [spec §13.3](../spec.md#133-live-harness-smoke-matrix). **Recorded/Existing** means a retained native receipt, not a rerun. **Partial** identifies the missing observation; fixture results never stand in for native model evidence. Unsupported controls below are application restrictions, not claims about every capability of the upstream harness. The original preflight and current desktop preflight are separate observations.

## Original zero-prompt preflight

Started with `mise current`: Node **26.7.0**, pnpm **11.22.0**. An instrumented throwaway script ran the actual application and all four installed adapters in fresh app-owned homes, then attempted only unsupported session configurations. It never called `prompt`. [Full receipt, catalogs, effort choices and diagnostics](evidence/m8-smoke-matrix-discovery.json).

| Harness | Native version | Discovered models | Authentication in this fresh home | Observed setup outcome |
| --- | --- | ---: | --- | --- |
| Codex | 0.163.0 | 8 | false | App-owned native login required; historical disposable login not reused |
| Claude Code | CLI 2.1.302 | 5 | false | `AUTH_ABSENT`; privately supplied approved route required |
| OpenCode | 2.0.29 | 12 | unknown | Catalog/control available; no model access or price verified |
| Pi | 1.3.0 | 2 | unknown | Catalog/control available; no model access or price verified |

The Claude SDK remains pinned to **0.3.302** in `package.json`; this original probe reports the CLI version, not a separate SDK handshake version. Model IDs and per-model thinking choices are retained in that receipt rather than copied into a second catalog. Its OpenCode catalog included `deepseek/deepseek-flash` with `none/low/high/max`, whereas the historical worker used a free OpenCode model. Rediscover before choosing; do not assume an old price or catalog is still valid.

Recorded refusal results: Codex writer and worker resume; Pi resume; Pi/Claude/OpenCode coordinator start all returned **UNSUPPORTED** before a native task/session was created. Zero persisted attempts/sessions; fixture HEAD/status and metadata of the seven named personal-config files unchanged; no process command line referencing the unique app directory survived close or the check three seconds later. Successful disposable state and the throwaway probe were removed. These observations are not active-generation cancellation, every-descendant cleanup, credential entitlement, or an OS sandbox.

The Codex login command in the raw discovery diagnostic names a deleted fresh home. Do **not** use a discarded probe path for future authentication; select an intentional application-owned home. The earlier `/tmp/lao-m8-workers` login is historical and is not assumed to exist on this desktop.

## Seven required checks

| §13.3 check | Codex | Claude Code | OpenCode | Pi |
| --- | --- | --- | --- | --- |
| 1. Binary/version, capabilities, model/thinking choices | **Recorded PASS** discovery; fresh home logged out | **Recorded PASS** discovery; `AUTH_ABSENT` | **Recorded PASS** discovery on 2.0.29; current desktop 2.0.32 discovery only | **Recorded PASS** catalog; current desktop fresh home requires credentials |
| 2. Disposable streamed reader and authoritative terminal status | **Partial existing:** reader/terminal/exit 0; worker receipt omits streaming observations [C] | **Existing PASS:** streamed read, completed result and exit 0 [A] | **Existing PASS:** streamed nonce read, authoritative completion and owned shutdown 130 [B] | **Partial existing:** reader/terminal/exit 0; worker receipt omits streaming observations [P] |
| 3. Effective selected model/thinking | **Existing PASS:** `gpt-6-luna` / low [C] | **Existing PASS:** native Sonnet 5.5 / low hook proof [A]; Haiku 5.5 / low worker [W] | **Existing PASS:** DeepSeek flash / low native variant [B]; free-model worker settings [W] | **Existing PASS:** DeepSeek flash / off native `get_state` [P] |
| 4. Completed-session follow-up resume | **OPEN:** Lead supported, but retained resume is 0.162.1, not current 0.163.0 [H]; worker resume **unsupported**, refusal recorded | **Existing PASS:** same native ID/original checkout, completed follow-up [A] | **Existing PASS on 2.0.29:** same native ID/original checkout, completed follow-up [B] | **Unsupported:** adapter does not reopen sessions; refusal recorded; fresh checkpoint handoff is not native resume |
| 5. Active cancellation and harmless permission prompt where supported | **OPEN** active cancellation on 0.163.0; historical stop is 0.162.1 [H]. Native approval prompts **unsupported** under read-only/never policy | **Existing PASS:** active interruption/exit 143; separate one-shot Write approval, independent denial and stale-grant refusal [A] | **Existing PASS:** active native interrupt acknowledgement; one-shot Write approval and independent denial [B] | **OPEN** native active cancellation. Per-call permission prompts **unsupported**; file policy is enforced by the guard |
| 6. Scoped orchestration invocation **and policy denial** | **Existing PASS as Lead:** scoped status/proposal, coordinator assignment `POLICY_DENIED` [L]. Worker invocation also passed [C]; no worker-specific native denial claim | **Partial existing:** worker `read_assignment`/`submit_result` succeeded; native gateway role-denial not recorded [W] | **Partial existing:** worker invocation succeeded; native gateway role-denial not recorded [W] | **Partial existing:** worker invocation succeeded; native gateway role-denial not recorded [P] |
| 7. Native writer → captured candidate → review → explicit owner approval → integration | Writer **unsupported**. No supported harness yet supplies the complete writer gate | **OPEN:** direct disposable Write approval is not candidate review/integration [A] | **OPEN:** direct disposable Write approval is not candidate review/integration [B] | **OPEN:** historical native worktree edit is not candidate review/integration [M] |

Evidence references:

- **[A]** [Claude five-turn native receipt](evidence/m8-claude-native-live.json): `liveResults` operations `read`, `same-checkout-resume`, `native-approved-write-and-independent-denial`, `active-generation-cancellation`; selected native init/stream/hook evidence. Clean completed turns exit 0; canceled generation is interrupted with exit 143 and a retained stream error, not success. The denial-only scenario's text mentions a closed permission stream; explicit independent denial proof comes from the separate approved-write scenario and its file/stale-grant assertions, not that text.
- **[B]** [OpenCode five-turn native receipt](evidence/m8-opencode-native-live.json): `results` operations `streamed-read`, `same-id-resume`, `approve-once-independent-denial`, `active-generation-cancel`; `modelRefs` and `interruptConfirmed`. Normal private-host shutdown 130 is recorded alongside authoritative completion; exit code alone is not success. Native HTTP 401 checks are server authentication, not Metatron gateway role-denial or Origin protection.
- **[C]** [Codex worker](evidence/m8-worker-codex.json): `run`, `settingsVerified`, `gatewayTools`, nonce report and unchanged checkout. Receipt does not retain text-delta or turn-completion event samples.
- **[P]** [Pi worker](evidence/m8-worker-pi.json): same fields, native ID and completed read-only attempt. The [recovered earlier attempt](evidence/m8-worker-pi-first-run-recovered.json) remains `passed:false`; historical personal-config metadata changes remain unexplained and do not become a PASS through this matrix.
- **[W]** [Claude worker](evidence/m8-worker-claude.json) and [OpenCode worker](evidence/m8-worker-opencode.json): native worker gateway invocation and confirmed settings. Both `gatewayTools` arrays contain successful calls, not role denials.
- **[L]** [Codex 0.163.0 Lead](evidence/m8-lead-codex-native.json): `nativeCodexLead.checks`, `tools`, `denials`; no worker launched.
- **[H]** [M4 native summary](evidence/m4-live-summary.json): `harnesses.lead` is Codex **0.162.1**; `run2_gate.autonomous.sessions/configured` and `resumedStopTurn` record historical resume/stop only. Do not upgrade those observations to current-version PASS.
- **[M]** [M3 native Pi reader/writer summary](evidence/m3-live-summary.json): disposable edit/Git evidence, no reviewed/approved integration.

### Current support, independent of completed smoke coverage

- **Codex:** Lead and fresh read-only workers; read-only sandbox without network, approvals never. Completed Lead-thread resume supported; no worker resume, writer or live steering. Reads are not confined to the repository.
- **Claude/OpenCode:** file-tool readers/writers, clean same-checkout direct native resume, cancellation and one-shot file permissions. New engine assignments get fresh worktrees/checkpoints, not cross-checkout resume. No Lead or live steering.
- **Pi:** file-tool readers/writers, active steer/follow-up and cancellation; no native resume, coordinator or per-call approval callback in this adapter.
- **All four:** scoped application gateway. Permission callbacks, gateway authority and final source integration are distinct boundaries. Approving a native Write never approves integration.

## Cost-free runner preparation — current desktop continuation

`scripts/live-workers.ts` now records bounded text samples, ordered delta/terminal sequences and observed gateway denials. A reader PASS requires text before one authoritative `completed` event, not just a nonce report or process exit. Pi-only `--verify-cancel` adds one separate reader-shaped turn that is stopped after observed live text. With `--allow-live`, that mode can spend **two turns total**; the default reader can spend **one**.

`scripts/live-leads.ts --verify-lifecycle` adds a completed same-native-thread follow-up and an actively interrupted third turn after its original Codex gateway check, **three turns total** with `--allow-live`. Each later scenario requires the previous one to pass. Resume checks native ID, persisted predecessor, completion and selected settings. Cancellation records text → owner stop request → native interrupted terminal → owned exit, rejects an already-ended turn, and never retries. Failures retain owned state with a redacted failure receipt rather than preserving an earlier PASS.

Both flags remain discovery-only without `--allow-live`. The flag is an execution gate, **not** fresh owner spending authorization. No writer/reviewer/integration or worker role-denial probe was added. Collecting `gatewayDenials` does not prove a denial occurred; do not expose additional Lead tools merely to manufacture one.

- [Actual current adapters, zero-prompt receipts](evidence/m8-smoke-runner-preflight.json): Pi **1.3.0**, Codex **0.163.0**, Claude **2.1.302**, OpenCode **2.0.32**; both lifecycle flags set, zero prompts. Fresh Codex/Claude/Pi homes require auth; OpenCode auth remains unknown. Owner checkout and seven named personal-config metadata checks unchanged. OpenCode 2.0.32 live compatibility is unverified.
- [Inert protocol runner receipts](evidence/m8-smoke-runner-fixtures.json): Pi reader/cancel, Codex reader and Codex completed-resume/cancel PASS through real adapters/engine/gateway/Git with scripted transports. Two already-completed cancellation targets correctly exit 1, retain evidence and do not retry; they are expected negative outcomes, not native failures. The first throwaway Lead fixture selected a coordinator from a worker-only roster and failed; only that fixture selector was corrected. **Zero native model prompts; no row in the native matrix is closed.**


## Cross-assignment gateway probe — cost-free continuation

The owner explicitly chose **Continue cost-free preparation** rather than authorizing the offered native turns. Spending HOLD remains; the work below submitted no native model prompt and created no login or integration approval.

`scripts/live-workers.ts --verify-gateway-denial` adds one negative call inside its existing reader turn, not another model turn. The runner prepares an actual unassigned task in another run, then asks the worker to call its existing `read_assignment` tool once with that foreign `taskId` as an extra top-level argument. The gateway's strict worker schema rejects it with **`INVALID_INPUT`** before rebinding the assignment. No worker catalog, adapter permission or gateway authorization is widened.

A probe PASS requires a successful assignment read, exactly one `read_assignment`/`INVALID_INPUT` rejection and a later structured result, all in the same task/attempt/session binding. The foreign task must remain identical with zero attempts/dispatches, and no Lead-only tool may have succeeded. A model report claiming denial is insufficient. If a native client rejects the extra argument before the gateway, this runner cannot certify a gateway rejection; it fails/retains state without retrying or bypassing that client.

**This is assignment-scope schema rejection, not worker-to-Lead role-denial proof.** Lead-only methods remain absent from worker catalogs; do not expose them merely to make a negative native call possible. The existing gateway/adapter policy regressions cover those role boundaries with fixtures. The native role-denial cells above remain open; this preparation neither replaces them with validation evidence nor checks off the milestone.

- [Three positive and three expected-negative inert runner receipts](evidence/m8-gateway-scope-fixtures.json): Pi/Claude/OpenCode run through their actual adapters with inert RPC/SDK/HTTP transports and real engine/gateway/Git. All positive cases record `INVALID_INPUT` and an unchanged unassigned control. All cases that merely claim denial exit 1 despite a valid completed reader, retain evidence and submit no retry.
- [Actual three-adapter preflight with the new flag](evidence/m8-gateway-scope-preflight.json): zero prompts, `gatewayScopeProbe:null`, Pi 1.3.0 and Claude 2.1.302 auth required; OpenCode 2.0.32 auth unknown and the requested DeepSeek selection unavailable. Catalog availability is not model access. No current native client schema behavior, role denial or full matrix PASS is claimed.

## Safe repeat commands — no new model prompts

Use fresh evidence filenames. Put disposable XDG overrides **after** `mise x --`; putting them before mise can trigger tool reinstallation. These existing commands cover subsets of preflight, not a complete live matrix or an exact reproduction of the removed instrumented probe.

```sh
mise current
mise x -- env XDG_DATA_HOME=/tmp/lao-m8-matrix-next pnpm test:live:leads \
  --model gpt-6-luna --thinking low --verify-lifecycle \
  --output /tmp/m8-matrix-leads-next.json
mise x -- pnpm test:live:claude --output /tmp/m8-matrix-claude-next.json
mise x -- pnpm test:live:opencode --output /tmp/m8-matrix-opencode-next.json
mise x -- env XDG_DATA_HOME=/tmp/lao-m8-matrix-next pnpm test:live:workers \
  --harness pi --model deepseek/deepseek-flash --thinking off \
  --verify-cancel --verify-gateway-denial \
  --output /tmp/m8-matrix-pi-next.json
```

Without `--allow-live`, model/lifecycle flags do not authorize a prompt or establish entitlement. Discovery can legitimately return login-required or unknown. The original full-catalog receipt came from its recorded throwaway command; the current runner receipts above name the exact repeat commands used here.

## Blockers and exact continuation

1. **Owner spending decision: HOLD.** New model-bearing checks remain unauthorized. Earlier M8 authorizations do not carry forward; do not add `--allow-live` to a native run, switch billing routes or retry a failed/ambiguous turn without new scoped authorization. The prior eight/non-Claude or nine/all-four turn proposals were not approved; neither was integration. Inert transport verification is not a live spend authorization.
2. **Claude/Pi authentication absent in the current fresh homes.** Privately supply an owner-approved native route to the process that will run the smoke; Pi currently lists no usable model. Existing Claude setup-token guidance and vendor-policy caveat remain in [recon](adapter-recon.md#m8-item-1--claude-authentication-slice-a-2026-10-17) and [ADR](adr/2026-10-17-claude-setup-token.md). Never paste a token into chat/arguments or extract personal credentials. A no-model Claude probe is `mise x -- pnpm test:live:claude --output /tmp/m8-matrix-claude-auth-next.json`; auth metadata still is not entitlement.
3. **Codex fresh home intentionally logged out.** The earlier owner-authenticated `/tmp/lao-m8-workers/local-agent-orchestrator/codex` home is historical, may disappear on reboot and is not assumed migrated to this desktop. This continuation did not inspect/reuse it. If the owner deliberately chooses that app-owned home, its no-prompt check is `mise x -- env XDG_DATA_HOME=/tmp/lao-m8-workers pnpm test:live:leads --model gpt-6-luna --thinking low --output /tmp/m8-matrix-codex-auth-next.json`; if logged out, the owner can run `mise x -- env CODEX_HOME=/tmp/lao-m8-workers/local-agent-orchestrator/codex codex login`. Never copy a personal login or authenticate a throwaway preflight home that will be removed.
4. **Missing native observations, not merely missing setup:** run the instrumented streaming/lifecycle and assignment-scope probes only after fresh scoped spending/auth authorization and rediscovery of an available selection. `--verify-gateway-denial` prepares a server-observed cross-assignment `INVALID_INPUT` check, not a worker-to-Lead role-denial call. The latter remains unobserved with Lead-only tools intentionally absent from worker catalogs; no policy widening or weaker acceptance claim is authorized. Reader-only reruns and inert passes do not close these native gaps.
5. **One real writer lifecycle remains unverified.** Use a supported writer on a marked disposable repository, capture its candidate, independently review it, inspect the exact integration preview, then obtain a separate explicit owner approval bound to that preview before applying. A model-spending decision or native Write callback is not that approval. Existing [integration workflow tests](../tests/integration-workflow.test.ts) establish application behavior with fixtures only; there is no native writer-to-integration receipt to cite.

**Next checklist item remains M8 item 8.** Resume with `mise current`, this matrix and the latest recon; settle new auth/spend prerequisites before native prompts, instrument only the missing scenarios, and leave M9 and beta completion unclaimed. Auth/rate-limit/credit-exhaustion induction and broad recovery/descendant hardening were not exercised here.

## Original matrix-recording verification

- `mise x -- pnpm typecheck`, `mise x -- pnpm lint`: PASS.
- `mise x -- pnpm test`: **444/444**; `mise x -- pnpm test:fixtures`: **3/3**. These use inert transports/FakeAdapter/disposable Git, not newly authorized native model turns.
- `mise x -- pnpm build`, `mise x -- pnpm smoke`: PASS; actual development and production health/HTML/script launches observed.
- Receipt invariants, all 15 linked matrix files and exact-environment-secret exclusion across seven changed/new artifacts: PASS. The throwaway link checker first misparsed an escaped literal; correcting that parser passed without application changes.
- No application code or permanent tests changed. No UI behavior changed; no new browser check or native cost-bearing smoke is claimed.

## Stream/lifecycle preparation verification

- `mise x -- pnpm typecheck`, `mise x -- pnpm lint`: PASS; `mise x -- pnpm test`: **448/448**, including four ordered-stream evidence regressions; `mise x -- pnpm test:fixtures`: **3/3**.
- `mise x -- pnpm build`, `mise x -- pnpm smoke`: PASS; development/production health, HTML and script launches observed.
- Positive/negative runner smoke and current native no-model checks are linked above. Receipt invariants and exact-environment-secret exclusion passed. No UI or adapter-policy change, dependency, toolchain, spec change or new ADR; no cost-bearing native run, login, candidate integration or milestone check-off.

## Gateway-scope preparation verification

- `mise x -- pnpm typecheck`, `mise x -- pnpm lint`: PASS; `mise x -- pnpm test`: **455/455**; focused evidence **11/11** (seven new cases); `mise x -- pnpm test:fixtures`: **3/3**.
- `mise x -- pnpm build`, `mise x -- pnpm smoke`: PASS, actual development/production startup observed. Positive/negative runner and native zero-prompt receipts are linked above; fixture passes are not native model evidence.
- No app adapter/policy, dependency, toolchain, spec or ADR change, login, native model turn, candidate integration or checkbox change. M8 item 8 remains blocked; M9 untouched.
