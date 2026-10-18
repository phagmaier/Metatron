# M8 item 8 — per-adapter smoke matrix

**Status: complete for M8 item 8, with recorded limitations.** Codex's lifecycle and Pi's corrected native reader/cancellation slice passed; both earlier Pi failures and their native states remain retained. Zero-prompt worker catalog probes passed natively for all four harnesses (Claude via an owner-supplied setup-token). The §13.3 one-writer check passed natively: Pi writer → captured candidate → independent read-only review → isolated preview → owner-approved fast-forward of the disposable fixture [Y][Z]. A native-client Lead-tool invocation by a worker stays unobserved (catalog-plus-server evidence only); Pi resume and Codex writer remain unsupported. All turn allowances are consumed; M9 untouched.

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
| 1. Binary/version, capabilities, model/thinking choices | **Native PASS:** 0.163.0, app-owned login and requested selection available [G][N] | **Recorded PASS** discovery; fresh homes `AUTH_ABSENT`, owner-supplied setup-token admitted for the zero-prompt catalog session [X] | **Recorded PASS** discovery on 2.0.29; current desktop 2.0.32 discovery only | **Native PASS:** 1.3.0, app-owned OpenAI OAuth readiness and requested selection [Q][R]; app auth metadata remains `unknown` |
| 2. Disposable streamed reader and authoritative terminal status | **Native PASS as read-only Lead:** streamed nonce read, authoritative completion and exit 0 [N]. Historical worker receipt [C] omits streaming | **Existing PASS:** streamed read, completed result and exit 0 [A] | **Existing PASS:** streamed nonce read, authoritative completion and owned shutdown 130 [B] | **Native reader PASS:** streamed nonce, authoritative completion, owned exit 0 and unchanged worktree [U]; earlier mixed receipts retained [R][S] |
| 3. Effective selected model/thinking | **Native PASS:** `gpt-6-luna` / low on completed Lead start and resume [N]; historical worker [C] | **Existing PASS:** native Sonnet 5.5 / low hook proof [A]; Haiku 5.5 / low worker [W] | **Existing PASS:** DeepSeek flash / low native variant [B]; free-model worker settings [W] | **Native PASS:** `openai/gpt-6-luna` / low via `get_state` [U]; earlier [R][S], historical DeepSeek/off [P] |
| 4. Completed-session follow-up resume | **Native PASS:** Lead 0.163.0, same native thread, predecessor linkage, remembered nonce and completed follow-up [N]; worker resume **unsupported**, refusal recorded | **Existing PASS:** same native ID/original checkout, completed follow-up [A] | **Existing PASS on 2.0.29:** same native ID/original checkout, completed follow-up [B] | **Unsupported:** adapter does not reopen sessions; refusal recorded; fresh checkpoint handoff is not native resume |
| 5. Active cancellation and harmless permission prompt where supported | **Native PASS:** 0.163.0 text → stop request → native interruption → owned exit 0, task `CANCELLED`, no success report [N]. Native approval prompts **unsupported** under read-only/never policy | **Existing PASS:** active interruption/exit 143; separate one-shot Write approval, independent denial and stale-grant refusal [A] | **Existing PASS:** active native interrupt acknowledgement; one-shot Write approval and independent denial [B] | **Native PASS:** corrected read-only Reader probe, text → stop → interruption → owned exit 0, `CANCELLED`, no session error/report, unchanged worktree [U][V]. Prior failures retained [R][S]. Per-call prompts **unsupported** |
| 6. Scoped orchestration invocation **and policy denial** | **Native PASS as Lead:** scoped status/proposal, coordinator assignment `POLICY_DENIED` [N]; earlier Lead [L], worker invocation [C]. **Zero-prompt worker catalog PASS:** native `codex-mcp-client` 0.163.0 fetched only the five worker tools; all 12 Lead-only tools `POLICY_DENIED` on that binding, probe-originated [X] | **Partial existing:** worker `read_assignment`/`submit_result` succeeded [W]. **Zero-prompt worker catalog PASS** on 2.1.302 with setup-token: native client fetched only worker tools; 12/12 Lead-only `POLICY_DENIED`, probe-originated [X]. Earlier `AUTH_ABSENT` receipt retained | **Partial existing:** worker invocation succeeded [W]. **Zero-prompt worker catalog PASS** on 2.0.32: native `opencode` client fetched only worker tools; 12/12 Lead-only `POLICY_DENIED`, probe-originated [X] | **Partial native:** worker assignment/result calls succeeded [R]. **Zero-prompt worker catalog PASS:** native `pi` 1.3.0 client fetched only worker tools; 12/12 Lead-only `POLICY_DENIED`, probe-originated [X] |
| 7. Native writer → captured candidate → review → explicit owner approval → integration (§13.3: one writer) | Writer **unsupported** | **Not exercised** (one-writer check satisfied by Pi); direct disposable Write approval is not candidate review/integration [A] | **Not exercised** (one-writer check satisfied by Pi); direct disposable Write approval is not candidate review/integration [B] | **Native PASS:** exact README edit, captured candidate, independent fresh read-only review `pass`, 8/8 preview checks, owner-approved `merge --ff-only` of the disposable fixture, re-apply blocked [Y][Z] |

