import type { SyncEnvelope } from "@platform/sync-protocol";
import type { ReceiveHandler, SyncTransport } from "./SyncTransport.js";

export type TauriInvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type TauriListenFn = <T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

export interface SyncEndpointInfo {
  endpoint_id: string;
  addr_json: string;
}

export interface InboundEnvelopeMessage {
  sender_endpoint_id: string;
  payload_json: string;
}

export interface IrohSyncTransportOptions {
  invoke: TauriInvokeFn;
  listen?: TauriListenFn | undefined;
}

/**
 * Live peer-to-peer synchronisation transport backed by native iroh QUIC endpoints.
 *
 * Communicates with the native Rust layer (`sync-core` / Tauri native commands) via IPC.
 * Enforces ALPN-scoped TLS, framed bidirectional streams, and zero private key leakage.
 */
export class IrohSyncTransport implements SyncTransport {
  private readonly invoke: TauriInvokeFn;
  private readonly listen?: TauriListenFn | undefined;
  private readonly connectedPeers = new Map<string, string>(); // peerId -> remoteEndpointId
  private readonly handlers: ReceiveHandler[] = [];
  private endpointInfo?: SyncEndpointInfo | undefined;
  private unlistenFn?: (() => void) | undefined;
  private isInitializing = false;

  constructor(options: IrohSyncTransportOptions) {
    this.invoke = options.invoke;
    this.listen = options.listen;
  }

  /**
   * Initializes the native iroh endpoint if not already running,
   * and attaches the event listener for inbound envelopes.
   */
  async init(): Promise<SyncEndpointInfo> {
    if (this.endpointInfo) {
      return this.endpointInfo;
    }
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (this.endpointInfo) {
        return this.endpointInfo;
      }
    }

    this.isInitializing = true;
    try {
      this.endpointInfo = await this.invoke<SyncEndpointInfo>("sync_start_endpoint");

      if (this.listen && !this.unlistenFn) {
        this.unlistenFn = await this.listen<InboundEnvelopeMessage>(
          "sync://envelope-received",
          (event) => {
            void this.handleIncomingMessage(event.payload);
          },
        );
      }
      return this.endpointInfo;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Returns information about the local iroh endpoint (Node ID & serialized EndpointAddr).
   */
  getEndpointInfo(): SyncEndpointInfo | undefined {
    return this.endpointInfo;
  }

  /**
   * Connects to a remote peer via its EndpointAddr JSON or Node ID string.
   */
  async connect(peerId: string, peerPublicKeyOrAddr: string): Promise<void> {
    await this.init();

    const remoteEndpointId = await this.invoke<string>("sync_connect_peer", {
      request: {
        addr_json: peerPublicKeyOrAddr,
      },
    });

    this.connectedPeers.set(peerId, remoteEndpointId);
  }

  /**
   * Closes the active QUIC connection with the specified peer.
   */
  async disconnect(peerId: string): Promise<void> {
    const endpointId = this.connectedPeers.get(peerId) ?? peerId;
    try {
      await this.invoke("sync_disconnect_peer", {
        request: {
          endpoint_id: endpointId,
        },
      });
    } finally {
      this.connectedPeers.delete(peerId);
    }
  }

  /**
   * Returns true if a transport session is currently tracked for this peer.
   */
  isConnected(peerId: string): boolean {
    return this.connectedPeers.has(peerId);
  }

  /**
   * Transmits a signed sync envelope across a bidirectional QUIC stream to the peer.
   */
  async send(peerId: string, envelope: SyncEnvelope): Promise<void> {
    if (!this.connectedPeers.has(peerId)) {
      throw new Error(`[IrohSyncTransport] Cannot send: peer '${peerId}' is not connected.`);
    }

    const endpointId = this.connectedPeers.get(peerId)!;
    const payloadJson = JSON.stringify(envelope);

    await this.invoke("sync_send_envelope", {
      request: {
        endpoint_id: endpointId,
        payload_json: payloadJson,
      },
    });
  }

  /**
   * Registers a callback invoked whenever an envelope is received from any peer.
   */
  onReceive(handler: ReceiveHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Handles incoming envelope payloads dispatched from the native event listener.
   */
  async handleIncomingMessage(msg: InboundEnvelopeMessage): Promise<void> {
    try {
      const envelope: SyncEnvelope = JSON.parse(msg.payload_json);

      // Resolve peerId from known mapped endpoint IDs, or fallback to sender's endpoint ID
      let peerId = msg.sender_endpoint_id;
      for (const [id, epId] of this.connectedPeers.entries()) {
        if (epId === msg.sender_endpoint_id) {
          peerId = id;
          break;
        }
      }

      for (const handler of this.handlers) {
        await handler(peerId, envelope);
      }
    } catch (err) {
      console.error("[IrohSyncTransport] Failed to process incoming envelope:", err);
    }
  }

  /**
   * Cleanup any active event listeners.
   */
  dispose(): void {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = undefined;
    }
  }
}

