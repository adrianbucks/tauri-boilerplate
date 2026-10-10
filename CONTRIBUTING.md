# Contributing to tauri-boilerplate

Thank you for contributing to `tauri-boilerplate`!

---

## Contribution Model

This repository is a **GitHub Template Repository** designed to serve as the platform starting point for independent applications.

- **Platform improvements** (fixes/enhancements to `packages/`, `crates/`, documentation, tooling) are welcomed as upstream Pull Requests.
- **Application-specific domain features** (WMS, ERP, logistics logic) should remain in your own downstream repository.

---

## Development Workflow

1. Read [`docs/README.md`](./docs/README.md), [`docs/06-status/current-state.md`](./docs/06-status/current-state.md), [`docs/04-guides/agent-guide.md`](./docs/04-guides/agent-guide.md), and [`docs/04-guides/developer-guide.md`](./docs/04-guides/developer-guide.md). Status registers are under review; verify claims against source and executable evidence.
2. Install dependencies: `pnpm install`.
3. Ensure all tests pass: `pnpm test`, `pnpm typecheck`, `pnpm lint`.
4. If adding new architecture decisions or changing protocols, document them in an ADR in `docs/decisions/`.
5. Use [Conventional Commits](https://www.conventionalcommits.org/) for your commit messages (`feat:`, `fix:`, `security:`, `docs:`, `chore:`).
6. Update `CHANGELOG.md` under `[Unreleased]`.
