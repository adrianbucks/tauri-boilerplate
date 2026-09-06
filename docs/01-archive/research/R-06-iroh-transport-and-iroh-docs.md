# R-06 --- iroh Transport and iroh-docs

## Findings

iroh provides networking primitives including endpoints, discovery and
relay support, while protocols can be composed through its router/ALPN
model.

iroh-docs provides a CRDT-oriented document store with namespace/author
concepts, signed entries and synchronisation facilities. It is not
automatically equivalent to the application's authoritative SQLite
domain state.

## Architectural options

### Custom operation log over iroh

Maximum control over domain semantics, authorization and tenant
isolation, but more replication code.

### iroh-docs as replication store

Leverages CRDT infrastructure, but requires careful mapping of
relational/domain semantics and authority.

### Hybrid

Use iroh for transport and evaluate iroh-docs selectively while
retaining explicit application operations.

## Recommended direction

Do not automatically replace the existing immutable operation model with
iroh-docs. Build a protocol spike using real application semantics and
compare idempotency, conflict handling, tombstones, offline recovery,
authorization and schema evolution.

## Sources

- https://docs.iroh.computer/what-is-iroh
- https://docs.iroh.computer/protocols/documents
- https://github.com/n0-computer/iroh-docs
- https://docs.rs/iroh-docs/

## Research gate

Pin exact versions and prototype before committing to the final
replication substrate.
