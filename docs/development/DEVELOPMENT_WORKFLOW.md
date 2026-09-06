# Development Workflow

## Before changing code

1. Read this documentation hub.
2. Read `verification/CURRENT_STATE.md`.
3. Identify the owning package/feature/crate.
4. Inspect existing tests.
5. Identify security boundaries.
6. Check ADRs and research gates.
7. Read current dependency/API documentation when the API is version-sensitive.

## During implementation

- make the smallest coherent change;
- preserve package ownership boundaries;
- prefer typed interfaces;
- validate untrusted input at the boundary;
- authorise before mutation;
- use transactions for atomic state changes;
- make retryable operations idempotent;
- add negative tests for security behavior;
- avoid unrelated dependency or formatting churn.

## Before merge

Run the repository's available checks in a fully provisioned environment:

```text
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:security
pnpm test:sync
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Also perform platform/device tests whenever the change affects native behavior, authentication, background execution, storage, transport or release packaging.

## Documentation synchronization

A pull request is incomplete when code and canonical documentation disagree. Update status/architecture/ADR/research material in the same change.