Evidence references:

- **[A]** [Claude five-turn native receipt](evidence/m8-claude-native-live.json): `liveResults` operations `read`, `same-checkout-resume`, `native-approved-write-and-independent-denial`, `active-generation-cancellation`; selected native init/stream/hook evidence. Clean completed turns exit 0; canceled generation is interrupted with exit 143 and a retained stream error, not success. The denial-only scenario's text mentions a closed permission stream; explicit independent denial proof comes from the separate approved-write scenario and its file/stale-grant assertions, not that text.
- **[B]** [OpenCode five-turn native receipt](evidence/m8-opencode-native-live.json): `results` operations `streamed-read`, `same-id-resume`, `approve-once-independent-denial`, `active-generation-cancel`; `modelRefs` and `interruptConfirmed`. Normal private-host shutdown 130 is recorded alongside authoritative completion; exit code alone is not success. Native HTTP 401 checks are server authentication, not Metatron gateway role-denial or Origin protection.
- **[C]** [Codex worker](evidence/m8-worker-codex.json): `run`, `settingsVerified`, `gatewayTools`, nonce report and unchanged checkout. Receipt does not retain text-delta or turn-completion event samples.
- **[P]** [Pi worker](evidence/m8-worker-pi.json): same fields, native ID and completed read-only attempt. The [recovered earlier attempt](evidence/m8-worker-pi-first-run-recovered.json) remains `passed:false`; historical personal-config metadata changes remain unexplained and do not become a PASS through this matrix.
- **[W]** [Claude worker](evidence/m8-worker-claude.json) and [OpenCode worker](evidence/m8-worker-opencode.json): native worker gateway invocation and confirmed settings. Both `gatewayTools` arrays contain successful calls, not role denials.
- **[X]** Zero-prompt worker catalog receipts ([Codex](evidence/m8-worker-catalog-codex.json), [OpenCode](evidence/m8-worker-catalog-opencode.json), [Pi](evidence/m8-worker-catalog-pi.json), [Claude setup-token PASS](evidence/m8-worker-catalog-claude-code-setup-token.json), [earlier Claude `AUTH_ABSENT`](evidence/m8-worker-catalog-claude-code.json)) from `pnpm smoke:worker-catalog`: a real read-only worker `startSession` behind a recording loopback proxy, `submittedPrompts:0`; `nativeExchanges` (client identity, `tools/list` names; never tokens/arguments), `probeLeadDenials`, `gatewayJournal`, `checks`. The Lead-tool calls are sent by the script with the native session's binding, **not** by the native client; how a native client handles a model-requested unlisted tool is not observed.
- **[L]** [Codex 0.163.0 Lead](evidence/m8-lead-codex-native.json): `nativeCodexLead.checks`, `tools`, `denials`; no worker launched.
- **[H]** [M4 native summary](evidence/m4-live-summary.json): `harnesses.lead` is Codex **0.162.1**; `run2_gate.autonomous.sessions/configured` and `resumedStopTurn` record historical resume/stop only. Do not upgrade those observations to current-version PASS.
- **[M]** [M3 native Pi reader/writer summary](evidence/m3-live-summary.json): disposable edit/Git evidence, no reviewed/approved integration.
- **[G]** [Codex auth/model preflights](evidence/m8-codex-auth-preflight.json): zero-prompt before/after auth history, exact commands and owner scope; final `authenticated:true`, requested selection available. Initial confirmation still reported false; its cause is unproven.
- **[N]** [Codex 0.163.0 native three-turn lifecycle](evidence/m8-codex-lead-lifecycle-native.json): `nativeCodexLead`, `completedResume`, `activeCancellation`, three submitted prompts and unchanged fixture/checked personal metadata. Current-version proof, not a reinterpretation of [H].
- **[Q]** [Pi native OAuth and exact selection preflights](evidence/m8-pi-oauth-preflight.json): zero prompts, native `openai` OAuth ready, actual app catalog and `openai/gpt-6-luna` / low selectable. The initial `openai-codex` status query used the wrong identifier; it did not establish that owner login failed.
- **[R]** [Pi two-turn native receipt, `passed:false`](evidence/m8-pi-reader-cancel-native.json): reader passed; strict cancellation failed on `noSessionError` and `noSuccessReport`. Original bytes retained, with database/fixture/worktree paths; no replay.
- **[D]** [Read-only native cancellation analysis](evidence/m8-pi-cancellation-analysis.json): report 111 → text 114 → stop 116 → error 122 → interruption 124 → exit 126. Only stop-reason/error-presence metadata from the app-owned native transcript is included, not error bodies or credential files.
- **[F]** [Inert requested-abort smoke](evidence/m8-pi-requested-abort-fixture.json): actual engine/Git/Pi RPC subprocess with an inert transport, canceled state and no session fault/result. Zero native model turns; not a correction of [R].
- **[S]** [Fresh Pi two-turn native receipt, `passed:false`](evidence/m8-pi-reader-cancel-fresh-native.json): separately authorized reader/cancellation, unchanged native bytes; all cancellation checks pass except `noSuccessReport`. Failed database/fixture/worktrees retained, no retry.
- **[T]** [Fresh authorization, commands and journal analysis](evidence/m8-pi-cancellation-fresh-analysis.json): result 109 → text 112 → stop 113 → interruption 117 → exit 119, no session error. [Fresh zero-prompt selection preflight](evidence/m8-pi-cancellation-fresh-preflight.json) and native app-owned OAuth readiness precede the two turns.
- **[U]** [Corrected Pi native two-turn PASS](evidence/m8-pi-cancellation-narration-native.json): streamed reader/settings and six strict cancellation checks, cancellation-only read-only Reader snapshot, text 94 → stop 95 → interruption 99 → owned exit 0. [Fresh zero-prompt preflight](evidence/m8-pi-cancellation-narration-preflight.json).
- **[V]** [New authorization, correction and exact command](evidence/m8-pi-cancellation-narration-scope.json): no retries/writes/other harnesses/integration, two-turn scope exhausted. [Inert CLI positive/negative proof](evidence/m8-pi-cancellation-narration-fixtures.json) retains premature-report and already-completed failures; zero native prompts in those fixtures.
- **[Y]** [Pi native writer/reviewer receipt](evidence/m8-writer-native.json): `writer`, `candidate`, `reviewer`, `independence`, `preview.checks`, `integrationHold`; two prompts, stage `awaiting_owner_integration_review`, unchanged bytes.
- **[Z]** [Owner-approved integration](evidence/m8-writer-integration-native.json): `ownerAuthorization`, `planBefore`/`planApproved`/`planAfter`, `decision`, `applications`, `git`, `checks`; fixture `main` 775d4f8 → cd0b39f, no model turn.

