# Focused Plan: Release, Verification, and Documentation Review

**Status:** Planned; begin during the baseline for document accuracy, then complete after implementation reviews.

## Scope

Inspect GitHub workflows, package scripts, Turbo task graph, Cargo/pnpm toolchain pins, capability and release configuration, and current status/reference documents. Confirm repository-level claims against actual configuration and available execution evidence.

## Review sequence

1. Inventory checks actually run in CI and locally; compare with `verify`, contributor guidance, status claims, and gate evidence.
2. Inspect workflow triggers, permissions, pinned actions, secrets handling, artifact naming, signing/provenance steps, and failure behavior.
3. Verify dependency and runtime versions against manifests and lockfiles; investigate advisories with official sources when needed.
4. Resolve stale links, duplicated/contradictory statuses, outdated known limitations, gate numbering, and work-package registers.
5. Update each affected document alongside reviewed code; mark unexecuted or platform-limited checks clearly.

## Acceptance criteria

- No status is presented as verified without an identified passing check or other concrete implementation evidence.
- CI and developer instructions describe commands that exist and agree on required checks.
- Gate and work-package IDs are consistent across indexes and detailed registers.
- Release/security claims match workflow configuration and evidence; optional downstream steps are distinguished from template defaults.
- Documentation links touched by the review resolve, and current vs target architecture is clearly labeled.
- Final verification results include commands, outcomes, and limitations; no unrun check is reported as passing.

## Findings

Initial documentation inconsistencies are listed in the parent [review plan](./codebase-review-plan.md). Release workflow claims have not yet been validated.
