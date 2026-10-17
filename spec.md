# Local Agent Orchestrator - Product and Technical Specification

Status: **Approved starting specification (beta target)**  
Date: 2026-10-15  
Audience: the project owner and AI coding agents  
Implementation companion: `todo.md`  
Working title: **Local Agent Orchestrator** (the UI may call its coordinating agent the "Lead" or "Godhead").

> Build a small, personal, local-first orchestration application that coordinates **existing coding harnesses**. It is NOT a replacement coding harness, a generic multi-agent platform, or a SaaS product. Favor a thin, reliable control plane over features and abstractions that are not needed yet.

## 0. Executive decisions / design contract

The following decisions came from the requirements discussion and are settled for the initial beta:

| Area | Decision |
|---|---|
| Users and OS | One user; local Arch Linux / Omarchy; no multi-user authentication or cloud deployment. |
| Interface | Simple browser GUI served from `127.0.0.1`; do not start with Tauri, Electron, or a TUI-only product. |
| Implementation | TypeScript / Node.js backend and React / TypeScript frontend; SQLite for durable state. |
| Harnesses | Support exactly four families: Codex, Claude Code, OpenCode, and Pi. No fifth adapter without an explicit request. |
| Harness philosophy | Reuse each harness's real runtime, native models, permissions, tool calls, and sessions. Never rebuild an agent loop. |
| Lead | Exactly one configured lead per run. Lead plans, coordinates, delegates, reviews reports, and manages workflow; ordinarily does **not** edit project code. |
| Workers | Named agent profiles combine a reusable role with harness, model, reasoning setting, and permissions. Roles are independent of harness/model. |
| Reusable structure | Roles, agent profiles, team presets, and workflow templates are distinct entities. |
| Workflow beta scope | User-authored static sequential or parallel/fan-in workflows; per-run reader count may be adjustable. Lead may invoke existing templates but cannot author arbitrary new workflows in beta. |
| Autonomy | Default is **bounded autonomous delegation**. Chat/Plan and Supervised modes are selectable. |
| Filesystem | One writable worktree per implementation attempt. Read/review instances inspect an appropriate stable snapshot. Never have two active writers own the same worktree. |
| Version control | Local Git only; manual approval of final integration to the user's project branch by default. |
| Reviewing | Independent review agent(s) inspect diff, surrounding repo, tests, and requirements. Lead routes findings; a reviewer alone does not authorize integration. |
| Human control | Owner can create/assign tasks, steer/pause/cancel agents, change priorities, resolve requests, and stop a run. Owner overrides lead decisions. |
| Human help | Unified "Needs You" inbox for installation requests, permission questions, missing credentials, clarification, and other blockers. |
| Context | Lead supplies task-specific context; application assembles instructions; workers independently inspect code. Task state is not stored only in chat. |
| Sessions | Preserve named profiles, but allow fresh native sessions. Default: resume same ongoing task, fresh session for unrelated new work. |
| Failure | Record event/task/session state, distinguish waiting vs failed vs disconnected, never blindly repeat an ambiguous mutating operation. |
| Context/cost limits | Separate concurrent writer, reader, and total-agent limits; total launches/revision limits; model availability/usage where supported. |
| Deferred | Dynamically invented execution graphs, unbounded YOLO spawns, automatic final merges, GitHub integration, remote hosts, billing integrations. |

These are **defaults**, not a claim that every harness exposes exactly equivalent controls. Capability differences must be reported honestly in the UI.

## 1. Goals, non-goals, and beta definition

### 1.1 Goals

1. Select a local Git repository as a project and issue one initial prompt to a persistent Lead agent.
2. Converse with the Lead in Chat/Plan mode without dispatching workers or changing source code.
3. Select a reusable team configuration: lead + named available workers with roles, harnesses, model IDs, thinking settings, and a bounded execution policy.
4. Let the Lead dispatch tasks to workers and call saved workflows; let the owner dispatch tasks manually as well.
5. Show who is doing what: task board, running instances, session output, review results, Git changes, dependencies, and human requests.
6. Make independent implementation work safe from **cross-worker overwrite** using isolated Git worktrees, while acknowledging worktrees are not security sandboxes.
7. Deliver worker findings via short structured handoffs, with detailed logs available only on demand.
8. Run a review/revise/integrate pipeline in which final application to the user's branch requires explicit approval in beta.
9. Survive ordinary process interruptions, app restarts, rate limits, dependency blockers, and session resets without losing task state or unexpectedly rerunning mutating work.
10. Operate locally without modifying global Codex/Claude/OpenCode/Pi installations or configurations.

### 1.2 Non-goals for beta

- Developing a new model, inference engine, coding loop, universal prompt framework, or replacement harness.
- Multi-user accounts, cloud synchronization, external auth server, remote compute scheduling, CI/CD integration, GitHub pull requests, PR automation.
- Production-grade container/VM sandboxing, adversarial tool isolation, supply-chain certification, or guaranteed enforcement of read-only behavior with only prompts.
- A general BPMN engine, a graphical workflow authoring canvas, arbitrary recursive workflows, or lead-generated workflow programs.
- Jujutsu support, automated remote branch publishing, hands-free integration into user's main branch.
- Exact cross-provider billing analytics when harnesses do not expose reliable usage/cost data.
- Supporting every unusual plugin/extension installed in the owner's harnesses.

### 1.3 Beta release criterion

A usable beta exists when a user can launch the local GUI, open a clean test repository, configure a lead and two workers across supported harness adapters, chat/plan, dispatch an implementation task, see its worktree and status, independently review the submitted changes, handle one human blocker, inspect a diff, and explicitly approve a safe local integration. A stored **parallel readers -> synthesis** workflow must work and display as one expandable unit. All four adapters must pass their capability-specific integration tests against installed/authenticated versions or be surfaced as explicitly unavailable with actionable diagnostics; a beta claiming four-harness support must not silently replace any harness with a generic API call.

## 2. Vocabulary and core product entities

**Project:** an independently selected local Git repository; one project can have multiple runs. Beta operates on one repository per run.

