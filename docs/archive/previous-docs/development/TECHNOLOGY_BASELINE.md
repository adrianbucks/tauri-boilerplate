# Technology Baseline

## Current repository declarations

| Technology  | Current declaration         | Role                                                   |
| ----------- | --------------------------- | ------------------------------------------------------ |
| Tauri       | 2.x; demo CLI 2.11.4        | native application shell/IPC                           |
| React       | 19.x                        | UI                                                     |
| TypeScript  | 5.7.3                       | application/platform language                          |
| Vite        | 6.2.0                       | frontend build                                         |
| pnpm        | 10.26.0                     | workspace package manager                              |
| Turborepo   | 2.4.4                       | task/build orchestration                               |
| Drizzle ORM | 0.39.3                      | SQLite schema/ORM abstraction                          |
| SQLite      | native `rusqlite`           | **primary durable store** (`NativeDatabaseConnection`) |
| sql.js      | 1.14.2                      | isolated unit test adapter (not production)            |
| Vitest      | 3.0.7                       | unit and integration test runner                       |
| Rust        | repository toolchain 1.98.1 | native core, key custody, and persistence layer        |
| iroh        | _Research Gate (R-002)_     | target P2P transport (WP-014)                          |

## Runtime policy

Node 24 LTS is the active and enforced runtime across local development and GitHub Actions CI (CS-014). Node 20 is deprecated and unsupported.

Do not update a major dependency merely because a newer version exists. For version-sensitive APIs:

1. inspect the installed lockfile/dependency;
2. read current official documentation;
3. run a compatibility spike if the API affects a security or architectural boundary;
4. pin/lock the chosen version;
5. document migration implications.

## TypeScript

The repository already enables strictness, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, declaration/source maps and bundler module resolution.

Maintain these constraints. TypeScript project references may be introduced where package build boundaries need stronger incremental compilation and dependency enforcement; TypeScript documents project references as a way to improve build/editor performance and logical separation.

## Monorepo dependency rule

Prefer workspace package resolution rather than TypeScript `paths` hacks for sibling packages. TypeScript's module documentation explicitly recommends workspace package managers for monorepos so runtime and type resolution agree.
