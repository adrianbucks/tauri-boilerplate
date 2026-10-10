use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, watch, Mutex, RwLock, Semaphore};

pub const SYNC_ALPN: &[u8] = b"tauri-boilerplate-sync/1.0";
const MAX_ENVELOPE_SIZE: usize = 10 * 1024 * 1024;
const INBOUND_QUEUE_CAPACITY: usize = 8;
const MAX_IN_FLIGHT_STREAMS: usize = 4;
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(30);
const STREAM_WRITE_TIMEOUT: Duration = Duration::from_secs(30);
const STREAM_ACK_TIMEOUT: Duration = Duration::from_secs(30);

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
    #[error("Envelope frame is too large: {0} bytes (maximum {MAX_ENVELOPE_SIZE})")]
    FrameTooLarge(usize),
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
    stream_slots: Arc<Semaphore>,
    shutdown_tx: watch::Sender<bool>,
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

        let (inbound_sender, inbound_receiver) = mpsc::channel(INBOUND_QUEUE_CAPACITY);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let connections = Arc::new(RwLock::new(HashMap::new()));
        let stream_slots = Arc::new(Semaphore::new(MAX_IN_FLIGHT_STREAMS));

        let instance = Self {
            endpoint: endpoint.clone(),
            connections: connections.clone(),
            inbound_sender: inbound_sender.clone(),
            inbound_receiver: Arc::new(Mutex::new(inbound_receiver)),
            stream_slots: stream_slots.clone(),
            shutdown_tx,
        };

        // Spawn stream listener loop for incoming connections
        let listener_endpoint = endpoint.clone();
        let listener_connections = connections.clone();
        let listener_tx = inbound_sender.clone();
        let listener_stream_slots = stream_slots;
        let listener_shutdown = shutdown_rx.clone();
        tokio::spawn(async move {
            Self::listen_incoming_streams(
                listener_endpoint,
                listener_connections,
                listener_tx,
                listener_stream_slots,
                listener_shutdown,
            )
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

        track_connection(remote_id, conn.clone(), self.connections.clone()).await;

        // Listen on incoming bi-streams for this newly established connection
        let sender = self.inbound_sender.clone();
        let stream_slots = self.stream_slots.clone();
        tokio::spawn(async move {
            Self::handle_connection_streams(remote_id, conn, sender, stream_slots).await;
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

        let bytes = payload_json.as_bytes();
        let len = frame_length(bytes.len())?;

        let conns = self.connections.read().await;
        let conn = conns
            .get(&endpoint_id)
            .ok_or_else(|| SyncTransportError::NotConnected(endpoint_id_str.to_string()))?;

        let (mut send_stream, mut recv_stream) = conn
            .open_bi()
            .await
            .map_err(|e| SyncTransportError::Stream(e.to_string()))?;

        // Write 4-byte big-endian length prefix followed by payload bytes
        tokio::time::timeout(
            STREAM_WRITE_TIMEOUT,
            send_stream.write_all(&len.to_be_bytes()),
        )
        .await
        .map_err(|_| SyncTransportError::Stream("frame prefix write timed out".to_string()))?
        .map_err(|e| SyncTransportError::Stream(e.to_string()))?;
        tokio::time::timeout(STREAM_WRITE_TIMEOUT, send_stream.write_all(bytes))
            .await
            .map_err(|_| SyncTransportError::Stream("frame payload write timed out".to_string()))?
            .map_err(|e| SyncTransportError::Stream(e.to_string()))?;
        send_stream
            .finish()
            .map_err(|e| SyncTransportError::Stream(e.to_string()))?;

        // The peer ACKs after buffering the frame for application processing.
        let mut ack = [0u8; 1];
        tokio::time::timeout(STREAM_ACK_TIMEOUT, recv_stream.read_exact(&mut ack))
            .await
            .map_err(|_| SyncTransportError::Stream("ACK timed out".to_string()))?
            .map_err(|e| SyncTransportError::Stream(format!("ACK failed: {e}")))?;

        Ok(())
    }

    /// Receives the next inbound envelope from any connected peer.
    pub async fn next_inbound_envelope(&self) -> Option<InboundEnvelopeMessage> {
        let mut shutdown_rx = self.shutdown_tx.subscribe();
        if *shutdown_rx.borrow() {
            return None;
        }
        let mut rx = self.inbound_receiver.lock().await;
        tokio::select! {
            message = rx.recv() => message,
            _ = shutdown_rx.changed() => None,
        }
    }

    /// Closes the endpoint and stops its listener and inbound receiver loops.
    pub async fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
        self.endpoint.close().await;
    }

    /// Background task listening for incoming connecting peers and accepting their streams.
    async fn listen_incoming_streams(
        endpoint: Endpoint,
        connections: Arc<RwLock<HashMap<EndpointId, iroh::endpoint::Connection>>>,
        inbound_sender: mpsc::Sender<InboundEnvelopeMessage>,
        stream_slots: Arc<Semaphore>,
        mut shutdown_rx: watch::Receiver<bool>,
    ) {
        loop {
            let incoming = tokio::select! {
                changed = shutdown_rx.changed() => {
                    if changed.is_err() || *shutdown_rx.borrow() {
                        break;
                    }
                    continue;
                }
                incoming = endpoint.accept() => incoming,
            };
            let Some(incoming) = incoming else { break };
            let sender = inbound_sender.clone();
            let conns = connections.clone();
            let stream_slots = stream_slots.clone();
            tokio::spawn(async move {
                if let Ok(conn) = incoming.await {
                    let endpoint_id = conn.remote_id();
                    track_connection(endpoint_id, conn.clone(), conns).await;
                    Self::handle_connection_streams(endpoint_id, conn, sender, stream_slots).await;
                }
            });
        }
    }

    /// Handles bidirectional streams on an established peer connection.
    async fn handle_connection_streams(
        remote_endpoint_id: EndpointId,
        conn: iroh::endpoint::Connection,
        sender: mpsc::Sender<InboundEnvelopeMessage>,
        stream_slots: Arc<Semaphore>,
    ) {
        while let Ok((mut send_stream, mut recv_stream)) = conn.accept_bi().await {
            // Acquire before spawning or allocating the frame buffer. This
            // bounds concurrent frame reads across all connected peers.
            let stream_slot = match stream_slots.clone().acquire_owned().await {
                Ok(slot) => slot,
                Err(_) => return,
            };
            let sender_clone = sender.clone();
            tokio::spawn(async move {
                let _stream_slot = stream_slot;
                // Read 4-byte length prefix
                let mut len_bytes = [0u8; 4];
                if !matches!(
                    tokio::time::timeout(
                        STREAM_READ_TIMEOUT,
                        recv_stream.read_exact(&mut len_bytes)
                    )
                    .await,
                    Ok(Ok(_))
                ) {
                    return;
                }
                let len = u32::from_be_bytes(len_bytes) as usize;
                if len > MAX_ENVELOPE_SIZE {
                    // Enforce 10 MiB frame limit to protect against OOM
                    return;
                }

                let mut buf = vec![0u8; len];
                if !matches!(
                    tokio::time::timeout(STREAM_READ_TIMEOUT, recv_stream.read_exact(&mut buf))
                        .await,
                    Ok(Ok(_))
                ) {
                    return;
                }

                if let Ok(payload_json) = String::from_utf8(buf) {
                    // ACK only after the bounded channel accepts the frame.
                    if sender_clone
                        .send(InboundEnvelopeMessage {
                            sender_endpoint_id: remote_endpoint_id.to_string(),
                            payload_json,
                        })
                        .await
                        .is_err()
                    {
                        return;
                    }
                    let _ = send_stream.write_all(&[1u8]).await;
                    let _ = send_stream.finish();
                }
            });
        }
    }
}

async fn track_connection(
    endpoint_id: EndpointId,
    conn: iroh::endpoint::Connection,
    connections: Arc<RwLock<HashMap<EndpointId, iroh::endpoint::Connection>>>,
) {
    let stable_id = conn.stable_id();
    let previous = connections.write().await.insert(endpoint_id, conn.clone());
    if let Some(previous) = previous.filter(|previous| previous.stable_id() != stable_id) {
        previous.close(0u32.into(), b"superseded by a newer peer connection");
    }

    tokio::spawn(async move {
        let _close_reason = conn.closed().await;
        let mut connections = connections.write().await;
        if connections
            .get(&endpoint_id)
            .is_some_and(|current| current.stable_id() == stable_id)
        {
            connections.remove(&endpoint_id);
        }
    });
}

fn frame_length(length: usize) -> Result<u32, SyncTransportError> {
    if length > MAX_ENVELOPE_SIZE {
        return Err(SyncTransportError::FrameTooLarge(length));
    }
    u32::try_from(length).map_err(|_| SyncTransportError::FrameTooLarge(length))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_length_accepts_supported_size_and_rejects_oversized_frame() {
        assert_eq!(
            frame_length(MAX_ENVELOPE_SIZE).unwrap(),
            MAX_ENVELOPE_SIZE as u32
        );
        assert!(matches!(
            frame_length(MAX_ENVELOPE_SIZE + 1),
            Err(SyncTransportError::FrameTooLarge(_))
        ));
    }
}
