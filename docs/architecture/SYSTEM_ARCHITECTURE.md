# System Architecture

## Current / Target / Gap

### Current

The repository is a pnpm/Turborepo monorepo with TypeScript platform packages, feature packages, a React/Tauri demo and Rust crates. The intended layering is already visible in package dependencies.

### Target

```text
┌─────────────────────────────────────────────────────────────┐
│ Application / Feature UI                                    │
│ React pages, feature components, user workflows              │
└────────────────────────────┬────────────────────────────────┘
                             │ typed service calls
┌────────────────────────────▼────────────────────────────────┐
│ Application services / feature services                      │
│ validation → authorization → transaction → audit/outbox      │
└────────────────────────────┬────────────────────────────────┘
                             │ repositories / platform APIs
┌────────────────────────────▼────────────────────────────────┐
│ Platform services                                            │
│ core / identity / authorization / audit / sync / import etc. │
└────────────────────────────┬────────────────────────────────┘
                             │ trusted gateway
┌────────────────────────────▼────────────────────────────────┐
│ Native boundary (Tauri/Rust)                                 │
│ DB lifecycle, protected keys, OS APIs, transport             │
└──────────────┬───────────────────────┬──────────────────────┘
               │                       │
        ┌──────▼──────┐         ┌──────▼──────┐
        │ SQLite      │         │ iroh        │
        │ durable     │         │ transport   │
        └─────────────┘         └─────────────┘
```

### Gap

The current database is memory-only, native identity is placeholder material, authentication is not credential verification, and sync transport is simulated.

## Architectural invariants

1. UI never opens a database connection directly.
2. Domain services never trust caller-supplied identity as proof of identity.
3. Every privileged mutation authorises before state change.
4. Business state, audit event and outbound replication metadata are committed atomically where they belong to one business operation.
5. Network availability is never required for local CRUD.
6. Sync transport does not decide business authorisation; it only transports data after admission.
7. Private keys never enter JavaScript, web storage or ordinary database tables.
8. Cross-organisation access is denied by default.
9. Synchronisable deletes are tombstones, not hard deletes.
10. Protocol compatibility and schema compatibility are explicit, versioned decisions.

## Dependency direction

Preferred dependency flow:

```text
core
  ↑
database / identity / authorization / audit / sync-protocol
  ↑
sync / import-export / hardware / feature-system
  ↑
platform
  ↑
features
  ↑
apps
```

A lower-level package must not import a higher-level application feature. Domain packages must not be hidden inside platform infrastructure.

## Operation pipeline

```text
Untrusted UI input
  ↓ validate shape/domain input
Trusted session/principal
  ↓ authorize(permission, tenant, resource, auth strength)
Transaction boundary
  ↓ mutate domain state
  ├── append audit event
  └── append durable outbox operation
Commit
  ↓
UI receives safe result
```

## Sync admission pipeline

```text
1. Transport connection established
2. Peer cryptographic identity verified
3. Application/protocol compatibility verified
4. Organisation relationship verified
5. Device + user/session status verified where applicable
6. Sync-group membership verified
7. Namespace/data-scope permission verified
8. Only then exchange application data
```

The seven gates are logical security controls. Their implementation may span Rust, platform services and persisted policy, but no gate may be treated as a UI-only check.
