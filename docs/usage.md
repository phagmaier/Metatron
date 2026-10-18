# Using Local Agent Orchestrator

Start with the [README](../README.md) and [configuration example](configuration-example.md). Screenshots and fixture/live receipts remain linked from the [GUI verification](gui-status-checks.md), [project-switching report](project-switching-verification.md) and [native matrix](adapter-smoke-matrix.md).

## Harness setup

**Harness setup → Check harnesses** runs no-model version/login/catalog checks in app-owned native homes. Cards show **Missing**, **Installed · not ready**, **Login required**, **Available** or **Discovery failed**, with a version and **Next step**. It can start native catalog processes, but sends no model prompt. Model listing and unverified login do not prove entitlement.

Executables must be on absolute `PATH` entries in the shell launching the app; relative entries such as `.` are ignored. Restart after installing a CLI or changing credentials. The CLI versions observed in the M9 startup check were Codex 0.163.0, Claude Code 2.1.302, OpenCode 2.0.32 and Pi 1.3.0. These are observations, not automatic compatibility guarantees. SDK/client versions are pinned in [package.json](../package.json).

| Harness | Authentication and native state |
| --- | --- |
| Codex | Follow the card's exact login command for its app-owned `CODEX_HOME`. An ambient personal login or provider API key is not reused. |
| Claude Code | Supply a supported API key, owner-created `CLAUDE_CODE_OAUTH_TOKEN`, or explicitly selected Bedrock/Vertex/Foundry route to the app process. Cloud route takes precedence over API key, then setup-token. No personal credential files are copied. |
| OpenCode | Uses its own password-protected loopback server and private HOME/XDG/config. The admitted provider variables are `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`. It never attaches to your personal server. |
| Pi | Uses app-owned configuration/authentication and the reviewed provider-variable allowlist in [environment.ts](../src/server/adapters/environment.ts). Custom variable names are not automatically forwarded. Use Pi's supported login in the app-owned `pi/` directory if needed. |

Enter credentials privately in your terminal/native login flow, never in chat, profile instructions, source, logs or command arguments. The app does not supply a credential-file loader or copy personal harness homes. Selected native cloud routes can use their supported credential chains. Shared admitted API-key variables can intentionally reach more than one compatible harness; a Claude setup-token reaches only Claude.

Claude setup-token compatibility is an owner-selected technical route, not vendor approval or a promise of free/subscription-covered SDK usage. The [authentication ADR](adr/2026-10-17-claude-setup-token.md) records unresolved vendor-policy applicability and route precedence; resolve applicable approval requirements before using/distributing subscription-backed SDK products. A successful historical native turn proves access at that time only.

## Roles, profiles and teams

**Role templates** hold reusable instructions and expected output guidance. Profiles add harness/model/thinking/permission choices. A profile is configuration, not a continuing conversation. Discovery and save checks dispatch no workers. Unsupported models/permissions are refused rather than substituted.

Roles support **Export role** and **Import role JSON → Import as new role**. Version 1 requires `format`, `formatVersion` and `role: {name, instructions, expectedOutput}`; export an existing role for the envelope. Imports create a new identity. Limits: file 128 KiB, name 160 characters, instructions 12,000, output guidance 8,000. Referenced roles/profiles cannot be deleted; reload before retrying a stale save.

Under **Team presets**, choose a coordinator Lead, worker pool, available workflows, mode and limits. Only Codex can Lead. Native teams can include Pi/Claude/OpenCode file workers and read-only Codex workers. A team cannot mix native and FAKE profiles or give coordinator authority to a worker. Saving a team starts nothing.

**Start a run from a saved team** copies the reviewed version, roles, profiles, workflows, mode and limits. Library edits/deletions do not change existing run snapshots. Switching projects selects that project's runs and clears new-run drafts; it does not stop work already running elsewhere. [Isolation verification and legacy Codex binding limits](project-switching-verification.md).

## Modes and workflows

| Mode | Behavior |
| --- | --- |
| Chat/Plan | Lead conversation/planning only; no worker dispatch or managed-source mutation. A native Lead turn can still incur costs. |
| Supervised | Lead proposes tasks/assignments; the owner authorizes worker assignment or explicitly starts a saved workflow. |
| Autonomous (bounded) | Lead can assign from the saved roster and invoke allowed workflows within engine caps. Final integration still requires the owner. |

Save native **Explore Subsystem** or **Review Implementation** recipes using **Team presets → Save a workflow template**. Explore binds 1–4 readers and a synthesizer; Review binds a read-only reviewer. Add every stage profile to the team and select the template under **Available workflows before starting the run**. The seeded FAKE recipes remain playback examples. There is no general workflow graph editor.

In **Workflows → Run a saved workflow**, supply the declared input: `target` for Explore, or `candidate_id` for Review. Review requires the current captured candidate of an implementation awaiting review in the same run. Starting uses only templates frozen into that run; paused/Chat/Plan runs refuse it. A Lead may start an allowed workflow in Autonomous mode; in Supervised mode it raises an owner request.

