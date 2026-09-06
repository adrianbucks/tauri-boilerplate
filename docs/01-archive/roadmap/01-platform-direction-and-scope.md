# Platform Direction and Scope

## 1. Strategic direction

The repository must evolve from an architectural scaffold into a
**domain-neutral local-first application platform**.

A downstream developer should be able to:

1.  copy or template the repository;
2.  retain the common platform infrastructure;
3.  replace or extend the demo frontend;
4.  define application-specific database schemas;
5.  define domain-specific features and workflows;
6.  register permissions and synchronisation policies;
7.  use platform identity, authentication, authorisation, audit, sync,
    hardware and native services;
8.  build Windows and Android applications without modifying platform
    internals unnecessarily.

## 2. Boilerplate boundary

### Platform-owned

The boilerplate should own reusable infrastructure:

- application/runtime bootstrap;
- configuration;
- logging and diagnostics;
- correlation IDs;
- error model;
- persistent SQLite runtime;
- migration framework;
- database transaction primitives;
- identity and secure key storage;
- authentication/session infrastructure;
- organisation/tenant primitives;
- RBAC and scoped authorisation;
- audit logging;
- sync protocol and transport;
- peer discovery/pairing;
- conflict framework;
- tombstone infrastructure;
- feature registration/dependency resolution;
- UI primitives and optional shell;
- import/export framework;
- barcode/hardware abstraction;
- Tauri capability governance;
- platform update/release tooling;
- test harnesses and architectural validation.

### Application-owned

A consuming application should own:

- business entities;
- domain database tables;
- domain migrations;
- business services;
- domain repositories;
- domain workflows;
- domain-specific permissions;
- domain sync policies;
- application navigation;
- application pages;
- application branding;
- application-specific components;
- domain reports;
- business rules.

## 3. Database ownership model

The platform must not assume that the boilerplate's demo schema is the
application's schema.

Use a namespace split:

```text
core_*       platform-owned infrastructure
app_*        application-owned data
feature_*    feature-owned data where appropriate
```

The consuming application may define any number of tables and migrations
subject to platform invariants.

The platform must provide a reliable mechanism for registering
application migrations without requiring the platform repository to know
their business meaning.

## 4. Frontend ownership model

The demo application should demonstrate composition, not prescribe the
frontend.

The platform should expose:

- typed service APIs;
- React hooks/adapters where useful;
- UI primitives;
- optional AppShell;
- optional navigation registry;
- permission-aware helpers;
- sync diagnostics components;
- standard error/loading states.

A downstream application should be able to replace the entire
`apps/demo/src` frontend while continuing to consume the platform
packages.

## 5. Architecture target

```text
                    Consuming Application
        ┌────────────────────────────────────────┐
        │ Domain schema / services / repositories │
        │ Pages / routes / workflows / branding   │
        └───────────────────┬────────────────────┘
                            │
                    Platform Extension APIs
                            │
        ┌───────────────────▼────────────────────┐
        │           Boilerplate Platform         │
        │                                        │
        │ DB | Identity | Auth | RBAC | Audit    │
        │ Sync | P2P | Features | Native | UI    │
        │ Hardware | Import/Export | Diagnostics │
        └────────────────────────────────────────┘
                            │
        ┌───────────────────▼────────────────────┐
        │ Tauri / Rust / OS / SQLite / Network  │
        └────────────────────────────────────────┘
```

## 6. Design rule

The platform should be **opinionated about safety and contracts, but
flexible about business functionality**.

It should prevent unsafe patterns without forcing a particular business
domain.

## 7. Key future architectural decisions

- Keep domain tables out of platform packages.
- Keep private cryptographic material in native secure storage.
- Make all synchronisable mutations transactional.
- Treat authorisation as a platform boundary, not a UI concern.
- Treat sync as an infrastructure capability rather than a
  feature-specific implementation.
- Make feature registration declarative but permit application-owned
  features.
- Make frontend composition replaceable.
- Make platform APIs versioned and documented.
