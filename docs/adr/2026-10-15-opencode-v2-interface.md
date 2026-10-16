# Use the OpenCode v2 client for the installed v2 harness

Date: 2026-10-15 · Status: accepted interface choice; implementation deferred to M8

## Context

Spec §5.3 lists `@opencode-ai/sdk` and the v1 server as candidate surfaces, subject to installed-version verification. The actual binary is **OpenCode v2.0.29**. Its CLI describes `serve` as the v2 API/web server. [Official v2 client docs](https://opencode.ai/v2/docs/build/client) specify **`@opencode/client`**, whose published 2.0.29 declarations were inspected without executing or installing it. Its session interruption and event methods differ from v1. The v2 CLI also defaults to a shared user service, which must not be disrupted by application tests.

## Decision

For M8, use the matching official v2 Promise client and an app-owned private loopback server. Do not use the obsolete v1 SDK for this installation. Do not invoke shared-service ensure/stop operations against the user's default service. Verify the private-server authentication and launch contract before any model turn or permission-sensitive use; v1 password behavior is not assumed to apply to v2.

## Consequences

This preserves the native-harness/server architecture. `session.interrupt`, session IDs, location scoping and model variants need version-specific mapping. Authentication, reconnection/reconciliation and permission round trips remain unverified until adapter work. No OpenCode dependency is added during M0; no shared service is started or stopped. The spec's product design is unchanged.