### Current support, independent of completed smoke coverage

- **Codex:** Lead and fresh read-only workers; read-only sandbox without network, approvals never. Completed Lead-thread resume supported; no worker resume, writer or live steering. Reads are not confined to the repository.
- **Claude/OpenCode:** file-tool readers/writers, clean same-checkout direct native resume, cancellation and one-shot file permissions. New engine assignments get fresh worktrees/checkpoints, not cross-checkout resume. No Lead or live steering.
- **Pi:** file-tool readers/writers, active steer/follow-up and cancellation; no native resume, coordinator or per-call approval callback in this adapter.
- **All four:** scoped application gateway. Permission callbacks, gateway authority and final source integration are distinct boundaries. Approving a native Write never approves integration.

## Cost-free runner preparation — current desktop continuation

`scripts/live-workers.ts` now records bounded text samples, ordered delta/terminal sequences and observed gateway denials. A reader PASS requires text before one authoritative `completed` event, not just a nonce report or process exit. Pi-only `--verify-cancel` adds one separate reader-shaped turn that is stopped after observed live text. With `--allow-live`, that mode can spend **two turns total**; the default reader can spend **one**.

The cancellation run now explicitly selects **Reader** in its own immutable snapshot with interim-narration guidance before normal final reporting. The generic native launcher instead selects the first read-only profile, **Reviewer**, whose concise-review guidance competed with the original narration objective. Exact model reasoning is unknown. No generic role, gateway catalog, adapter permission or cancellation acceptance check is changed.

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

