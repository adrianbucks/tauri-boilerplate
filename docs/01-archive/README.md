# Platform Documentation

**Status:** Authoritative living documentation
**Last reviewed:** 2026-09-04

This repository is a platform boilerplate and reference application. Documentation must do two things at once:

1. Describe the **current codebase** honestly (scaffolds, simulations, and incomplete paths included).
2. Preserve **target architecture and coding patterns** so future work can reach a production-ready platform without inventing a new design.

The platform is not currently production-ready. See the [implementation status](./verification/status.md) before treating any capability as complete.

## Start Here

1. [Implementation status](./verification/status.md)
2. [Verification coverage matrix](./verification/coverage-matrix.md)
3. [Development roadmap](./development/roadmap.md)
4. [Architecture principles](./architecture/02-architecture-principles.md)
5. [Development and agent guidelines](./development/06-agent-and-developer-guidelines.md)

## Documentation Areas

### Architecture

- [Project overview](./architecture/01-project-overview.md)
- [Architecture principles](./architecture/02-architecture-principles.md)
- [Database and schema](./architecture/03-database-and-schema.md)
- [Identity and authentication](./architecture/04-identity-and-authentication.md)
- [Authorization and RBAC](./architecture/05-authorization-and-rbac.md)
- [Synchronization and P2P](./architecture/06-synchronisation-and-p2p.md)
- [Feature system](./architecture/07-feature-system.md)
- [UI and components](./architecture/08-ui-and-components.md)
- [Import, export, and hardware](./architecture/09-import-export-and-hardware.md)
- [Demo application](./architecture/10-demo-application.md)

Architecture documents are dual-purpose: they keep the intended package boundaries, APIs, and invariants as the coding standard, and they record what is actually present today. Each architecture document opens with **Current / Target / Remaining**. Completeness claims follow the status matrix and the matching specification, not the target diagrams.

### Decisions

Accepted ADRs remain available in [decisions](./decisions/). They explain why the architecture was chosen; they do not override evidence from the current implementation status.

### Research

The [research register](./research/README.md) tracks unresolved technology and design questions. Research-required APIs, especially Tauri, iroh, SQLite bindings, and secure storage, must be verified with current documentation and a spike.

### Specifications

The [implementation specifications](./specifications/README.md) define S-01 through S-12, including acceptance criteria and research gates.

### Security and Protocols

- [Security model](./security/01-security-model.md)
- [Native command contracts](./security/02-native-command-contracts.md)
- [Handshake and sync protocol](./protocols/01-handshake-and-sync-protocol.md)

### Development and Operations

- [Repository structure](./development/01-repository-structure.md)
- [Technology baseline](./development/02-technology-baseline.md)
- [Implementation phases](./development/03-implementation-phases.md)
- [Testing strategy](./development/04-testing-strategy.md)
- [Build, release, and versioning](./development/05-build-release-and-versioning.md)
- [Agent and developer guidelines](./development/06-agent-and-developer-guidelines.md)
- [Roadmap](./development/roadmap.md)

## How to read these documents

| Layer         | Use it for                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Current**   | What exists in source today. Prefer [verification/status.md](./verification/status.md) over prose when they disagree. |
| **Target**    | Architecture, APIs, and patterns to follow when implementing the next increment.                                      |
| **Remaining** | Work still required for that area to meet production acceptance criteria.                                             |

Illustrative TypeScript in architecture docs is the intended contract unless a **Current** section says the live API differs. Do not delete target patterns just because they are unimplemented.

## Documentation Rules

- Do not call a scaffold, simulation, or placeholder production-ready.
- Keep target patterns in architecture docs; mark them as target when they are not implemented.
- Every implemented claim should link to source and an executable check where one exists.
- Every security change requires a security regression test.
- Every research-required decision records evidence, alternatives, and an ADR or explicit deferral.
- Update status, specification, and verification coverage when implementation changes.
