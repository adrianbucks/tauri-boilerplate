# S-12 --- Release and Distribution

**Status:** Ready after platform build verification\
**Priority:** P1

## Objective

Produce trustworthy Tauri application artefacts.

## Pipeline

`commit -> verification -> native build -> package -> inspect -> sign -> publish`

A frontend build is not a Tauri release build.

## Artefact verification

Verify expected target, version, architecture, installer metadata,
signatures, checksums and absence of development-only configuration.

## Compatibility

Document database migration compatibility, sync protocol compatibility,
application version compatibility and key/protocol rotation.

## Acceptance criterion

A release is publishable only after the actual target installer/package
has been generated and automatically inspected.

## Implemented baseline

The tagged release workflow invokes native Tauri packaging for Windows and
Android, fails when expected installer/package artifacts are absent, and
records SHA-256 checksums during artifact inspection.

Native packaging is also verified on pushes to `main` by the non-publishing
`.github/workflows/build.yml` workflow.

Native workflows use the repository-pinned Rust toolchain from
`rust-toolchain.toml` to keep desktop and Android builds reproducible.
