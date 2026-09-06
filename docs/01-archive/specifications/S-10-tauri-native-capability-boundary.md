# S-10 --- Tauri Native Capability Boundary

**Status:** Ready after Tauri verification\
**Priority:** P0

## Objective

Enforce least-privilege native access.

## Command families

- `identity.*`
- `secure_storage.*`
- `database.*`
- `sync.*`
- `hardware.*`
- `import_export.*`
- `diagnostics.*`

Each command must define its capability, authentication requirement,
permission, tenant scope, validation rules, output sensitivity and audit
requirement.

## Forbidden

No unrestricted filesystem, shell, process, network or secret-store
primitive should be exposed to the frontend.

## CI

Capability changes must be reviewable and broad permissions should fail
automated checks.

## Acceptance criterion

Every native command has a documented capability and security contract.

## Implemented baseline

The device identity command no longer accepts an application identifier
from the webview. It uses the compiled application identifier and returns
only public identity material. Its security contract is documented in
`docs/security/02-native-command-contracts.md`.
