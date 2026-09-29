# R-07 --- Local-First Replication and Conflict Handling

## Required properties

Production replication needs durable outbound operations, globally
unique operation IDs, idempotent inbound application, ordering metadata,
author/device identity, schema/protocol versions, authorization before
mutation, acknowledgements, retries, quarantine, tombstones and explicit
conflict policies.

## Important corrections

Do not implement additive conflict resolution by summing replicated
absolute values. Counters should generally replicate deltas/operations.

Hybrid logical clocks provide deterministic ordering metadata but are
not global time or consensus.

Tombstone garbage collection must not remove deletion evidence while an
eligible peer can still reintroduce the deleted object.

## Recommended direction

Retain explicit immutable operations unless a protocol spike
demonstrates that another substrate satisfies the same invariants with
materially lower complexity.

## Sources

- https://docs.iroh.computer/protocols/documents
- https://owasp.org/www-project-application-security-verification-standard/

## Research gate

Define the replication state machine and execute
property/fault-injection tests before production synchronisation is
declared complete.
