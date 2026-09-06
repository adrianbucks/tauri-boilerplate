# Feature System Architecture

## Current

`@platform/feature-system` provides manifest types, validation, a dependency resolver and registry. Existing features are `organisations`, `identity-admin` and `example-feature`.

## Target

A feature is a build-time module with explicit metadata:

```text
Feature
├── manifest
├── permissions
├── migrations
├── repositories
├── services
├── UI/navigation metadata
└── sync policy declarations (when applicable)
```

Features are statically compiled into the application by default. Runtime arbitrary plugins are deferred because they expand the attack surface and complicate trust/capability isolation.

## Dependency rules

- feature dependencies must be declared in the manifest;
- dependency resolution is deterministic;
- cycles fail startup/build;
- optional dependencies must have explicit fallback behavior;
- platform packages must never depend on a concrete business feature.

## Feature lifecycle

1. validate manifest;
2. resolve dependency order;
3. register permissions;
4. register migrations;
5. initialise services;
6. expose UI/navigation according to authorization;
7. participate in sync only when a sync policy is declared.

## Feature-owned schema

A feature must own its domain tables and migrations. It must not create `core_*` platform tables from UI/application bootstrap code.

## Permissions

Permission names are stable identifiers, for example:

```text
organisations.read
organisations.create
organisations.manage
```

Features must use central authorization rather than role-name checks.
