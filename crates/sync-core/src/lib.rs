pub mod endpoint;

pub use endpoint::{InboundEnvelopeMessage, IrohSyncEndpoint, SyncTransportError, SYNC_ALPN};
pub use iroh::EndpointAddr;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TransportConnectionMode {
    DirectLan,
    RelayFallback,
    Disconnected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerNodeInfo {
    pub peer_id: String,
    pub device_id: String,
    pub mode: TransportConnectionMode,
    pub last_seen_unix_ms: u64,
}

pub struct TransportManager {
    pub node_id: String,
}

impl TransportManager {
    pub fn new(node_id: impl Into<String>) -> Self {
        Self {
            node_id: node_id.into(),
        }
    }

    pub fn status(&self) -> TransportConnectionMode {
        TransportConnectionMode::DirectLan
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_transport_manager() {
        let mgr = TransportManager::new("iroh_node_1");
        assert_eq!(mgr.status(), TransportConnectionMode::DirectLan);
    }

    #[tokio::test]
    async fn test_iroh_loopback_two_node_envelope_exchange() {
        // 1. Create two independent in-process endpoints
        let node_a = IrohSyncEndpoint::bind(None)
            .await
            .expect("Failed to bind Node A");
        let node_b = IrohSyncEndpoint::bind(None)
            .await
            .expect("Failed to bind Node B");

        assert_ne!(node_a.endpoint_id(), node_b.endpoint_id());

        // 2. Node B dials Node A using Node A's discovered EndpointAddr
        let addr_a = node_a.endpoint_addr();
        let connected_peer = node_b
            .connect_endpoint_addr(addr_a)
            .await
            .expect("Node B connect to Node A");

        assert_eq!(connected_peer, node_a.endpoint_id());

        // Small delay to allow QUIC handshake to settle
        tokio::time::sleep(Duration::from_millis(50)).await;

        // 3. Node B sends envelope payload to Node A
        let payload = r#"{"envelope_id":"env_test_001","operation":"CREATE_WIDGET"}"#;
        node_b
            .send_envelope(&node_a.endpoint_id(), payload)
            .await
            .expect("Send envelope from B to A");

        // 4. Node A receives envelope payload
        let received = tokio::time::timeout(Duration::from_secs(5), node_a.next_inbound_envelope())
            .await
            .expect("Timeout waiting for envelope on Node A")
            .expect("Received envelope message");

        assert_eq!(received.sender_endpoint_id, node_b.endpoint_id());
        assert_eq!(received.payload_json, payload);

        // 5. Bidirectional test: Node A sends envelope back to Node B
        let response_payload = r#"{"envelope_id":"env_ack_002","status":"CONFIRMED"}"#;
        node_a
            .send_envelope(&node_b.endpoint_id(), response_payload)
            .await
            .expect("Send envelope from A to B");

        let received_by_b =
            tokio::time::timeout(Duration::from_secs(5), node_b.next_inbound_envelope())
                .await
                .expect("Timeout waiting for envelope on Node B")
                .expect("Received envelope message on Node B");

        assert_eq!(received_by_b.sender_endpoint_id, node_a.endpoint_id());
        assert_eq!(received_by_b.payload_json, response_payload);
    }
}
