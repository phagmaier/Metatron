# Refuse hidden index state and executable Git drivers

## Context

M9's safety audit reproduced `git status` reporting a clean owner checkout while `assume-unchanged` or `skip-worktree` hid tracked edits. An inert repository clean filter also ran during app-issued status inspection despite hooks and external diff being disabled. Repository configuration can supply clean/smudge/process filters, executable merge drivers, or an implicit `union` merge driver that settles overlapping edits without a conflict.

## Decision

- Before inspecting checkout cleanliness, and again in the final checkout-state check before applying an integration, reject index entries with either hiding flag. Never clear flags or expand a sparse checkout automatically.
- Before every app Git command, query effective filter/merge-driver configuration with the same sanitized Git environment. Refuse nonempty executable clean/smudge/process filters or custom merge drivers. Do not log their values, rewrite repository config, or disable conversions silently: that could change candidate contents. This also checks configuration added after a project was opened.
- Set the implicit merge driver to Git's built-in `text` driver; explicit union/custom attributes remain subject to the existing overlap gate. Disable automatic signature verification and submodule recursion alongside the existing hook/fsmonitor/signing restrictions. Integration still requires the independent review and exact owner-approved apply plan.

## Consequences

Repositories requiring executable filters (including Git LFS), custom executable merge drivers, sparse checkouts or hidden index entries are unsupported by this beta. The app returns an actionable refusal; the owner decides how to prepare a compatible checkout. Each Git operation incurs one extra read-only configuration query. Ordinary full checkouts retain candidate conversion semantics and non-destructive integration behavior.

These are application guardrails, not hostile-code or filesystem isolation. External processes can still race checks. Worktrees, refs, index flags and repository configuration are retained; no cleanup, reset, stash or force update is introduced. Disposable-fixture regressions cover hidden edits, all three filter kinds, custom merge drivers, and conflicting edits under an implicit union default.
