use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};

pub const SYNC_ALPN: &[u8] = b"tauri-boilerplate-sync/1.0";

#[derive(Debug, thiserror::Error)]
pub enum SyncTransportError {
    #[error("Iroh endpoint error: {0}")]
    Iroh(String),
    #[error("Peer not connected: {0}")]
    NotConnected(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Stream error: {0}")]
    Stream(String),
    #[error("Invalid EndpointId: {0}")]
    InvalidEndpointId(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundEnvelopeMessage {
    pub sender_endpoint_id: String,
    pub payload_json: String,
}

#[derive(Clone)]
pub struct IrohSyncEndpoint {
    endpoint: Endpoint,
    connections: Arc<RwLock<HashMap<EndpointId, iroh::endpoint::Connection>>>,
    inbound_sender: mpsc::Sender<InboundEnvelopeMessage>,
    inbound_receiver: Arc<Mutex<mpsc::Receiver<InboundEnvelopeMessage>>>,
}

impl IrohSyncEndpoint {
    /// Creates and binds a new iroh endpoint with ALPN `tauri-boilerplate-sync/1.0`.
    pub async fn bind(secret_key: Option<SecretKey>) -> Result<Self, SyncTransportError> {
        let mut builder = Endpoint::builder(presets::N0);
        if let Some(key) = secret_key {
            builder = builder.secret_key(key);
        }
        builder = builder.alpns(vec![SYNC_ALPN.to_vec()]);

        let endpoint = builder
            .bind()
            .await
            .map_err(|e| SyncTransportError::Iroh(e.to_string()))?;

        let (inbound_sender, inbound_receiver) = mpsc::channel(128);
        let connections = Arc::new(RwLock::new(HashMap::new()));

        let instance = Self {
            endpoint: endpoint.clone(),
            connections: connections.clone(),
            inbound_sender: inbound_sender.clone(),
            inbound_receiver: Arc::new(Mutex::new(inbound_receiver)),
        };

        // Spawn stream listener loop for incoming connections
        let listener_endpoint = endpoint.clone();
        let listener_connections = connections.clone();
        let listener_tx = inbound_sender.clone();
        tokio::spawn(async move {
            Self::listen_incoming_streams(listener_endpoint, listener_connections, listener_tx)
                .await;
        });

        Ok(instance)
    }

    /// Returns the local node's public EndpointId string.
    pub fn endpoint_id(&self) -> String {
        self.endpoint.id().to_string()
    }

    /// Returns the current EndpointAddr containing endpoint id, relay URL, and direct addresses.
    pub fn endpoint_addr(&self) -> EndpointAddr {
        self.endpoint.addr()
    }

    /// Connects to a remote peer by EndpointAddr.
    pub async fn connect_endpoint_addr(
        &self,
        addr: EndpointAddr,
    ) -> Result<String, SyncTransportError> {
        let remote_id = addr.id;
        let conn = self
            .endpoint
            .connect(addr, SYNC_ALPN)
            .await
            .map_err(|e| SyncTransportError::Iroh(e.to_string()))?;

        let mut conns = self.connections.write().await;
        conns.insert(remote_id, conn.clone());

        // Listen on incoming bi-streams for this newly established connection
        let sender = self.inbound_sender.clone();
        tokio::spawn(async move {
            Self::handle_connection_streams(remote_id, conn, sender).await;
        });

        Ok(remote_id.to_string())
    }

    /// Disconnects an active peer connection.
    pub async fn disconnect(&self, endpoint_id_str: &str) -> Result<(), SyncTransportError> {
        let endpoint_id: EndpointId =
            endpoint_id_str
                .parse()
                .map_err(|e: iroh::KeyParsingError| {
                    SyncTransportError::InvalidEndpointId(e.to_string())
                })?;

        let mut conns = self.connections.write().await;
        if let Some(conn) = conns.remove(&endpoint_id) {
            conn.close(0u32.into(), b"disconnected by user");
        }
        Ok(())
    }

    /// Checks whether an active connection exists for the given peer.
    pub async fn is_connected(&self, endpoint_id_str: &str) -> bool {
        if let Ok(endpoint_id) = endpoint_id_str.parse::<EndpointId>() {
            let conns = self.connections.read().await;
            conns.contains_key(&endpoint_id)
        } else {
            false
        }
    }

    /// Sends a length-prefixed JSON envelope string across a bidirectional QUIC stream.
    pub async fn send_envelope(
        &self,
        endpoint_id_str: &str,
        payload_json: &str,
    ) -> Result<(), SyncTransportError> {
        let endpoint_id: EndpointId =
            endpoint_id_str
                .parse()
                .map_err(|e: iroh::KeyParsingError| {
                    SyncTransportError::InvalidEndpointId(e.to_string())
                })?;

        let conns = self.connections.read().await;
        let conn = conns
            .get(&endpoint_id)
            .ok_or_else(|| SyncTransportError::NotConnected(endpoint_id_str.to_string()))?;

        let (mut send_stream, mut recv_stream) = conn
            .open_bi()
            .await
            .map_err(|e| SyncTransportError::Stream(e.to_string()))?;

        let bytes = payload_json.as_bytes();
        let len = bytes.len() as u32;

        // Write 4-byte big-endian length prefix followed by payload bytes
        send_stream
            .write_all(&len.to_be_bytes())
            .await
            .map_err(|e| SyncTransportError::Stream(e.to_string()))?;
        send_stream
            .write_all(bytes)
            .await
            .map_err(|e| SyncTransportError::Stream(e.to_string()))?;
        send_stream
            .finish()
            .map_err(|e| SyncTransportError::Stream(e.to_string()))?;

        // Await 1-byte ACK from peer
        let mut ack = [0u8; 1];
        recv_stream
            .read_exact(&mut ack)
            .await
            .map_err(|e| SyncTransportError::Stream(format!("ACK failed: {e}")))?;

        Ok(())
    }

    /// Receives the next inbound envelope from any connected peer.
    pub async fn next_inbound_envelope(&self) -> Option<InboundEnvelopeMessage> {
        let mut rx = self.inbound_receiver.lock().await;
        rx.recv().await
    }

    /// Background task listening for incoming connecting peers and accepting their streams.
    async fn listen_incoming_streams(
        endpoint: Endpoint,
        connections: Arc<RwLock<HashMap<EndpointId, iroh::endpoint::Connection>>>,
        inbound_sender: mpsc::Sender<InboundEnvelopeMessage>,
    ) {
        while let Some(incoming) = endpoint.accept().await {
            let sender = inbound_sender.clone();
            let conns = connections.clone();
            tokio::spawn(async move {
                if let Ok(conn) = incoming.await {
                    let endpoint_id = conn.remote_id();
                    {
                        let mut lock = conns.write().await;
                        lock.insert(endpoint_id, conn.clone());
                    }
                    Self::handle_connection_streams(endpoint_id, conn, sender).await;
                }
            });
        }
    }

    /// Handles bidirectional streams on an established peer connection.
    async fn handle_connection_streams(
        remote_endpoint_id: EndpointId,
        conn: iroh::endpoint::Connection,
        sender: mpsc::Sender<InboundEnvelopeMessage>,
    ) {
        while let Ok((mut send_stream, mut recv_stream)) = conn.accept_bi().await {
            let sender_clone = sender.clone();
            tokio::spawn(async move {
                // Read 4-byte length prefix
                let mut len_bytes = [0u8; 4];
                if recv_stream.read_exact(&mut len_bytes).await.is_err() {
                    return;
                }
                let len = u32::from_be_bytes(len_bytes) as usize;
                if len > 10 * 1024 * 1024 {
                    // Enforce 10 MiB frame limit to protect against OOM
                    return;
                }

                let mut buf = vec![0u8; len];
                if recv_stream.read_exact(&mut buf).await.is_err() {
                    return;
                }

                if let Ok(payload_json) = String::from_utf8(buf) {
                    // Send 1-byte ACK
                    let _ = send_stream.write_all(&[1u8]).await;
                    let _ = send_stream.finish();

                    let _ = sender_clone
                        .send(InboundEnvelopeMessage {
                            sender_endpoint_id: remote_endpoint_id.to_string(),
                            payload_json,
                        })
                        .await;
                }
            });
        }
    }
}
