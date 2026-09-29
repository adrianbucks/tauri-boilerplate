# API and Data Contracts

This document records contracts that coding agents should treat as stable design intent. It does not claim that every target contract is implemented today.

## Operation context

### Current

`OperationContext` contains:

- `correlationId`;
- `userId`;
- `deviceId`;
- `organisationId`;
- optional metadata.

### Target

Split caller request data from trusted identity:

```text
RequestContext
  = untrusted request metadata

TrustedPrincipal
  = native/session-issued user + device + organisation + auth strength

TrustedOperationContext
  = TrustedPrincipal + correlation + operation metadata
```

Only trusted context may be consumed for security decisions.

`AuthorizationEngine.requireTrusted()` is the authorization entry point for
trusted service flows. It derives the authorization subject from the embedded
principal; callers cannot provide a separate user, device or organisation to
that method.

The native widget read prototype follows the same rule: it accepts a
`NativePrincipal` produced by an authenticated native session and enforces
`widgets.read` plus organisation scope before querying. It is exposed through
the typed `list_widgets` Tauri command and obtains the principal from managed
native session state.

Native authentication now verifies Argon2id credentials against the versioned
core user state, validates the active device, derives permissions from native
role bindings, and persists lockout state transactionally. Its APIs remain
native-owned; the typed gateway is available to the demo, whose login gate
establishes the native session and whose widget list reads now use native data.
Widget writes and import remain transitional until corresponding native
operations exist.

## Platform errors

`PlatformError` provides:

- stable error code;
- developer message;
- user-safe message;
- correlation ID;
- retryable flag;
- severity;
- optional technical details.

User-facing errors must not reveal secrets or unnecessary internal state.

## Native gateway

Webview code may call typed native operations through a narrow gateway. The
gateway must expose named operations with validated inputs and typed results;
it must not accept arbitrary SQL, filesystem paths or shell commands. The first
implemented operation is `get_database_health`. Data operations remain blocked
until the native/session-issued principal and authorization contract exists.

## Feature manifest

A feature manifest should declare:

- stable feature ID/version;
- dependencies/optional dependencies;
- permissions;
- migrations;
- navigation/UI metadata;
- sync policy for synchronisable entities.

Feature dependency resolution must be deterministic and reject cycles.

## Sync operation envelope

Target minimum:

```text
operationId
applicationId
organisationId
syncGroupId
featureId
entityType
entityId
operation
payload
schemaVersion
protocolVersion
authorId
deviceId
logicalTimestamp
signature
```

Canonical serialization and signature input must be defined before production interoperability.

## Handshake

Target minimum:

```text
applicationId
applicationVersion
protocolVersion
peer/device identity
organisation context
supported features
supported entity versions
nonce
freshness timestamp
signature
```

A matching application ID alone is never sufficient to authenticate a peer.

## Namespace

Canonical namespace:

```text
application/organisation/sync-group/feature/entity
```

All security comparisons use canonical parsed components, not ad-hoc string prefix checks.

## Tombstone

Target minimum tombstone fields:

```text
entityId
deletedAt
deletedBy
deleteOperationId
logicalTimestamp
```

A tombstone remains visible to replication logic until retention policy proves it can be safely garbage-collected.