**Run:** a top-level orchestration effort initiated by the owner with a chosen team, lead, mode, policy, and initial prompt. Multiple historical runs may be browsed; first implementation may restrict actively executing runs to one per project.

**RoleTemplate:** reusable system/behavior guidance (e.g., Backend Engineer, Code Reader, Reviewer, Synthesizer). Does not encode a fixed model or harness. Explicit role instructions and expected output shape.

**AgentProfile:** reusable named configuration (e.g., "Ada"): role reference + harness + model identifier + supported thinking setting + permission class + optional per-profile overrides. This is an **identity/configuration**, not a permanent model conversation.

**TeamPreset:** one lead profile, a roster or pool of available named worker profiles, workflow access, default mode, and resource limits. A run resolves a versioned snapshot of the chosen preset so later editing presets does not silently change running work.

**WorkflowTemplate:** user-created, saved, versioned static execution recipe made of sequential stages and/or a bounded parallel fan-out followed by aggregation/synthesis. A workflow is not an agent and is counted by its child agent instances.

**Task:** durable unit of planned or discovered work. Has objective, scope, acceptance criteria, priority, origin, dependencies, artifacts, status, assignment, and parent run/workflow. Remains after agent process exits.

**Attempt:** one execution of a task by a specific profile and native session, possibly on a new worktree. A failed attempt never erases the task or a previous attempt.

**AgentSession:** reference to a native harness session/thread, along with adapter type, native session ID, associated task/attempt, live process reference, context strategy, and state.

**Event:** append-only record of a meaningful transition or message: worker started, task blocked, review completed, issue discovered, owner replied, merge approved, etc.

**HumanRequest:** blocking or informational question with type, priority, owner-visible instructions, state, reply, and affected task(s).

**Review:** independent, evidence-bearing assessment of a candidate change (finding severity, file/line evidence, reviewer recommendation, tests). Distinct from integration approval.

**IntegrationCandidate:** an immutable reference to proposed change commit(s) and base revision, review evidence, status, and final human decision.

**Artifact:** report/log/reference, stored as a local file with metadata and linked to task/attempt; source changes remain in Git.

Relationship summary: Project -> Runs -> Tasks -> Attempts -> AgentSessions. TeamPreset -> AgentProfiles -> RoleTemplates. WorkflowTemplate -> WorkflowRuns -> stage Tasks/Attempts. Tasks -> Reviews/HumanRequests/Artifacts/IntegrationCandidates.

## 3. Architecture

```text
Local browser GUI (React)
    | HTTP API + local event stream (SSE or WebSocket)
    v
Local Node application/server (bind loopback only)
    |-- Configuration & preset registry (versioned JSON + validation)
    |-- Task board / scheduler / dependency DAG / state machine
    |-- Policy and user override enforcement
    |-- Event journal + human request inbox + notifications
    |-- Context assembler + report/artifact writer
    |-- Session manager + harness adapter manager
    |     |-- Codex app-server adapter
    |     |-- Claude Code Agent SDK adapter
    |     |-- OpenCode SDK/server adapter
    |     `-- Pi RPC adapter (or supported SDK alternative)
    |-- Orchestration tools gateway (MCP, per-session permissions)
    |-- Git worktree manager + review and integration coordinator
    |-- SQLite storage + local structured log store
    `-- Local process supervisor (start/stop/reconcile)

Lead session <-> Orchestration tool gateway <-> scheduler / task state
Worker session <-> Restricted worker tools <-> reports / human requests
Coding workers -> isolated Git worktrees
Reader/reviewer workers -> appropriate stable repository snapshots
```

No separate Redis, message broker, Kubernetes, LangChain, workflow SaaS, or central model router. The control plane is one local app process plus harness child processes / local servers.

**Important design separation:** the application decides whether something is authorized and what state transition occurs; an LLM decides *what task or workflow to request*. It must not be able to bypass engine policy by inventing extra shell-driven subagents or writing directly to SQLite.

### 3.1 Backend modules (suggested, not mandated filenames)

- `domain`: typed entities, state machines, input schemas, authorization and policy types.
- `storage`: SQLite schema, migrations, transactions, event journal, queries.
- `scheduler`: dispatch, quotas, dependency evaluation, queueing, retries, locks.
- `adapters`: one implementation per supported harness plus a fake adapter for tests.
- `orchestration-tools`: lead vs worker tools exposed via session-scoped MCP/runtime integration; server validates every request.
- `sessions`: native session registry, prompt/steering gateway, context reset/resume, process lifecycle.
- `git`: validate, create/cleanup worktrees, record diffs/commits, isolated integration, conflict handling.
- `workflows`: static stage scheduler, fan-out/fan-in, synthesis handoffs.
- `notifications`: event-driven lead wake-up, human inbox, worker-to-lead escalations.
- `api`: local HTTP endpoints, event stream, runtime schema validation.
- `ui`: React screens and components; thin view of backend state.

### 3.2 Suggested repository structure

```text
/
  README.md
  AGENTS.md
  spec.md
  todo.md
  package.json
  pnpm-workspace.yaml        # optional if workspace complexity is justified
  apps/
    server/
    web/
  packages/
    core/                    # shared domain types and validation
    harness-adapters/
  tests/
    fixtures/                # disposable toy Git repositories only
    integration/
    e2e/
  docs/
    adr/                     # concise architecture decision records for new decisions
```

Prefer the smallest workable monorepo layout. If splitting packages creates noise before first vertical slice, use `src/server`, `src/web`, and `src/shared` in a single package until needed. Do not create empty directories just to satisfy this suggestion.

## 4. The lead, permissions, and human authority

### 4.1 Authority hierarchy

1. **Human owner:** may override queue/priorities/assignments, provide steering, pause/cancel runs, approve or reject integrations, and change runtime policies. The owner must explicitly authorize destructive cleanup and final integration.
2. **Lead agent:** chooses from configured workers/templates, sets task-specific goals, dispatches within limits, consumes reports, requests revision, coordinates integration and escalation. It cannot override owner locks or policy limits.
3. **Workers:** execute assigned work, inspect assigned repository context, report findings, request help, and raise issues. They cannot create arbitrary unbudgeted worker processes or make final merge decisions.
4. **Engine:** deterministic enforcer of lifecycle, concurrency, repository ownership, permissions, and event persistence. It does not make model-generated implementation decisions.

