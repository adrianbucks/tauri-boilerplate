# Tauri Local-First Platform — Documentation

This is the central documentation hub for the **Tauri Local-First Platform Boilerplate** — a development scaffold for building cross-platform (Windows & Android), local-first business applications using Tauri 2, React, TypeScript, SQLite, and iroh P2P synchronisation.

> **Development Stage Notice** — The platform is under active development and not yet production-ready. See [`06-status/current-state.md`](./06-status/current-state.md) for the evidence-backed implementation status before treating any capability as complete.

---

## Quick Navigation

### I am a developer new to this project

→ Start with [`01-overview/project-overview.md`](./01-overview/project-overview.md), then [`04-guides/getting-started.md`](./04-guides/getting-started.md).

### I am building a feature or fixing a bug

→ Read the [`04-guides/developer-guide.md`](./04-guides/developer-guide.md) and the relevant [`02-architecture/`](./02-architecture/) section.

### I am an AI agent contributing to the codebase

→ Start with [`04-guides/agent-guide.md`](./04-guides/agent-guide.md) — this is mandatory reading. Then read the architecture section for the subsystem you are modifying.

### I want to use this as a template for my own application

→ Read [`04-guides/downstream-adoption.md`](./04-guides/downstream-adoption.md).

### I want to understand the current implementation status

→ See [`06-status/current-state.md`](./06-status/current-state.md) and [`06-status/roadmap.md`](./06-status/roadmap.md).

### I want to understand what's still in development

→ See [`07-in-development/README.md`](./07-in-development/README.md).

---

## Documentation Map

### [`01-overview/`](./01-overview/) — Project overview

High-level purpose, technology stack, distribution model, and full repository tour.

- [Project overview & goals](./01-overview/project-overview.md)
- [Technology stack](./01-overview/technology-stack.md)
- [Repository structure](./01-overview/repository-structure.md)

### [`02-architecture/`](./02-architecture/) — Architecture

In-depth technical architecture for every platform subsystem.

- [System architecture](./02-architecture/system-architecture.md)
- [Architecture principles](./02-architecture/architecture-principles.md)
- [Database & persistence](./02-architecture/database-and-persistence.md)
- [Identity & authentication](./02-architecture/identity-and-authentication.md)
- [Authorization & RBAC](./02-architecture/authorization-and-rbac.md)
- [Synchronization & P2P](./02-architecture/synchronization.md)
- [Background tasks](./02-architecture/background-tasks.md)
- [Feature system](./02-architecture/feature-system.md)
- [Native boundary & Tauri IPC](./02-architecture/native-boundary.md)
- [Security model](./02-architecture/security-model.md)
- [Import, export & hardware](./02-architecture/import-export-and-hardware.md)
- [UI & components](./02-architecture/ui-and-components.md)

### [`03-decisions/`](./03-decisions/) — Architecture Decision Records

Formal ADRs explaining every major technology and design decision.

- [ADR index](./03-decisions/README.md)

### [`04-guides/`](./04-guides/) — Developer & agent guides

Step-by-step guides for developers, AI agents, and downstream users.

- [Getting started](./04-guides/getting-started.md)
- [Developer guide](./04-guides/developer-guide.md)
- [Agent guide (AI agents)](./04-guides/agent-guide.md)
- [Feature development guide](./04-guides/feature-development.md)
- [Downstream adoption guide](./04-guides/downstream-adoption.md)
- [Testing guide](./04-guides/testing-guide.md)
- [Build & release guide](./04-guides/build-and-release.md)

### [`05-reference/`](./05-reference/) — Technical reference

Precise specifications, contracts, and reference tables.

- [API & native command contracts](./05-reference/api-contracts.md)
- [Sync protocol & wire format](./05-reference/sync-protocol.md)
- [Tauri capability matrix](./05-reference/capability-matrix.md)
- [Dependency map](./05-reference/dependency-map.md)

### [`06-status/`](./06-status/) — Implementation status

Evidence-backed view of what is implemented, what passes gates, and what remains.

- [**Current state (evidence-backed)**](./06-status/current-state.md)
- [Development roadmap](./06-status/roadmap.md)
- [Work packages](./06-status/work-packages.md)
- [Acceptance gates](./06-status/acceptance-gates.md)

### [`07-in-development/`](./07-in-development/) — Active development

Tracks everything still in progress: open gates, open research questions, known limitations.

- [In-development overview](./07-in-development/README.md)
- [Open work & gates](./07-in-development/open-gates.md)
- [Research register](./07-in-development/research-register.md)
- [Known limitations](./07-in-development/known-limitations.md)

### [`archive/`](./archive/) — Historical documents

Superseded documents preserved for historical context. Do not use for implementation guidance.

---

## Documentation Rules

1. **Evidence over aspiration** — Never describe a scaffold or simulation as production-ready.
2. **Current vs. target** — Architecture docs carry a "Current / Target / Gap" status header. Keep target patterns even when unimplemented; mark them clearly.
3. **Executable claims** — Every implemented capability links to source code and a passing test.
4. **Security regression tests** — Every security change is accompanied by a test in `tests/security/`.
5. **Code and docs stay in sync** — When modifying a subsystem, update the corresponding architecture and status docs.
6. **ADR lifecycle** — New architectural decisions get an ADR. Superseded ADRs are marked, not deleted.
