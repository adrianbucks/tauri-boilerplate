# ADR-010: Modular Feature Manifest & Registry System

## Status

Accepted

## Context

Downstream developers consuming the boilerplate need to add domain-specific features without altering core packages (`packages/`). Features must declare their own database migrations, permission surface, sync policies, and navigation metadata in a self-contained, validated structure.

## Decision

We establish `@platform/feature-system` and `@tooling/feature-validator`:

1. **`FeatureManifest` Schema**:
   - `id`: Unique kebab-case identifier (e.g. `example-feature`, `organisations`, `identity-admin`).
   - `version`: Semver string.
   - `dependencies` & `optionalDependencies`: Explicit array of feature IDs.
   - `permissions`: Declared permission definitions (`name`, `description`).
   - `migrations`: Versioned SQL migrations (`version`, `name`, `sql`, `checksum`).
   - `syncPolicies`: Declared conflict resolution strategies and namespace patterns per entity.
   - `navigation`: UI routes and permission requirements.

2. **Topological Dependency Resolution**:
   - `DependencyResolver` constructs a directed acyclic graph (DAG) of features.
   - Detects circular dependencies and throws a structured `PlatformError`.
   - Orders migrations across features topologically to guarantee foreign key integrity.

3. **Build-Time Verification (`@tooling/feature-validator`)**:
   - Build-time validator script checks manifests for completeness and rejects invalid manifests before compilation.