### 4.2 Execution modes

- `chat_plan`: Lead may inspect/read relevant repository information and discuss a plan; no worker dispatch, Git mutation, or source edits. Enforced in backend tool allowlist and harness/tool permission configuration, not merely in prompt text.
- `supervised`: Lead proposes tasks/delegations; owner approves requests before new worker execution. Owner can manually assign tasks directly.
- `autonomous_bounded` (**default**): Lead dispatches tasks and runs allowed templates, revises tasks, and controls only its own run's work, within resource and scope limits. Human still approves final integrations and sensitive actions.

Mode can change mid-run; persist the change, notify the lead, and apply it before the next tool action.

### 4.3 Scope changes

- Additional work **necessary for the original objective** may be autonomously delegated if within budgets and dependencies.
- Unrelated bugs, opportunities, refactors, and feature ideas become proposed backlog tasks with evidence, **not** autonomously scheduled expansion.
- The owner may explicitly authorize promoted backlog tasks; record that authorization.
- A worker may report an urgent issue directly, but does not gain authority to halt unrelated runs or modify unrelated code.

### 4.4 Tool permissions

Expose a **small, explicit tool surface** instead of unrestricted access to the scheduler:

Lead tools (conceptual names; final names and schemas must be versioned):

- `list_tasks`, `get_task`, `get_run_status`, `get_worker_status`, `read_report`
- `propose_task`, `assign_task`, `request_revision`, `run_workflow`
- `pause_run`, `cancel_task`, `escalate_issue`, `request_human_input`
- `propose_integration` (NOT `force_merge_main`)

Worker tools:

- `report_progress`, `submit_result`, `report_issue`, `request_human_action`, `ask_lead`, `read_assignment`
- **No** `assign_task`, `run_workflow`, `create_unbounded_workers`, or `approve_integration`.

Use the same validated engine API from the GUI and tool gateway. Every mutation checks authenticated local session identity, role, run scope, mode, task ownership, concurrency and budget policy, and idempotency key. Reject invalid requests with structured error data; do not silently ignore them.

**Security honesty:** MCP role separation and harness permission toggles are guardrails, not a hostile-code sandbox. Models with shell access can sometimes execute commands outside their worktree or start their own processes unless operating-system isolation is added. Beta must block known dangerous tools and restrict harness permissions where supported; document residual risk, keep the user in control, and never promise perfect containment. Support optional stronger isolation as a future phase.

### 4.5 Steering

Owner may: message the lead; add/edit a task; reprioritize; assign/reassign; request worker pause/cancel; send a worker a steering/follow-up message; request session refresh; approve/decline/answer HumanRequests; override a lead-proposed task; inspect a running session and worktree.

A steering message is delivered according to adapter capabilities: immediate steer if supported, otherwise deferred until a safe input boundary, or cancel-and-restart with clear confirmation. Show delivery status; do not falsely label a queued message "delivered." Meaningful owner overrides generate lead-visible events and cannot be silently reversed by the lead.

## 5. Harness adapter contract

### 5.1 Principles

1. Harness adapter is an anti-corruption layer, **not a replacement model API client**. Running plain OpenAI/Anthropic messages through custom tools is not equivalent to using Codex/Claude Code.
2. Work with the owner's installed harnesses and existing supported authentication where permissible. Do not extract tokens or copy/modify user global credentials. If SDK login requirements differ, surface a prerequisite rather than inventing a bypass.
3. Use harness-specific supported mechanisms for models, thinking, environment, MCP, prompt handling, session resume, streaming, cancellation, and permission prompts.
4. Every adapter advertises real capabilities and reports unsupported operations explicitly.
5. Never hardcode a global model list, equate model thinking scales across providers, or assume a model catalog equals access entitlement. Prefer real capability discovery and a test turn before declaring ready.
6. Avoid modifying native global configs; use temporary per-process/worktree configuration overlays if supported, and clean only files owned by this application.

### 5.2 Required logical interface (illustrative TypeScript, not a library API claim)

```ts
type HarnessName = 'codex' | 'claude-code' | 'opencode' | 'pi';
type ReasoningChoice = { id: string; label: string };
type AdapterCapabilities = {
  harness: HarnessName;
  installed: boolean;
  authenticated?: boolean | 'unknown';
  models: Array<{ id: string; label: string; thinking: ReasoningChoice[] }>;
  supportsResume: boolean;
  supportsLiveSteer: boolean;
  supportsCancel: boolean;
  supportsPermissionPrompts: boolean;
  supportsToolGateway: boolean;
  diagnostics: string[];
};
type SessionEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_started' | 'tool_finished'; toolId: string; summary: string }
  | { type: 'approval_requested'; nativeRequestId: string; details: unknown }
  | { type: 'turn_completed'; nativeStatus: 'completed' | 'failed' | 'interrupted' }
  | { type: 'session_error'; code: string; recoverable: boolean; message: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; source: string };
interface HarnessAdapter {
  discover(): Promise<AdapterCapabilities>;
  startSession(input: StartSessionInput): Promise<ManagedSession>;
  prompt(session: ManagedSession, text: string): AsyncIterable<SessionEvent>;
  resume(nativeSessionId: string, input: ResumeInput): Promise<ManagedSession>;
  steer(session: ManagedSession, text: string): Promise<'sent'|'queued'|'unsupported'>;
  cancel(session: ManagedSession): Promise<void>;
  respondToApproval(session: ManagedSession, id: string, decision: string): Promise<void>;
  dispose(session: ManagedSession): Promise<void>;
}
```

`StartSessionInput` includes: run/task/attempt IDs, absolute worktree/snapshot cwd, role, model and thinking choices, effective permission policy, context packet, orchestration tool endpoint, and required environment overlay. The engine owns native ID mapping and process references.

Do **not** require every adapter to implement every optional operation with identical behavior; the server can translate `unsupported` into a UX fallback, but not silently drop requested controls.

