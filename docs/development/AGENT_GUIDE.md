# AI Agent and Developer Guide

## Prime directive

**Never guess at a security-sensitive or version-sensitive API.** Inspect the repository, inspect the installed dependency, consult current official documentation, then implement or write a spike.

## Mandatory reading by task

| Task         | Read                                                          |
| ------------ | ------------------------------------------------------------- |
| any task     | `PROJECT_REFERENCE.md`, `verification/CURRENT_STATE.md`       |
| architecture | relevant `architecture/*.md` + ADRs                           |
| database     | `DATA_AND_DATABASE.md` + migration tests                      |
| auth         | `IDENTITY_AND_AUTHENTICATION.md` + `SECURITY_ARCHITECTURE.md` |
| sync         | `SYNC_ARCHITECTURE.md` + research register                    |
| native/Tauri | `SECURITY_ARCHITECTURE.md` + current Tauri docs               |
| background   | `BACKGROUND_TASKS.md` + current Android/Windows docs          |

## Forbidden patterns

```text
if (user.role === "admin")

ctx = { userId: request.userId, organisationId: request.organisationId }

execute_sql(request.sql)

SELECT * FROM tenant_table

DELETE FROM synchronisable_table

publicKey = "ed25519_pk_" + deviceId

accept handshake because applicationId matches

log(password)

expose private key to JavaScript

broaden Tauri capability because a test is failing
```

## Required patterns

```text
authorization.require(trustedPrincipal, permission, resourceScope)

repository.findByIdWithinOrganisation(id, principal.organisationId)

transaction(domainMutation + audit + outbox)

createTombstone(...)

verifyPeerIdentity(...)

canonicalSerialize(...)
sign(...)

idempotencyStore.checkAndApply(operationId)
```

## Security change gate

Request human review before changing cryptography, key custody, authentication, authorization, tenant isolation, native commands/capabilities, sync admission, migrations containing security state, or release signing.

## Research gate

If a task is marked `RESEARCH GATE`, do not silently implement a plausible API. Produce:

- question;
- official evidence;
- constraints;
- alternatives;
- recommended option;
- smallest proof-of-concept;
- acceptance criteria;
- ADR update.

## Completion report

Every coding-agent task should report:

```text
Summary
Files changed
Tests added/changed
Commands run
Results
Security impact
Architecture impact
Documentation updated
Research remaining
Follow-up work
```

## Migrations

Never edit an applied migration. Add a new migration. Never alter a checksum to bypass validation.
