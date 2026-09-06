# R-05 --- Authentication, Authorization and Tenancy

## Critical current issue

The session service currently accepts caller-provided role information,
while many operations accept organisation identifiers as input. This is
insufficiently authoritative.

## Target model

`Session -> Subject -> Membership -> Roles -> Permissions -> Scope`

A caller may request an operation against a resource but must not assert
its own organisation, roles or permissions.

## Tenant isolation

Use organisation-scoped repository interfaces and mandatory tenant
predicates. Validate membership before constructing an authenticated
context. Add explicit cross-tenant negative tests.

## RBAC

Roles must be loaded from authoritative persistence and constrained to
the subject's current organisation. Feature code should check
permissions rather than role names.

## Sources

- https://owasp.org/www-project-application-security-verification-standard/
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

## Research gate

Decide whether the platform needs RBAC only or RBAC plus typed
resource/scope attributes. Do not allow the current generic scope
mechanism to become an accidental ABAC system.
