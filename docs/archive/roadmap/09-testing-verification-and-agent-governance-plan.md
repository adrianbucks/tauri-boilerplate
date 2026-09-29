# Testing, Verification and Agent Governance Plan

## Objective

The test system must prove platform invariants, not merely exercise
methods.

## 1. Test layers

### Unit

Pure logic:

- HLC;
- permission evaluation;
- manifest validation;
- conflict policy;
- namespace generation.

### Component/service

- repository;
- services;
- migrations;
- identity lifecycle;
- feature registration.

### Integration

- full platform bootstrap;
- persistent SQLite;
- native commands;
- feature registration;
- transaction behaviour.

### Security

- tenant isolation;
- identity;
- signatures;
- pairing;
- replay;
- revocation;
- sync authorization.

### Sync/convergence

- two or more actual instances;
- offline writes;
- reconnect;
- conflict;
- duplicate operations;
- tombstones.

### Release

- Windows package;
- Android APK;
- signing;
- upgrade;
- clean install.

## 2. Test doubles

Memory/sql.js implementations remain useful for fast unit tests.

They must not be used as evidence that production SQLite behaves
correctly.

Likewise, simulated sync harnesses are useful for deterministic protocol
tests but cannot prove iroh transport correctness.

## 3. Invariant testing

Every critical invariant should have at least one automated regression
test.

Examples:

```text
No private key reaches TS.
No cross-tenant role is effective.
No unauthorised peer receives payload.
Duplicate operation never mutates twice.
Business mutation and sync operation commit atomically.
Deleted synchronisable records cannot resurrect.
```

## 4. Architecture linting

Add automated checks for:

- forbidden imports;
- UI → database bypass;
- domain code in platform packages;
- sync entity without sync policy;
- broad Tauri capabilities;
- hard-coded role checks;
- direct raw DELETE for synchronisable tables.

## 5. Agent workflow

AI agents should work from:

1.  architecture;
2.  implementation plan;
3.  focused research register;
4.  invariants;
5.  acceptance tests.

Agents must not infer undocumented behaviour for evolving dependencies.

## 6. Definition of done

A feature is not complete until:

- implementation exists;
- integration exists;
- tests exist;
- security implications are tested;
- documentation reflects reality;
- platform boundary is respected.
