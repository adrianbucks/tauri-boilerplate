# Downstream Application Adoption Guide

## Purpose

This document defines how a developer should consume the boilerplate to
build a new application.

## 1. Start from the template

Copy the repository and establish a new application identity:

```text
application ID
application name
branding
package names
bundle identifiers
```

Do not retain demo business data or demo branding.

## 2. Keep platform infrastructure

Retain the reusable platform packages/crates unless a deliberate
architecture decision replaces them.

Do not fork platform internals merely to implement business
functionality.

## 3. Replace the frontend

The consuming application should be able to replace:

```text
apps/demo/src/*
```

with its own frontend.

It can use:

- platform UI primitives;
- platform hooks;
- optional AppShell;
- optional routing integration.

## 4. Define application database

Create application-owned schema/migrations.

Example:

```text
app_products
app_locations
app_orders
app_order_lines
```

Use the platform database API.

Never put application tables into generic platform packages.

## 5. Define application features

Example:

```text
features/
  inventory/
  orders/
  shipments/
```

Each feature owns:

- manifest;
- permissions;
- schema;
- migrations;
- repository;
- service;
- sync policy;
- UI;
- tests.

## 6. Register the application

Bootstrap should provide a clear composition API:

```ts
platform.registerApplication({
  id,
  version,
  migrations,
  features,
  frontend,
});
```

The exact API should be established during implementation.

## 7. Use platform authorization

Business code should call:

```ts
authorization.require("inventory.update", {
  warehouseId,
});
```

It should never inspect roles directly.

## 8. Use platform sync

A feature declares its sync policy.

The feature should not implement its own:

- iroh connection;
- cryptographic handshake;
- peer authentication;
- queue;
- retry engine.

It defines the domain semantics; the platform performs transport and
security.

## 9. Keep business logic local

A consuming application can implement complex business workflows without
modifying:

```text
packages/core
packages/database
packages/identity
packages/authorization
packages/sync
crates/*
```

If a requirement appears to need a platform change, first determine
whether it is actually a reusable infrastructure capability.

## 10. Boilerplate validation

Before releasing a downstream application, run:

```text
unit tests
integration tests
security tests
sync tests
typecheck
lint
web build
Tauri build
```

and ensure application-specific code does not violate platform
invariants.

## 11. Upgrade strategy

The boilerplate should eventually expose a documented upgrade path:

```text
boilerplate version
        ↓
platform migration set
        ↓
application migration compatibility
        ↓
application tests
        ↓
new release
```

Downstream applications must never blindly overwrite platform migrations
or schema metadata.
