# M9: an applied integration advances its own run's base

## Context

Each run records its repository identity and base commit. Before every dispatch and worktree creation, the engine refuses to continue when the checkout's HEAD differs from that base ("Repository identity or HEAD changed since this run started"), so a run never builds on commits it did not see. Acceptance scenario B (§13.4) showed the consequence: a dependency is satisfied only at `DONE`, which an approved integration reaches by fast-forwarding the run's branch. The fast-forward then moved HEAD, and the dependent task the integration had just released was blocked forever, as was any further work in that run.

## Decision

When this app's own application of an owner-approved integration is verified as `applied`, the same transaction advances the run's recorded base from the application's expected commit to the observed result, but only if the run is based on the destination branch and its recorded base equals that expected commit. A `run.base_advanced` event records branch, from, to and integration. Later worktrees therefore start from the integrated result.

Nothing else moves a base. An owner commit, a branch switch, another run's integration, or a destination the run is not based on still fails the identity check, and the owner starts a new run.

## Consequences

Dependents and later work in the same run see the integrated code. Integration still requires explicit owner approval and confirmation; this changes no authority. Existing reviews and revisions of candidates captured on the earlier base still refuse to start ("owner review required") because their recorded base no longer matches; integration previews of such candidates keep using drift and conflict detection. Other runs on the same repository stay blocked after any integration until the owner starts a new run.
