import type { Attempt } from "./domain/entities.ts";

// Owner controls this app wires for each harness, whatever else the native
// protocol exposes. null means available; otherwise the owner-facing reason it
// is not. Discovery, server checks and the GUI read the same values, so a
// control is never offered and then refused.
export const steeringUnsupported: Record<Attempt["adapter"], string | null> = {
  fake: null,
  pi: null,
  codex:
    "Codex runs only as the Lead; this app does not use its native turn/steer, so owner messages wait for the next Lead turn",
  "claude-code":
    "This app sends no live input to Claude workers; stop or reassign the task to change its instructions",
  opencode:
    "This app sends no live input to OpenCode workers; stop or reassign the task to change its instructions",
};

// Worker resume across attempts. Every native attempt gets a new worktree, so
// a harness that cannot reopen its session there can never resume one.
export const resumeUnsupported: Record<Attempt["adapter"], string | null> = {
  fake: null,
  pi: "This Pi adapter does not reopen native sessions",
  codex: "Codex is not a worker harness in this build",
  "claude-code":
    "Claude SDK resume requires the original checkout; assignments create a fresh isolated worktree",
  opencode:
    "OpenCode native resume requires the original checkout; assignments create a fresh isolated worktree",
};
