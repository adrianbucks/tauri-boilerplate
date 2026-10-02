# ADR-030: Production P2P Relay Infrastructure Policy

**Status**: Accepted  
**Deciders**: Platform Architecture Team  
**Date**: 2026-10-01  
**Research Gate**: R-009 (Production P2P Relay Infrastructure)

---

## Context

The platform uses native `iroh 1.2.0` QUIC endpoints for peer-to-peer synchronisation (ADR-012). When two devices cannot form a direct QUIC connection (e.g., symmetric NAT, firewall-restricted corporate networks), they require a relay server to forward encrypted QUIC packets.

iroh ships with a built-in relay protocol (`iroh-relay`, formerly DERP — Designated Encrypted Relay for Packets). The platform must decide its relay operational model.

**Problem**:

1. Relying on public iroh relay infrastructure (operated by n0 company) means:
   - No SLA guarantees for enterprise deployments.
   - Sync envelopes route through a third-party-operated network endpoint (even though they are end-to-end encrypted).
   - Availability is outside the operator's control.
2. Running no relay infrastructure means direct-IP-only connectivity, which fails on most real-world networks.
3. Self-hosting relay infrastructure requires operational investment but provides full control, SLA ownership, and data residency compliance.

---

## Decision

### Option Evaluated

| Option                                        | Description                                                             | Decision                             |
| :-------------------------------------------- | :---------------------------------------------------------------------- | :----------------------------------- |
| **A** — Public iroh relay only                | Use n0's public DERP servers without modification                       | ❌ Rejected for production           |
| **B** — No relay (direct only)                | Require direct IP connectivity between peers                            | ❌ Rejected (impractical)            |
| **C** — Self-hosted relay fleet               | Operate `iroh-relay` servers on operator-controlled infrastructure      | ✅ **Accepted for production**       |
| **D** — Hybrid: self-hosted + public fallback | Configure self-hosted relay as primary, public as fallback during setup | ✅ Accepted for staging / evaluation |

**Selected**: Option C (production) + Option D (staging/evaluation only).

---

## Consequences

### Positive

- **Data Residency**: Sync relay traffic stays within the operator's network perimeter. No envelope payload content is visible to relay servers (envelopes are end-to-end encrypted), but metadata (IP address, timing) is contained.
- **SLA Ownership**: Operators control relay uptime, capacity, and failover policies.
- **Compliance**: Suitable for regulated environments (GDPR, HIPAA, SOC 2) that prohibit third-party network intermediaries.
- **Cost Transparency**: Relay infrastructure costs are explicitly budgeted and visible to operators.

### Negative / Mitigation

- **Operational Burden**: Requires deployment, monitoring, and maintenance of `iroh-relay` instances. Mitigated by container-based deployment guides (Docker / Kubernetes).
- **Setup Time**: New deployments need relay provisioning before peer connections work across NATs. Mitigated by providing a one-command compose configuration.
- **Single Point of Failure**: A relay cluster must implement HA. Mitigated by multi-region or active-active relay fleet design.

---

## Implementation Guidance

### Relay Server Deployment

`iroh-relay` is a standalone binary that can be deployed on any Linux server with a public IP:

```bash
# Install iroh-relay
cargo install --locked iroh-relay

# Run with TLS termination (production)
iroh-relay \
  --hostname relay.your-domain.com \
  --tls-cert /etc/letsencrypt/live/relay.your-domain.com/fullchain.pem \
  --tls-key  /etc/letsencrypt/live/relay.your-domain.com/privkey.pem
```

### Client Configuration in `tauri.conf.json`

Downstream deployments configure the relay URL in their Tauri configuration. The platform's `IrohSyncTransport` passes relay endpoints to the native iroh endpoint at startup:

```json
{
  "plugins": {
    "iroh-sync": {
      "relayUrl": "https://relay.your-domain.com",
      "directConnectionsOnly": false
    }
  }
}
```

### Docker Compose Reference (Minimal HA Setup)

```yaml
services:
  relay-primary:
    image: ghcr.io/n0-computer/iroh-relay:latest
    ports:
      - "443:443"
      - "3478:3478/udp"
    environment:
      RELAY_HOSTNAME: relay-primary.your-domain.com
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
    restart: unless-stopped

  relay-secondary:
    image: ghcr.io/n0-computer/iroh-relay:latest
    ports:
      - "443:443"
      - "3478:3478/udp"
    environment:
      RELAY_HOSTNAME: relay-secondary.your-domain.com
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
    restart: unless-stopped
```

### Staging / Evaluation (Option D)

For development and staging environments where self-hosted relay is not yet provisioned, the public iroh relay fallback is acceptable. This is configured by leaving `relayUrl` unset; iroh will use its default relay discovery.

> [!IMPORTANT]
> Never use public relay in production deployments that handle personally identifiable information or commercially sensitive data. The relay operator cannot read envelope content (end-to-end encrypted) but can observe connection metadata.

---

## Security Properties

| Property                     | Guarantee                                                                                       |
| :--------------------------- | :---------------------------------------------------------------------------------------------- |
| **Envelope confidentiality** | ✅ End-to-end encrypted; relay server sees only opaque QUIC packets                             |
| **Envelope integrity**       | ✅ Ed25519-signed; relay cannot tamper without detection at the 7-layer admission filter        |
| **Identity**                 | ✅ iroh node IDs are derived from Ed25519 public keys; relay cannot impersonate peers           |
| **Metadata privacy**         | ⚠️ Relay operator sees source/destination IP and timing; use self-hosted relay for full control |
| **Replay prevention**        | ✅ 32-hex nonce freshness and 30s skew window enforced at the receiver, not the relay           |

---

## Related Decisions

- [ADR-012](./ADR-012-iroh-p2p-transport.md) — iroh P2P Transport Selection
- [ADR-019](./ADR-019-secure-storage.md) — Cryptographic Key Custody
- [ADR-025](./ADR-025-cross-organisation-access.md) — Cross-Organisation Access Boundary

## Related Research Gates

- [R-002](../07-in-development/research-register.md) — Replication Substrate Evaluation (Resolved)
- [R-009](../07-in-development/research-register.md) — Production P2P Relay Infrastructure (Resolved by this ADR)
