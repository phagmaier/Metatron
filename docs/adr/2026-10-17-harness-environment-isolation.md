# Harness process environments are explicit credential boundaries

## Context

M8 item 7 requires preserving personal harness config/sessions and forbidding silent token copying between tools. Codex, Pi RPC and Pi's version subprocess inherited `process.env`, including another harness's setup-token, session selectors and executable preload variables. Claude's broad cloud-prefix allowances forwarded unrelated `GOOGLE_*`/`AWS_*`/`AZURE_*` secrets even without an enabled cloud route. Inert regression canaries reproduced these exposures; this is not evidence of real credential exfiltration or an explanation for the historical personal Pi writes.

## Decision

- `adapters/environment.ts` defines the common minimal runtime environment and reviewed native credential names. Never inherit arbitrary environment variables, preload hooks, personal-session selectors or unrelated gateway tokens.
- **Codex:** runtime variables plus app-owned `CODEX_HOME` and its explicitly issued gateway token. Authentication remains the owner's native login in that app-owned home; ambient provider API keys and other harness tokens are not forwarded.
- **Pi:** runtime variables plus the installed 1.3.0 provider variables documented in [providers.md](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/providers.md). App-owned config/session paths, offline/telemetry policy and gateway overlay are explicit. Its version child gets no provider credentials. Unknown custom credential-variable names require configuration through Pi's supported app-owned authentication rather than implicit inheritance.
- **Claude:** retain admitted API-key/setup-token values and all provider-enable flags, preserving existing native route precedence. Exact cloud credential/configuration variables are forwarded only for explicitly enabled (`1`) Bedrock, Vertex or Foundry routes; arbitrary namespace matches are forbidden. Shared API-key environment names may intentionally be admitted by multiple supporting harnesses; a Claude setup-token is Claude-only.
- **OpenCode:** keep its existing fixed four-key policy and private HOME/XDG/config/server identity unchanged. No personal login files are read/copied by the application. Explicit native cloud routes can still use their supported cloud credential chains; this is not a promise to sandbox cloud authentication.
- A completed Claude session clears its lease handle before unlinking it. Completion and later disposal cannot both remove the same pathname after a successor has acquired it.

## Consequences and verification

Nine regressions fail on the previous implementation and pass after repair: three actual subprocess inheritance/preload paths, five Claude cloud-route combinations and the successor-lease interleaving. `pnpm smoke:isolation` runs actual installed binaries with disposable seeded personal homes, inert credential canaries, private app data and no model prompt; it checks actual child environments, app-file canary copies, metadata and process identities without reading real credential contents. No personal session is attached, resumed, interrupted or used for authentication.

This narrows previously excessive inheritance without changing authority, model selection or tool policy. New providers/credential variables need an explicit reviewed list update. Current evidence is bounded: trusted executables/app-owned directories, metadata snapshots rather than syscall tracing, direct-child process ownership rather than descendant isolation. No OS sandbox, live cloud entitlement or historical Pi-write attribution is claimed. The per-adapter smoke matrix remains M8 item 8.

Official configuration references: [Bedrock](https://code.claude.com/docs/en/amazon-bedrock), [Vertex](https://code.claude.com/docs/en/google-vertex-ai), [Foundry](https://code.claude.com/docs/en/microsoft-foundry). Version-specific installed Pi docs and Claude CLI 2.1.302 / SDK 0.3.302 were checked; native cloud credentials were not authenticated.
