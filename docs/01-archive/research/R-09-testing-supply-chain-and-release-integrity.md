# R-09 --- Testing, Supply Chain and Release Integrity

## Findings

Current tests demonstrate architecture concepts but do not prove durable
SQLite persistence, real cryptographic identity, real P2P transport or
production packaging.

Required verification layers:

1.  static analysis
2.  unit tests
3.  integration tests
4.  security tests
5.  property/fault-injection tests
6.  migration tests
7.  sync tests
8.  native platform tests
9.  package/build tests
10. dependency/supply-chain verification

OWASP ASVS should be used as a verification reference and mapped to
concrete tests or documented exceptions.

Release CI must build actual Tauri packages rather than treating a
frontend build as a release build.

## Sources

- https://owasp.org/www-project-application-security-verification-standard/
- https://rust-lang.github.io/api-guidelines/
- https://v2.tauri.app/security/