## Approval-held writer and reviewer preparation

`pnpm test:live:writer` (`scripts/live-writer.ts`) prepares the remaining **one-writer** lifecycle using Pi's existing file-worker guard and independent read-only Reviewer profile. Pi is a bounded implementation choice, not a claim that Claude/OpenCode cannot write; no native permission callback is automatically approved.

Default mode is actual native discovery with **zero turns**. Future execution requires fresh owner spending/auth authorization **and both** `--allow-live --allow-disposable-write`; either flag alone blocks with zero attempts/sessions. With both gates and a discovered selection, the runner can request at most **two Pi turns**: one scoped README edit and one separate reviewer. No model Lead, revision or automatic retry is scheduled.

The writer must produce exactly the expected README content and one captured candidate against the fixture base. Only then may a different profile/task/attempt/native session independently inspect its own clean checkout at that exact candidate. Freshness is checked from persisted **effective** context, not the requested `auto` policy. A passing durable review permits an isolated integration preview with an exact-content Node check; incorrect edits, changes-requested reviews or dirty reviewers stop before preview.

The runner ends at **`awaiting_owner_integration_review`**, with the task still awaiting review, candidate/preview unapproved, no applications and a blocked apply plan. It has **no approve/apply option or operation**. Neither its Write gate nor a reviewer recommendation grants integration authority. The owner must separately inspect candidate findings, final diff, destination SHA, tests and proposed commands before explicitly authorizing the existing GUI approval/apply workflow.

Use a fresh canonical disposable XDG home. The script atomically claims its default `state.sqlite` and refuses any existing database before model dispatch; this prevents accidental replay. Successful native held previews and all failed native work remain retained. The receipt's `retained.inspectCommand` opens that exact database with `pnpm dev` for owner inspection; rerunning this smoke against it is refused. Only discovery-only scratch Git/database state is cleaned automatically.

- [Inert writer/reviewer/preview and retained HTTP inspection evidence](evidence/m8-writer-held-fixtures.json): exact candidate, distinct effective-fresh reviewer, passing isolated preview, unapproved candidate and blocked plan. Incorrect writer, changes-requested and dirty-reviewer cases fail with no preview; single-gate cases block without work; existing-database replay and an unknown integration flag are refused without child spawn or database change. HTTP readback observes findings/diff/preview without adding attempts or approval. **Not native model evidence or human candidate review.**
- Initial inert run exposed the runner's requested-`auto` versus effective-`fresh` mistake; it was fixed without relaxing independence. A throwaway HTTP inspector initially used `content` instead of the published candidate-diff `patch`; only that inspector was corrected. Both corrections and the original failed lifecycle receipt are recorded, not disguised as native failures.
- [Actual Pi 1.3.0 default preflight](evidence/m8-writer-preflight.json): auth required, requested selection unavailable, zero turns/attempts/sessions/worktrees, owner checkout and checked personal metadata unchanged. No new login, native edit, independent native review or integration occurred. Inert scratch paths in receipts are discarded verification fixtures, not native candidates or login homes.

## Codex native lifecycle — 2026-10-18

Owner selected **Signed in — authorize three Codex turns**, then completed native browser login with file storage in `/tmp/metatron-m8-auth-sjdG2wvR/local-agent-orchestrator/codex`. No personal credential file was opened or copied. [Auth preflights](evidence/m8-codex-auth-preflight.json) preserve the initial still-unauthenticated observation and final successful application discovery; no model was submitted while the gate was false.

Exact successful commands, in order:

```sh
mise x -- env XDG_DATA_HOME=/tmp/metatron-m8-auth-sjdG2wvR pnpm test:live:workers \
  --harness codex --model gpt-6-luna --thinking low \
  --output /tmp/metatron-m8-auth-sjdG2wvR/auth-model-confirmed-login.json
mise x -- env XDG_DATA_HOME=/tmp/metatron-m8-auth-sjdG2wvR pnpm test:live:leads \
  --allow-live --verify-lifecycle --model gpt-6-luna --thinking low \
  --output /tmp/metatron-m8-auth-sjdG2wvR/codex-lead-lifecycle-native.json
```

