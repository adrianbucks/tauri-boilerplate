# S-08 --- Feature System and Migrations

**Status:** Ready\
**Priority:** P1

## Objective

Make features independently composable without bypassing platform
invariants.

## Manifest

Declare feature ID/version, dependencies, optional dependencies,
permissions, migrations, sync policies, navigation and native
capabilities where applicable.

## Dependency validation

Validate missing dependencies, version incompatibility, cycles,
duplicate feature IDs, duplicate permissions and migration collisions.

## Migration ownership

Feature migrations use an owned namespace such as
`feature.organisations:0001`. Application migrations remain separate.

## Boundary

Features may depend on platform interfaces but not demo application
internals. Platform packages must not depend on domain feature packages.

## Tests

Dependency cycle; missing dependency; incompatible version; duplicate
permission; migration collision; invalid sync policy; forbidden import;
disabled-feature registration.

## Implemented baseline

Feature registration now rejects duplicate feature IDs, and dependency
resolution rejects permission names declared by more than one feature.
Migration ownership is persisted in `core_migrations.owner`; platform
migrations use `platform` and feature migrations use `feature.<feature-id>`.
Migration identity is the `(owner, version)` pair, allowing independent
features to start their migration sequence at version `1`.
