# Local Agent Orchestrator

This is the working repo for a **single-user, local-first multi-agent coding-harness orchestrator** targeting Arch Linux / Omarchy. Design docs and implementation live here side by side.

The application coordinates native **Codex, Claude Code, OpenCode and Pi** sessions. M3 added native Pi workers in isolated Git worktrees; M4 added a native Codex Lead using a session-scoped gateway. M8 items 1–2 add the official Claude Code Agent SDK and OpenCode v2 worker adapters; item 5 ran all four as live read-only workers. Item 6 verified the current Codex Lead and tested worker fallbacks for the three adapters without coordinator support—not four native Leads. Item 7 fixed credential-environment exposure and verified bounded config/session isolation. Tasks, reports, approvals and events are persisted. The full four-harness smoke matrix and the beta remain incomplete.

## Run the app

Prerequisites: Git and mise with the existing `.mise.toml` pins installed (Node **26.7.0**, pnpm **11.22.0**). Use mise for every Node/pnpm command. The pinned Node release currently reports `lts: false`; it is retained as required by `AGENTS.md`. No global packages or harness configuration changes are needed.

```sh
mise current
mise x -- pnpm install --frozen-lockfile --store-dir /tmp/lao-pnpm-store --cache-dir /tmp/lao-pnpm-cache
mise x -- pnpm dev
```

Open **http://127.0.0.1:4317**. One Node process serves the health API and the React GUI through Vite middleware. Frontend edits reload through Vite; restart the command after backend edits. Stop with Ctrl-C. The install command above is the one verified in the restricted development environment; a fresh unrestricted checkout can also use `mise x -- pnpm install --frozen-lockfile` with pnpm's normal user cache/store. No global configuration is changed by either command.

For the built GUI:

```sh
mise x -- pnpm build
mise x -- pnpm start
```

`GET /api/health` returns:

```json
{"status":"ok","app":"Local Agent Orchestrator","milestone":"M4"}
```

## Checks and current coverage

```sh
mise x -- pnpm typecheck
mise x -- pnpm test
mise x -- pnpm lint
mise x -- pnpm build
mise x -- pnpm smoke
```

`smoke` starts and closes real development and production servers on temporary loopback ports, checking health, HTML, and every script entry. Run `build` first. `test:fixtures` runs only the disposable Git fixture checks. `format` applies Biome formatting and safe lint fixes to project code/configuration.

All default checks use temporary databases and no model tokens. Tests cover task/process transition matrices, atomic rollback (including process exit before commit), idempotency across reopen, causal event ordering, SSE reconnect/live delivery, session identity, recovery decisions, and API validation/token protection. FakeAdapter tests exercise permission waits, steering, cancellation, completion, quota failure, crashes, disconnects, and explicit resume. M2 tests also cover Git safety, queue reservations and launch caps, active Lead accounting, cross-run reader caps, simulated writer locks, mode/role denials, owner pins, pause/cancel, reports, and the complete HTTP loop. Native harness turns are excluded from default checks. M3's explicit live Pi reader/writer smoke passed; cancellation, auth/quota and ambiguous-exit failure paths also have token-free protocol fixtures. Installed-version findings remain in [adapter reconnaissance](docs/adapter-recon.md).

Git fixture tests retain their M0 safety checks: each fixture is created under the OS temporary directory with a local commit and isolated Git configuration; cleanup happens only after verification and ownership checks succeed. Failed fixtures are retained. No important repository is used as a fixture.

## Role templates

Expand **Role templates** to create, edit or delete reusable instructions and an expected output shape. Harness, model, reasoning and permission settings belong to AgentProfiles. Choose custom roles in **Agent profiles** after reloading profiles and roles. Editing a built-in role affects future fake, Pi, Claude Code, OpenCode and Codex Lead runs; saved runs keep their original snapshots.

**Export role** downloads one versioned JSON document. Import that file or paste its JSON under **Import role JSON**, then choose **Import as new role**. Imports always create a new identity, even when the name already exists; they never replace saved guidance or configure a harness. Format version 1 contains only `format`, `formatVersion` and `role: {name, instructions, expectedOutput}`. Files are limited to 128 KiB; names to 160 characters, instructions to 12,000 and output guidance to 8,000. All fields are required.

Stale saves/deletes are refused; use **Reload roles** before editing again. A role referenced by a saved profile cannot be deleted. Role mutations use the local API token, idempotency journal and app-owned SQLite database, with no managed repository writes. The automated restart/round-trip demo is `mise x -- node --test tests/roles.test.ts tests/roles-api.test.ts`; [desktop](docs/evidence/m7-roles-desktop.png) and [mobile](docs/evidence/m7-roles-mobile.png) screenshots show the editor and deletion refusal.

## Harness setup

**Harness setup** (near the top of the page) → **Check harnesses** shows each of Codex, Claude Code, OpenCode and Pi as **Missing**, **Installed · not ready**, **Login required** or **Available** (or **Discovery failed**), with the version the harness itself reports, the number of listed models and a **Next step** to fix it, e.g. the exact `CODEX_HOME=… codex login` command for the app-owned Codex home, the Claude route to supply, or the provider keys forwarded to OpenCode. The check uses the same no-model discovery as profiles: it starts each installed harness with app-owned configuration, sends no prompt, and never reads or copies personal logins. **Available** means discovery passed; with unverified login, provider access is proven only by a native turn. Executables are found only through absolute `PATH` entries of the shell that started the app (restart it after installing a harness); a relative entry such as `.` is ignored because harnesses run inside worktrees. [Native receipt](docs/evidence/m8-harness-availability.json), [desktop](docs/evidence/m8-harness-availability-desktop.png), [missing/login-required](docs/evidence/m8-harness-availability-restricted-desktop.png), [mobile](docs/evidence/m8-harness-availability-restricted-mobile.png).

## Agent profiles

Expand **Agent profiles**, choose **New profile**, enter a name and saved role, then **Discover profile settings**. Select a discovered model, optional reasoning setting, supported permission and optional additional instructions, then **Create profile**. Discovery starts app-owned catalog processes without a model turn; saving checks discovery again on the server. No workers are dispatched. A null reasoning setting uses the harness default. Profiles are reusable configuration, not ongoing conversations. Names are limited to 160 characters and additional instructions to 4,000.

Pi, Claude Code and OpenCode permit `read_only` and `workspace_write` file-tool workers; a catalog does not prove provider entitlement. Claude accepts owner-supplied setup-token or API/provider authentication, subject to applicable vendor policy (see below). OpenCode uses an app-owned authenticated loopback server and private configuration, not the personal service. Codex permits `coordinator` (the Lead) and `read_only` workers, both in its read-only sandbox without network, and requires app-owned login; Codex writers are not implemented. Unsupported models, reasoning or permission choices are refused; unknown authentication does not become an entitlement claim. These controls are not an OS sandbox. Built-in FAKE profiles remain fixed, labeled playback.

Select a saved native profile to edit/delete it. Stale versions are refused; **Reload profiles and roles** before trying again. Referenced team/workflow profiles cannot be deleted, and role references are kept consistent. Existing run snapshots retain their original settings even after library edits/deletes. A profile in a saved team cannot switch between the coordinator (Lead) and worker permission classes until the team is edited. Add profiles to runs through **Team presets**; the older native run forms still use their explicit settings. Minimal protocol-only demo: `mise x -- node --test tests/profiles.test.ts tests/profiles-api.test.ts`. [Desktop](docs/evidence/m7-profiles-desktop.png) and [mobile](docs/evidence/m7-profiles-mobile.png) captures use protocol fixtures with no provider calls.

## Claude Code workers — M8 item 1

