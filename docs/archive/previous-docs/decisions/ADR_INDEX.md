# ADR Index

This index is the canonical decision register. A decision becomes authoritative only when its ADR is accepted and the implementation/status documents are aligned.

## Canonical decisions

- [ADR-001 — Monorepo structure and package boundaries](./ADR-001-monorepo-structure.md) (Accepted)
- ADR-002 — Tauri 2
- [ADR-003 — Native SQLite persistence strategy](./ADR-003-native-sqlite-persistence.md) (Accepted)
- ADR-004 — Drizzle integration
- ADR-005 — React/UI system
- ADR-006 — identity model
- ADR-007 — scoped RBAC
- ADR-008 — audit
- ADR-010 — feature system
- ADR-011 — HLC
- [ADR-012 — Peer-to-Peer Replication Transport (iroh Research Gate)](./ADR-012-iroh-p2p-transport-gate.md) (Proposed)
- ADR-013 — replication strategy evaluation
- ADR-017 — import/export
- ADR-018 — hardware
- ADR-019 — secure storage
- ADR-020 — release pipeline

## Core platform decisions

### ADR-021 — Shared-device authentication

One physical device may host multiple local user profiles. Device identity and user sessions are independent. Logout/switch-user does not inherently revoke device transport membership.

### [ADR-022 — Separate user and device identity](./ADR-022-separate-user-device-identity.md) (Accepted)

User authentication and transport/device identity are distinct. A session binds them; neither is used as a substitute for the other.

### ADR-023 — Versioned replication objects

Replication operates on versioned operations/objects, not blind table mirroring. Each entity declares schema, namespace and conflict semantics.

### [ADR-024 — First-class background tasks](./ADR-024-first-class-background-tasks.md) (Accepted)

Background work is durable, observable and platform-adapted. Android uses WorkManager where appropriate; Windows uses a native lifecycle/scheduling mechanism.

### [ADR-025 — Cross-organisation access](./ADR-025-cross-organisation-access.md) (Accepted)

Cross-org access is denied by default and must be an explicit capability with authorisation and audit.

### ADR-026 — Database encryption

Deferred until key hierarchy, performance, backup/recovery and migration semantics are defined.

### [ADR-027 — Typed native data gateway](./ADR-027-typed-native-data-gateway.md) (Accepted)

No arbitrary SQL or broad native authority from the frontend. Native operations are typed, scoped and capability-controlled.

### ADR-028 — Cryptography is a research gate

Do not hardcode final device-key custody until Windows/Android/transport compatibility is proven.

### ADR-029 — Platform/domain boundary

Platform packages remain domain-neutral. Features own business semantics. The demo is a consumer.

### ADR-030 — Production relay policy

Public relays are development/test infrastructure. Production uses dedicated/self-hosted relay infrastructure subject to operational requirements.

## ADR lifecycle

When architecture changes:

1. identify affected ADRs;
2. add a new ADR rather than silently rewriting history;
3. mark superseded decisions;
4. update architecture docs;
5. update implementation roadmap;
6. update tests/acceptance gates;
7. update agent guidance.
