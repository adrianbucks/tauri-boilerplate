# Platform Architecture Summary

For the complete documentation suite, please refer to [`docs/README.md`](./docs/README.md).

---

## The Four Core Layers

The platform cleanly separates four independent concerns:

```text
┌───────────────────────────────────────────────┐
│                    DATA                       │
│               SQLite (local)                  │
│  "What is the current local operational state?"│
└───────────────────────┬───────────────────────┘
                        │
┌───────────────────────▼───────────────────────┐
│                  IDENTITY                     │
│            Users / Devices / Sessions         │
│   "Who is making this request and from where?"│
└───────────────────────┬───────────────────────┘
                        │
┌───────────────────────▼───────────────────────┐
│               AUTHORISATION                   │
│           RBAC + Scoped Permissions           │
│   "Is this subject allowed to do this action  │
│         on this resource right now?"          │
└───────────────────────┬───────────────────────┘
                        │
┌───────────────────────▼───────────────────────┐
│              SYNCHRONISATION                  │
│          iroh / iroh-docs / op log            │
│   "How do authorised peers exchange data?"    │
└───────────────────────────────────────────────┘
```

---

## The 7-Layer Pre-Sync Security Stack

No peer can exchange application data without passing through all seven gates sequentially:

```text
1. iroh connection established (P2P QUIC transport / relay fallback)
       ↓
2. Peer identity verified (cryptographic public key check)
       ↓
3. Application handshake (applicationId & protocolVersion check)
       ↓
4. Organisation validation (organisationId match or explicit cross-org grant)
       ↓
5. Device/User authentication (active device status & valid session)
       ↓
6. Sync-group authorisation (active membership in target group)
       ↓
7. Data-scope authorisation (target entity namespace belongs to allowed scope)
       ↓
Replication / Synchronisation begins
```

---

## Key Invariants

1. **Local-First Writes**: Business mutations commit locally in SQLite first alongside audit and replication metadata. The network is never in the critical path of local CRUD.
2. **Authorisation Before Replication**: The sync layer is never the security layer. Authorised namespaces are computed before data is transmitted.
3. **No Direct Database Access in UI**: UI $\to$ Service $\to$ Repository $\to$ Database Package $\to$ SQLite.
4. **Hardware Key Isolation**: Cryptographic private keys reside in secure storage in Rust and never cross into JavaScript memory.
