# Canonical Platform Documentation

**Status:** authoritative living documentation
**Baseline reviewed:** 2026-09-05
**Source of truth:** the checked-in source tree, configuration, tests, and the evidence recorded in `verification/`

This directory is the **development backbone** for the Tauri local-first platform. It is written for both human developers and coding AI agents. It describes the architecture the repository is intended to evolve toward while explicitly distinguishing that target from what is actually implemented.

## Non-negotiable documentation rule

Never make an implementation claim from an interface, type, comment, diagram, or target architecture alone. A capability is **implemented** only when source code exists, the relevant tests/checks exist, and the verification status says it is implemented.

Use these labels consistently:

- **Current** — demonstrably present in the repository snapshot.
- **Target** — required architecture/pattern that future code must follow.
- **Gap** — known difference between Current and Target.
- **Research gate** — implementation must wait for evidence from current official documentation and/or a reproducible spike.

## Start here

1. `PROJECT_REFERENCE.md` — product/platform purpose, boundaries and invariants.
2. `verification/CURRENT_STATE.md` — evidence-based status and blockers.
3. `architecture/SYSTEM_ARCHITECTURE.md` — authoritative architectural model.
4. `architecture/SECURITY_ARCHITECTURE.md` — trust boundaries and security rules.
5. `architecture/DATA_AND_DATABASE.md` — persistence, migrations and transaction model.
6. `architecture/IDENTITY_AND_AUTHENTICATION.md` — device/user/session model.
7. `architecture/SYNC_ARCHITECTURE.md` — replication model and seven admission gates.
8. `development/AGENT_GUIDE.md` — rules for humans and coding agents.
9. `development/ROADMAP.md` — ordered implementation work.
10. `reference/IMPLEMENTATION_SPECIFICATIONS.md` — capability-level contracts.
11. `testing/ACCEPTANCE_GATES.md` — definition of done for production capability.
12. `research/RESEARCH_REGISTER.md` — unresolved questions and evidence requirements.
13. `decisions/ADR_INDEX.md` — architectural decisions and supersession rules.

## Directory structure

```text
docs/
├── README.md
├── PROJECT_REFERENCE.md
├── architecture/
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── DATA_AND_DATABASE.md
│   ├── IDENTITY_AND_AUTHENTICATION.md
│   ├── SYNC_ARCHITECTURE.md
│   ├── SECURITY_ARCHITECTURE.md
│   └── BACKGROUND_TASKS.md
├── development/
│   ├── REPOSITORY_STRUCTURE.md
│   ├── TECHNOLOGY_BASELINE.md
│   ├── DEVELOPMENT_WORKFLOW.md
│   ├── AGENT_GUIDE.md
│   └── ROADMAP.md
├── testing/
│   ├── TEST_STRATEGY.md
│   └── ACCEPTANCE_GATES.md
├── research/
│   ├── RESEARCH_REGISTER.md
│   └── SOURCES.md
├── decisions/
│   └── ADR_INDEX.md
├── reference/
│   └── API_AND_DATA_CONTRACTS.md
└── verification/
    └── CURRENT_STATE.md
```

## How this stays live

Any change that materially affects behavior must update documentation in the same change:

1. implementation changes → update `verification/CURRENT_STATE.md` if status changes;
2. architecture changes → update the affected architecture document and ADR;
3. protocol/security changes → update the protocol contract, security model and regression tests;
4. migration/schema changes → update data documentation and migration status;
5. research resolution → update the research register, sources and ADR;
6. roadmap progress → close/re-scope the corresponding work item;
7. new feature → document ownership, permissions, data model, sync policy and tests.

Historical material may be moved manually into `docs/archive/`. Archived documents are evidence only and **must not be used as the current development contract**.