The [native receipt](evidence/m8-codex-lead-lifecycle-native.json) passes all gateway/settings/stream, same-thread completed follow-up and ordered active-cancellation checks. The interrupted turn exits 0 with `interrupted:true` and task `CANCELLED`; exit 0 is not mistaken for task success. No worker launched, no retry, source edit, candidate or integration. The disposable fixture and per-run database were removed by the successful runner; app-owned login remains under `/tmp` and may disappear on reboot.

**Three authorized Codex turns consumed; do not rerun the live command without a new scope.** No worker streaming claim is retroactively added to [C]. The later Pi continuation below records its separate authorization and mixed native outcome.

## Pi OAuth and reader/cancellation — 2026-10-18

The owner completed Pi's private native login in `/tmp/metatron-m8-auth-sjdG2wvR/local-agent-orchestrator/pi`. Installed 1.3.0 reports that login under provider **`openai`** (`authType:"oauth"`), not the `openai-codex` identifier initially checked. No credential file was opened or copied by the observer. Actual app discovery remains `authenticated:"unknown"` while exposing the validated selection; [preflights](evidence/m8-pi-oauth-preflight.json) submitted zero prompts.

The owner then selected **Authorize two Pi read-only turns**, `openai/gpt-6-luna` / low, no retries/writes/integration. Exact command:

```sh
mise x -- env XDG_DATA_HOME=/tmp/metatron-m8-auth-sjdG2wvR pnpm test:live:workers \
  --allow-live --harness pi --model openai/gpt-6-luna --thinking low --verify-cancel \
  --output /tmp/metatron-m8-auth-sjdG2wvR/pi-reader-cancel-native.json
```

**Native outcome: reader PASS, overall receipt FAIL (exit 1), two turns consumed.** The first turn streamed the correct nonce before authoritative completion, confirmed requested model/thinking, used its scoped assignment/result tools, exited 0 and left its worktree unchanged. The second reached ordered native interruption, task `CANCELLED` and owned exit 0, but emitted `native_error` and had already saved a result before the stop. The [original receipt](evidence/m8-pi-reader-cancel-native.json) is preserved unchanged with all retained state.

[Journal/stop-reason analysis](evidence/m8-pi-cancellation-analysis.json) separates the two causes: result 111 precedes stop 116; native assistant stop reason is `aborted`. `PiAdapter` now marks an explicit abort request, and `PiEvents` treats only that requested `aborted` message as expected interruption with usage retained. Unexpected aborts and genuine provider/transport failures remain diagnostic. The engine/mapper regressions failed before the fix; [inert engine smoke](evidence/m8-pi-requested-abort-fixture.json) passes. No native retry, prompt workaround, early-result check relaxation or retroactive native PASS.

**Pi allowance exhausted; strict native cancellation stays open.** Failed native database, fixture and worktrees remain retained; the receipt identifies them. Codex/Pi app-owned logins remain under `/tmp` and may disappear on reboot. Native worker role denial and writer/reviewer/approved integration remain unverified.

## Fresh Pi native cancellation verification — 2026-10-18

Owner selected **Authorize up to two Pi turns**: existing app-owned OAuth, `openai/gpt-6-luna` / low, reader prerequisite then active cancellation, no retries/source writes/other harnesses/writer/reviewer/integration. Fresh native auth reported `ready` / `openai` / `oauth` with `--no-refresh`; no login or credential-file inspection/copy was performed. [Zero-prompt preflight](evidence/m8-pi-cancellation-fresh-preflight.json) found Pi 1.3.0 and the requested selection; catalog auth remains unknown, not entitlement.

Exact live command, run once:

```sh
mise x -- env XDG_DATA_HOME=/tmp/metatron-m8-auth-sjdG2wvR pnpm test:live:workers \
  --allow-live --harness pi --model openai/gpt-6-luna --thinking low --verify-cancel \
  --output /tmp/metatron-m8-auth-sjdG2wvR/pi-reader-cancel-fresh-native-20261018.json
```

**Exit 1, exactly two prompts; strict gate remains failed.** The [unaltered fresh receipt](evidence/m8-pi-reader-cancel-fresh-native.json) passes streamed reader/settings and confirms requested-abort normalization natively: no session error, ordered interruption, task `CANCELLED`, owned exit 0, clean worktrees. It fails only `noSuccessReport`. [Read-only journal analysis](evidence/m8-pi-cancellation-fresh-analysis.json) records result **109**, text **112**, stop **113**, interruption **117**, exit **119**. The check is unchanged; no pre-stop report is relabeled as success.