### 5.3 Candidate implementations (verify against installed versions before coding)

- **Codex:** official `codex app-server`, stdio transport, initialize/initialized handshake, thread creation/resume, turn start, streamed notifications, approval protocol, model list, interruption. Save native thread IDs. Use stdio instead of unstable websocket networking in beta. See https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server and https://github.com/openai/codex/tree/main/codex-rs/app-server .
- **Claude Code:** official `@anthropic-ai/claude-agent-sdk`, `query(...)` with sessions, streaming, permissions/hooks, abort/resume, and MCP configuration. Do NOT confuse this with `@anthropic-ai/sdk`, which is the lower-level model API. See https://github.com/anthropics/claude-agent-sdk-typescript . Verify specific SDK/version, authentication, and approval callback behavior.
- **OpenCode:** official JS/TS client `@opencode-ai/sdk` with local headless server (`opencode serve` or SDK-spawned server), session/prompt/abort/status/permissions/events, server password and loopback binding. OpenCode's newer embedded SDK surface may evolve; choose one supported surface and document why. See https://docs.opencode.ai/docs/sdk/ and https://docs.opencode.ai/docs/server/ .
- **Pi:** native subprocess RPC (`pi --mode rpc`) / typed RpcClient using JSON records, model and thinking level controls, stream/steer/abort/new session; or official Pi SDK when demonstrably simpler. Prefer subprocess isolation for consistent process supervision. New Pi versions have built-in MCP for CLI; SDK resource loader may require explicit MCP extension wiring. See https://pi.dev/docs/latest/rpc , https://pi.dev/docs/latest/rpc-commands , https://pi.dev/docs/latest/mcp .

**Required preflight artifact:** produce a short `docs/adapter-recon.md` during implementation recording installed binary versions, chosen integration surface, auth expectations, known capability gaps, and a minimal scripted smoke test per harness. When a surface is different from these suggestions, use the installed official API and update the document; don't block the whole product on an obsolete API assumption.

### 5.4 Tool gateway integration

Prefer a local session-scoped MCP server with distinct lead and worker tool sets where each harness supports it. Do not write custom global harness extensions merely to pass instructions if MCP works. If a supported harness/version cannot expose the required tools, a well-defined adapter-native tool mechanism is acceptable; capability and limitations must be recorded. Scope endpoints to the run/agent session and enforce policy server-side. Never expose SQLite or unrestricted server admin operations to model tools.

### 5.5 Event normalization

Native events are mapped into consistent internal events, while raw events remain available in bounded diagnostic logs. Unrecognized events are logged without throwing the entire run. Completion must be inferred from **authoritative terminal status**, not "last text appeared". Permission requests and tool calls may outlive one text response. Add test fixtures for each adapter's event mapping.

## 6. Context, handoffs, and session strategy

### 6.1 Context assembly

The Lead determines the **task-specific intent** and may reference relevant files; the engine supplies shared policy, selected role, project guidance and task metadata. Effective context packet includes:

1. Hard engine-enforced run scope, task ownership, tool permissions and worktree address (not just prompt rules).
2. Agent role instructions, role version and expected output schema.
3. Task title, objective, constraints, success criteria, dependencies, priority, lead-provided context and references.
4. Project instructions, applicable `AGENTS.md` and other harness-native discovery mechanisms, and Git base revision.
5. For revision/resume: previous attempt summary, review comments, human responses, exact change references.

Preserve source/provenance, no giant blind transcript/file dump. For repo context, favor pointers to files and a short map. The worker is free to inspect surrounding code. Repo content and tool results must be treated as untrusted inputs, not new app permissions.

### 6.2 Handoff report

At completion or an important escalation, worker supplies validated structured fields plus optional Markdown:

```json
{
  "taskId": "task-123",
  "outcome": "completed",
  "summary": "Fixed project navigation deadlock",
  "changedFiles": ["src/navigation.ts"],
  "tests": [{"command": "pnpm test", "result": "passed"}],
  "findings": [{"severity": "info", "location": "src/navigation.ts:44", "text": "..."}],
  "knownRisks": [],
  "questions": [],
  "artifactRefs": [],
  "revisionOrCommit": "<Git ref when available>"
}
```

Validate report shape and size. Tool-based submission is preferred but must not be required for survival; after unexpected exits, engine may reconstruct a minimal result from Git status and logs marked as unverified. The Lead receives short report + references, not entire raw worker context.

### 6.3 Context policy

- `auto` (default): reuse native session for continuing/revising same task or after a human unblock; create fresh native session for unrelated new assignment.
- `fresh`: new native session with relevant handoff and worktree/reference context.
- `resume`: explicit native session ID; if unavailable, ask owner/lead to authorize fresh fallback with a generated checkpoint summary.
- Manual owner "Refresh session" creates a successor session and preserves old transcript reference.

Session IDs are unique per attempt and never silently attached to a different project/worktree. A fresh session is not guaranteed cheaper because it may reread code and lose cache benefits. Usage displays observed data only. Context compaction can remain harness-native in beta. Future: lead checkpoint+refresh, measured context/cost strategies.

### 6.4 Asynchronous event delivery to Lead

The engine is event-driven. It queues messages while Lead is working, delivers in a serialized next turn when idle, and may request a controlled interruption for truly urgent conditions. Avoid multiple simultaneous turns in the same Lead session. The model must not run continuously polling task state; engine wakes it for meaningful task completions, blockers, exceptions, or owner messages. Bound automatic wake-up/decision cycles to prevent expensive loops.

## 7. Tasks, board, scheduling, and workflows

### 7.1 Task board and state model

User-facing columns may group statuses to keep UI simple, but persist precise states:

```text
BACKLOG -> READY -> QUEUED -> RUNNING -> AWAITING_REVIEW
                    |           |              | 
                    |           |              +-> CHANGES_REQUESTED -> READY
                    |           +-> WAITING_HUMAN -> READY/RUNNING
                    |           +-> WAITING_DEPENDENCY -> READY
                    |           +-> INTERRUPTED / FAILED -> RETRY_DECISION
                    |           +-> CANCELLED
                    +-> CANCELLED
AWAITING_REVIEW -> READY_TO_INTEGRATE -> INTEGRATING -> DONE
               \-> CHANGES_REQUESTED -> READY
READY_TO_INTEGRATE -> BLOCKED_CONFLICT -> READY_TO_INTEGRATE (resolved candidate)
```

