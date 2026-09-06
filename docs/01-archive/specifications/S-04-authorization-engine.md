# S-04 --- Authorization Engine

**Status:** Ready\
**Priority:** P0

## Objective

Provide consistent permission evaluation without hard-coded role checks.

## Permission model

Use `resource.action` permissions such as `organisation.read`,
`device.revoke` and `sync.connect`.

## Evaluation

1.  authenticated session
2.  active subject
3.  valid device
4.  valid organisation
5.  valid membership
6.  permission exists
7.  role grants permission
8.  resource scope passes

## Tenant rule

Resolve roles only through the current organisation membership.

## Tests

Negative tests for every layer, especially cross-tenant access and
revoked identities.

## Acceptance criteria

No feature code checks role names directly; permission decisions are
auditable and testable.

## Implemented baseline

Effective permissions are resolved through `core_user_roles` and
`core_roles.organisation_id` for the subject's current organisation. The
role IDs supplied on a subject cannot grant access unless the corresponding
persisted user-role binding exists in that organisation.
