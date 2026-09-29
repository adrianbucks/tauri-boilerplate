# ADR-001: Monorepo Structure and Package Boundaries

## Status
Accepted

## Context
The application platform requires a modular architecture supporting both client-side desktop/mobile applications (Windows and Android via Tauri 2), shared platform services (offline storage, replication, authorization, background execution), reusable business domain features, and native Rust primitives. Without strict package boundaries, business domain logic easily leaks into infrastructure, making the platform non-reusable.

## Decision
We organize the repository as a monorepo governed by `pnpm` workspaces and Turborepo, paired with a Cargo Rust workspace:

- `packages/`: Domain-neutral platform infrastructure (`@platform/*`). Contains core logging, database abstractions, identity services, authorization engine, replication protocols, background tasks, and hardware/UI abstractions. Must never import from `features/` or `apps/`.
- `features/`: Pluggable domain modules (e.g., `organisations`, `identity-admin`, `example-feature`). Encapsulate domain entities, migrations, repositories, permissions, and UI components.
- `crates/`: Native Rust libraries (`native-core`, `identity-core`, `crypto-core`, `sync-core`). Privileged native execution, OS key custody, cryptography, and durable file-backed SQLite.
- `apps/`: Concrete application binaries (e.g., `demo`). Responsible for composition, Tauri entry point, window management, and end-user workflows. Must not own platform infrastructure.
- `docs/`: Canonical architecture documentation, contracts, and ADRs.

## Consequences
- Clean separation of concerns between reusable platform mechanisms and application domain behavior.
- High barrier to accidental circular dependencies.
- Build caching and incremental verification via Turborepo.
