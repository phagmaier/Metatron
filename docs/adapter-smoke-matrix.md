# M8 item 8 — per-adapter smoke matrix

**Status: BLOCKED / incomplete.** The owner selected **Keep new model turns blocked** for this session. No new model prompts, login, native write approvals or integration approvals were issued. M8 item 8 stays unchecked; M9 has not started.

Scope: [spec §13.3](../spec.md#133-live-harness-smoke-matrix). **Fresh** means exercised in this session. **Existing** means a retained native receipt, not a rerun. **Partial** identifies the missing observation; fixture results never stand in for native model evidence. Unsupported controls below are application restrictions, not claims about every capability of the upstream harness.

## Fresh zero-prompt preflight

Started with `mise current`: Node **26.7.0**, pnpm **11.22.0**. An instrumented throwaway script ran the actual application and all four installed adapters in fresh app-owned homes, then attempted only unsupported session configurations. It never called `prompt`. [Full receipt, catalogs, effort choices and diagnostics](evidence/m8-smoke-matrix-discovery.json).

| Harness | Native version | Discovered models | Authentication in this fresh home | Observed setup outcome |
| --- | --- | ---: | --- | --- |
| Codex | 0.163.0 | 8 | false | App-owned native login required; historical disposable login not reused |
| Claude Code | CLI 2.1.302 | 5 | false | `AUTH_ABSENT`; privately supplied approved route required |
| OpenCode | 2.0.29 | 12 | unknown | Catalog/control available; no model access or price verified |
| Pi | 1.3.0 | 2 | unknown | Catalog/control available; no model access or price verified |

The installed Claude SDK remains pinned to **0.3.302** in `package.json`; this fresh probe reports the CLI version, not a separate SDK handshake version. All model IDs and per-model native thinking choices are retained in the receipt rather than copied into a second catalog. Catalogs are dynamic: OpenCode currently includes `deepseek/deepseek-flash` with `none/low/high/max`, whereas the historical worker used a free OpenCode model. Rediscover before choosing; do not assume an old price or catalog is still valid.

Fresh refusal results: Codex writer and worker resume; Pi resume; Pi/Claude/OpenCode coordinator start all returned **UNSUPPORTED** before a native task/session was created. Zero persisted attempts/sessions; fixture HEAD/status and metadata of the seven named personal-config files unchanged; no process command line referencing the unique app directory survived close or the check three seconds later. Successful disposable state and the throwaway probe were removed. These observations are not active-generation cancellation, every-descendant cleanup, credential entitlement, or an OS sandbox.

The Codex login command in the raw discovery diagnostic names the now-deleted fresh home. Do **not** use that discarded path for future authentication; use the deliberately retained application-owned home described under prerequisites below.

## Seven required checks

| §13.3 check | Codex | Claude Code | OpenCode | Pi |
| --- | --- | --- | --- | --- |
| 1. Binary/version, capabilities, model/thinking choices | **Fresh PASS** discovery; logged out in fresh home | **Fresh PASS** discovery; `AUTH_ABSENT` | **Fresh PASS** discovery; auth unknown | **Fresh PASS** discovery; auth unknown |
| 2. Disposable streamed reader and authoritative terminal status | **Partial existing:** reader/terminal/exit 0; worker receipt omits streaming observations [C] | **Existing PASS:** streamed read, completed result and exit 0 [A] | **Existing PASS:** streamed nonce read, authoritative completion and owned shutdown 130 [B] | **Partial existing:** reader/terminal/exit 0; worker receipt omits streaming observations [P] |
| 3. Effective selected model/thinking | **Existing PASS:** `gpt-6-luna` / low [C] | **Existing PASS:** native Sonnet 5.5 / low hook proof [A]; Haiku 5.5 / low worker [W] | **Existing PASS:** DeepSeek flash / low native variant [B]; free-model worker settings [W] | **Existing PASS:** DeepSeek flash / off native `get_state` [P] |
| 4. Completed-session follow-up resume | **OPEN:** Lead supported, but retained resume is 0.162.1, not current 0.163.0 [H]; worker resume **unsupported**, freshly refused | **Existing PASS:** same native ID/original checkout, completed follow-up [A] | **Existing PASS:** same native ID/original checkout, completed follow-up [B] | **Unsupported:** adapter does not reopen sessions; freshly refused; fresh checkpoint handoff is not native resume |
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

## Safe repeat commands — no new model prompts

Use fresh evidence filenames. Put disposable XDG overrides **after** `mise x --`; putting them before mise can trigger tool reinstallation. These existing commands cover subsets of preflight, not a complete live matrix or an exact reproduction of the removed instrumented probe.

```sh
mise current
mise x -- env XDG_DATA_HOME=/tmp/lao-m8-matrix-next pnpm test:live:leads \
  --model gpt-6-luna --thinking low --output /tmp/m8-matrix-leads-next.json
mise x -- pnpm test:live:claude --output /tmp/m8-matrix-claude-next.json
mise x -- pnpm test:live:opencode --output /tmp/m8-matrix-opencode-next.json
mise x -- env XDG_DATA_HOME=/tmp/lao-m8-matrix-next pnpm test:live:workers \
  --harness pi --model deepseek/deepseek-flash --thinking off \
  --output /tmp/m8-matrix-pi-next.json
```

Without `--allow-live`, the selected model flags do not authorize a prompt or establish entitlement. Discovery can legitimately return login-required or unknown. The fresh receipt in this session came from the instrumented throwaway command recorded in its `command` field, not the four commands above.

## Blockers and exact continuation

1. **Owner spending decision: HOLD.** New model-bearing checks were explicitly declined for this session. Earlier M8 authorizations do not carry forward; do not add `--allow-live`, switch billing routes or retry a failed/ambiguous turn without new scoped authorization. The offered upper bounds of eight non-Claude or nine all-four turns were not approved, nor was any integration.
2. **Claude authentication absent.** Privately supply an approved route to the process that will run the smoke. Existing setup-token guidance and vendor-policy caveat remain in [recon](adapter-recon.md#m8-item-1--claude-authentication-slice-a-2026-10-17) and [ADR](adr/2026-10-17-claude-setup-token.md). Never paste a token into chat/arguments or extract personal credentials. A fresh no-model probe is `mise x -- pnpm test:live:claude --output /tmp/m8-matrix-claude-auth-next.json`; auth metadata still is not entitlement.
3. **Codex fresh home intentionally logged out.** The earlier owner-authenticated disposable home is `/tmp/lao-m8-workers/local-agent-orchestrator/codex` and may disappear on reboot; this session did not inspect/reuse it. To check it without a prompt, run `mise x -- env XDG_DATA_HOME=/tmp/lao-m8-workers pnpm test:live:leads --model gpt-6-luna --thinking low --output /tmp/m8-matrix-codex-auth-next.json`. If actually logged out and the owner chooses this route, owner command: `mise x -- env CODEX_HOME=/tmp/lao-m8-workers/local-agent-orchestrator/codex codex login`. Never copy a personal login.
4. **Missing native observations, not merely missing binary setup:** retain streamed deltas and authoritative terminal events for Codex/Pi; exercise current Codex Lead completed resume and active cancellation; exercise Pi active cancellation; capture Pi/Claude/OpenCode scoped policy-denial evidence. Existing worker scripts do not yet collect every one of these scenarios, so rerunning their reader-only mode cannot close the matrix. No unsupported native operation should be emulated and labeled resume/approval.
5. **One real writer lifecycle remains unverified.** Use a supported writer on a marked disposable repository, capture its candidate, independently review it, inspect the exact integration preview, then obtain a separate explicit owner approval bound to that preview before applying. A model-spending decision or native Write callback is not that approval. Existing [integration workflow tests](../tests/integration-workflow.test.ts) establish application behavior with fixtures only; there is no native writer-to-integration receipt to cite.

**Next checklist item remains M8 item 8.** Resume with `mise current`, this matrix and the latest recon; settle new auth/spend prerequisites before native prompts, instrument only the missing scenarios, and leave M9 and beta completion unclaimed. Auth/rate-limit/credit-exhaustion induction and broad recovery/descendant hardening were not exercised here.

## Verification in this session

- `mise x -- pnpm typecheck`, `mise x -- pnpm lint`: PASS.
- `mise x -- pnpm test`: **444/444**; `mise x -- pnpm test:fixtures`: **3/3**. These use inert transports/FakeAdapter/disposable Git, not newly authorized native model turns.
- `mise x -- pnpm build`, `mise x -- pnpm smoke`: PASS; actual development and production health/HTML/script launches observed.
- Receipt invariants, all 15 linked matrix files and exact-environment-secret exclusion across seven changed/new artifacts: PASS. The throwaway link checker first misparsed an escaped literal; correcting that parser passed without application changes.
- No application code or permanent tests changed. No UI behavior changed; no new browser check or native cost-bearing smoke is claimed.
