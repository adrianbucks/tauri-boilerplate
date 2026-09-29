# ADR-027: Typed Native Data Gateway and IPC Boundary Hardening

## Status
Accepted

## Context
Exposing raw database handles, unconstrained SQL query interfaces, or broad OS filesystem/shell commands to the frontend webview compromises client-side security. An XSS flaw or untrusted script could execute arbitrary SQL or extract sensitive database contents.

## Decision
1. **No Arbitrary SQL over IPC**: The frontend webview is not granted arbitrary SQL query execution authority.
2. **Typed Native Commands**: Expose narrowly scoped, domain-validated Tauri IPC commands:
   - `authenticate_user`, `logout_user`, `get_device_identity`, `get_database_health`.
   - Domain-scoped commands (e.g. `list_widgets`, `create_widget`, `list_organisations`, `create_organisation`).
3. **Rust-Side Input Validation**: All command parameters are strictly validated in native Rust code before execution.
4. **Least-Privilege Tauri Capabilities**: The Tauri configuration uses granular capability files in `capabilities/`, omitting broad plugin defaults or wildcard access.

## Consequences
- Webview compromise cannot directly drop tables or execute unvetted SQL queries.
- Strong defense-in-depth across the TypeScript/Rust boundary.
- Verified by security regression tests against IPC permission denial.