Use a tested transition table; do not allow arbitrary status changes. `WAITING_HUMAN`, `WAITING_DEPENDENCY`, `FAILED`, and `CANCELLED` are not synonyms. A rejected integration remains available as rejected history rather than disappearing.

An agent/process has a separate lifecycle: `not_started`, `starting`, `busy`, `idle`, `waiting_permission`, `disconnected`, `exited`, `crashed`, `stopping`. Never infer task success solely because process is idle or exited.

### 7.2 Task CRUD and discovery

Tasks can be created by owner, Lead, workflow template, or worker `report_issue`. All have origin/provenance, optional parent, scoped objective, acceptance criteria, and mutable priority/assignment history. New unrelated discoveries start in backlog. Lead can autonomously promote necessary work within policy; unrelated discoveries require owner promotion. Manual owner assignments outrank conflicting Lead assignments until owner releases the override.

### 7.3 Dependencies and scheduling

- DAG dependencies; reject cycles, missing IDs, and cross-project references.
- Dependencies gate scheduling: only `READY` tasks with satisfied prerequisites can launch.
- Workflow children use same global scheduler, not hidden unlimited processes.
- Priority with FIFO tie-break. Avoid starvation; simple queue sufficient for beta.
- Before dispatch, atomically reserve resource slots and a worktree ownership lock.
- Idempotent start operations with one dispatch ID per attempt. Release slots in `finally`/reconciliation.
- Let unaffected running tasks continue when one worker is waiting on human or review.
- Owner-initiated work can be pinned to a worker profile; Lead may not override pin without explicit owner action.

### 7.4 Default limits (user adjustable)

Suggested starting configuration, not hard-coded universal values:

```json
{
  "maxConcurrentWriters": 2,
  "maxConcurrentReadersReviewers": 4,
  "maxConcurrentAgentsIncludingLead": 7,
  "maxTotalWorkerLaunchesPerRun": 24,
  "maxParallelReadersPerWorkflow": 4,
  "maxRevisionCyclesPerTask": 2,
  "maxAutomaticLeadWakeupsPerRun": 40
}
```

All limits need bounds and GUI explanations. Lead consumes one total concurrent agent slot when active; the scheduler must not double-count a long-lived idle session in a way that starves all workers. Count **actively executing sessions** for concurrency and **spawned attempts** for launch budget. Workflows get no exempt quota. Agent costs may be displayed if observable but absence of precise billing is not authorization to exceed hard operation limits.

### 7.5 Static workflow engine for beta

Support an execution graph whose structure comes from a user-saved template. Initial stage types:

- `single_agent`: one selected profile/role completes a prompt with runtime parameters.
- `parallel_agents`: N instances of a role/profile with defined independent partitions/instructions, bounded fan-out.
- `synthesize`: one model receives bounded reports/references from upstream stages and consolidates them.
- `review`: optional single or parallel independent reviewer stage using a Git candidate and task criteria.

Stages depend on prior stage success, or have explicit documented partial-failure behavior. In beta no recursive template calls, arbitrary loops, self-modifying graphs, or runtime model-generated template definitions. The Lead may invoke a template and select an allowed parameter such as reader count or target subsystem.

**Required example template:** `Explore Subsystem` - (1) parallel readers examine architecture, state/data flow, dependencies, tests/edge cases using complementary prompts, (2) synthesizer receives their reports plus cited file locations, (3) concise consolidated report returned to Lead. Partial reader failure yields explicit partial result; do not invent missing evidence.

Another useful preset: `Review Implementation` - independent reviewer(s) read stable candidate diff + repository snapshot, produce findings, and optional synthesizer resolves overlapping reports.

### 7.6 Workflow visibility

Show workflows as one expandable item in the board/activity panel. Expanding reveals stage status, child sessions, individual logs/reports, chosen model/harness, and failures. Owner can inspect or cancel children without losing workflow history.

## 8. Git worktrees, reviews, and integration

### 8.1 Opening a project

- Verify absolute path, `.git` status, repository identity, base branch/reference, and Git availability.
- Default require a **clean user checkout** before starting isolated coding tasks. If dirty, display a clear warning and let the owner clean/commit manually; do not reset, stash, or silently discard changes. Handling dirty-root snapshots may be added later.
- Record base SHA before dispatch. Never assume moving main/HEAD remains unchanged during a run.
- Create app-owned worktrees outside target repository (e.g., under XDG data path) with unique branch names and attempt IDs. Keep a manifest of app-owned paths and repository IDs.
- Worktree operations use Git CLI through safe spawn argument arrays, never shell-concatenated repository paths.

### 8.2 Writer isolation

One active implementation attempt owns one writable worktree, derived from known base ref. Two active attempts may edit identical *filenames* in separate worktrees; they may still conflict during integration. Ensure default working directory is that attempt's worktree; detect and warn about edits outside managed area when possible. Never allow scheduler to concurrently attach two writable attempts to the same worktree.

### 8.3 Reader and reviewer isolation

Readers can inspect the codebase and search nearby files. Reviewers **must** see the candidate change in the context of the surrounding repository, ideally a separate read-oriented worktree at candidate commit. They should not be constrained to diff-only prompts. Restrict mutating tools in harness config and avoid exposing candidate modification tools. If tests must write artifacts, use a disposable copy/worktree and treat it as writable scratch. Do not represent prompts or Git worktrees as kernel-level read-only enforcement.

### 8.4 Candidate creation

The engine must capture the full candidate including tracked changes **and intentionally included new files**. No silent loss of untracked files. Before candidate submission, inspect `git status --porcelain`, staged/unstaged diff, changed paths, secret-sensitive paths, ignored files, and base SHA. Prefer a deterministic engine-owned task commit using allowed change paths, with generated commit identified in the task record. Do **not** blindly `git add -A` to the owner's checkout or stage obvious credentials; unknown/sensitive additions should block and request owner review. Do not require an LLM report as proof the working tree is clean.

