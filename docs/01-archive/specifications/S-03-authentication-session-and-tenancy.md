# S-03 --- Authentication, Session and Tenancy

**Status:** Ready\
**Priority:** P0

## Objective

Make identity, membership and organisation context authoritative.

## Flow

`Authentication -> Session -> AuthenticatedContext -> Authorization`

Authenticated context contains subject, device, organisation, membership
and session identifiers.

## Rules

- Never accept caller-supplied roles as authoritative.
- Verify user/device status.
- Verify active organisation membership.
- Load roles from persistence.
- Construct trusted context only after all checks pass.
- Require trusted organisation scope at repository boundaries.

## Tests

Caller role injection; cross-organisation access; revoked session;
disabled user; revoked device; expired session; cross-tenant resource
access.

## Acceptance criterion

No privileged service treats a caller-provided role list or organisation
ID as proof of authority.

## Implemented baseline

The identity session service now validates the persisted user organisation,
loads role bindings from `core_user_roles`, and rejects unapproved,
suspended, or revoked devices before creating a session. Caller-provided
roles remain accepted only for source compatibility and are ignored.
