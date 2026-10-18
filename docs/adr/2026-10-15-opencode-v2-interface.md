# Use the OpenCode v2 client for the installed v2 harness

Date: 2026-10-15 · Status: accepted; implemented and natively verified in M8 item 2 on 2026-10-17

## Context

Spec §5.3 lists `@opencode-ai/sdk` and the v1 server as candidate surfaces, subject to installed-version verification. The actual binary is **OpenCode v2.0.29**. Its CLI describes `serve` as the v2 API/web server. [Official v2 client docs](https://opencode.ai/v2/docs/build/client) specify **`@opencode/client`**, whose published 2.0.29 declarations were inspected without executing or installing it. Its session interruption and event methods differ from v1. The v2 CLI also defaults to a shared user service, which must not be disrupted by application tests.

## Decision

Use exact `@opencode/client@2.0.29` and an owned `opencode serve --hostname 127.0.0.1 --port 0` foreground child per private session state. Capture complete URL/password control lines privately, verify native PID/loopback identity, and wait for per-location policy/plugins and worker instructions to activate. Never use default shared-service ensure/stop or personal configuration/session state. Provider credentials stay in the curated native environment, separate from the private HTTP password.

Disable project configuration/instructions and unsafe Code Mode/browser integrations. Native policies deny unknown actions; every allowed file operation asks the app, whose source-bound checkout/path validation remains authoritative. A mutation receives only `once`, never persistent approval. Native `reject` rejects all pending session requests, so owner denial stops that turn and expires other callbacks. These guards are not an OS sandbox.

Prompt `resume:true` wakes only explicitly authorized new input after empty-inbox/idle checks; interrupt always uses `resume:false`. Success needs authoritative native completion, effective model/variant evidence, reconciliation and owned shutdown (normally exit 130). Live-only stream loss fails closed; only clean same-checkout sessions may explicitly resume. Release a lease once; later disposal must never unlink a successor's lease.

## Consequences

The installed server emits transient `session.text.delta` events absent from its generated `V2Event` union; validate the observed installed payload and reconcile durable text endings without duplicates. Preserve decision/interrupt HTTP acknowledgements before terminal SSE triggers shutdown. Model variants are not a universal reasoning scale; discovery is not entitlement. [Native proof and limits](../adapter-recon.md#m8-item-2--native-opencode-validation-2026-10-17) cover the selected owner-authorized DeepSeek route; live steering, usage accounting, native gateway/Lead and four-harness gates remain unclaimed. No new service framework, generic model API or spec change.
