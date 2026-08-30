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

    #[test]
    fn test_transport_manager() {
        let mgr = TransportManager::new("iroh_node_1");
        assert_eq!(mgr.status(), TransportConnectionMode::DirectLan);
    }
}
