# Downstream Application Adoption Guide

This guide defines how downstream development teams and product engineers should clone, customize, and consume this boilerplate to build independent, local-first enterprise desktop and mobile applications.

---

## 1. Starting from the Template

When creating a new application from this boilerplate:

1. **Clone & Detach Git Remote**:

   ```bash
   git clone https://github.com/adrianbucks/tauri-boilerplate.git my-enterprise-app
   cd my-enterprise-app
   git remote remove origin
   git remote add origin https://github.com/my-org/my-enterprise-app.git
   ```

2. **Update Application Identity**:
   - **Tauri Identifier**: Edit `apps/demo/src-tauri/tauri.conf.json`:
     - Change `identifier`: e.g. `com.mycompany.inventoryapp`
     - Change `productName`: e.g. `Enterprise Inventory`
     - Change `version`: e.g. `0.1.0`
   - **Android Package ID**: Update `applicationId` in `apps/demo/src-tauri/gen/android/app/build.gradle.kts`.
   - **Monorepo Root**: Update root `package.json` with your project name and repository URLs.

3. **Remove Demo Artifacts**:
   - The demo feature (`features/example-feature`) demonstrates full widget lifecycle, migrations, and UI. You can retain it as a reference or remove it from `pnpm-workspace.yaml`.

---

## 2. Retain Platform Infrastructure

**Do not fork or re-implement platform infrastructure packages:**

- `@platform/core`: Logging, error definitions, correlation IDs.
- `@platform/database`: SQLite connection management, migrations, repository patterns.
- `@platform/identity`: Device and user authentication abstractions.
- `@platform/authorization`: Scoped RBAC engine.
- `@platform/sync` & `@platform/sync-protocol`: Canonical replication envelopes, HLC conflict resolution.
- `@platform/tasks`: Durable SQLite task queue and worker pools.
- `crates/*`: Rust native runtime, Argon2id, Ed25519 memory key custody, and iroh P2P transport.

Business requirements should be implemented inside **features**, never by altering platform infrastructure mechanics.

---

## 3. Creating Domain Features

Structure your business domain capabilities under `features/`:

```text
features/
├── inventory/         # Products, stock levels, warehouse locations
├── sales/             # Orders, invoices, line items
└── customers/         # Customer profiles, contacts, addresses
```

Each feature encapsulates:

- Drizzle table definitions & versioned SQL migrations
- Hierarchical permissions (`inventory.read`, `inventory.transfer`)
- Scoped repositories extending `BaseRepository`
- Business service layer requiring `authorization.requireTrusted()`
- Sync policies declaring replication namespaces and conflict strategies
- React screens and navigation definitions

---

## 4. Application Composition & Bootstrap

Create a `Platform` with the application's configured `DatabaseConnection`, register each feature manifest before startup, and call `platform.init()` to apply platform and feature migrations. The current API is `Platform.registerFeature({ manifest })`; there is no global feature registry or `createAppPlatform` factory.

The application owns route definitions and page rendering. A manifest may contribute flat navigation metadata through `platform.features.getAllNavigationItems()`, which the application can adapt to its shell's navigation model. Registering a manifest does not register route components.

---

## 5. Boilerplate Verification & Quality Gates

Before cutting a release of your downstream application, ensure all quality gates pass:

```bash
# 1. Typecheck and unit tests
pnpm typecheck
pnpm test

# 2. Security regression tests
pnpm --filter @tests/security test

# 3. Native Rust verification
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# 4. Packaging validation
pnpm --filter @apps/demo tauri:build
```

---

## 6. Upstream Upgrade Strategy

To periodically incorporate platform updates, security patches, and iroh improvements from the upstream boilerplate:

```bash
# Add upstream remote
git remote add upstream https://github.com/adrianbucks/tauri-boilerplate.git
git fetch upstream

# Create an upgrade branch
git checkout -b chore/upgrade-platform
git merge upstream/main --allow-unrelated-histories
```

Resolve any conflicts in `packages/` or `crates/`, verify platform migrations, run the test suite, and merge back to your main branch.