The grouped view shows individual child tasks, queue state, reports and final results. Each reader/synthesizer/reviewer consumes normal slots and launch budget. Synthesis retains source citations and explicit missing/failed-reader provenance. Settled failure can yield a partial result; ambiguous recovery blocks downstream stages and never automatically retries them. Workflow completion records reports, not source integration. Full static recipe constraints live in [spec §7.5](../spec.md#75-static-workflow-engine-for-beta) and [workflow schemas](../src/shared/domain/workflow.ts).

## Review and local integration

Writer completion captures a candidate from verified tracked changes plus declared new files. Undeclared/ignored/sensitive/symlinked paths, a moved checkout or failed whitespace checks block capture for an owner decision. Worktree creation and candidate branches update Git metadata; the owner's working files stay unchanged until approved application.

1. Use the task's **Request review** or the saved Review workflow. The read-only reviewer gets an independent worktree at the candidate commit, its objective and diff, without the implementer's report. Review findings retain severity, file:line, confidence and evidence.
2. If changes are requested, use **Revision feedback → Request revision**. A bounded child starts from the candidate; its verified result returns the original task to review. Prior candidates/reviews remain inspectable. Reviews/revisions of older candidates can refuse after the run's base advances; inspect and start suitable fresh work rather than replaying it.
3. After a passing review, **Integration preview → Prepare integration preview** checks the candidate against the chosen local destination in a separate worktree. Declare test commands as argument arrays; they run without a shell but with your user permissions. File-tool reviewers cannot run tests, so inspect actual preview results.
4. Inspect the independent review, base/candidate diff, test output and final integration diff. Destination drift is checked; conflicting paths stay unresolved in the integration worktree and appear in **Needs You**. There is no force overwrite.
5. **Approve** accepts the current passed preview and applies nothing. **Decline** retains the work for revision. Then **Review apply plan** shows the exact destination update and checks its current state. **Confirm apply** performs only that plan: a compare-and-swap branch update, or a clean fast-forward when the branch is checked out in the owner root.

A dirty checkout, moved destination, in-progress Git operation or destination checked out elsewhere blocks application. If the destination moves after approval, prepare and approve a new preview. Refused/interrupted applies never automatically retry. Worktrees, candidates, conflicts and history are retained; beta does not automatically delete them. [Git compatibility and safety audit](security-audit.md).

## Needs You, messages and recovery

**Needs You** holds permission callbacks, clarifications, environment/provider problems, budget holds and recovery decisions. A blocking request suspends affected tasks; unrelated work continues. Answering a provider/credit request records your response but does not automatically resume failed work.

Claude/OpenCode safe file mutations wait for their exact live **Approve once** or deny callback. A generic inbox answer cannot grant native access; unsafe paths, shell/delegation and stale callbacks cannot be approved. Cancellation, session end or restart expires a callback. Pi has no per-call approval prompt; Codex native permissions are denied under its read-only/never policy. File approval never approves final integration.

Pi supports active steering/follow-up. Other harnesses show unsupported delivery instead of pretending a message arrived. Worker messages retain delivery/queued/unconfirmed diagnostics. For unrelated work, start fresh context; profiles and task state persist independently of native conversations.

| Action | Effect |
| --- | --- |
| Inspect / close view | Reads or hides a view; does not stop a worker. |
| Pause scheduling | Holds queued dispatch; active turns can finish. |
| Pause worker | Cancels that attempt into `RETRY_DECISION`, retains its worktree and notifies the Lead without a wake. |
| Stop run | Cancels its active sessions and permanently stops dispatch for that run. |
| Emergency stop | Pauses active runs and closes app-owned direct children. Descendants/earlier edits can remain; in-progress integration Git operations are not interrupted. |

Stop history distinguishes **pending**, **confirmed**, **failed** and **uncertain**. A missing PID, silent stream or missing folder is not proof of success. After a crash/disconnect/restart, use **Recheck**, inspect original repository/worktree/session/process facts, select the recovery profile/context, then explicitly **Retry**. A fresh retry gets a new worktree and checkpoint lineage; unfinished work stays retained. Native worker resume across engine assignments is unsupported. Codex completed Lead continuation requires a verified binding to its own run and original checkout; unknown/legacy bindings require a new run.

For context refresh use **Pause worker → Recheck → Fresh + checkpoint → Retry**; no dedicated Refresh session button exists. [Visible recovery examples and limits](gui-status-checks.md).

## Local state and privacy

The database, reports (`artifacts/`), worktrees, adapter configuration and transcripts live under `$XDG_DATA_HOME/local-agent-orchestrator/`, default `~/.local/share/local-agent-orchestrator/`. Preserve that directory and registered worktrees when inspecting unresolved work. Run one app/demo per database; close it before taking a consistent backup, including SQLite's associated WAL state if present. No automatic cleanup or credential export is provided.

The GUI uses the server API; mutations require a per-process token, idempotency key and same-origin checks. Agent MCP credentials are scoped to their run/task/session. These are local control-plane protections, not OS isolation. Reports, model text, transcripts and test output can contain sensitive content, and native provider calls leave the machine. See the [README safety notes](../README.md#safety-before-real-work).
