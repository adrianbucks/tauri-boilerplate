# R-03 --- Rust Architecture and API Integrity

## Findings

Rust should be treated as a security-sensitive native boundary. Public
APIs require explicit types, predictable errors and clear ownership.
Long-lived resources such as database handles, identity stores and iroh
endpoints need explicit lifecycle ownership.

Use structured internal error enums and translate them into stable Tauri
command errors. Never log private keys, authentication material or
sensitive payloads.

## Recommended direction

Keep native functionality in dedicated Rust crates and keep the Tauri
adapter thin. Do not expose raw database handles, filesystem paths,
private key material or unrestricted transport objects to the frontend.

## Sources

- https://rust-lang.github.io/api-guidelines/
- https://doc.rust-lang.org/book/
- https://v2.tauri.app/

## Research gate

Review the current maintenance/support status of selected Rust
cryptographic, SQLite and iroh dependencies before implementation.
