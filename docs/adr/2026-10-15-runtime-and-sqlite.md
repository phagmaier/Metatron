# Retain the pinned runtime and use built-in SQLite

Date: 2026-10-15 · Status: accepted for M0/M1

## Context

The supplied local `.mise.toml` pins Node 26.7.0 and pnpm 11.22.0; local `AGENTS.md` forbids changing these without owner approval. This Node version reports `process.release.lts` unset (Current), despite the general preference for LTS. `node:sqlite` is available without a native addon; the installed runtime reports SQLite 3.53.4. The [version-specific Node documentation](https://nodejs.org/download/release/v26.7.0/docs/api/sqlite.html) labels this module release candidate, stability 1.2.

## Decision

Preserve the owner's pins. Use `node:sqlite` / `DatabaseSync` for M1 persistence, with migrations, WAL, foreign keys and XDG paths as specified. M0 selects and probes it; M1 implements persistence. Use native TypeScript execution for erasable server/test syntax, with a separate strict typecheck; use Node's built-in test runner. Keep one package with `src/server`, `src/web`, and `src/shared`, as explicitly permitted by spec §3.2.

## Consequences

No SQLite addon installation, compiler toolchain or added package is necessary. The app depends on the pinned Node runtime; release-candidate SQLite APIs must be rechecked before runtime upgrades. A future move to LTS needs the owner's explicit approval and compatibility validation. No product scope, authority or isolation claim changes.
