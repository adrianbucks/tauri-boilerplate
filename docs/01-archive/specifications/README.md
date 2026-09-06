# Implementation Specifications

These specifications are the concrete engineering contracts for the platform. They are ordered S-01 through S-12 and include current state, target state, interfaces, tests, invariants, acceptance criteria, and research gates.

Architecture documents keep the coding patterns. These specifications and [verification/status.md](../verification/status.md) decide whether a pattern is implemented.

| ID                                                   | Topic                                | Status                                                 |
| ---------------------------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| [S-01](./S-01-database-and-persistence.md)           | Database and persistence             | Ready after driver research; incomplete implementation |
| [S-02](./S-02-identity-and-secure-storage.md)        | Identity and secure storage          | Research required                                      |
| [S-03](./S-03-authentication-session-and-tenancy.md) | Authentication, session, and tenancy | Implemented baseline; incomplete                       |
| [S-04](./S-04-authorization-engine.md)               | Authorization engine                 | Implemented baseline; incomplete                       |
| [S-05](./S-05-sync-operation-log.md)                 | Sync operation log                   | Research required                                      |
| [S-06](./S-06-iroh-transport-and-handshake.md)       | iroh transport and handshake         | Research required                                      |
| [S-07](./S-07-conflict-tombstone-and-recovery.md)    | Conflict, tombstone, and recovery    | Draft/research required                                |
| [S-08](./S-08-feature-system-and-migrations.md)      | Feature system and migrations        | Implemented baseline; incomplete                       |
| [S-09](./S-09-frontend-and-application-boundary.md)  | Frontend/application boundary        | Implemented baseline; incomplete                       |
| [S-10](./S-10-tauri-native-capability-boundary.md)   | Tauri native capability boundary     | Implemented baseline; incomplete                       |
| [S-11](./S-11-verification-and-ci-gates.md)          | Verification and CI gates            | Implemented baseline; incomplete                       |
| [S-12](./S-12-release-and-distribution.md)           | Release and distribution             | Implemented baseline; incomplete                       |

The authoritative cross-specification status is [verification/status.md](../verification/status.md).