Both failed native receipts and their databases/fixtures/worktrees remain retained; no replay, native write, candidate, review or integration occurred. Fixture HEAD/status and checked personal-config metadata stayed unchanged. The fresh allowance is exhausted. Next: investigate the pre-stop report before proposing another scoped native run; worker role-denial and writer/review/explicitly approved integration remain open. M8 item 8 unchecked, M9 untouched.

## Corrected Pi native cancellation PASS — 2026-10-18

The owner selected **Authorize two Pi turns** after the probe mismatch was identified: `openai/gpt-6-luna` / low, existing app-owned OAuth, reader then cancellation, no retries/source writes/other harnesses/writer/reviewer lifecycle/integration. `scripts/live-workers.ts` now gives only the cancellation run a read-only Reader snapshot whose assigned work is interim narration before final reporting. The previous generic Reviewer submitted repository findings before text; that observation does not reveal the model's exact internal decision. Worker policy and `cancellationEvidence` remain unchanged.

[Inert CLI proof](evidence/m8-pi-cancellation-narration-fixtures.json) passed the positive case while premature-result and already-completed cases still failed with retained state and no retry. An initial throwaway fixture used a nested XDG path and produced no receipt; only fixture paths were corrected. These fixtures are not native model proof.

Fresh native OAuth readiness and [zero-prompt selection](evidence/m8-pi-cancellation-narration-preflight.json) passed before this single live command:

```sh
mise x -- env XDG_DATA_HOME=/tmp/metatron-m8-auth-sjdG2wvR pnpm test:live:workers \
  --allow-live --harness pi --model openai/gpt-6-luna --thinking low --verify-cancel \
  --output /tmp/metatron-m8-auth-sjdG2wvR/pi-narration-cancel-native-20261018.json
```

**Native PASS, exit 0, exactly two prompts.** The [unaltered receipt](evidence/m8-pi-cancellation-narration-native.json) passes the streamed reader/settings and all six strict cancellation checks: text **94** → stop **95** → native interruption **99** → owned exit **0**, task `CANCELLED`, no session fault or success report. Both worktrees, fixture HEAD/status and checked personal-config metadata stayed unchanged. [Authorization/correction/limits](evidence/m8-pi-cancellation-narration-scope.json).

Successful fixture/per-run DB/worktrees were cleaned by the runner; both earlier failed native states and the app-owned login remain retained. Owned inert fixtures/hooks were removed after evidence preservation. All turn allowances are exhausted. Remaining M8 item 8 gates: native worker role-denial and writer/independent review/separately approved integration. No write/integration approval or M9 work is implied.

## Native writer, review and owner-approved integration — 2026-10-18

The owner selected **Approve 2 turns**: Pi `openai/gpt-6-luna` / low, one exact README edit in a disposable fixture plus one independent reviewer, no retries/other harnesses, integration held. The existing app-owned home had no `state.sqlite`, so no discovery run preceded it (that would have claimed the database and refused the live run). Exact command, run once:

```sh
mise x -- env XDG_DATA_HOME=/tmp/metatron-m8-auth-sjdG2wvR pnpm test:live:writer \
  --model openai/gpt-6-luna --thinking low --allow-live --allow-disposable-write \
  --output /tmp/metatron-m8-auth-sjdG2wvR/pi-writer-native-20261018.json
```

**Native PASS, exit 0, exactly two prompts** [Y]. Writer: settings verified via `get_state`, streamed before terminal, exit 0, one `README.md` change matching the exact expected content. Reviewer: different task/attempt/profile, effective-fresh native session, clean checkout at the candidate SHA, recommendation `pass` with no findings. Preview: 8/8 checks, exact-content Node test passed. The receipt ended at `awaiting_owner_integration_review` with candidate/preview unapproved and the apply plan blocked. Neither agent ran tests (shell tools disabled); `git diff` of base→candidate was independently confirmed as the two-line README append.