A task with unresolved dirty state or untracked files is not silently marked `DONE`.

### 8.5 Review protocol

Reviewer receives: original task and acceptance criteria, immutable base and candidate refs, candidate diff, relevant report and test results, and permission to inspect context. Ideally review candidate independently before being shown the implementer's optimistic summary. Reviewer returns categorized findings (`blocking`, `important`, `suggestion`, `nit`), concrete file references, justification, and pass/changes-requested recommendation. Preserve all reviews. A human/Lead may mark a finding accepted, rejected with rationale, or sent for revision; no reviewer gets to delete prior comments.

A revision normally resumes same task/worker context in its worktree or launches a fresh attempt with explicit handoff when necessary. Enforce per-task revision limit and surface exhaustion to owner.

### 8.6 Integration

1. Candidate passes review gates and deterministic checks (`git diff --check`, declared tests, no unresolved changes).
2. Engine creates/uses an **isolated integration worktree** based on a recorded destination SHA, and dry-runs applying candidate(s). Never integrate directly into owner's possibly dirty active checkout.
3. Detect base drift and merge conflicts. When conflicts arise, mark candidate `BLOCKED_CONFLICT` and create scoped conflict-resolution task in integration worktree; do not silently choose sides.
4. Owner inspects exact final diff, test summary, target branch/SHA and proposed Git commands, then explicitly approves applying the result to the selected local branch.
5. Immediately before application, recheck current branch and target SHA/cleanliness. If moved/dirty, fail safely and require reconciliation. Do not overwrite or reset local changes.
6. Persist integration commit IDs and an audit trail. Cleanup only app-owned worktrees after successful verification and owner confirmation; never garbage-collect active or unresolved work.

**Beta default:** no direct automatic merge into main. The owner can decline or defer indefinitely; task histories remain.

## 9. Human requests, escalations, and stopping

### 9.1 Unified "Needs You" inbox

A request has `type` (permission, environment/dependency, clarification, credential setup, risky operation, manual check), `urgency`, `reason`, `suggested action`, `affectedTaskIds`, `blocking`, `status`, `ownerResponse`, `createdAt`, and `resolvedAt`.

When worker says "install X" or "I need permission":

1. Record request, mark affected task `WAITING_HUMAN` if blocking, release execution slot where the harness permits suspension, but preserve native session and worktree.
2. Do not stop unrelated tasks. Downstream tasks become `WAITING_DEPENDENCY`.
3. GUI displays actionable instructions with explicit source and associated worker.
4. Human may mark completed, decline, answer with text, or defer. Application sends reply to affected session or creates successor with handoff when native resume unavailable.
5. Worker verifies outcome; marking "completed" is not proof that dependency/permission worked.

Use harness-native permission request APIs when available and map them to the same inbox; do not bypass native safeguards silently.

Confirmed auth failures, rate limiting and exhausted credits use this same blocker flow, preserving evidence and an actionable owner next step. Distinguish unknown/unavailable usage from confirmed exhaustion; never infer a balance or reset time. Keep deterministic hard budgets independent; do not add credential management or automatic resumption.

### 9.2 Escalation policy

- Informational finding: record issue, optionally add backlog task.
- Work-blocking finding: notify Lead, block affected task and dependency descendants.
- High-severity data loss/security/destructive-operation concern: emit urgent event and **pause affected execution** where feasible; surface owner alert. Do not automatically kill unrelated healthy work based solely on a model's severity label. Engine may hard-stop operations forbidden by deterministic policy.
- Lead receives typed high-priority events. If busy, queue event and use controlled interruption if appropriate; no concurrent overlapping Lead turns.

### 9.3 Pause and stop semantics

- **Pause scheduling:** stop new dispatches; running workers continue to safe completion unless separately paused/cancelled.
- **Stop run:** cancel active sessions in the selected run, halt dispatch, preserve worktrees, artifacts, and database state.
- **Emergency stop:** best-effort termination of app-managed agent process groups and dispatch, plus prominent warning that external descendants and already-performed filesystem changes may remain. It must not kill unrelated user's manual Codex/Pi/etc sessions.

Persist pending-stop, failed and uncertain outcomes and history independently of navigation, view closure and app restart, reusing the stop journal. Inspecting or closing a view does not stop execution; only supported process/session evidence confirms termination.

A paused/suspended task can be resumed only by an explicit transition that rechecks its dependencies, resource limits, worktree and session status.

## 10. Runtime failure and recovery

### 10.1 Cases to distinguish

- Normal tool/model latency vs genuinely silent process.
- Model rate limiting / exhausted credits / explicit auth failure.
- Missing dependencies or denied native permissions.
- Network disconnect with child still alive.
- Native process exited cleanly without authoritative task completion.
- Native process crash or unexpectedly terminated app server.
- Orchestrator itself restarted while workers were active.
- Worktree conflict, Git command failure, dirty integration destination.
- Missing, inaccessible or replaced worktree; neither a missing folder nor same-path existence proves process termination or checkout identity.
- User cancellation vs unexpected interruption.

### 10.2 Durable execution rules

- Persist the task, attempt ID, intended operation and state transition **before** launching/accepting a mutating request.
- Append structured event with causal IDs; persist native session/thread ID as soon as returned.
- Processes are supervised and their exit codes recorded. "No streamed tokens" is never sufficient to classify a crash.
- On restart, reconcile local process state, native session IDs, task attempts, and worktree Git state. Expose ambiguous attempts as `RECOVERY_REQUIRED`/`RETRY_DECISION` rather than automatically rerunning commands that might have succeeded.
- For missing/inaccessible/replaced worktrees, preserve task/attempt, native-session and process evidence plus the path and reason. Block unsafe submissions until an explicit recovery decision validates repository/worktree identity. Recheck observes current facts only; it never resubmits work, automatically relinks or deletes a checkout.
- Every spawn/submit/integration operation carries an idempotency key so retries cannot accidentally create duplicate tasks or apply a change twice.
- Prefer native session resume when the same unfinished task and state support it; otherwise create a fresh attempt from existing task/commit/report evidence, but only after a safe recovery decision.
- Always preserve unfinished or conflicted worktrees until user-authorized cleanup.
- Mark terminal statuses based on authoritative harness events + Git state; test all paths with FakeAdapter fault injection.

