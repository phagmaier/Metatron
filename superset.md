# HOWTO: How Superset runs the Pi and Claude harnesses

This document explains how Superset starts, drives, and observes the Pi and
Claude coding agents, and where every part of the implementation lives. It is
written for a person (or coding agent) building a separate orchestration harness
who wants to copy or debug this design.

Paths are relative to the repository root. Line numbers refer to this checkout
(snapshot `491ca53f4c`, 2026-10-16). The implementation is not stable API: treat
the paths as a map, not as a contract.

Contents:

- [Short version](#short-version)
- [1. Which "harness" you mean](#1-first-decide-which-harness-you-mean)
- [2. Names and versions](#2-names-and-versions)
- [3. The chat path, end to end](#3-the-chat-path-end-to-end)
- [4. The Claude harness](#4-the-claude-harness)
- [5. The Pi harness](#5-the-pi-harness)
- [6. The ACP client in detail](#6-the-acp-client-in-detail)
- [7. File map](#7-file-map)
- [8. Adding or repairing a harness](#8-adding-or-repairing-a-harness-checklist)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Verification](#10-verification)
- [11. Minimal adapter skeleton](#11-minimal-adapter-skeleton)
- [12. Suggested reading order](#12-suggested-reading-order)
- [13. One-paragraph summary](#13-the-one-paragraph-summary)

---

## Short version

- **Chat** runs through ACP. The host spawns an adapter subprocess and speaks
  newline-delimited JSON-RPC 2.0 over stdio.
- **Claude chat** is `claude-acp`: the host spawns
  `@agentclientprotocol/claude-agent-acp`, which uses the Claude Agent SDK and
  starts the resolved `claude` CLI.
- **Pi chat** is `pi-acp`: the host spawns the `pi-acp` package, which starts
  `pi --mode rpc`.
- The links between them are the catalogue row
  (`packages/host-service/src/chat-v3/acpCatalogue.ts`) and the preset map
  (`packages/chat/src/core/harness/harness.ts`).
- **Terminal** agents are a different integration: the CLI runs in a PTY and
  Superset only receives lifecycle hooks. Claude uses hooks in
  `~/.claude/settings.json`; Pi uses an extension in
  `~/.pi/agent/extensions/`.
- When chat fails, check in this order: preset map, CLI resolution and version,
  adapter package resolution, ACP handshake/session.
- If you are copying this into your own project, read
  [§6](#6-the-acp-client-in-detail),
  [§8](#8-adding-or-repairing-a-harness-checklist), and
  [§11](#11-minimal-adapter-skeleton).

---

## 1. First decide which "harness" you mean

Superset integrates the same agent CLI in two unrelated ways.

| Surface | What runs | How Superset observes it | Pi | Claude |
|---|---|---|---|---|
| **Terminal agent** | The CLI runs in a PTY, exactly as a user would run it | Lifecycle hooks call `notify.sh`, which posts to the host; status is inferred from those events | Extension in `~/.pi/agent/extensions/` | Hooks merged into `~/.claude/settings.json` |
| **Chat harness** | The host owns a subprocess and speaks ACP (Agent Client Protocol) to it | ACP JSON-RPC over stdio, translated into Superset chat events | `pi-acp` adapter package | `claude-acp` adapter package (current), or the native Claude Agent SDK adapter (legacy) |

If a chat pane is not streaming, you want the second row. If the sidebar
indicator or completion chime is wrong, you want the first row.

The most important structural fact:

> **For chat, Superset does not implement either agent's turn loop.** It
> implements an ACP *client* (`AcpAdapter`) plus the launch/catalogue layer. The
> per-agent translation is an external npm package: `pi-acp` for Pi and
> `@agentclientprotocol/claude-agent-acp` for Claude. The Claude adapter uses the
> Claude Agent SDK, which spawns the Claude Code process.

That split is why almost every "harness does not work" failure is in one of four
places:

1. The preset was not mapped to the harness id.
2. The agent CLI could not be resolved, or is below the version floor.
3. The adapter package could not be resolved or spawned.
4. The adapter connected, but the session or turn handshake failed.

---

## 2. Names and versions

These names are easy to confuse because several different version numbers appear
next to each other.

| Name | Meaning in this repo |
|---|---|
| `chat-v3` | The current chat runtime and its host routes (`/chat-v3/trpc`, `/chat-v3/sessions/:sessionId/stream`). **Not** ACP protocol v3. |
| ACP protocol v2 | The wire protocol the `AcpAdapter` asks for in `initialize`. `LATEST_PROTOCOL_VERSION = 2`. |
| Chat protocol v1 | Superset's own envelope/item format, defined in `packages/chat/src/protocol/`. Unrelated to ACP versioning. |
| Harness id | The string stored on a chat session: `claude-acp`, `pi-acp`, `codex-acp`, `pdev-acp`, or the legacy `claude-code`. |
| Preset id | The user-facing agent id: `claude`, `pi`, `codex`, `opencode`, `pdev`. |

Pinned adapter versions in this checkout:

| Dependency | Version | Declared in |
|---|---|---|
| `@agentclientprotocol/claude-agent-acp` | `0.85.0` | `packages/host-service/package.json:78`, `apps/desktop/package.json:47` |
| `pi-acp` | `0.0.34` | `packages/host-service/package.json:104`, `apps/desktop/package.json:213` |
| `@anthropic-ai/claude-agent-sdk` | `0.3.286` | `packages/chat-runtime/package.json:24` |

---

## 3. The chat path, end to end

```text
desktop / mobile / your harness
        |
        |  tRPC: createSession { workspaceId, harness, ... }
        v
host-service  /chat-v3/trpc
        |
        v
chat-runtime  commands.createSession
        |
        |  journal.open()  -> chat.db
        v
LiveSessionRegistry.create()
        |
        |  harness factory lookup by id
        v
AcpAdapter.start()
        |
        |  spawn node <adapter>/dist/index.js
        |  env: CLAUDE_CODE_EXECUTABLE / PI_ACP_PI_COMMAND
        v
adapter child (claude-agent-acp or pi-acp)
        |
        |  ACP JSON-RPC over stdio
        v
agent CLI (claude or pi)
        |
        |  session/update notifications
        v
AcpAdapter -> AdapterEvent -> LiveSession -> journal -> subscription -> client
```

The flow in code:

1. **The client picks a preset and asks for the matching harness id.**
   `acpHarnessForPreset` is the single mapping used by desktop, mobile, and the
   workspace launcher:
   `packages/chat/src/core/harness/harness.ts:10-16`.

2. **The host creates a session through the runtime, not by spawning anything
   itself.**
   `packages/host-service/src/trpc/router/agents/agents.ts:615-735`
   (`chatLaunchTarget` and `launchChatAgent`) calls
   `chat.commands.createSession` and then `chat.commands.prompt`.

   The tRPC surface is `packages/chat-runtime/src/router/router/router.ts`
   (`createSession`, `prompt`, `respondToApproval`, `cancelTurn`,
   `setConfigOption`, `closeSession`, `forkSession`).

3. **The runtime records the session and builds a live adapter.**
   `packages/chat-runtime/src/commands/commands/commands.ts:208-237` opens the
   journal, checks `live.supports(harness)`, and calls
   `options.live.create(...)`.

   `packages/chat-runtime/src/sessions/registry/registry.ts:45-83` looks up the
   factory and calls `session.start({ cwd, modeId, modelId, resume })`.

4. **The factory decides what process to spawn and with what environment.**
   `packages/host-service/src/chat-v3/acpHarnesses.ts:31-106`.

5. **The adapter performs the ACP handshake and session setup.**
   `packages/chat-runtime/src/harness/acp/acpAdapter.ts:736-916`.

6. **Turns and notifications become chat items.**
   `packages/chat-runtime/src/harness/acp/acpAdapter.ts:918-1126`.

7. **The journal fans out to clients.**
   `packages/chat-runtime/src/index.ts:50-98` wires
   `LiveSessionRegistry`, `ChatJournal`, `SubscriptionHub`, and `ChatCommands`.
   `packages/host-service/src/chat-v3/mount.ts:147-223` mounts the tRPC and
   WebSocket routes.

### Harness selection table

| Preset | Harness id the chat uses | Adapter package | CLI binary | Env var that points the adapter at the CLI | Minimum version | Default mode |
|---|---|---|---|---|---|---|
| `claude` | `claude-acp` | `@agentclientprotocol/claude-agent-acp` | `claude` | `CLAUDE_CODE_EXECUTABLE` | `2.1.226` | `bypassPermissions` |
| `pi` | `pi-acp` | `pi-acp` | `pi` | `PI_ACP_PI_COMMAND` | ungated (`0.0.0`) | none; the agent's own default |
| `codex` | `codex-acp` | `@agentclientprotocol/codex-acp` | `codex` | `CODEX_PATH` | `0.160.0` | `agent-full-access` |
| `opencode` | `opencode-acp` | none; the CLI is its own ACP server | `opencode` | n/a | `1.15.5` | none |
| `pdev` | `pdev-acp` | none; the CLI is its own ACP server | `pdev` | n/a | ungated | `bypassPermissions`, with client-side approval modes |

The catalogue is `packages/host-service/src/chat-v3/acpCatalogue.ts:19-76`.
The preset mapping is duplicated, deliberately, in two packages:

- `packages/chat/src/core/harness/harness.ts:10-16` — client-side selection.
- `packages/host-service/src/chat-v3/acpCatalogue.ts:93-99` — host-side launch.

**Keep those two maps in sync.** A preset that the client thinks is ACP-capable
but the host cannot launch produces a chat pane whose session never starts.

### Driving a session from your own code

If your orchestrator runs in the same process as the runtime, you do not need
the tRPC layer. Build the runtime with a harness map and use the commands:

```ts
import { createAcpAdapter, createChatRuntime } from "@superset/chat-runtime";

const runtime = createChatRuntime({
  dataDir: "/path/to/data",
  // Pass this in a bundled app; the default is relative to this package.
  migrationsFolder: "/path/to/chat-migrations",
  harnesses: new Map([
    [
      "claude-acp",
      (options) =>
        createAcpAdapter({
          command: process.execPath,
          args: ["/abs/path/to/claude-agent-acp/dist/index.js"],
          cwd: options.cwd,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1", // only when execPath is Electron
            CLAUDE_CODE_EXECUTABLE: "/path/to/claude",
          },
        }),
    ],
    [
      "pi-acp",
      (options) =>
        createAcpAdapter({
          command: process.execPath,
          args: ["/abs/path/to/pi-acp/dist/index.js"],
          cwd: options.cwd,
          env: {
            ...process.env,
            PI_ACP_PI_COMMAND: "/path/to/pi",
          },
        }),
    ],
  ]),
});

const { sessionId } = runtime.commands.createSession({
  commandId: crypto.randomUUID(),
  scopeId: workspaceId,
  harness: "pi-acp",
  cwd: worktreePath,
});

runtime.subscribe(
  sessionId,
  { deltas: ["text", "tool_input", "terminal", "background"] },
  { send: (envelope) => console.log(envelope), close: () => {} },
);

runtime.commands.prompt({
  commandId: crypto.randomUUID(),
  sessionId,
  clientId: crypto.randomUUID(),
  content: [{ type: "text", text: "List the files in this repo." }],
});
```

The host does the same thing through `acpHarnessFactory`, which adds CLI
resolution, version gating, environment construction, and account capture. Use
the factory when you can; use this direct form only when you need a custom
launch.

---

## 4. The Claude harness

There are three Claude implementations in the tree. Know which one you are
looking at before changing anything.

| Harness id / surface | Implementation | Status |
|---|---|---|
| `claude-acp` | External `@agentclientprotocol/claude-agent-acp` driven by `AcpAdapter` | Current chat path for new chats |
| `claude-code` | In-repo `ClaudeAdapter` using `@anthropic-ai/claude-agent-sdk` directly | Legacy sessions; still registered |
| Terminal `claude` | PTY plus hooks in `~/.claude/settings.json` | Current terminal path |

### 4.1 The ACP catalogue entry

`packages/host-service/src/chat-v3/acpCatalogue.ts:20-30`:

```ts
"claude-acp": {
  registryId: "claude-acp",
  binary: "claude",
  args: [],
  minVersion: "2.1.226",
  adapter: "@agentclientprotocol/claude-agent-acp",
  executableEnv: "CLAUDE_CODE_EXECUTABLE",
  upgrade: "npm i -g @anthropic-ai/claude-code@latest",
  fullAccessModeId: "bypassPermissions",
  note: "2.1.226 verified against adapter 0.85.0: session/new returns the same modes and configOptions as 2.1.286.",
},
```

Field meanings:

- `binary`: the CLI the adapter should drive. It is *not* the adapter process.
- `args`: arguments passed to the adapter process, not to the CLI.
- `adapter`: package name to resolve to `<package>/dist/index.js`.
- `executableEnv`: the env var the adapter reads to find the CLI. Superset sets
  it to the resolved path.
- `fullAccessModeId`: the agent's own id for its unrestricted mode. A new chat
  starts in this mode unless the caller passes another one.
- `minVersion` / `upgrade`: the host-side version gate and the message shown to
  the user when the gate fails.

### 4.2 Launch, step by step

`packages/host-service/src/chat-v3/acpHarnesses.ts:31-106` is the whole factory.

1. Look up the catalogue entry by harness id. Unknown id returns `null`, which
   makes the runtime report `unknown harness ...`.

2. Resolve the adapter entry:

   ```ts
   function resolveAdapterEntry(packageName: string): string {
     const moduleRequire = createRequire(import.meta.url);
     const pkgJson = moduleRequire.resolve(`${packageName}/package.json`);
     return join(dirname(pkgJson), "dist/index.js");
   }
   ```

   If the package is not installed, `require.resolve` throws and the factory
   returns `null`. In a packaged desktop or sandbox this is the usual cause of
   `unknown harness claude-acp`.

3. Resolve and gate the CLI with `resolveAgentCli`
   (`packages/host-service/src/chat-v3/agentCli.ts:115-128`):

   - `agentCliCommand` prefers `~/.superset/bin/<binary>` (the Superset wrapper),
     then searches `PATH` using the chat agent's environment.
   - It runs `<command> --version` with a 10 s timeout.
   - It parses the first `x.y.z` from stdout or stderr.
   - If no version is found, or the version is below `minVersion`, it throws.
     `claude` below 2.1.226 gets the upgrade instruction.

4. Build the environment with `buildChatAgentEnv`
   (`packages/host-service/src/chat-v3/agentEnv.ts:55-75`):

   - Starts from the same env a terminal gets.
   - Puts `~/.superset/bin` first on `PATH`, because a directly spawned agent
     never runs the shell bootstrap.
   - Adds the default account env for Claude/Codex accounts.
   - Outside a sandbox, removes ambient `ANTHROPIC_API_KEY` and
     `ANTHROPIC_AUTH_TOKEN`, so the agent uses the machine's Claude login.

5. Start the process. For an adapter-backed harness the returned launch object
   is (`acpHarnesses.ts:95-103`):

   ```ts
   {
     command: process.execPath,
     args: [adapterEntry, ...entry.args],
     env: {
       ...env,
       ELECTRON_RUN_AS_NODE: "1",
       [entry.executableEnv]: cli.command,
     },
   }
   ```

   `process.execPath` matters: host-service runs inside Electron in the desktop
   build. `ELECTRON_RUN_AS_NODE=1` makes the Electron binary behave as Node, so
   the adapter's `dist/index.js` runs instead of opening a second app.

6. Capture the account for usage attribution. The host reads
   `CLAUDE_CONFIG_DIR` or `ANTHROPIC_API_KEY` and calls
   `captureSessionAccount` (`acpHarnesses.ts:73-86`).

### 4.3 What the adapter does with Claude

The external adapter wraps the Claude Agent SDK and exposes it over ACP. Superset
never passes `--dangerously-skip-permissions` to the chat process. Instead it
sets the ACP session mode to `bypassPermissions`, and the adapter translates that
into the SDK's permission mode.

The generic adapter handles everything else:

- `initialize` (protocol negotiation),
- `session/new` or `session/load`,
- `session/prompt` per turn,
- `session/update` notifications,
- `session/request_permission`,
- `session/set_mode` (ACP v1) or `session/set_config_option` (ACP v2),
- `session/cancel`.

Claude-specific pieces inside the shared adapter:

- `_meta.claudeCode.toolName` and `_meta.claudeCode.mcpServer` are used to fill
  `ToolCall.toolName` and `mcpServer` when the agent does not send `name`
  (`packages/chat-runtime/src/harness/acp/acpAdapter.ts:1359-1368`).
- The `fullAccessModeId` default is applied only to a new session, not a resumed
  one (`acpAdapter.ts:1782-1789`). A resumed conversation keeps the mode it had
  unless the caller passes an explicit `modeId`.
- The adapter sends `session/new` with `mcpServers: []`. Superset does not pass
  MCP servers into the session; if your client needs MCP, send them in that
  field instead of relying on the agent's global config.

### 4.4 The legacy direct SDK adapter

This is still registered under the harness id `claude-code` in
`packages/host-service/src/chat-v3/mount.ts:54-78`:

```ts
["claude-code", (options) =>
  createClaudeAdapter({
    launch: async () => {
      const cli = await resolveAgentCli({
        binary: "claude",
        ...cliFloor("claude-acp"),
        env: () => buildChatAgentEnv({ ... }),
      });
      return {
        pathToClaudeCodeExecutable:
          process.env.SUPERSET_CHAT_V3_CLAUDE_BIN ?? cli.command,
        env: cli.env,
      };
    },
  }),
],
```

Why it exists:

- Sessions created before the ACP path carry `harness: "claude-code"`. The
  runtime can still resume and stream them.
- `presetForAnyHarness` maps `claude-code` back to the `claude` preset for
  display only (`packages/chat/src/core/harness/harness.ts:36-41`). It is not a
  valid choice for a new chat: `claude-code` is not in the ACP preset map, so
  the client will not offer it.

The implementation:

- `packages/chat-runtime/src/harness/claude/createClaudeAdapter/createClaudeAdapter.ts:10-19`
  injects the real SDK `query()`.
- `packages/chat-runtime/src/harness/claude/claudeAdapter/claudeAdapter.ts:177-393`
  owns the SDK session:
  - `PromptQueue` implements streaming input.
  - `query()` is called with `includePartialMessages: true`,
    `settingSources: []`, `permissionMode`,
    `allowDangerouslySkipPermissions: true`, `abortController`, and
    `canUseTool`.
  - `canUseTool` returns a promise held in `approvals` until
    `respondToApproval`.
  - `translateStream` turns SDK messages into chat events.
- `packages/chat-runtime/src/harness/claude/translateStream/translateStream.ts`
  is the message translator. `HARNESS_ID = "claude-code"`.
- `packages/chat-runtime/src/harness/claude/mapToolUse/mapToolUse.ts` maps
  Claude tool names (`Read`, `Edit`, `Bash`, `Grep`, `Agent`, ...) to
  `toolKind`, title, content, and locations.

Two design traps recorded for this adapter, relevant if you build your own
direct-SDK path:

- `allowedTools` shadows `canUseTool`: a tool listed there is auto-approved and
  the callback never fires. Do not set both.
- An `accept` decision must echo `updatedInput` back to the SDK. Without it, the
  tool call fails with a Zod error.

Neither trap exists on the ACP path, because approvals are ordinary ACP server
requests.

### 4.5 Terminal Claude

This is the non-chat path.

- Agent definition:
  `packages/shared/src/builtin-terminal-agents.ts:60-71`.
  The launch command includes `--dangerously-skip-permissions`; resume uses
  `--resume`; fork uses `--resume <id> --fork-session`.
- Hook installation:
  `packages/agent-setup/src/agent-wrappers-claude-codex-opencode.ts:147-171`.
  Superset merges its hooks into `~/.claude/settings.json` and removes only its
  own entries on teardown.
- Managed events: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`,
  `StopFailure`, `SubagentStart`, `SubagentStop`, `PostToolUse`,
  `PostToolUseFailure`, `PermissionRequest`
  (`agent-wrappers-claude-codex-opencode.ts:81-92`).
- Secondary accounts: `ensureClaudeManagedHooksAt(configDir)` writes the same
  hooks into a profile's `CLAUDE_CONFIG_DIR/settings.json`. Without it, an agent
  launched on a non-default account loses lifecycle events.
- Wrapper: `createClaudeWrapper`
  (`agent-wrappers-claude-codex-opencode.ts:296-306`) makes
  `~/.superset/bin/claude` execute the real binary. The chat path also benefits:
  `agentCliCommand` prefers that wrapper.

The hook command is `~/.superset/hooks/notify.sh` plus the agent id. The host
receives the payload at `packages/host-service/src/trpc/router/notifications/notifications.ts:90-201`,
records the terminal binding, and fans out lifecycle events.

---

## 5. The Pi harness

Pi has exactly one chat implementation: ACP through the `pi-acp` package. There
is no in-repo native Pi adapter.

| Surface | Implementation |
|---|---|
| Chat | `pi-acp` adapter package, harness id `pi-acp` |
| Terminal | `pi` in a PTY, plus the Superset Pi extension |
| Usage history | Parsed from `~/.pi/agent/sessions/` by the host |
| Oh My Pi (`omp`) | A Pi fork with the same session format; terminal-only in this repo |

### 5.1 The ACP catalogue entry

`packages/host-service/src/chat-v3/acpCatalogue.ts:58-66`:

```ts
"pi-acp": {
  registryId: "pi-acp",
  binary: "pi",
  args: [],
  minVersion: UNGATED_VERSION,
  adapter: "pi-acp",
  executableEnv: "PI_ACP_PI_COMMAND",
  note: "Ungated: no pi install was available to verify a floor against, and gating on a guess would reject working versions. It reached the same state before this catalogue, since the harness resolved pi off PATH either way.",
},
```

Why it is ungated: the maintainers had no verified minimum Pi version, and a
guessed floor would reject working installs. "Ungated" means the *comparison* is
skipped, not that the version probe is skipped: `resolveAgentCli` still requires
`pi --version` to print a parseable `x.y.z`, or it throws "pi was not found"
(`packages/host-service/src/chat-v3/agentCli.ts:109-126`). If Pi's version
output changes shape, chat will fail even though the catalogue says ungated.

### 5.2 Launch, step by step

1. `acpHarnessForPreset("pi")` returns `pi-acp`.

2. `acpHarnessFactory("pi-acp", ...)` resolves `pi-acp/package.json` and uses
   `pi-acp/dist/index.js`. The package declares `"main": "dist/index.js"` and a
   `pi-acp` bin that points at the same file, so either entry works; Superset
   hardcodes `dist/index.js`.

3. `resolveAgentCli`:
   - `~/.superset/bin/pi` is checked first. Superset does **not** create a Pi
     wrapper (`packages/agent-setup/src/agent-setup-targets.ts:23` has no
     `managedBinary`), so normally this falls through to `PATH`.
   - `pi --version` is probed.
   - Because the floor is `0.0.0`, any parseable version passes.

4. `buildChatAgentEnv` prepares the environment (same function as Claude).

5. The host spawns:

   ```text
   <node or Electron-as-node> <pi-acp>/dist/index.js
   env:
     PI_ACP_PI_COMMAND=<resolved pi path>
   ```

6. `pi-acp` spawns the real Pi process as `pi --mode rpc` and bridges:

   - ACP requests from the host -> Pi RPC commands,
   - Pi events -> ACP `session/update` notifications.

   Pi stores its own sessions under `~/.pi/agent/sessions/`. `pi-acp` keeps a
   small mapping file at `~/.pi/pi-acp/session-map.json` so `session/load` can
   reattach to the right Pi session file.

7. `AcpAdapter` performs the same handshake as it does for Claude. Pi has no
   `fullAccessModeId`, so a new chat opens in whatever mode Pi reports as its
   current mode. Modes and models arrive as ACP config options.

Pi authentication and model-provider configuration are not managed by Superset
for chat. They come from the user's Pi configuration (`~/.pi/agent`, plus
`PI_CODING_AGENT_DIR` if set). If Pi has no model provider configured,
`session/new` or the first prompt fails, and the ACP error is the only clue.

### 5.3 Pi-specific handling in the shared adapter

There is no Pi adapter class. There are three small Pi-shaped branches.

**Background shells.** Pi reports a shell tool result with
`rawOutput.details = { shellId, status, pid? }`. The adapter turns a running shell
into a `BackgroundTask` and can stop it by process group:

- detection: `packages/chat-runtime/src/harness/acp/acpAdapter.ts:1405-1442`,
- schemas: `acpAdapter.ts:2296-2305`,
- stop: `acpAdapter.ts:688-699` and `stopProcessGroup` at `acpAdapter.ts:2316-2324`.

**Model label.** Agents built on Pi (notably `pdev`) report
`_meta.piAcp.model`, either as a string or `{ provider, modelId }`. The adapter
strips the `vercel-ai-gateway/` prefix and uses the value as the item's model
label: `acpAdapter.ts:176-198`.

**Question answers.** ACP questions arrive as `session/request_permission`
options. When the agent offers an "Other" option, the adapter renders a form with
a free-text field and sends the typed answer as a new turn after the current one
ends: `acpAdapter.ts:1864-1930`, `1988-2039`.

Pi does **not** use `clientApprovalModes`; that is a `pdev` feature. Pi's
approval behavior comes from its own mode and ACP permission requests.

### 5.4 Terminal Pi

Agent definition:
`packages/shared/src/builtin-terminal-agents.ts:139-148`:

```ts
{
  id: "pi",
  label: "Pi",
  command: "pi",
  resumeCommand: "pi --session",
  forkCommand: "pi --fork {sessionId}",
  nonInteractiveCommand: "pi --no-tools -p",
}
```

The extension:

- Installed at `~/.pi/agent/extensions/superset-hooks.ts`
  (`packages/agent-setup/src/agent-wrappers-pi.ts:25-33`).
- Auto-discovered by Pi at session start. There is no registration step.
- Installed unconditionally: if Pi is installed later, hooks start working.
- Removed only if the file still carries the Superset marker.
- The install is global by design. Pi reads `PI_CODING_AGENT_DIR` exclusively
  when it is set, so an env-scoped install would shadow user extensions.

Hook mapping (`packages/agent-setup/templates/pi-extension.template.ts:73-107`):

| Pi event | Hook event sent to `notify.sh` | Effect in Superset |
|---|---|---|
| `session_start` | `SessionStart` | Bind the pane/terminal icon |
| `before_agent_start` | `UserPromptSubmit` | Start the working indicator |
| `tool_execution_end` | `PostToolUse` | Progress signal |
| `agent_end` | `Stop` / `Failed` | Completion chime or failure |
| `session_end` | `SessionEnd` | Detach the pane icon |
| `session_shutdown` | `Stop` | Clear the indicator on Ctrl+C/quit |

Three constraints in the template matter:

- It activates only when `SUPERSET_TERMINAL_ID` is set.
- It is a no-op when `notify.sh` is missing.
- It skips events when `ctx.hasUI === false`, so print mode (`-p`) and
  non-interactive subagents do not drive the UI.

One observable difference from Claude: this extension's payload contains only
`hook_event_name` and an optional `message`. It does **not** send a `session_id`.
If your orchestrator needs a Pi session id from terminal hooks, read it from Pi's
own `session_start` event or from the session files; do not expect it in the
notify payload as written. The built-in terminal definition still declares
`pi --session` as the resume command, but that command needs an id from
somewhere; the current extension does not supply one.

Usage history:

- Pi writes JSONL session trees under
  `~/.pi/agent/sessions/--<encoded-cwd>--/`.
- Oh My Pi uses `~/.omp/agent/sessions/`.
- The parser is `packages/host-service/src/trpc/router/usage/history/pi.ts:25-134`.
- Each file starts with a `{ type: "session", cwd }` header, then
  `{ type: "message" }` rows. Assistant rows carry `model` and a `usage` block
  with `input`, `output`, `cacheRead`, `cacheWrite`, and `cost.total`.
- Entries are appended exactly once; branching is by parent id, so no cross-file
  dedupe is needed.

---

## 6. The ACP client, in detail

Everything in this section is shared by Claude and Pi. If you are building your
own harness and only want to copy one layer, copy this one. The canonical wire
spec is the Agent Client Protocol at <https://agentclientprotocol.com>; the
schemas in `wire.ts` model only the subset Superset consumes.

### 6.1 The adapter contract

`packages/chat-runtime/src/harness/types.ts:23-39`:

```ts
export interface HarnessAdapter {
  start(options: HarnessStartOptions): AsyncIterable<AdapterEvent>;
  prompt(content: UserContent[]): void;
  cancelTurn(): void;
  canSteer?(): boolean;
  steer?(content: UserContent[]): Promise<boolean>;
  respondToApproval(approvalId: string, decision: Decision): void;
  setMode(modeId: string): void;
  setConfigOption?(configId: string, value: string): void;
  fork?(): Promise<string | null>;
  stopBackgroundTask?(taskId: string): Promise<boolean>;
  dispose(): Promise<void>;
}
```

`start` returns an async iterable of `AdapterEvent`:

```ts
type AdapterEvent =
  | { kind: "item"; item: Item; turnId: string }
  | { kind: "delta"; delta: Delta }
  | { kind: "turn"; turn: Turn }
  | { kind: "session"; session: Partial<SessionState> };
```

Adapters know nothing about persistence, cursors, sockets, or workspace
resolution. That is what makes them testable as pure stream translators.

### 6.2 Transport and JSON-RPC

`packages/chat-runtime/src/harness/acp/rpcClient/rpcClient.ts:33-106` spawns the
adapter:

- stdio pipes,
- one JSON object per line,
- `detached` on non-Windows so the whole process group can be killed,
- stderr forwarded for diagnostics (the adapter keeps the last 4,000 chars),
- `close()` ends stdin, waits 2 s, then SIGKILLs the group,
- an `exit` event is flushed after 500 ms so final stdout lines are not lost.

`AcpRpcClient` (`rpcClient.ts:158-289`) is a small newline-delimited JSON-RPC
2.0 client:

- `request(method, params, timeoutMs)` correlates numeric ids and rejects with
  `AcpTimeoutError`.
- `notify()` sends a notification.
- Incoming frames with a `method` and no `id` go to `onNotification`.
- Incoming frames with a `method` and an `id` go to `onServerRequest`; the host
  must answer with `respond` or `respondWithError`.
- Incoming frames with an `id` and a `result`/`error` settle a pending request.
- A malformed line is reported to stderr and skipped rather than killing the
  stream.

This is deliberately not a full JSON-RPC library. It tolerates agents that omit
the `jsonrpc` field on server frames, which some do.

### 6.3 Handshake

`AcpAdapter.bootstrap` (`acpAdapter.ts:736-916`) sends:

```ts
{
  protocolVersion: 2,
  info: { name: "superset", version: "1.0.0" },
  capabilities: { elicitation: { form: {} }, _meta: AIR_CLIENT_META },
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    elicitation: { form: {} },
    _meta: AIR_CLIENT_META,
  },
}
```

Notes:

- Both v1 and v2 field names are sent (`capabilities` and
  `clientCapabilities`) so one request works on either side of the bump.
- The client deliberately does **not** advertise filesystem or terminal
  delegation. Agents fall back to their own `Read`/`Edit`/`Bash` tools, which run
  inside the workspace. Do the same unless you want to implement those ACP
  services.
- Elicitation form support is required for Claude's `AskUserQuestion`; without
  it, that tool is dropped.
- The reply determines the negotiated version, agent name, capabilities, and
  whether `_session/steering` is supported.

Wire schemas live in
`packages/chat-runtime/src/harness/acp/wire.ts:31-69` (initialize, new session,
prompt) and `wire.ts:71-269` (all `session/update` variants).

A normal turn looks like this:

```text
client -> agent: initialize
agent -> client: { protocolVersion, agentInfo, capabilities }
client -> agent: session/new { cwd, mcpServers: [] }
agent -> client: { sessionId, modes, configOptions }
client -> agent: session/prompt { sessionId, prompt }
agent -> client: session/update ... (notifications)
agent -> client: { stopReason }
```

A permission request can arrive anywhere between `session/prompt` and its
response:

```text
agent -> client: session/request_permission (id)
client -> agent: { outcome: { outcome: "selected", optionId } }
```

### 6.4 Session setup

After `initialize`:

- If `startOptions.resume` is set, send `session/load` with
  `{ sessionId, cwd, mcpServers: [] }`.
  - On a "session not found" error, emit an informational notice, send
    `session/new`, and continue.
  - On any other error, fail the session with a real error; replacing the
    conversation would hide the agent's history.
  - During replay, `replaying = true`; user-message updates are recorded instead
    of dropped, and text items are matched by `messageId` where the agent
    supplies one.
- Otherwise, send `session/new`.

The response gives:

- the harness session id (stored as `SessionState.harnessSessionId`),
- modes (`currentModeId`, `availableModes`) on ACP v1,
- config options on ACP v2,
- optionally `_meta.piAcp.startupInfo` from `pi-acp`, which Superset currently
  ignores.

The adapter then applies the start selections:

- `modelId` -> the config option whose `category` is `model`.
- `modeId` -> `session/set_mode` on v1, or the `mode` config option on v2.
- `defaultModeId` (Claude's `bypassPermissions`) applies only to a **new**
  session. An explicit `modeId` applies to either.
- `AGENT_DEFAULT_MODE` (`"agent-default"`) is a sentinel meaning "do not apply
  any mode; let the agent open in its own mode". It is defined in
  `packages/chat/src/protocol/commands.ts:10-11`.

Important ACP v2 change: `session/set_mode` and `current_mode_update` were
dropped. In v2, a mode is a `select` config option whose `category` is `"mode"`.
The adapter handles both, but if you write your own client, do not assume
`session/set_mode` exists.

### 6.5 Turn lifecycle

One `session/prompt` request is one turn
(`acpAdapter.ts:918-962`):

1. Mint a turn id, emit `turn: running` and `session: running`.
2. Wait for any in-flight mode/model selections (`selectionsApplied`) so the
   agent does not run the prompt with the previous model or mode.
3. Send `session/prompt` with the converted content blocks.
4. On response, read `stopReason`:
   - `cancelled` -> `turn: interrupted`
   - `refusal` -> informational notice
   - anything else -> `turn: completed`
5. Flush open text, cancel pending approvals, emit `session: idle`, and deliver
   the next queued prompt.

If the request throws, the turn becomes `failed`, the error text is emitted as a
notice, and the session returns to idle.

Content conversion (`toAcpPrompt`, `acpAdapter.ts:2041-2086`):

- text -> `{ type: "text", text }`
- image attachment, when the agent advertises `promptCapabilities.image` ->
  `{ type: "image", mimeType, data }`
- any other attachment -> `{ type: "resource_link", uri, name, mimeType }`
- an attachment that cannot be read is dropped and a notice lists the names.

### 6.6 `session/update` mapping

`handleNotification` (`acpAdapter.ts:964-1126`) is the translation table:

| ACP update | Superset result |
|---|---|
| `agent_message_chunk` | `agent_message` item + text delta |
| `agent_message` (v2 whole message) | patches the item with the same `messageId` |
| `agent_thought_chunk` / `agent_thought` | `reasoning` item + text delta |
| `user_message_chunk` / `user_message` | dropped during a live prompt; recorded during `session/load` replay |
| `tool_call` / `tool_call_update` | `tool_call` item (upsert by `toolCallId`) |
| `tool_call_content_chunk` (v2) | appends content to the tool call |
| `plan` / `plan_update` | `plan` item |
| `available_commands_update` | `SessionState.availableCommands` |
| `current_mode_update` (v1) | `SessionState.modeId` |
| `config_option_update` (v2) | `SessionState.configOptions`, `modeId`, `availableModes` |
| `state_update` (v2) | `SessionState.status` (`running`, `idle`, `awaiting_input`) |
| `usage_update` | used to detect a turn cycle boundary; cost itself is not rendered here |
| `session_info_update` | `SessionState.title` |
| `async_task_spawned` / `_progress` / `_state_update` | `BackgroundTask` entries |
| `subagent_spawned` / `_state_update` / `subagent_update` | subagent `tool_call` item plus background task |

Text item identity deserves care:

- ACP v1 chunks have no message id; items group by kind and turn.
- ACP v2 names the message. A new `messageId` starts a new item even within the
  same kind and turn.
- A whole v2 message patches the item its chunks produced: omitted content
  leaves streamed text alone, `null`/`[]` clears it, an array replaces it.
- A flushed message can be reopened by a later chunk or patch with the same id.

That logic is `openMessage` / `handleMessage` / `flushOpenText` at
`acpAdapter.ts:1188-1308`.

### 6.7 Approvals and forms

Two different mechanisms arrive as ACP server requests:

1. `session/request_permission` — a tool or plan approval
   (`acpAdapter.ts:1823-1930`).
2. `elicitation/create` — a structured form
   (`acpAdapter.ts:1947-1987`).

For a permission request, the adapter:

- parses `toolCall` and `options`,
- decides whether the request is a question (`clientApprovalModes` and a
  non-"allow" title) or a permission,
- emits an `approval_request` item with `status: "pending"`,
- sets `SessionState.status = "awaiting_input"`,
- stores the JSON-RPC request id so the answer can be routed back.

`respondToApproval` (`acpAdapter.ts:554-588`) resolves the pending promise with:

- `{ outcome: { outcome: "selected", optionId } }` for a chosen option,
- `{ outcome: { outcome: "cancelled" } }` for cancel,
- `{ action: "accept" | "decline" | "cancel", content? }` for an elicitation
  form.

When the process dies, pending approvals are re-emitted as `stale` rather than
left forever pending (`stalePendingApprovals`, `acpAdapter.ts:2167-2176`).

If you build your own client, the two things most likely to bite you:

- Answer the **server request id**, not the tool-call id. They are different.
- The ACP permission response shape is `{ outcome: { outcome, optionId? } }`,
  not a bare string.

### 6.8 Modes and config options

`handleConfigOptions` (`acpAdapter.ts:1744-1780`) flattens ACP config options:

- only `select` options are kept,
- grouped options are flattened to leaves,
- the option whose `category` is `"mode"` becomes `modeConfigId`,
- `SessionState.modeId` comes from the mode option's `currentValue`,
- `SessionState.availableModes` comes from the mode option's choices.

`setMode` (`acpAdapter.ts:590-630`):

- if `clientApprovalModes` is on (pdev), it is host-side only; no wire request,
- otherwise, v1 sends `session/set_mode`,
- v2 sends `session/set_config_option` with `configId = modeConfigId` and
  `type: "id"`.

`setConfigOption` (`acpAdapter.ts:647-686`) is optimistic: it updates local state
first, sends the request, and rolls back on failure. A timeout is reported as
"the agent did not answer" but the local selection is kept, because the agent may
still apply it.

### 6.9 Cancel, resume, teardown

- **Cancel:** `session/cancel` notification with `{ sessionId }`
  (`acpAdapter.ts:535-552`). If the turn was only "held" waiting for mode/model
  reconciliation, it is ended locally with `interrupted`.
- **Cancel a request:** `$/cancel_request` from the agent drops the matching
  pending approval (`dropCancelledRequest`).
- **Resume:** `session/load`; fall back to `session/new` only on a missing
  session. Never silently replace a session on any other error.
- **Teardown:** `dispose()` closes pending approvals, background tasks, the RPC
  client, and the event queue (`acpAdapter.ts:726-734`). The transport closes
  stdin, waits 2 s, then kills the process group.

### 6.10 What the runtime adds on top

The adapter is only half of a working harness. `LiveSession` and `LiveSessionRegistry`
provide:

- **Prompt queueing.** `LiveSession.prompt` accepts prompts before the adapter is
  ready; they are queued and delivered in order
  (`packages/chat-runtime/src/sessions/liveSession/liveSession.ts:112-167`).
- **Turn accounting.** `awaitingTurn` is attributed when the adapter emits
  `turn: running`; queued prompts advance when a turn ends
  (`liveSession.ts:285-330`).
- **Steering.** Adapters that support `steer` can inject a prompt into a running
  turn; otherwise the prompt stays queued.
- **Durability.** Every durable event is appended to the journal; deltas are
  published live only.
- **Replay.** Subscribers pass a cursor and get journal replay before live
  delivery (`packages/chat-runtime/src/stream/subscriptions/subscriptions.ts`).
- **Lifecycle projection.** `packages/host-service/src/chat-v3/chatAgentBridge.ts:73-82`
  maps harness ids to agent identities and maps session status to
  `Start` / `PermissionRequest` / `Stop` / `Failed`, which drives the sidebar and
  notifications.

If you are building a standalone orchestrator, you can reuse `AcpAdapter` without
reusing the journal. `AcpAdapter` only needs:

- a `launch()` function returning `{ command, args, env }`,
- optional `resolveAttachment` and `storeImage`,
- an `onSpawn(pid)` callback if you track processes,
- `createTransport` only for tests.

---

## 7. File map

### Host launch layer

| Path | Responsibility |
|---|---|
| `packages/host-service/src/chat-v3/acpCatalogue.ts` | Every ACP harness's binary, adapter package, env var, version floor, default mode, and preset mapping |
| `packages/host-service/src/chat-v3/acpHarnesses.ts` | Factory: resolves adapter + CLI, builds env, returns a `HarnessFactory` |
| `packages/host-service/src/chat-v3/agentCli.ts` | PATH/wrapper resolution, version probe, floor check, error text |
| `packages/host-service/src/chat-v3/agentEnv.ts` | Chat agent environment: `~/.superset/bin`, terminal env, account env, ambient key stripping |
| `packages/host-service/src/chat-v3/mount.ts` | Builds the `harnessRegistry`, mounts `/chat-v3/trpc` and the WebSocket stream |
| `packages/host-service/src/chat-v3/chatAgentBridge.ts` | Harness id -> agent identity; status -> terminal lifecycle events |
| `packages/host-service/src/chat-v3/promptChatSession.ts` | Delivers a prompt to a live chat, guarding for dead sessions and delivery ownership |
| `packages/host-service/src/chat-v3/resolveCwd.ts` | Maps a workspace id to its worktree path |
| `packages/host-service/src/app.ts:339-350,491` | Creates the mount and registers the routes |
| `packages/host-service/package.json:78,104` | Adapter package pins |

### Chat runtime

| Path | Responsibility |
|---|---|
| `packages/chat/src/core/harness/harness.ts` | Preset id -> ACP harness id, plus the legacy display mapping |
| `packages/chat/src/protocol/commands.ts` | Command input schemas and `AGENT_DEFAULT_MODE` |
| `packages/chat-runtime/src/index.ts` | `createChatRuntime`: db, journal, sessions, subscriptions, registry, commands |
| `packages/chat-runtime/src/commands/commands/commands.ts` | `createSession`, `prompt`, `cancelTurn`, `respondToApproval`, etc.; command-id dedupe |
| `packages/chat-runtime/src/router/router/router.ts` | tRPC surface over the commands |
| `packages/chat-runtime/src/sessions/registry/registry.ts` | Harness factory registry and `LiveSession` creation |
| `packages/chat-runtime/src/sessions/liveSession/liveSession.ts` | Prompt queue, turn state, steering, journal writes |
| `packages/chat-runtime/src/stream/subscriptions/subscriptions.ts` | Replay-then-live fan-out, delta coalescing, reset frames |
| `packages/chat-runtime/src/harness/types.ts` | `HarnessAdapter` and `AdapterEvent` contracts |
| `packages/chat-runtime/src/harness/acp/acpAdapter.ts` | The ACP client: handshake, session, turns, updates, approvals, modes, resume |
| `packages/chat-runtime/src/harness/acp/rpcClient/rpcClient.ts` | Process spawn, newline JSON-RPC, request/response correlation |
| `packages/chat-runtime/src/harness/acp/wire.ts` | Zod schemas for ACP messages |
| `packages/chat-runtime/src/harness/acp/air/*` | Superset's `_meta` extensions: subagents, async tasks, steering |
| `packages/chat-runtime/src/harness/acp/imageBlocks/*` | Image content extraction and persistence |
| `packages/chat-runtime/src/harness/backgroundTasks/*` | Background task bookkeeping |
| `packages/chat-runtime/src/harness/eventQueue/*` | Async-iterable pump adapters emit through |

### Claude-specific

| Path | Responsibility |
|---|---|
| `packages/chat-runtime/src/harness/claude/createClaudeAdapter/createClaudeAdapter.ts` | Wires the real `query()` into the adapter |
| `packages/chat-runtime/src/harness/claude/claudeAdapter/claudeAdapter.ts` | Direct SDK adapter: streaming input, approvals, modes, dispose |
| `packages/chat-runtime/src/harness/claude/translateStream/translateStream.ts` | `SDKMessage` -> `AdapterEvent` |
| `packages/chat-runtime/src/harness/claude/mapToolUse/mapToolUse.ts` | Claude tool name -> `toolKind`, title, content |
| `packages/chat-runtime/src/harness/claude/fixtures/*.jsonl` | Recorded SDK streams for tests |
| `packages/agent-setup/src/agent-wrappers-claude-codex-opencode.ts` | Claude hooks in `settings.json`, wrapper, secondary profiles |
| `packages/shared/src/builtin-terminal-agents.ts:60-71` | Terminal Claude command, resume, fork |
| `packages/host-service/src/trpc/router/usage/history/entries.ts` | Claude (and Codex) session-log discovery and usage extraction |
| `packages/host-service/src/trpc/router/usage/claude.ts` | Claude account credentials and quota windows |

### Pi-specific

| Path | Responsibility |
|---|---|
| `packages/agent-setup/src/agent-wrappers-pi.ts` | Install/remove the global Pi extension |
| `packages/agent-setup/templates/pi-extension.template.ts` | Pi lifecycle hooks -> `notify.sh` |
| `packages/agent-setup/src/agent-setup.ts:111-114` | Registers Pi setup/teardown |
| `packages/agent-setup/src/agent-setup-targets.ts:23` | Pi is not a Superset-managed binary and has no `~/.superset/bin` wrapper |
| `packages/shared/src/builtin-terminal-agents.ts:139-148` | Terminal Pi command, resume, fork |
| `packages/host-service/src/trpc/router/usage/history/pi.ts` | Pi/OMP session-log parser |
| `packages/host-service/src/trpc/router/usage/history/pricing.ts` | Model pricing used by usage history |

### Tests and fixtures

| Path | What it proves |
|---|---|
| `packages/chat-runtime/src/harness/acp/acpAdapter.test.ts` | The most complete executable ACP contract in the repo: fake agent, streaming, approvals, modes, resume, replay, cancellation |
| `packages/host-service/src/chat-v3/acpHarnesses.test.ts` | Catalogue completeness, preset mapping, adapter executable env |
| `packages/host-service/src/chat-v3/chatAgentBridge.test.ts` | Chat status -> terminal lifecycle events |
| `packages/chat-runtime/src/harness/claude/claudeAdapter/claudeAdapter.test.ts` | Direct Claude adapter mapping |
| `packages/chat-runtime/src/harness/claude/claudeAdapter/claudeAdapter.live.test.ts` | Live Claude smoke, skipped by default |
| `packages/agent-setup/src/agent-wrappers.test.ts:2611-2635` | Pi extension rendering and install path |

### Packaging

| Path | Responsibility |
|---|---|
| `packages/sandbox/src/assets/produce.ts:280-360` | Installs `claude-agent-acp`, `codex-acp`, and `pi-acp` into the host-service runtime tarball |
| `apps/desktop/package.json:47-48,213` | Desktop must also carry the adapters, because host-service is bundled with it |

A packaged build that omits the adapter packages silently drops those harnesses
from the registry and reports `unknown harness claude-acp` /
`unknown harness pi-acp` at runtime. The bundle cannot inline them because the
host resolves them with `require.resolve` at runtime. This is recorded in
`docs/cloud-sandbox-mismatches.md:298-305`.

---

## 8. Adding or repairing a harness: checklist

Use this when adding a new ACP agent or when an existing one fails.

1. **Add a catalogue row**
   (`packages/host-service/src/chat-v3/acpCatalogue.ts`):
   - `binary`, `args`
   - `minVersion`, `upgrade`
   - `adapter` + `executableEnv`, or neither if the CLI is its own ACP server
   - `fullAccessModeId` only if the agent has a known unrestricted mode
   - `clientApprovalModes` only if approvals are host-side

2. **Map the preset in both places**
   - `packages/chat/src/core/harness/harness.ts`
   - `packages/host-service/src/chat-v3/acpCatalogue.ts`

3. **Add the adapter dependency** to:
   - `packages/host-service/package.json`
   - `apps/desktop/package.json` if the desktop bundles host-service
   - the sandbox tarball list in `packages/sandbox/src/assets/produce.ts`

4. **Verify the adapter entry.** It must exist at
   `node_modules/<package>/dist/index.js`, and the runtime that executes it must
   meet the adapter's Node engine requirement. `pi-acp` is ESM and expects a
   modern Node; in Electron, `ELECTRON_RUN_AS_NODE` uses Electron's bundled
   Node. The host hardcodes the `dist/index.js` path.

5. **Verify the executable env var.** The adapter must read the same variable
   the catalogue names. If the agent CLI is found by `PATH`, prefer a wrapper at
   `~/.superset/bin/<binary>` so the same binary is used everywhere.

6. **Check the version probe.** `resolveAgentCli` requires `--version` to print
   a parseable `x.y.z`, even for ungated harnesses. If the CLI prints something
   else, add a parser or a dedicated probe.

7. **Build the environment.** Use `buildChatAgentEnv` so the agent sees the same
   PATH, account, and workspace env as a terminal. Do not reconstruct `PATH`
   from the parent process.

8. **Decide the default mode.** A new chat with no mode uses
   `fullAccessModeId` when present; otherwise the agent's own current mode. If
   your agent blocks on a permission prompt at startup, this is the first thing
   to check.

9. **Advertise only the capabilities you implement.** Do not advertise ACP
   filesystem or terminal delegation unless the client really provides them.
   Superset deliberately advertises neither.

10. **Handle `session/load`.** Resume is not optional if you want history after
    a restart. Fall back to `session/new` only on a missing session; surface
    every other error.

11. **Write the failure path.** On spawn failure, exit, or bad handshake:
    - emit a `notice` with a useful message,
    - emit `session: dead`,
    - close the queue and the process group.

12. **Test the three layers separately:**
    - adapter mapping against a fake ACP agent (see `acpAdapter.test.ts`),
    - launch/gating with a temp `PATH` and a stub CLI (see `agentCli.test.ts`
      for the error-text cases),
    - end-to-end through the chat router with a real adapter.

13. **Update the docs** only after the code path is verified:
    - `apps/docs/content/docs/supported-agents.mdx`
    - `apps/docs/content/docs/add-agent-support.mdx` for third-party agents

---

## 9. Troubleshooting

| Symptom | Likely cause | Where to look |
|---|---|---|
| `unknown harness claude-acp` / `unknown harness pi-acp` | Adapter package not installed, or `require.resolve` failed | `acpHarnesses.ts:39-46`; check `node_modules/<adapter>/dist/index.js` |
| `claude was not found` / `pi was not found` | CLI not on the chat agent's `PATH`, or `--version` printed no version | `agentCli.ts:36-57,115-128`; check `~/.superset/bin` and the shell `PATH` |
| `claude 2.1.226 or newer is needed` | CLI below the floor | `acpCatalogue.ts:24`; upgrade with the printed command |
| Chat opens and immediately says `dead` | Handshake failed; usually login/auth or a bad adapter entry | The notice includes the last 4,000 chars of stderr (`acpAdapter.ts:2118-2120`) |
| `initialize` times out (120 s) | Agent is stuck at a login prompt or a model-provider setup screen | Run the CLI's login in a terminal, then reopen the chat |
| `session/new` fails with auth | Claude/Pi is not signed in, or the account env is wrong. The hint text names `claude /login` even for Pi, so use the matching agent's login flow | `authAwareMessage` (`acpAdapter.ts:2177-2185`); check `buildChatAgentEnv` |
| Prompt is accepted but no turn starts | Adapter is not ready, or the session is dead | `LiveSession.prompt` queue; `AcpAdapter.bootstrap` |
| `chat session ... is not running` | Process died or host restarted; the stored row outlives the process | Create a new session with `resume` |
| No stream updates in the UI | Wrong WebSocket URL or a bad `since` cursor | `mount.ts:169-223`; `SubscriptionHub` |
| Chat pane does not appear at all | `chat-v3` feature flag is off | `packages/shared/src/constants.ts:189-194` |
| "Switch to chat" is unavailable | `acp-chat` flag is off, or the preset has no ACP harness | `useAcpChatEnabled.ts`; `acpHarnessForPreset` |
| Claude chat always asks for permission | `fullAccessModeId` not applied, or the user selected another mode | `acpCatalogue.ts:28`; `applyStartSelections` |
| Mode switch does nothing on a v2 agent | Client is sending `session/set_mode`; v2 uses config options | `setMode` (`acpAdapter.ts:590-630`) |
| Approval never resolves | Client answered the tool-call id instead of the server request id | `handleServerRequest` / `respondToApproval` |
| Pi background shell never clears | Pi did not report a terminal status; the process poll did not run | `trackBackgroundShell` (`acpAdapter.ts:1405-1442`) |
| Pi extension does not fire | Not inside a Superset terminal, `notify.sh` missing, or `hasUI === false` | `pi-extension.template.ts:31-37,59-68` |
| Pi extension installed but ignored | `PI_CODING_AGENT_DIR` points Pi at a different config root | `agent-wrappers-pi.ts:19-24` |
| Packaged app cannot start chats | Adapter packages were not shipped in the runtime tarball | `packages/sandbox/src/assets/produce.ts:293-296`; `docs/cloud-sandbox-mismatches.md` |

### Logs and diagnostics

- The ACP adapter keeps a stderr tail and appends it to the error notice on
  process exit (`acpAdapter.ts:2088-2120`).
- A notification that cannot be parsed is reported through `onDispatchError` and
  becomes a notice rather than killing the stream.
- `onStderr` in `AcpRpcClient` is wired to that tail in `bootstrap`.
- The runtime does not log the exact launch command. If you need it, add a
  temporary log in `acpHarnesses.ts` around the `launch()` return.
  `SUPERSET_CHAT_V3_CLAUDE_BIN` bypasses discovery for the **legacy**
  `claude-code` harness only; the ACP `claude-acp` factory ignores it.

---

## 10. Verification

Run the focused suites first:

```bash
bun test packages/chat-runtime/src/harness/acp/acpAdapter.test.ts
bun test packages/host-service/src/chat-v3
bun test packages/agent-setup/src/agent-wrappers.test.ts
bun run typecheck
```

The ACP adapter test is the best specification of the wire behavior. Its
`FakeAcpAgent` auto-answers `initialize` and `session/new`, then scripts
`session/update` frames. Add a case there before changing the adapter.

The live Claude test is skipped:

```bash
# packages/chat-runtime/src/harness/claude/claudeAdapter/claudeAdapter.live.test.ts
# describe.skip("ClaudeAdapter live", ...)
```

Remove `.skip` locally and run it with a signed-in Claude CLI to exercise the
real SDK stream and approval callback. Do not commit it unskipped: it depends on
the machine's login and a model that may not be available.

### Manual ACP probe

If you need to see the adapter by itself, run it with a JSON-RPC frame on stdin.
Run this from a directory where the adapter package resolves, for example
`packages/host-service`:

```bash
node -e '
const { spawn } = require("node:child_process");
const path = require("node:path");
const entry = path.join(
  path.dirname(require.resolve("pi-acp/package.json")),
  "dist/index.js",
);
const child = spawn(process.execPath, [entry], {
  env: { ...process.env, PI_ACP_PI_COMMAND: "pi" },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stdout.on("data", (d) => process.stdout.write(d));
child.stderr.on("data", (d) => process.stderr.write(d));
child.stdin.write(JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: {
    protocolVersion: 2,
    info: { name: "probe", version: "1.0.0" },
    capabilities: {},
    clientCapabilities: {},
  },
}) + "\n");
setTimeout(() => child.kill(), 5000);
'
```

For Claude, resolve `@agentclientprotocol/claude-agent-acp` instead and set
`CLAUDE_CODE_EXECUTABLE` to the resolved `claude` path. A useful reply contains
`agentInfo`, `protocolVersion`, and capabilities. If it hangs, the adapter is
waiting on the CLI (usually login).

### What "working" looks like

A healthy chat session produces, in order:

1. `session: starting`
2. `session: idle` with `harnessSessionId`, modes/config options
3. on prompt: `turn: running`, `session: running`
4. streamed `agent_message` deltas/items and `tool_call` items
5. `turn: completed`, `session: idle`

If the sequence stops at 2, the adapter is alive but the prompt path is broken.
If it stops at 1, the handshake is broken. If there is no 1 at all, the factory
failed before spawning.

---

## 11. Minimal adapter skeleton

If you are writing your own harness, this is the shape that fits the runtime.
It is deliberately small and omits imports, fields, and transport helpers; the
real implementation is `AcpAdapter`.

```ts
import type {
  AdapterEvent,
  HarnessAdapter,
  HarnessStartOptions,
} from "@superset/chat-runtime";

export class MyAdapter implements HarnessAdapter {
  private queue = new EventQueue();       // async iterable of AdapterEvent
  private child: ChildProcess | null = null;

  start(options: HarnessStartOptions): AsyncIterable<AdapterEvent> {
    void this.bootstrap(options);
    return this.queue.iterable();
  }

  prompt(content: UserContent[]): void {
    // If the session is not ready, buffer; flush after session/new.
    void this.runTurn(content);
  }

  cancelTurn(): void {
    this.notify("session/cancel", { sessionId: this.sessionId });
  }

  respondToApproval(id: string, decision: Decision): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.respond(pending.requestId, {
      outcome: decision.type === "cancel"
        ? { outcome: "cancelled" }
        : { outcome: "selected", optionId: pending.allowOptionId },
    });
  }

  setMode(modeId: string): void {
    // v2: session/set_config_option with the mode config id.
    // v1: session/set_mode.
  }

  async dispose(): Promise<void> {
    await this.client?.close();
    this.queue.close();
  }

  private async bootstrap(options: HarnessStartOptions) {
    this.emitSession({ status: "starting" });
    this.child = spawn(this.command, this.args, { cwd: options.cwd, env: this.env });
    // create transport, send initialize, then session/new or session/load
    // capture sessionId, emit session: idle, flush queued prompts
  }
}
```

The non-obvious rules:

- Emit `session: starting` **before** any async work, so the UI has a state.
- Keep `prompt()` non-blocking. Queue until `session/new` returns.
- Every item needs a non-empty `turnId`. Use a synthetic history turn for
  replay items.
- Keep item start times strictly increasing. A replay can outrun the clock, and
  items with equal timestamps sort by random id.
- On failure, emit a `notice` and `session: dead`; do not leave the queue open.
- Do not put persistence or sockets in the adapter. The runtime owns those.

---

## 12. Suggested reading order

If you are trying to understand the whole thing, read in this order:

1. `packages/chat-runtime/README.md` — the pipeline in one page.
2. `packages/host-service/src/chat-v3/acpCatalogue.ts` — what a harness is in
   this system.
3. `packages/host-service/src/chat-v3/acpHarnesses.ts` — how it is launched.
4. `packages/chat-runtime/src/harness/types.ts` — the adapter contract.
5. `packages/chat-runtime/src/harness/acp/rpcClient/rpcClient.ts` — the
   transport and JSON-RPC client.
6. `packages/chat-runtime/src/harness/acp/acpAdapter.ts` — the translation.
7. `packages/chat-runtime/src/sessions/liveSession/liveSession.ts` — queues,
   turns, and journal interaction.
8. `packages/host-service/src/chat-v3/mount.ts` — how it is mounted.
9. `packages/chat-runtime/src/harness/acp/acpAdapter.test.ts` — the executable
   contract.

For the terminal path, read:

1. `packages/shared/src/builtin-terminal-agents.ts`
2. `packages/agent-setup/src/agent-setup.ts`
3. `packages/agent-setup/templates/pi-extension.template.ts`
4. `packages/agent-setup/src/agent-wrappers-claude-codex-opencode.ts`
5. `packages/host-service/src/trpc/router/notifications/notifications.ts`

---

## 13. The one-paragraph summary

For chat, Superset maps a preset to an ACP harness id, resolves the harness's
adapter package and CLI, spawns the adapter with `process.execPath` and an
`*_EXECUTABLE` env var, then speaks ACP JSON-RPC 2.0 over stdio: `initialize`
with protocol version 2, `session/new` or `session/load`, one `session/prompt`
per turn, and `session/update` notifications translated into items, deltas,
turns, and session state. Claude uses `@agentclientprotocol/claude-agent-acp` and
starts in `bypassPermissions`; Pi uses `pi-acp` and is ungated on version. The
same `AcpAdapter` handles both; the per-agent differences are the catalogue row,
the adapter package, and a few `_meta`/tool-result quirks. For terminals, the
agent runs in a PTY and Superset only observes lifecycle hooks, so a working
chat does not imply working terminal hooks, and vice versa.
