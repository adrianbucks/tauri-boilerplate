# Dependency Map

## TypeScript packages

```text
@platform/core
  ├── database
  ├── identity
  ├── authorization
  ├── audit
  ├── sync-protocol
  ├── feature-system
  ├── hardware
  ├── import-export
  └── ui

@platform/database ───────┐
@platform/identity ───────┤
@platform/authorization ──┤
@platform/audit ──────────┤
@platform/sync-protocol ──┼──> @platform/sync
@platform/feature-system ─┤
@platform/import-export ──┤
                          └──> @platform/platform

features/* ───────────────> platform packages
apps/demo ────────────────> platform packages + features
```

The exact package manifests remain authoritative if this diagram diverges.

## Rust workspace

```text
native-core
identity-core
crypto-core
sync-core
      ↑
demo-app-native
```

The current Rust crates are small and mostly scaffold functionality. In particular, `sync-core` has no iroh dependency in the supplied snapshot.

## Boundary rule

Dependencies may point downward toward mechanisms, not upward toward concrete applications. If a feature requirement appears to force a platform package to import a feature, move the abstraction boundary rather than creating a cycle.