### 10.3 Retention

App data should live under standard Linux XDG paths, e.g. `$XDG_DATA_HOME/local-agent-orchestrator/` (fallback `~/.local/share/local-agent-orchestrator/`). Config under `$XDG_CONFIG_HOME/local-agent-orchestrator/`; runtime files under `$XDG_RUNTIME_DIR/` when appropriate. SQLite in WAL mode with migrations, foreign keys, and transactions for state changes. Logs/artifacts stored separately and prunable after confirmation. Do not log secrets or complete environment variables; bind web server to loopback; local API should defend against cross-origin requests from arbitrary pages (origin checks and CSRF/nonced local session protection), even without accounts.

## 11. GUI design

### 11.1 UI guiding rules

Local-first; fast; minimal; no fancy dashboards, draggable infinite canvas, or unnecessary organizational hierarchy. One glance should answer: What is happening? Who is working? What needs my approval? What changed? What do I do next?

### 11.2 Minimum screens

1. **Projects / Runs:** choose repository, detect Git state and adapters, select saved team, create/resume run.
2. **Run workspace:** Lead chat + compact tasks/activity status; mode toggle `Chat/Plan`, `Supervised`, `Autonomous`; pause/stop controls; run budget indicator.
3. **Task board:** Backlog / Ready / Active / Review / Done grouped columns. Add tasks manually, assign a profile, reorder priority, see blockers and dependencies. Detail drawer shows progress, native session link, report, evidence, diff, and owner actions.
4. **Workers and Workflows:** named worker cards showing role, harness, model, thinking, runtime state; expand workflows to see readers and synthesizer separately; inspect logs and steer an instance.
5. **Needs You:** a first-class inbox for native permissions, missing packages, questions and escalations; respond and resume directly.
6. **Reviews / Integration:** compare candidate vs base, read independent findings, see tests and conflicts, approve/reject integration explicitly.
7. **Configuration:** edit role templates, agent profiles, team presets, workflow templates, and scheduler limits. Show available harness capabilities and unsupported reasoning settings honestly.

The navigation may expose these as tabs or a narrow sidebar; do not over-design v1. Use accessible controls, persistent status badges, keyboard navigation for key actions, and durable confirmation dialogs for destructive operations. Streaming event view should reconnect/replay from last event ID rather than silently losing updates.

### 11.3 UI semantics

Task board is authoritative view of backend state, not a second workflow engine. "Ready for Review" is not "Done". "Needs You" requests can be nonblocking or blocking. A workflow is visually one unit with expandable children; readers each consume resource slots. A person may create/assign a task without the Lead's permission. The owner can inspect raw harness events when needed but should see normalized summaries by default.

## 12. API and persistence boundaries

Design a small typed HTTP API with zod/JSON Schema validated request/response objects, authenticated to the loopback UI by a random per-process token/cookie or equivalent CSRF-safe method. Exact URLs may evolve; cover these resources:

- `/projects`, `/runs`, `/runs/:id/mode`, `/runs/:id/pause`, `/runs/:id/stop`
- `/roles`, `/agent-profiles`, `/team-presets`, `/workflow-templates`
- `/tasks`, `/tasks/:id/assign`, `/tasks/:id/reprioritize`, `/tasks/:id/steer`, `/tasks/:id/cancel`
- `/sessions/:id/messages`, `/sessions/:id/steer`, `/sessions/:id/refresh`
- `/human-requests`, `/human-requests/:id/respond`
- `/reviews`, `/integration-candidates/:id/preview`, `/integration-candidates/:id/approve`
- `/adapters/health`, `/events/stream`

Do not implement every route before the vertical slice. All writes must use shared domain services with explicit state validation, event logging, and idempotency. GUI must never directly mutate SQLite or invoke `git` from the browser.

SQLite schema should use explicit migrations and entities from section 2, including foreign keys and timestamps. Prefer immutable events and attempts; allow controlled edits to task descriptors with change history. Version workflow/team/role snapshots for reproducibility. No distributed transaction system necessary, but Git operations need a recovery journal because filesystem and SQLite cannot share one ACID transaction.

## 13. Tests and acceptance matrix

### 13.1 Test philosophy

Do not incur model tokens while testing scheduler, database, task transitions, or Git. Create a `FakeAdapter` that supports deterministic streaming, completion, pause, crash, permission prompt, credit exhaustion, and ambiguous disconnect. Build disposable Git repos from fixture scripts. Only run live adapter smoke tests intentionally.

### 13.2 Core automated tests

- Task state-transition table: valid/invalid transitions, dependency cycles, user override locks, idempotent repeat request.
- Scheduler: counts writers/readers/total, active lead handling, workflows count all child instances, no starvation deadlock, queued vs running, revision/spawn budget exhaustion.
- Persistence: app restart, partial transaction recovery, event replay, preserving native session ID/worktree, no duplicate spawns on replay.
- Human requests: blocking and nonblocking, completed/declined/answered, session follow-up, unaffected workers continue.
- Policy enforcement: Lead tool cannot merge, worker cannot spawn, chat mode cannot dispatch/edit, unauthorized cross-run calls rejected.
- Context: correct assembly order, task-local handoff, no wrong session reuse, named identity survives context reset.
- Git: one writer/worktree lock, concurrent edits to same path in separate worktrees, untracked file capture, secret file filtering, dirty root refusal, branch drift, conflict handling, non-destructive stop, safe integration preview.
- Workflow: parallel readers -> synthesis; one child failure; no duplicate result; capped fan-out; report references retained.
- GUI smoke: create project/run, change mode, view task board, Needs You response, review integration with explicit confirmation, reconnect to events.
- Adapter event translation: parse native completion, auth failure, permission and cancel distinctly. Supported feature flags match real behavior.