Integration [Z]: after a plain-language summary, the owner approved in chat. Claude Code auto-mode refused the first agent-issued approve call; the owner then explicitly re-approved. The agent started `pnpm dev` on the retained home and called the owner decision/apply endpoints for preview `ac4816ed…` only, confirming the plan's method/SHAs/checkout. The plan was blocked before approval and unblocked only after it. The apply fast-forwarded the disposable fixture `main` 775d4f8 → cd0b39f with the recorded `merge --ff-only` command; the fixture is clean and a second apply is blocked. A GUI click was offered but not used. The owner's Metatron checkout HEAD/status stayed unchanged throughout; the app was stopped afterwards and the retained database/fixture remain for inspection.

Claude: the owner supplied a `claude setup-token` through the ADR's private 0700/0600 file handoff. The token was read only into the probe's environment, never printed or passed as an argument, and the file/directory were removed afterwards. `mise x -- env XDG_DATA_HOME=/tmp/metatron-m8-auth-sjdG2wvR pnpm smoke:worker-catalog --harness claude-code --model haiku --thinking low --output /tmp/metatron-m8-auth-sjdG2wvR/claude-worker-catalog-20261018.json` passed with zero prompts [X]. Exact-token search over the receipt, the app home and the repo found no matches before deletion.

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
mise x -- env XDG_DATA_HOME=/tmp/lao-m8-writer-next pnpm test:live:writer \
  --model deepseek/deepseek-flash --thinking off \
  --output /tmp/m8-writer-preflight-next.json
```

Without `--allow-live`, model/lifecycle flags do not authorize a prompt or establish entitlement. Discovery can legitimately return login-required or unknown. The original full-catalog receipt came from its recorded throwaway command; the current runner receipts above name the exact repeat commands used here.

## Blockers and exact continuation

No item below blocks M8 item 8; they are recorded limitations and rules for any future native run.

1. **All allowances exhausted.** Codex's three-turn lifecycle, Pi's two-turn reader/cancellation [U] and Pi's two-turn writer/reviewer [Y] consumed their scopes; the integration [Z] used no model turn. Any further model-bearing check needs fresh scoped approval; do not reuse allowances, switch billing routes or replay retained work.
2. **Auth routes.** Pi's app-owned login reports `pi auth check --provider openai --json --no-refresh` → ready/OAuth; do not repeat the wrong `openai-codex` query. Claude's setup-token handoff was one-off and the file is deleted; a future Claude run needs a new private handoff per the [ADR](adr/2026-10-17-claude-setup-token.md). Never paste tokens into chat/arguments, reuse the owner's personal Claude login, or infer future entitlement/quota.
3. **Codex app-owned login.** Completed in `/tmp/metatron-m8-auth-sjdG2wvR/local-agent-orchestrator/codex` [G]; retained, not assumed durable across reboot. Never inspect/copy personal credentials or authenticate discarded preflight paths.
4. **Worker role boundary: catalog-plus-server evidence only.** All four native clients fetched exactly the five worker tools and made no tool call; the same binding gets `POLICY_DENIED` for all 12 Lead-only tools with no state created [X]. The denials are probe-originated, not a native-client Lead-tool invocation; do not relabel them. Observing a client's local refusal of a model-requested unlisted tool would need a separately authorized model turn. `--verify-gateway-denial` remains cross-assignment `INVALID_INPUT`.
5. **One-writer lifecycle: Pi only.** [Y][Z] prove the gate for one writer into a disposable fixture, not a managed user repository and not Claude/OpenCode writers. The approval was given in chat and issued by the agent, not a GUI click. Integration still requires a separate explicit owner approval bound to a reviewed preview; neither model spending, the disposable Write gate nor a native permission callback is integration approval.

**M8 item 8 is checked; next is M9.** Resume with `mise current` and the first M9 item. Auth/rate-limit/credit-exhaustion induction and broad recovery/descendant hardening were not exercised here; beta completion is not claimed.

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

## Held-writer preparation verification

- `mise x -- pnpm typecheck`, `mise x -- pnpm lint`, `mise x -- pnpm test` **455/455**, `mise x -- pnpm test:fixtures` **3/3**, `mise x -- pnpm build`, `mise x -- pnpm smoke`: PASS; actual development/production startup observed.
- New CLI paths were exercised through actual engine/Git/gateway/review/preview with inert Pi RPC, plus retained-app read-only HTTP inspection and actual native zero-turn discovery. No permanent test was added for script wiring; existing state/Git/integration guard suites remain unchanged and passing.
- No adapter authority, provider authentication, dependency, toolchain, spec or ADR change; no native model turn, native Write approval, integration approval/apply or milestone check-off. M8 item 8 remains blocked and M9 untouched.
