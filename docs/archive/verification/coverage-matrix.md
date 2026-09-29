# Verification Coverage Matrix

**Status:** Living test and gate map
**Last reviewed:** 2026-09-04

| Invariant or requirement                  | Current check                                 | Coverage status                 | Missing verification                                          |
| ----------------------------------------- | --------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| No UI database bypass                     | Manual code inspection and demo structure     | Partial                         | Automated import-boundary check.                              |
| No hard-coded role checks                 | Security tests and review rules               | Partial                         | Repository-wide static check.                                 |
| Syncable entity requires sync policy      | Feature manifests and registry                | Partial                         | Validator must inspect all synchronizable schemas.            |
| Seven-layer authorization before sync     | Pairing and handshake tests                   | Partial                         | Real transport and ordered gate integration test.             |
| Private keys never cross boundary         | Identity design and public return type        | Incomplete                      | Native command secret-leak regression test.                   |
| No raw DELETE for sync entities           | `BaseRepository` soft-delete tests            | Partial                         | Static SQL check and inbound operation test.                  |
| No broad Tauri capability                 | `default.json` review                         | Incomplete                      | CI capability allow-list check.                               |
| Security changes include regression tests | Repository process and current security tests | Partial                         | CI changed-file enforcement.                                  |
| Feature/platform dependency boundary      | Package structure and TypeScript imports      | Incomplete                      | Architecture import validator.                                |
| Durable SQLite persistence                | Memory database tests                         | Not covered                     | Restart, WAL, corruption, backup, native adapter integration. |
| Migration checksum and ownership          | Database tests                                | Verified at TypeScript boundary | Durable/native migration runner integration.                  |
| Operation idempotency                     | Sync types/simulation                         | Not covered                     | Duplicate operation application test.                         |
| HLC ordering                              | Existing protocol tests                       | Partial                         | Clock skew and concurrent-device integration.                 |
| Tombstone propagation                     | Local soft-delete tests                       | Not covered                     | Offline peer and garbage-collection tests.                    |
| Native package artifacts                  | Local Windows/Android builds and CI workflows | Partial                         | Signing and release metadata inspection.                      |

Compilation is never sufficient evidence for a row marked partial or not covered.
