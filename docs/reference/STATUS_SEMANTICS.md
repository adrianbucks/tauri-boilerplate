# Status Semantics

## Readiness labels

- **Scaffold:** interface or partial mechanism exists.
- **Implemented:** behavior is present and covered by executable verification.
- **Hardened:** implemented plus negative/failure-path/security tests.
- **Production-ready:** hardened, operationally verified on the supported platform matrix and accepted by all relevant gates.

## Why the distinction matters

The repository contains several classes whose names imply capabilities that are not yet real transport/security implementations. Examples include:

- `KeyManager` — currently generates placeholder identity strings;
- `HandshakeValidator` — currently validates compatibility, not cryptographic authentication;
- `SyncManager.connect()` — currently simulates connection state;
- `MemoryDatabaseConnection` — current adapter is not durable;
- `UserSessionService.createSession()` — current method does not prove credential possession.

Agents must preserve these distinctions in code comments and documentation.
