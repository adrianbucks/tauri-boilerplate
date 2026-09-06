# Repository Structure

```text
apps/
  demo/                  # downstream/reference application
packages/
  core/                  # shared errors, context, config, logging, time
  database/              # persistence abstraction, migrations, repositories
  identity/              # user/device/session platform services
  authorization/         # permission, role and scope evaluation
  audit/                 # audit event service
  sync/                  # sync orchestration/state/pairing
  sync-protocol/         # wire models, namespace, HLC, conflict rules
  feature-system/        # manifests and dependency resolution
  platform/              # platform composition/bootstrap
  import-export/         # spreadsheet import/export
  hardware/              # hardware input abstraction
  ui/                    # reusable UI primitives
features/
  organisations/        # example domain feature
  identity-admin/        # example administration feature
  example-feature/       # template/reference feature
crates/
  native-core/           # Rust/native error helpers
  identity-core/         # native identity/key custody implementation
  sync-core/             # native transport/sync implementation
  crypto-core/           # native cryptographic primitives
apps/demo/src-tauri/     # Tauri application/native entry point
docs/                    # canonical development backbone
```

## Package rules

- `packages/` contains domain-neutral platform mechanisms.
- `features/` contains application/domain behavior.
- `apps/` composes features and presents product-specific UI.
- `crates/` contains privileged/native mechanisms.
- `docs/` records contracts, decisions and evidence.

Avoid introducing a new package unless the ownership boundary is genuinely distinct.
