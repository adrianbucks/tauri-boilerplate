# ADR-001: Repository Structure and Workspace Tooling

**Status**: Accepted  
**Date**: 2026-08-30  
**Authors**: Antigravity Pair Programming

---

## Context

The `tauri-boilerplate` project needs to support building cross-platform (Windows and Android) local-first business applications. The repository must serve as a GitHub Template Repository that downstream developers can fork or clone without coupling their domain implementations to the boilerplate code.

## Options Considered

### Option A: Monorepo containing all production apps

- All downstream applications (`wms`, `erp-lite`, `logistics`) reside inside `apps/` in a single monorepo.
- _Downsides_: Tight coupling across unrelated business domains, bloated repository size, dependency version conflicts, difficult access control.

### Option B: GitHub Template Repository with clean Boilerplate/Implementation Separation (Chosen)

- The repository is the standalone platform starting point.
- Only a single showcase application (`apps/demo`) lives in the repository to validate all capabilities.
- Downstream developers fork/clone the template, replace `apps/demo` with `apps/<their-app>`, add domain features into `features/`, and consume `packages/` and `crates/` without modifying platform internals.
- Workspace managed via `pnpm` workspaces and `Turborepo`.

## Decision

We adopt **Option B**:

1. `pnpm` workspaces for package management (`apps/*`, `packages/*`, `features/*`, `tooling/*`).
2. `Turborepo` for pipeline task orchestration (build, lint, typecheck, test).
3. `Cargo` workspace for Rust library crates (`crates/*`) and Tauri apps (`apps/demo/src-tauri`).
4. Strict separation between boilerplate packages and domain features.

## Consequences

- Clean ownership model for downstream developers.
- Platform improvements can be contributed back upstream via pull requests.
- No cross-app dependency leakage.