### 13.3 Live harness smoke matrix

For each installed/authenticated Codex, Claude Code, OpenCode and Pi:

1. Discover binary/version and capability; record installed model/thinking choices or show unknown with a safe manual test.
2. Start a session in a **disposable test repo**, ask a read-only question, stream output, observe terminal status.
3. Test model/thinking setting where available; report truthful unsupported cases.
4. Test resume of a completed session with a follow-up.
5. Test cancellation and any native permission prompt with an intentionally harmless guarded operation.
6. Test scoped orchestration tool invocation and policy denial.
7. For one writer, modify a disposable file, review candidate, and integrate only after explicit approval.

Any auth failure must show diagnostics; do not mark adapter working based only on binary presence.

### 13.4 End-to-end acceptance scenarios

**A. Initial autonomous run:** owner selects team, prompts Lead, Lead assigns a coding task, worker edits isolated branch, submits report, reviewer explores relevant code and finds/clears issues, human inspects diff and approves integration. No root worktree corruption.

**B. Human blocker:** worker requests missing dependency, another independent worker continues, owner responds, blocked worker resumes/verifies, downstream task unblocks.

**C. Independent investigation workflow:** Lead invokes four cheap readers and one synthesizer; scheduler honors limits, board groups child stages, final report cites source locations and partial failures.

**D. Owner takes over:** human pauses a worker, changes task priority, reassigns to new profile, sees old worktree retained and Lead notified. Old worker does not keep writing to new owner's worktree.

**E. Failure/restart:** intentional worker crash/disconnection and app restart do not erase pending tasks, silently rerun mutating work, or delete unresolved worktrees.

**F. Conflicting implementations:** two workers change same logical area in separate worktrees; integration detects real conflict and requests resolution, not last-writer-wins overwrite.

**G. Planning-only:** owner chats with Lead and receives a plan without worker spawns or project mutation.

## 14. Implementation sequence / release gates

Follow `todo.md` in dependency order. This is a thin vertical slice, not a "build every subsystem before demonstration" project:

1. Repo scaffold; architecture recon; SQLite; fake harness; Git fixture; minimal local GUI.
2. Complete fake run: owner -> Lead simulation -> task -> worker simulation -> report -> board.
3. Live **Pi** worker using RPC, worktree, native session, streaming. It has a small, inspectable protocol and is a good first adapter. Do not force this if installed local facts show another is materially easier.
4. Live Codex lead via app-server plus scoped orchestration tools; one Codex/Pi end-to-end run.
5. Review -> candidate -> manual integration with isolated integration worktree.
6. Human inbox, steering, stop/recovery, session refresh.
7. Saved roles/profiles/teams, bounded autonomous dispatch, parallel readers -> synthesis workflow.
8. Claude Code and OpenCode adapters, all-four capability and smoke coverage.
9. UI polish, end-to-end regression tests, packaging/start script, beta checklist.

Each stage must remain runnable and tested. If a harness SDK surface is difficult, continue developing against FakeAdapter while the adapter is investigated; log the blocker, don't fake its capabilities.

## 15. Risk register and honest constraints

| Risk | Mitigation |
|---|---|
| Four external tool APIs change | Adapter interfaces + official docs check + capability probes + pinned tested versions + smoke tests. |
| A native harness starts uncontrolled internal subagents | Limit exposed native delegation tools where supported; warn that a local process sandbox is not yet absolute. Preserve a per-run launch budget at control plane. |
| Prompt-based read-only restriction is bypassed | Harness-level tool permissions; read-oriented snapshots; explicit untrusted-repo warning. Optional OS-level sandbox later. |
| Chat/Plan unexpectedly mutates code | Remove write/shell tools where supported; run in safe snapshot; test with file hashes and deny tool gateway mutation. |
| Two workers edit same logical lines | Separate worktrees; review + isolated integration + conflict detection. |
| Agent stops without final report | Persistent attempts; live Git inspection; `RECOVERY_REQUIRED`, never assume success. |
| Model names/thinking labels drift | Dynamic discovery, supported capability mapping, no hardcoded cross-harness model equivalence. |
| Session continuity varies by harness | Native IDs + saved handoff; explicit fresh fallback. |
| User's main repo contains uncommitted work | Refuse destructive start/integration by default; never auto-reset/stash/force. |
| Local UI exposed to malicious browser tab | Loopback bind plus origin/CSRF checks; no unprotected state-changing HTTP endpoints. |
| Token runaway | Hard concurrency/launch/revision/wake budgets, no LLM polling, owner stop. |
| Too many features at once | Enforce non-goals, milestone gates, simple UI. |

## 16. After beta (explicitly deferred)

- Lead dynamically designs bounded DAG workflows using validated primitives (subject to human-visible policy and budgets); no arbitrary code-as-workflow injection.
- YOLO preset with high configurable budgets, but still user-controlled emergency stop and protection from destructive repo commands.
- Recursive templates / nested workflows with depth bounds and cycle checks.
- Better lead context checkpoint/refresh, adaptive session selection based on measured token cost and outcomes.
- Stronger OS sandboxing (e.g., bubblewrap/container isolation), approved external paths, secure per-role capabilities.
- Optional per-model spend analytics, task estimates, caching and model recommendations.
- More elaborate board views, notifications, artifacts, and optional GUI desktop shell.
- Optional Jujutsu backend / GitHub integration only if the owner later asks for it.

## 17. Change control during development

This is a starting contract, not a prohibition on learning. If an SDK differs from expectations or an implementation choice is underspecified:

1. Check current official documentation and installed version.
2. Choose the smallest robust solution that preserves the product principles.
3. Record a concise ADR under `docs/adr/` with rationale and tradeoffs; update `spec.md` only for actual design changes.
4. Add/update tests before expanding feature scope.
5. Ask the owner **only** when a required choice materially changes user experience, authority, privacy/security, costs, or one of the locked decisions.

Never claim implementation is complete without a working demo and explicit acceptance evidence. Follow `AGENTS.md` for development-agent behavior and `todo.md` for execution order.