The adapter pins official `@anthropic-ai/claude-agent-sdk` **0.3.302** and launches installed **Claude Code 2.1.302**, not a generic Anthropic API client or silently substituted bundled CLI. Its configuration/transcripts stay app-owned; discovered settings, plugins, skills, agents and other MCP servers are disabled. The owner selected privately supplied `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`; existing `ANTHROPIC_API_KEY` and Bedrock/Vertex/Foundry routes remain supported. No personal credential files or ambient sessions are reused. Native provider selection takes precedence over API key, which takes precedence over setup-token; Metatron never removes a key to change billing. Confirmed source metadata reports auth **unknown**, not entitlement. The [CLI supports setup-token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token); the [SDK product restriction](https://code.claude.com/docs/en/agent-sdk/quickstart) still requires resolving applicability/obtaining approval where required. Owner consent is not vendor approval; subscription allowance/extra usage is not promised free. [Authentication decision](docs/adr/2026-10-17-claude-setup-token.md).

Choose `claude-code` in **Agent profiles**, discover its actual models/efforts, then include a saved worker profile in a native team. The owner-directed `POST /api/runs/native` also accepts `harness: "claude-code"` with the same model/thinking/permission checks; its default remains Pi. There is no dedicated Claude run form or Claude Lead executor in this slice.

Workers have Read/Grep/Glob and, for writers, Edit/Write, plus only the five scoped worker gateway methods. No shell, delegation or integration authority. A safe Edit/Write blocks in **Needs You** until **Approve once** or **Deny once** answers its exact live callback. Unsafe paths, secrets, symlinks, replaced checkouts and Lead tools cannot be approved. Other tasks continue. An adapter receipt is **not** proof that a tool ran; inspect the final report/worktree evidence. Generic inbox replies cannot grant native access. Stale callbacks expire on cancellation, session end or restart, and a saved decision never replays a grant. [Authority/recovery decision](docs/adr/2026-10-17-claude-worker-permissions.md).

Native streaming preserves root-session text; completion requires an authoritative successful result **and** a clean owned-process exit. Model must match native discovery and init/stream identity. Requested effort must be proven by native init or native PreToolUse/Stop hook metadata; missing or changed proof cannot authorize tools or report success. The installed headless CLI omits effort from init, so its hook evidence is used. Explicit SDK resume permits only a clean app-owned session in the same run/task/checkout/model/permission; interrupted work never resumes or replays. Engine assignments create fresh worktrees, so cross-assignment resume remains refused and auto continuation uses a checkpoint. Live steering is unsupported. File guards/worktrees are **not OS isolation**.

For the selected route, generate the token privately in your own terminal using `CLAUDE_CONFIG_DIR="$(mktemp -d /tmp/metatron-token-setup.XXXXXX)" mise x -- claude setup-token`. The CLI prints a secret: do not paste it into chat, source, logs or command arguments. In Bash or zsh, use `printf 'Setup-token: '; IFS= read -rs CLAUDE_CODE_OAUTH_TOKEN; printf '\n'; export CLAUDE_CODE_OAUTH_TOKEN` to supply it without putting its value in shell history. Run Metatron/the smoke from that same environment; another terminal cannot update an already-running process. Remove only your disposable token-setup directory afterward. No separate API billing is required by Metatron's selected policy. This validation used an explicitly owner-created private temporary handoff file, loaded only into the child environment and removed afterward; Metatron adds no credential-file loader or login UI.

```sh
# Installed CLI/SDK control/catalog/auth probe; zero model prompts.
mise x -- pnpm test:live:claude --output /tmp/claude-probe.json

# Only with permitted, privately supplied authentication and explicit quota/cost authorization.
# Use a model/effort returned by fresh discovery; sonnet/low were observed.
mise x -- pnpm test:live:claude --allow-live \
  --model sonnet --thinking low --output /tmp/m8-claude-live-evidence-new.json
```

Both modes create a marked disposable Git fixture and app configuration, refuse existing evidence outputs, and verify fixture HEAD/README plus checked personal-config metadata before cleanup. CLI version uses the actual worker executable/environment, not an ambient `claude`. Without a configured route, opt-in live execution exits **2**, records **BLOCKED** and submits zero prompts. The five-turn smoke exercises streaming read, same-checkout resume, denial/cancel, an approved `approved.txt` write followed by a separately denied `denied.txt` write, and active-generation cancellation before any native result. It checks stale-grant and interrupted-resume refusal, authoritative completion/owned exit, native init/stream model and native-hook effort. Only the approved disposable file may change. Failed native work retains bounded selected metadata/events and fixture paths at the requested evidence output, never raw SDK errors or credentials; nothing is automatically replayed. Durable approval receipts retain their engine/HTTP fixture coverage; this direct adapter smoke does not claim native GUI/gateway or four-harness integration coverage.

**Native PASS:** [real owner-token discovery](docs/evidence/m8-claude-owner-token-probe.json) and [five-turn live receipt](docs/evidence/m8-claude-native-live.json), Claude Code **2.1.302** / Agent SDK **0.3.302**, Sonnet **5.5** with `low` effort. Read/resume and the approved writer completed with authoritative success and clean exits; the second write was denied; active generation ended interrupted with owned exit **143**, not success. Discovery intentionally still reports auth **unknown**; a successful turn proves access at that time, not future quota or vendor-policy approval. The earlier inert probes and scripted Chromium [approval receipt](docs/evidence/m8-claude-approve-once.png)/[runtime](docs/evidence/m8-claude-ui.json) remain separately labeled. See [native outcomes, initial failures and limitations](docs/adapter-recon.md#m8-item-1--native-claude-validation-completed-2026-10-17). M8 item 1 is complete.

## OpenCode workers — M8 item 2

The adapter pins official **`@opencode/client@2.0.29`**, matching installed **OpenCode v2.0.29**. Each owned foreground server binds `127.0.0.1` on an ephemeral port and supplies a private random Basic password, never exposed to the browser. HOME/XDG/configuration/session state stays app-owned; project customization, automatic instructions, Code Mode and browser tools are disabled. The process must finish applying its native plugins/worker policy before any prompt. No personal service/session is attached or stopped.

File operations are bound to their actual native tool source and checked against the original checkout and sensitive-path policy. Mutations require **Approve once**; **Deny and stop** rejects all pending requests in that native session. Durable decisions/receipts survive restart, but ended callbacks cannot be granted again. Completion needs native success, effective model/variant evidence, an empty inbox, idle session and observed owned shutdown; normal OpenCode shutdown reports **130**, not task failure. Resume is explicit, clean and same-checkout only; assignments in new worktrees use fresh context/checkpoints. Disconnects and ambiguous work never automatically replay.

```sh
# Actual private worker configuration/catalog/control probe; zero model prompts.
mise x -- pnpm test:live:opencode --output /tmp/opencode-probe-new.json

# Only with the selected provider route and explicit usage/cost authorization.
# Choose the model and native variant from fresh discovery.
mise x -- pnpm test:live:opencode --allow-live \
  --model deepseek/deepseek-flash --thinking low \
  --output /tmp/opencode-live-new.json
```

Both modes own disposable Git/app state and refuse existing output files; failures retain state for inspection. Native **PASS**: [five-prompt receipt](docs/evidence/m8-opencode-native-live.json), [no-model discovery](docs/evidence/m8-opencode-discovery.json). Read/resume, one-shot approval, independent denial/stale-grant refusal and active cancellation passed with native `deepseek-flash` / `low` evidence. Provider access is still discovered as **unknown**; variants are native model settings, not a universal reasoning scale. No usage/balance accounting or live steering is claimed. [Browser receipt checks](docs/evidence/m8-opencode-ui-fixture.json) used inert HTTP/SSE fixtures, not live model evidence. Item 5 verified its native worker gateway; item 6 records its unsupported Lead role and tested fallback below. The broader smoke matrix remains incomplete. [Recon and limitations](docs/adapter-recon.md#m8-item-2--native-opencode-validation-2026-10-17).

## Read-only workers on all four harnesses — M8 item 5

Any of the four harnesses can run an owner-directed or team **Reader**. Codex readers start a fresh thread in Codex's read-only sandbox without network, with the effort requested at thread start; Codex reads through its shell there, so its reads are not confined to the worktree. Every adapter journals `<harness>.settings_verified` before a completed turn: the model and thinking level the harness itself confirmed (Pi `get_state`, Claude init model plus native effort report, OpenCode step model/variant, Codex thread response without a reroute). A mismatch or reroute fails the turn instead.

```sh
# Discovery only, zero prompts. XDG_DATA_HOME goes after `mise x --`, or mise looks for its own installs there.
mise x -- env XDG_DATA_HOME=/tmp/lao-m8-workers pnpm test:live:workers \
  --harness codex --model gpt-6-luna --thinking low --output /tmp/codex-reader-probe.json

# One paid read-only turn; only with explicit cost authorization.
mise x -- env XDG_DATA_HOME=/tmp/lao-m8-workers pnpm test:live:workers --allow-live \
  --harness codex --model gpt-6-luna --thinking low --output /tmp/codex-reader-live.json
```

The script commits a random nonce to a disposable repository and passes only if the worker reports it through `submit_result`, the harness confirms the selected settings, the worktree and owner checkout are unchanged, and checked personal-config metadata is unchanged. Codex needs `CODEX_HOME='/tmp/lao-m8-workers/local-agent-orchestrator/codex' codex login` once; Claude needs `CLAUDE_CODE_OAUTH_TOKEN` (or another admitted route) in the environment. Native **PASS** at the cheapest selections: [Pi](docs/evidence/m8-worker-pi.json) `deepseek-flash`/off, [OpenCode](docs/evidence/m8-worker-opencode.json) free `deepseek-v4.1-flash-free`/low, [Codex](docs/evidence/m8-worker-codex.json) `gpt-6-luna`/low, [Claude](docs/evidence/m8-worker-claude.json) `haiku` (`claude-haiku-5-5`)/low. [Recon and limitations](docs/adapter-recon.md#m8-item-5--four-harness-read-only-workers-2026-10-17).

## Lead support and worker fallback — M8 item 6

Only **Codex** has a coordinator executor in this application. Pi, Claude Code and OpenCode refuse `coordinator` before launching a session; profile discovery does not offer that permission. This is an **application integration limitation**, not evidence that their native MCP/SDK interfaces cannot implement a Lead.

- **Pi:** its current guard and MCP overlay implement file-worker/report tools only; coordinator sessions and session resume are refused.
- **Claude Code:** its exact file-tool and five-method worker gateway allowlists do not admit coordinator operations. The SDK's MCP support is not the limitation.
- **OpenCode:** its private host agent, native permission rules and gateway permission checks implement worker tools only.

Fallback: save a team with a **Codex coordinator** and one or more of these harnesses as roster workers, or use owner-directed workers without a live Lead. `mise x -- node --test tests/lead-fallback.test.ts` exercises each saved-team fallback through the real engine, gateway and isolated Git worktree: coordinator refusal, one worker launch, one completion wake-up, report consumption and Lead/worker authority separation. All native boundaries in that test use **inert protocol fixtures**, not live models. Separate live worker evidence is linked under item 5; it is not a live cross-harness delegation claim.

```sh
# Four-harness discovery + coordinator refusals; zero model prompts.
mise x -- env XDG_DATA_HOME=/tmp/lao-m8-workers pnpm test:live:leads \
  --model gpt-6-luna --thinking low --output /tmp/lead-support-probe-new.json

# One native Codex Lead turn, only with explicit usage/cost authorization.
# Requires the app-owned Codex login; no workers are launched.
mise x -- env XDG_DATA_HOME=/tmp/lao-m8-workers pnpm test:live:leads --allow-live \
  --model gpt-6-luna --thinking low --output /tmp/lead-codex-live-new.json
```

The opt-in checks a committed random nonce, `get_run_status`, `propose_task`, a deliberately denied assignment to the coordinator itself, native model/effort confirmation and clean completion/exit. It refuses existing evidence outputs, uses a new database and disposable repo, retains failures without replay, and checks owner-checkout/personal-config metadata before cleanup. The default mode proves only discovery/refusals, not model access. Item 7's bounded isolation evidence is below; item 8's full smoke matrix remains incomplete.

Native **PASS** on Codex **0.163.0**, `gpt-6-luna`/low: [one-turn gateway/denial receipt](docs/evidence/m8-lead-codex-native.json). The Lead reported the nonce, used both gateway tools, received `POLICY_DENIED`, launched no worker and exited 0 with unchanged checked metadata. [Four-harness no-model support/refusal receipt](docs/evidence/m8-lead-support-probe.json); [precise support matrix and limitations](docs/adapter-recon.md#m8-item-6--lead-gateway-support-and-tested-fallbacks-2026-10-17). Claude has no supplied authentication in this process; no new Claude/Pi/OpenCode model prompts were sent.

## Harness credential, config and session isolation — M8 item 7

Native process environments are explicit allowlists, not copies of the app's whole environment. Arbitrary secrets, executable preload hooks and personal-session selectors are excluded; config/session paths and gateway tokens are assigned by the adapter.

| Harness | Admitted authentication |
| --- | --- |
| Codex | Native owner login in the app-owned `CODEX_HOME`; no ambient provider API keys or other harness tokens |
| Pi | Reviewed Pi 1.3.0 provider variables in [`environment.ts`](src/server/adapters/environment.ts), or native app-owned Pi authentication; the version subprocess receives no provider credentials |
| Claude Code | Its admitted API key/setup-token; exact cloud variables only with the matching `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` or `CLAUDE_CODE_USE_FOUNDRY` flag set to `1` |
| OpenCode | Existing fixed `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` policy; private HOME/XDG/config/server |

A shared provider API-key environment name can intentionally reach multiple compatible harnesses. A Claude setup-token reaches only Claude. Unknown custom Pi credential-variable names are no longer inherited implicitly: use Pi's supported authentication in its app-owned config, or explicitly review/add that provider variable. Native cloud routes may use their supported cloud credential chains; Metatron does not extract/copy personal harness logins or change route precedence to alter billing. Completed Claude disposal also cannot remove a newer resume session's lease.

```sh
# Actual installed binaries, inert credentials, private app data; no model prompt.
mise x -- pnpm smoke:isolation --output /tmp/m8-isolation-new.json
```

The smoke refuses existing output files. It creates disposable seeded personal homes, a separate process/service canary and two real app lifecycles, strips real provider credentials, and verifies actual child environments, app-file token canaries and owned exits. [Native receipt](docs/evidence/m8-isolation-native.json): no copied canaries, no seeded or watched real-config metadata changes, no canary service contact, all 10 pre-existing harness process identities preserved; zero prompts. Real credential/config/transcript contents were not read by the metadata checks. Native catalog availability with inert keys is **not authenticated model access**.

Nine new failing-before/passing-after regressions cover inheritance/preload, cloud credential routing and the Claude successor-lease race. [Decision and exact limits](docs/adr/2026-10-17-harness-environment-isolation.md); [audit evidence](docs/adapter-recon.md#m8-item-7--config-session-and-credential-isolation-2026-10-17). This is bounded source/native observation, not syscall tracing or an OS sandbox. The earlier personal Pi writes remain unattributed. Descendant cleanup, live cloud entitlement and the full smoke matrix are not claimed.

## Team presets

Expand **Team presets**, choose **New team**, then pick a coordinator Lead profile, one or more worker profiles, available workflows (workflow authoring is currently backend-only), a default mode and resource limits, and choose **Create team**. Saving dispatches nothing. Stale saves/deletes are refused; **Reload teams and profiles** before editing again. The seeded **Fake demo team** is fixed playback configuration.

A team is either all FAKE demo profiles (scripted playback, no model tokens) or all native profiles; the two never mix. Native teams currently need a Codex Lead plus Pi, Claude Code, OpenCode and/or read-only Codex workers. A worker can never be a coordinator. Selected workflows may only use the team's profiles. The item 6 saved-team fallbacks above passed with inert native-boundary fixtures; direct live adapter/worker evidence is separate, not proof of live cross-harness team delegation.

Under **Projects and new runs**, open **Start a run from a saved team**, choose a team, enter a title and objective, then **Start team run**. The server refuses the start if the team changed after you reviewed that version. Native starts check Codex login and fresh discovery for each selected worker harness; live runs use your providers and may cost money. The run copies the team version, its Lead/worker profiles, their roles, its workflows, mode and limits into its own snapshot. Later edits or deletion of the team, profiles, roles or workflows do not change it; the run header shows the snapshot name and version. Minimal protocol-only demo: `mise x -- node --test tests/teams.test.ts tests/teams-api.test.ts`.

## Static workflow engine

M7 provides backend template authoring (no authoring UI), owner and Lead invocation, and a grouped workflow view. `createWorkflowTemplate(store, content, key)` saves a validated v1 recipe; `engine.workflows.start({runId, templateId, parameters}, key)` (owner `POST /api/workflows`, Lead `run_workflow`) instantiates only a workflow already allowed in the run's immutable team snapshot. No arbitrary runtime graphs, nested calls or loops. Saved presets include `Explore Subsystem` and `Review Implementation`.

Recipes declare named runtime `inputs`, named `results: [{name, stageId}]`, and topologically ordered stages. Each stage declares `id`, `type` (`single_agent`, `parallel_agents`, `synthesize`, `review`), a roster worker's `profileId`, `instructions`, `inputs: [{name, source: "parameter" | "stage", ref}]`, expected `result` guidance, `dependsOn`, `count`, `partitions` and `partialFailure`. Parallel stages require one independent partition per child; other stages have count 1 and no partitions. Stage inputs can reference declared parameters or direct upstream dependencies. Synthesis must consume an upstream result. A review stage requires a read-only profile and exactly one parameter binding named `candidate_id`; it cannot consume implementation reports. Runtime parameter names must match exactly.

Each child is a durable ordinary task dispatched through the existing scheduler and executor. A stage succeeds on authoritative attempt completion plus a saved report, **not** source integration: child tasks retain `AWAITING_REVIEW`. Workflow report prerequisites are separate from ordinary task dependencies, which still require `DONE`. A consumer's `partialFailure: "stop"` requires successful upstream stages; `"include_partial"` accepts settled failed/cancelled children with explicit failure references and no fabricated report. Ambiguous disconnect/recovery blocks downstream execution and never automatically retries a child. Pause and Chat/Plan prevent new dispatch.
Owner reassignment of a prepared, queued child still uses the normal roster, pin and budget checks; neither an owner assignment nor a tool call can dispatch an unprepared downstream stage.

Bounds: 64 children per parallel stage, at most 128 children per recipe, and the run's `maxParallelReadersPerWorkflow` fan-out limit. Parameter values total at most 4,000 characters; each instruction/result/partition is at most 4,000. Handoffs retain task/artifact references and at most 2,000 characters per source excerpt inside the 32,768-character context limit; originals remain separate. Missing/unreadable source reports block the consumer. SQLite migration v8 adds durable workflow executions; stage inputs and child dispatches commit atomically. Replaying a start or reopening the app never duplicates completed attempts.

Regression demo: `mise x -- node --test tests/workflows.test.ts`. The initial disposable runtime smoke exercised single → parallel → synthesis under a one-reader cap with four completed FAKE attempts and an unchanged owner checkout: [observed output](docs/evidence/m7-workflows-smoke.json). The [M7 workflow smoke gate](#workflow-smoke-gate) below also records actual read-only Pi execution.

### Reader evidence and synthesis provenance

`engine.workflows.evidence(workflowId)` is the read-only backend view of every child, its attempt history, original artifact metadata, submitted result events and failure/recovery diagnostics. `taskArtifacts` retains task-owned artifacts such as integration diffs/test logs without falsely assigning them to a worker attempt. Full report contents remain available through the existing report service/API; bounded synthesis excerpts never replace originals.

SQLite migration v10 adds immutable `workflow_handoffs` records keyed by prepared child task. Each records the stage's parameter bindings and exact upstream task, attempt, report artifact, result-event and failure-event references. Failed/cancelled sources retain an explicit failure kind and diagnostic with a null successful-report artifact. A provisional model-submitted partial report remains in the journal even if its attempt fails; its claims do not turn failure or ambiguous execution into success.

Source bindings commit in the same transaction as prepared inputs and child dispatches. Source changes during report reads invalidate preparation; rollback leaves no orphan bindings. Held children retain prepared inputs but still need explicit owner continuation; budget-held synthesis can have source bindings without an attempt. Records describe prepared provenance, not proof that a model inspected each source.

Earlier v9 prepared/completed children return `handoff: null`: the upgrade preserves their reports, attempts and dispatch identities without inventing historical bindings or rerunning work. Newly prepared stages record bindings normally. No grouped workflow UI or owner/Lead invocation surface is added by this persistence slice.

Checks: `mise x -- node --test tests/workflow-evidence.test.ts tests/workflow-artifacts.test.ts tests/workflow-lifecycle.test.ts`. [Disposable FAKE app evidence](docs/evidence/m7-workflow-evidence-smoke.json) covers successful/partial synthesis, ambiguity, budget holds, original-report hashes, task-owned artifacts and restart without replay. Live native-harness workflow verification remains a later M7 gate.

### Child scheduling and launch budgets

Workflow cards have no special quota: each child acquires the ordinary global reader/writer and total-agent slots, including contention with other runs and active Lead turns. Idle sessions consume no slot. Concurrency pressure leaves funded children queued with their FIFO identity intact; each spawned worker attempt, including synthesis, failures and retries, counts against the run's launch budget.

An eligible stage records every child's prepared inputs and dispatch intent atomically. When its remaining launch budget cannot fund every child, affordable children proceed and the rest retain `QUEUED` task status with a `blocked` dispatch, `blockedReason: "launch_budget"`, no attempt ID and an actionable warning on the task card. These unfunded intents do not count as committed launches or active agents. Ordinary over-budget task assignments still return `BUDGET_EXCEEDED`.

Cancelling an **unstarted, funded** assignment frees its commitment. Eligible budget-held children can then enter the normal queue in priority/FIFO order, retaining owner reassignment and queue generation. Admission rechecks active run, mode, human blockers and stage preparation; it never launches by itself. A slot release or cancellation after an attempt spawned does **not** refund that launch. Human waits require explicit owner continuation, and repository/recovery blocks are never automatically re-admitted.

A workflow can exhaust its budget before synthesis. Its unlaunched child stays visible and the workflow is blocked rather than reporting invented partial evidence. Once the budget is spent, start a new run with sufficient limits; the engine never raises caps or reruns ambiguous work. SQLite migration v9 preserves budget holds across restart and permits their block reason only on never-launched dispatches. [Decision and safety invariants](docs/adr/2026-10-17-workflow-budget-holds.md).

Checks: `mise x -- node --test tests/workflow-scheduling.test.ts tests/workflow-slots.test.ts`. [Runtime evidence](docs/evidence/m7-workflow-budgets-smoke.json) covers shared one-agent contention, hard budget exhaustion, cancellation-funded admission and restart identity; [retained child](docs/evidence/m7-workflow-budgets-child.png) and [reload readback](docs/evidence/m7-workflow-budgets-browser.json) verify the existing task-card warning without additional launches. All demonstrations use labeled FAKE playback, not live harness turns.

### Workflow view

In a selected run, **Workflows** (above the task board) shows each workflow as one expandable item: template name/version, status, agent counts, parameters and its named results, with the result stage's report. Expanding it lists every stage (type, status, dependency and partial-failure policy, diagnostics) and each child agent separately: configured profile, harness, model, thinking and permission (FAKE runs are labelled as playback), session state, failure reason, every attempt with its diagnostics, submitted result summary (model-reported, unverified) and report/log artifacts, its prepared inputs and upstream provenance, and its persisted journal log. Workflow children appear only there, not as separate board cards; **Task controls** opens the normal task card for continue, steer, recovery, review and cancel. Cancelling a child keeps the workflow's attempts, reports and logs. The workflow items are read-only and launch nothing.

Backend reads: `GET /api/workflows?runId=` returns `{workflows: [{workflow, children}]}` from `engine.workflows.evidence`; `GET /api/events?runId=&taskId=&after=&limit=` pages one child's journal. Checks: `mise x -- node --test tests/workflow-view-api.test.ts`. [Desktop](docs/evidence/m7-workflow-view-desktop.png), [mobile](docs/evidence/m7-workflow-view-mobile.png), [failed child](docs/evidence/m7-workflow-view-child.png) and [browser readback](docs/evidence/m7-workflow-view-browser.json) use FAKE playback only.

### Running a workflow

**Owner:** in a selected run, **Workflows → Run a saved workflow** lists only templates in that run's team snapshot. Pick one, fill each declared input, then choose **Start workflow** (`POST /api/workflows` with `{runId, templateId, parameters}`). The server revalidates the snapshot, stage roster and fan-out bound. Parameters must name exactly the declared inputs; each is non-empty text, and the values total at most 4,000 characters. Paused runs and Chat/Plan are refused. The owner may start a workflow whose children exceed the remaining launch budget; those children stay visibly held (see budgets below).

**Lead:** `get_run_status` lists `workflows.available` (template ID, version, declared inputs, stage shape, agent count) and `workflows.runs`. The `run_workflow` tool (`lao-tools/5`) accepts only `{templateId, parameters}`, so a Lead cannot supply or change a graph, profile, partition or agent count. Autonomous mode starts the workflow only when every child launch fits the remaining launch budget; otherwise it returns `BUDGET_EXCEEDED` and creates nothing. Supervised mode validates the call identically, then records a non-blocking **Needs you** request and a `workflow.proposed` event. Nothing runs until the owner starts the workflow; there is no one-click approval yet. Chat/Plan and every worker are denied. `workflow.started` records `invokedBy` (`owner` or `lead`).

Workflow children are not separate Lead wake-ups. Their outcomes are journaled, and a native Lead is woken **once** when the workflow settles (completed, partial or failed). That turn lists the result-stage task IDs for `read_report`. Urgent issues and human requests from a child still wake the Lead immediately. A blocked workflow (recovery, budget hold) waits for the owner and wakes no one.

Checks: `mise x -- node --test tests/workflow-invocation.test.ts` and `mise x -- node --test --test-name-pattern="saved workflow by template" tests/lead.test.ts` (Codex/Pi protocol fixtures; no provider calls). [Form](docs/evidence/m7-workflow-run-form.png), [desktop](docs/evidence/m7-workflow-run-desktop.png), [mobile](docs/evidence/m7-workflow-run-mobile.png) and [browser readback](docs/evidence/m7-workflow-run-browser.json) use FAKE playback only.

### Explore Subsystem

Startup adds one saved **Explore Subsystem · v1** example using the fixed **Fake Reader** and **Fake Synthesizer** profiles. To reuse it, include both profiles and the workflow under a team's **Available workflows**, then save the team. This only configures access; it never starts exploration or changes existing teams/runs. The example executes FAKE playback, not a live harness.

Backend callers can save the same recipe for their own read-only profiles through `createExploreSubsystemTemplate(store, {readerProfileId, synthesizerProfileId, readerCount}, key)` in `src/server/storage/workflows.ts`. `readerCount` is **1–4**, default **4**, chosen when saving the static template. Four readers separately cover entry points/architecture, state/data flow, dependencies, and tests/edge cases; smaller counts group all four areas without dropping coverage. Run fan-out limits still apply. No harness or model is hardcoded into the recipe.

The runtime input is `{target: "path, subsystem or question"}`. Readers return concise findings with file:line evidence, confidence and gaps; one synthesizer receives their bounded reports and task/artifact references, preserves citations, reconciles disagreements and identifies missing evidence. The named `exploration` result points to synthesis. Confirmed reader failures yield an explicit partial workflow result; ambiguous recovery still blocks synthesis. Nothing approves integration or changes the native harness's permission guarantees.

Verification: `mise x -- node --test tests/explore-subsystem.test.ts`. [Initial FAKE evidence](docs/evidence/m7-explore-smoke.json) covers the four-reader success/partial paths and all 1–4 partition layouts; [team selection](docs/evidence/m7-explore-preset.png) and [reload readback](docs/evidence/m7-explore-browser.json) confirm reusable GUI configuration. The [M7 workflow smoke gate](#workflow-smoke-gate) exercises saved-team reuse, fan-out bounds and actual read-only Pi readers/synthesis.

### Review Implementation

Save the single-reviewer recipe through `createReviewImplementationTemplate(store, {reviewerProfileId}, key)` in `src/server/storage/workflows.ts`, using a real read-only worker profile. Include that profile and the saved workflow in a team **before starting its run**. No model/harness is hardcoded, no extra synthesizer or multi-reader variant is added, and the child consumes normal scheduling slots and launch budget.

In **Workflows → Run a saved workflow**, choose **Review Implementation** and supply `{candidate_id: "<captured candidate UUID>"}`. The candidate must be the current captured candidate of an implementation awaiting review **in the same run**. The server rejects paths, raw diffs, unknown/foreign/stale candidates and extra parameters before creating children. The Lead uses the same saved-template validation and existing Supervised approval policy.

The child reuses M5's independent-review path: a fresh session and separate read-only worktree pinned to the immutable candidate commit, the full repository snapshot, original objective/acceptance criteria, changed files and a bounded base-to-candidate diff. Its context excludes the implementer's report. Only a valid structured recommendation with file/line findings, evidence and confidence, followed by clean completion/Git evidence, records a Review. Missing structured output requires a retry decision; changed checkout evidence blocks for explicit recovery. Neither automatically reruns.

The named `review` result points to the review child's report; expand the workflow to inspect its agent, findings, context packet and logs. `completed` means the assessment finished, even when its recommendation is `changes_requested`; it never means human approval or integration. Shell is disabled, so tests remain `not_run`. Existing harness guardrails are not an OS sandbox.

Startup also saves a **Review Implementation · v1** example using **Fake Reviewer**, without changing existing teams/runs or overwriting saved edits. This example is for configuration only: FAKE runs cannot produce Git-backed reviews and invocation returns `UNSUPPORTED`, never simulated approval. Save a native-profile copy through the factory above for execution.

Verification: `mise x -- node --test tests/review-implementation.test.ts`. [Browser smoke evidence](docs/evidence/m7-review-workflow-smoke.json) and [review result](docs/evidence/m7-review-workflow.png) use deterministic Pi protocol subprocesses on a disposable Git fixture, not a native harness or provider. M7 item 11 verified native exploration; a live candidate-review turn remains intentionally omitted (cost).

### Workflow smoke gate

`scripts/smoke-workflow.ts` exercises the saved **Explore Subsystem** recipe without accepting an existing repository or database. It creates a marked disposable inventory repository and a private loopback app/database, refuses an existing evidence output, and cleans up only after every safety check passes. Failures retain the database and checkout for inspection, never automatically rerun a model turn, and leave this gate incomplete.

```sh
# No native harness/provider: saved team reused for complete and failed-reader runs.
mise x -- pnpm smoke:workflow --fake \
  --output /tmp/m7-workflow-fake-evidence.json

# Explicit provider cost: installed Pi; no model Lead; hard limit of 3 worker launches.
mise x -- pnpm smoke:workflow --allow-live \
  --model deepseek/deepseek-flash --thinking off \
  --output /tmp/m7-workflow-pi-evidence.json
```

Choose a model/thinking setting returned by fresh Pi discovery; catalog presence is not authentication or entitlement. The sample selection above is environment-specific, never a fallback. Pi uses app-owned settings/session directories and supported inherited provider authentication; this script never extracts/copies credentials or edits personal configuration.

Both modes declare three readers, observe one active/two queued under a one-agent cap, reject a saved four-reader recipe against the fan-out limit of three, and preserve the original reports plus explicit missing-reader provenance before synthesis. FAKE mode injects one deterministic reader failure in its second run. Live mode starts an owner-directed native snapshot (not a live Codex Lead/team-start test), cancels one **queued, unlaunched** reader and runs two real Pi readers plus synthesis. The cancelled reader has no native session/report; this is not evidence of a native crash. Restart rechecks workflow outcomes, original report hashes and idempotent starts without launching anything. The exported evidence retains original report text, session IDs, source references, fixture source and observed usage samples; usage is not account balance or complete billing.

Observed M7 gate: [FAKE complete + failed-reader runs](docs/evidence/m7-workflow-fake-smoke.json) reused one saved team/template in two runs; [Pi 1.3.0 live partial run](docs/evidence/m7-workflow-pi-smoke.json) used `deepseek/deepseek-flash`, thinking `off`, with three real read-only sessions, clean Git evidence and explicit cancelled-reader provenance in the grounded synthesis. All passed restart/idempotency, report-hash retention, unchanged owner checkout and checked personal-config metadata. The synthesizer corrected an overlong tool submission within its existing turn; no new attempt or relaxed context bound was needed. No new browser check, live candidate review, native crash or four-harness matrix is claimed; M8 and beta remain incomplete.

## M2 fake orchestration demonstration

Stop any app using this database before seeding, then run from the repo:

```sh
mise x -- env XDG_DATA_HOME=/tmp/lao-m2-demo pnpm demo:m2
mise x -- env XDG_DATA_HOME=/tmp/lao-m2-demo pnpm dev
```

Open **http://127.0.0.1:4317**. The seed command initializes a disposable Git fixture and prints its path. It exercises the actual fake orchestration engine: an owner message prompts a saved fake Lead, the Lead proposes and assigns a scoped task, a fake worker returns a file-backed report, and a second worker deliberately fails. The selected run shows **AWAITING_REVIEW** and **RETRY_DECISION**, saved sessions, Lead conversation, budget usage, and ordered events. Choose **View report** on the successful task. The report explicitly identifies scripted playback; no repository files were read or edited by a worker and no native model was called.

Repeat the seed command to browse its existing run; an existing or partially seeded run is never replayed. Restart the server with the same data directory to verify preserved tasks, reports and session IDs. Use a new temporary data directory for a separate demonstration. Set `XDG_DATA_HOME` **inside** `mise x -- env`, as shown, so mise's own tool lookup directory stays unchanged. Keep the printed disposable fixture while browsing its project. `demo:fake` remains the legacy M1 persistence seed.

The M2 browser gate **passed** through connected Playwright MCP: success/report, failure requiring a retry decision, reload/replay, supervised approval, priority/worker selection, pause/resume, owner task cancellation, Chat/Plan without worker launches, and dirty-checkout refusal. See the [browser evidence](docs/evidence/m2-browser-success-failure.png) and [progress](docs/progress.md). Server restart persistence is covered by automated integration tests; the owner's running server was left running. The following procedure remains available for manual verification:

1. In the saved run, inspect **Lead conversation**, **View report**, **Session event detail**, and the event journal. Review is distinct from integration or Done.
2. Send an owner message with worker simulation **Success**, then **Failure**, and observe new tasks/results without reloading.
3. Start a new **Supervised** run: its proposed task remains Backlog until **Assign / approve**. Choose a worker and simulation outcome on its card.
4. Start a **Chat/Plan** run: the fake Lead replies without proposing or dispatching a worker; the assignment button remains disabled. Backend tests also reject direct dispatch requests in this mode.
5. Add an owner task, set/save priority, and assign it. Pause scheduling immediately to hold queued work; resume to continue. Cancel a queued or running fake task and inspect its preserved history.
6. Use **Check repository** on the printed fixture. A dirty tracked, staged or untracked file must prevent opening/starting work; commit or clean changes manually. The app never resets/stashes them. Do not use this repo's dirty development checkout as a demo fixture.
7. Stop/restart the server and verify the same tasks, reports and events remain. Failed/disconnected work is never automatically retried; M6 will add recovery controls.

## M3 native Pi demonstration

The live reader and writer used **Pi 1.3.0**, discovered model `deepseek/deepseek-flash`, and discovered thinking level `off`. The reader read README.md; the writer appended one line in its own worktree. Both exited cleanly and stopped at AWAITING_REVIEW. The owner checkout and checked personal configuration metadata stayed unchanged. See [live evidence](docs/evidence/m3-live-summary.json), [GUI screenshot](docs/evidence/m3-native-writer.png), and [policy ADR](docs/adr/2026-10-15-pi-worker-policy.md).

To inspect the retained demonstration without calling a model:

```sh
mise x -- env XDG_DATA_HOME=/tmp/lao-m3-live-data pnpm dev
```

Open **http://127.0.0.1:4317**, select **M3 live Pi workspace_write**, then **View report**, **Worktree and Git evidence**, and **Session event detail**. The retained temporary fixture is `/tmp/lao-git-fixture-Ggrjs9/repo with spaces`; it must remain available. Stop the existing app on that port before starting another. This data is temporary and may be removed by the OS.

For a new deliberately cost-bearing reader/writer smoke, stop the server using the same database, create a marked disposable fixture, and pass its printed path explicitly:

```sh
mise x -- pnpm test:live --create-fixture
mise x -- env XDG_DATA_HOME=/tmp/lao-m3-new-demo pnpm test:live \
  --allow-live --fixture '/tmp/lao-git-fixture-REPLACE/repo with spaces' \
  --model deepseek/deepseek-flash --thinking off
```

Replace the fixture path and choose a model/thinking level actually returned by **Discover Pi models**. Catalog availability is not proof of authentication or provider entitlement. Pi uses inherited provider environment credentials or its supported login in the app-owned configuration directory; personal native credentials/configuration are never copied. If authentication is missing, use Pi's supported login with `PI_CODING_AGENT_DIR` set to the app data directory's `pi/` subdirectory, then retry only after inspecting the retained failed attempt. Do not paste keys into this GUI.

For normal GUI use, open a clean project, expand **Run a real Pi worker**, discover models, select permissions/model/thinking, and enter an objective. **Start real Pi worker** explicitly launches one owner-directed worker in Supervised mode. Subsequent owner-created tasks can be assigned from the same saved roster. M3 has no native Lead session.

Readers have read/grep/find/ls; writers additionally have edit/write. Shell, MCP, discovered extensions and personal context files are disabled. The app's explicit Pi extension rejects paths outside the worktree, sensitive paths and unsafe symlink/recursive searches. Tests in the managed project are explicitly **not run**; engine `git diff --check` is recorded separately. Sessions and bounded redacted wire headers live under app data's `pi-sessions/<attempt-id>/`. Settings/auth live under app data's `pi/`. Owner steer/follow-up messages queue at Pi's native input boundaries (queued is not delivered). Resume and native interactive per-call permission prompts are not exposed by this adapter; the GUI disables them with the reason. Unknown exits require an owner retry decision. Retained worktrees are never cleaned automatically.

## M4 Codex Lead demonstration

A Codex Lead coordinates Pi workers only through a session-scoped MCP gateway (`POST /mcp` on the loopback app server). Each Lead turn and worker session gets its own bearer token, held only in memory and revoked when the session ends. Tools are filtered per role and mode, and every call is re-authorized server-side. Lead tools: `get_run_status`, `list_tasks`, `get_task`, `get_worker_status`, `read_report`, `propose_task`, `assign_task`, `request_revision`, `escalate_issue`, `request_human_input`. Worker tools: `read_assignment`, `report_progress`, `submit_result`, `report_issue`. Policy is in the [ADR](docs/adr/2026-10-15-lead-gateway.md).

Codex runs `codex app-server` over stdio with an app-owned `CODEX_HOME` (`<app data>/codex`). It never uses `~/.codex`. Log in once with Codex's own flow, using the path the GUI or `pnpm test:live:lead` prints:

```sh
CODEX_HOME='<app data>/local-agent-orchestrator/codex' codex login
```

The Lead's sandbox is read-only and has no network. Approvals are never granted, and native sub-agents, apps, plugins, hooks and web search are disabled. The Lead can read (not write) the owner's checkout. A HEAD/status change during a Lead turn pauses the run. Chat/Plan lists no dispatch tools. In Supervised mode, Lead assignments become proposals that need your approval; an owner choice is pinned and visible to the Lead. In Autonomous mode, the Lead dispatches roster workers within the launch, revision and automatic wake-up budgets. Workers finish by submitting a structured report; text-only results are labeled unverified. Worker completion, failure and urgent issues wake the Lead in one serialized turn, which resumes the same Codex thread. Startup reads every page of Codex's feature list and refuses unless each disabled feature is reported disabled. Installed Codex 0.163.0 has a native `turn/steer`, but this app does not use it: owner messages wait for the next Lead turn ([capability recheck](docs/adapter-recon.md#m8-item-3--picodex-capability-revisit-2026-10-17)). Read-only Codex workers (M8 item 5) use the same sandbox and policy checks, and a native model reroute interrupts any Codex turn.

GUI: open a clean project, expand **Run a real Codex Lead with Pi workers**, then discover models and start a run. **Stop Lead turn** interrupts an active turn. Message the Lead to continue.

Deliberately cost-bearing smoke, on a marked disposable fixture (stop any server using the same database first):

```sh
mise x -- pnpm test:live --create-fixture
mise x -- env XDG_DATA_HOME=/tmp/lao-m4-live-data pnpm test:live:lead --allow-live \
  --fixture '/tmp/lao-git-fixture-REPLACE/repo with spaces' \
  --lead-model gpt-6.1-sol --lead-thinking low \
  --worker-model deepseek/deepseek-flash --worker-thinking off --verify-stop
```

Without an app-owned Codex login, the script exits with `BLOCKED` and the login command. The verified live run (Codex `gpt-6.1-sol`/low Lead, Pi `deepseek/deepseek-flash`/off Reader) is in the [evidence summary](docs/evidence/m4-live-summary.json) and [GUI screenshot](docs/evidence/m4-codex-lead.png). To inspect it without model calls: `mise x -- env XDG_DATA_HOME=/tmp/lao-m4-live-data pnpm dev`, then select the second **M4 live Codex Lead autonomous_bounded** run (temporary data; the OS may remove it).

## State, API and safety boundaries

The database is `$XDG_DATA_HOME/local-agent-orchestrator/state.sqlite`, falling back to `~/.local/share/local-agent-orchestrator/state.sqlite`; report files are in its sibling `artifacts/` directory. SQLite migration v3 adds durable worktree ownership manifests; v2 adds durable dispatches/reservations and converts M1's legacy mode names to the spec's `chat_plan` / `supervised` / `autonomous_bounded`. Run/team snapshots and historical events remain durable. WAL, foreign keys and full synchronous transactions are enabled. Run only one app or demo process against a database.

Opening a project validates its absolute canonical root, common Git directory, committed HEAD, branch and clean state. Starting a run captures a fresh base SHA; dispatch checks for dirtiness, identity changes and HEAD drift. Repository probes use argv arrays and read-only Git settings. App metadata must remain outside the managed repository. The scheduler uses priority plus FIFO ties, durable launch counts, global active-slot checks, and atomic simulated writer ownership. Active Lead turns consume total capacity; idle sessions do not. Pausing holds queued work while current fake turns finish. Owner assignments are pinned against Lead changes.

Fake runs execute **only FakeAdapter** and keep simulated reservation paths. Native runs execute installed Pi in unique app-owned worktrees outside the original checkout. No automatic merge, worktree deletion or retry is performed. Worktree creation updates Git's registration metadata and app-owned branch refs; it does not reset, stage, stash or edit the owner's working files. When a writer completes, the engine builds a deterministic candidate commit from a private index: tracked changes plus new files the worker declared in its tool-submitted `changedFiles`. It records the commit on a create-only `lao/candidate-<attempt>` branch and, in the same transaction that completes the attempt, one `integration_candidates` row (base and candidate SHAs, task/attempt link, whether a structured report was submitted). Secret-sensitive, undeclared, ignored-but-declared, symlinked or embedded-repository paths, a moved HEAD or a failed `git diff --check` block the candidate without a commit. The task then waits for an owner decision (RETRY_DECISION) with a "Needs you" review request; see the [candidate ADR](docs/adr/2026-10-16-candidate-capture.md). The owner (task card **Request review**) or the Lead (`request_review`) can then have a read-only profile such as the Reviewer inspect the candidate. The reviewer gets its own worktree at the candidate commit and a context packet with the original objective, criteria and bounded diff, but not the implementer's report; see the [reviewer ADR](docs/adr/2026-10-16-reviewer-snapshot.md). Native file-tool allowlists and a path-policy extension restrict operations; these are not an OS sandbox. Review/integration is M5; interactive recovery is M6; reusable configuration/workflow CRUD is M7.

Read APIs: `/api/projects`, `/api/runs?projectId=...`, `/api/tasks?runId=...`, `/api/attempts`, `/api/sessions`, `/api/presets`, `/api/dispatches`, `/api/reports?taskId=...`, `/api/human-requests`, `/api/events?after=0&limit=100&runId=...&taskId=...`, `/api/workflows?runId=...`, and `/api/events/stream`. SSE supports `Last-Event-ID` or an initial `after` cursor. The GUI retains the latest 200 received events; older history remains queryable.

Additional M3 routes: `GET /api/adapters/pi` discovers installed native capabilities without a model turn; `GET /api/worktrees` reads manifests; `POST /api/runs/native` validates and starts an owner-directed Pi run. M4 adds `GET /api/adapters/codex`, `POST /api/runs/lead`, Lead messages through `POST /api/runs/messages`, and the agent-only `POST /mcp` gateway (bearer token per session; browsers are refused by the same Host/Origin checks). M7 adds `GET/POST/PATCH/DELETE /api/team-presets`, `POST /api/runs/team` (project, team ID and reviewed version, title, objective; `scenario` only for FAKE teams) and `POST /api/workflows` (owner workflow start).

`GET /api/local-session` provides the per-process CSRF token. Writes require `X-Local-Token`, `Idempotency-Key` and JSON. The GUI reuses an unconfirmed request's key when retried. Writes are `POST /api/projects/inspect`, `/api/projects`, `/api/runs`, `/api/runs/messages`, `/api/tasks`, `/api/tasks/assign`, `/api/tasks/cancel`, and `PATCH /api/runs` or `/api/tasks`. Run creation accepts project/title/initialPrompt/leadProfileId/mode/limits/scenario; worker outcomes are explicit `success`, `failure` or `disconnect` simulations. All UI commands use the same engine services as fake Lead/worker tools. Arbitrary task-status mutation is no longer exposed over HTTP.

## Implementation layout and boundaries

- `src/server`: application HTTP listener binds `127.0.0.1:4317`; OpenCode workers additionally own private password-protected ephemeral loopback servers.
- `src/web`: React page and styles; Vite bundles the production assets into `dist/web`.
- `src/shared/domain`: strict Zod schemas/types for all M1 entities, input contracts, and task/session transition tables.
- `src/server/storage`: SQLite migration, transactional services, append-only journal, idempotency, conservative restart recovery.
- `src/server/adapters`: capability/event contracts, FakeAdapter, Pi RPC and Codex app-server transports/normalization, Pi file-tool policy.
- `src/server/orchestration`: owner commands, role/mode tool policy, tool implementations, Lead runs/wake-ups/turns, fake and native execution, candidate reviews, durable reports.
- `src/server/gateway`: session-scoped MCP endpoint for Lead and worker tools.
- `src/server/git`: safe argv Git commands, repository inspection, path checks, durable worktree creation, evidence capture and deterministic candidate commits.
- `src/server/storage/scheduling.ts`: transactional queue, resource reservations and per-worktree writer ownership.
- `src/server/storage/candidates.ts`: one validated integration-candidate record per writer attempt.
- `src/server/storage/integrations.ts`: integration previews (isolated worktree, checks, test results), owner decisions, branch applications and restart interruption.
- `tests`: Node's built-in test runner and disposable Git helper.
- `scripts/smoke.ts`: development/production HTTP launch check.
- `scripts/demo-m2.ts`: opt-in fake orchestration demonstration on a disposable Git fixture.

The server rejects foreign Host/Origin headers and cross-site browser requests, sends no permissive CORS headers, and requires its random per-process token on writes. Worktrees will isolate working copies; they will not provide OS filesystem isolation. Fake playback never implies that a native harness or policy sandbox was exercised.

M5 (review, candidate commits and local integration) is in progress: candidate capture is done ([GUI: blocked](docs/evidence/m5-candidate-blocked.png), [captured](docs/evidence/m5-candidate-captured.png)) and candidates are persisted ([demo](docs/evidence/m5-candidate-record-demo.json)); independent read-only review of the candidate snapshot is available ([demo](docs/evidence/m5-reviewer-demo.json), [GUI](docs/evidence/m5-reviewer-review.png)). Structured findings and pass/changes-requested recommendations are saved in immutable review history after native completion and clean Git checks ([fixture API/restart demo](docs/evidence/m5-review-results-demo.json)). Revision handoff and parent reconciliation are complete ([decision](docs/adr/2026-10-16-revision-lifecycle.md), [fixture API/restart demo](docs/evidence/m5-revision-lifecycle.json)). Use **Revision feedback → Request revision** on a completed implementation: a bounded child continues from the prior candidate, the original task waits in `CHANGES_REQUESTED`, and verified completion returns it to review with its history intact. Review requests select the latest candidate. After a passing review, **Integration preview → Prepare integration preview** builds the candidate in a separate `lao/integration-<id>` worktree at the destination branch's recorded commit and verifies the diff, `git diff --check` and your declared test commands (argv, no shell, run with your user permissions) without changing your checkout or branches ([decision](docs/adr/2026-10-16-integration-preview.md), [GUI demo](docs/evidence/m5-integration-preview.png)). If the destination moved, the preview shows how and merges there instead; conflicting files are listed, left unresolved in that worktree and raised in "Needs you", and files changed on both sides are flagged ([decision](docs/adr/2026-10-16-integration-drift-conflicts.md), [conflict](docs/evidence/m5-integration-conflict.png), [clean merge](docs/evidence/m5-integration-drift-merge.png)). The task card's **Review** panel shows each independent review's findings (severity, file:line, confidence, evidence) and the base..candidate diff; the **Integration** panel shows test output and the final diff. There the owner can **Approve** a passed preview of the current candidate (only while its destination is unchanged), which moves the task to `READY_TO_INTEGRATE` and applies nothing, or **Decline** the candidate, which keeps the task open for a revision ([decision](docs/adr/2026-10-16-integration-approval.md), [GUI](docs/evidence/m5-integration-approval.png), [findings](docs/evidence/m5-review-findings.png)). **Review apply plan** then rechecks Git and shows the exact command: a compare-and-swap `update-ref` if the branch is not checked out, or a fast-forward of your checkout if it is checked out there and clean. Another worktree, a rebase/bisect, a dirty checkout or a moved branch blocks it. **Confirm apply** runs only that confirmed plan and verifies the result (`DONE`); a refused or interrupted apply is reported, moved to `BLOCKED_CONFLICT` and never retried automatically ([decision](docs/adr/2026-10-16-integration-apply.md), [blocked](docs/evidence/m5-integration-apply-blocked.png), [plan](docs/evidence/m5-integration-apply-plan.png), [applied](docs/evidence/m5-integration-apply-done.png)). If the branch moves after approval, prepare and approve a new preview. See [progress](docs/progress.md) for verified commands and [todo.md](todo.md) for milestone gates.

## Files

| File | Purpose |
|---|---|
| `spec.md` | Full agreed beta scope, architecture, data model, execution policies, adapter contracts, Git/review design, UI, safety and acceptance tests. **Main product source of truth.** |
| `todo.md` | Ordered, testable milestones M0-M9 with agent-checkable task boxes and release gates. Each header lists its relevant `spec.md` sections — read only those. |
| `AGENTS.md` | Standing instructions for AI coding agents building this application. Read this first. |
| `README.md` | Verified setup, start, checks, coverage and safety boundaries. |
| `docs/progress.md` | Per-milestone verification evidence and exact next action. |
| `docs/adapter-recon.md` | Installed harness versions, selected native interfaces and unverified capabilities. |
| `docs/adr/` | Runtime/SQLite and OpenCode v2 interface decisions. |

## How to begin (for agents and owner)

1. Read `AGENTS.md`, then the tail of `docs/progress.md` (if present), then the first incomplete milestone in `todo.md`.
2. Load only the `spec.md` sections listed in that milestone's header.
3. Complete **one milestone at a time** in dependency order. Review each milestone's demo before pushing onward.

## Working agreement

- The app is **personal software**, not an open platform or cloud service.
- One project run has one coordinating **Lead/Godhead** agent; workers are named profiles composed of a role + selected native harness + model + supported thinking level.
- Lead is a coordinator, not normally a code author. Human owner can supervise, directly assign work, steer, interrupt and approve integrations.
- Saved team and workflow templates are reusable. A workflow may fan out to multiple readers and synthesize results; individual reader instances still count against budgets.
- Beta's default execution is bounded autonomous scheduling. Chat/Plan and supervised modes are available.
- Git worktrees separate concurrent code changes; only an explicitly approved integration updates the chosen local branch. Worktrees are **not security sandboxes**.
- Authoritative state is kept by the app, not hidden in an LLM conversation; fresh sessions are normal for unrelated tasks.
- Features such as lead-authored dynamic workflows, YOLO scaling, automatic merges and GitHub integrations are intentionally after beta.

## Technology

The app uses Node HTTP + TypeScript, built-in `node:sqlite`, React + Vite, Zod, Biome, Node's test runner and Git CLI worktrees. Native execution uses installed Pi RPC, Codex app-server, the official Claude Agent SDK and the matching OpenCode v2 HTTP client; orchestration tools remain scoped by the loopback MCP gateway. No dependencies were added for M1–M5; M8's two SDK/client dependencies are pinned and justified in progress.

Exact library versions are pinned in `package.json` and `pnpm-lock.yaml`. Harness interfaces were checked against this machine for M0; live capabilities still require explicit opt-in validation. The spec's candidate interfaces are subject to version-specific findings in `docs/adapter-recon.md`.

## Definition of progress

The first truly useful vertical slice is a GUI that shows a Lead assigning work to a real worker in a disposable Git worktree and receiving a durable report. It is more important to reach that milestone safely than to create every screen and abstraction up front.

The project is not ready to use merely because these starter documents exist. Progress is verified through the M0-M9 checklists and the end-to-end scenarios in `spec.md`.
