# Feature System and Extension Model

## Purpose

The feature system is the primary mechanism for reusable platform
capabilities and application-specific modules.

## Target distinction

### Platform features

Examples:

- organisations;
- identity administration;
- sync administration;
- diagnostics.

These may ship with the boilerplate.

### Application features

Examples:

- inventory;
- purchase orders;
- shipments;
- warehouse operations;
- CRM.

These must remain outside generic platform packages.

## 1. Feature contract

A feature should be able to declare:

```text
id
version
dependencies
optionalDependencies
permissions
sync policies
migrations
services
repositories
UI contribution
configuration
```

## 2. UI contribution

The manifest should optionally expose:

- routes;
- navigation items;
- page components;
- icons;
- required permissions.

The consuming application remains responsible for deciding whether and
how these are rendered.

Avoid forcing a platform-wide router.

## 3. Dependency resolution

Continue using:

- cycle detection;
- hard dependencies;
- optional dependencies;
- deterministic topological ordering.

Add:

- version constraints;
- compatibility validation;
- duplicate feature detection;
- clear diagnostic output.

## 4. Migration ownership

A feature owns its migrations but does not control platform migrations.

Migration registration should identify the feature explicitly.

## 5. Permission ownership

Feature permissions should be declared by the feature and registered
centrally.

Avoid application code manually reproducing permission lists.

## 6. Sync policy

Every synchronisable entity must declare:

```text
entity type
sync policy
conflict strategy
required scope
payload schema/version
```

The agent invariant that synchronisable entities require a policy should
be machine-validated.

## 7. Application feature example

A downstream application might contain:

```text
features/
  inventory/
    manifest.ts
    permissions.ts
    schema/
    migrations/
    repositories/
    services/
    sync/
    pages/
    components/
    tests/
```

The platform must not need to know what `inventory_item` means.

## 8. Feature validator

Extend the validator to check:

- required files;
- manifest validity;
- dependency graph;
- permission uniqueness;
- migration metadata;
- sync policy presence;
- schema/version compatibility;
- forbidden imports;
- platform boundary violations.

## 9. Boundary rule

Domain-specific logic must never leak into:

```text
packages/core
packages/database
packages/sync
packages/identity
crates/*
```

unless the logic is genuinely domain-neutral infrastructure.
