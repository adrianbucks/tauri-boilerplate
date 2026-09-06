# Technology Baseline

## Current repository declarations

| Technology  | Current declaration         | Role                           |
| ----------- | --------------------------- | ------------------------------ |
| Tauri       | 2.x; demo CLI 2.11.4        | native application shell/IPC   |
| React       | 19.x                        | UI                             |
| TypeScript  | 5.7.3                       | application/platform language  |
| Vite        | 6.2.0                       | frontend build                 |
| pnpm        | 10.26.0                     | workspace package manager      |
| Turborepo   | 2.4.4                       | task/build orchestration       |
| Drizzle ORM | 0.39.3                      | SQLite schema/ORM abstraction  |
| sql.js      | 1.14.2                      | current in-memory test adapter |
| Vitest      | 3.0.7                       | tests                          |
| Rust        | repository toolchain 1.98.1 | native layer                   |
| SQLite      | runtime-dependent           | target durable store           |
| iroh        | **not yet a dependency**    | target P2P transport           |

## Runtime policy

Node.js 20 is EOL as of 2026-03-24. CI should move to a supported LTS after compatibility testing; Node 24 is currently LTS.

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
