import type { SyncEnvelope } from "@platform/sync-protocol";

export type ReceiveHandler = (
  peerId: string,
  envelope: SyncEnvelope,
) => Promise<void>;

/**
 * Transport abstraction boundary for synchronisation (WP-014 boundary).
 *
 * Real network transports (such as the iroh QUIC-based transport) and
 * in-memory simulators both implement this contract.
 */
export interface SyncTransport {
  /**
   * Establishes a transport session to a known peer.
   *
   * @param peerId - The unique peer identifier.
   * @param peerPublicKey - The peer's verified Ed25519 public key.
   */
  connect(peerId: string, peerPublicKey: string): Promise<void>;

  /**
   * Closes a transport session with a peer.
   */
  disconnect(peerId: string): Promise<void>;

  /**
   * Transmits a signed sync envelope to a connected peer.
   *
   * @throws if the peer is not currently connected.
   */
  send(peerId: string, envelope: SyncEnvelope): Promise<void>;

  /**
   * Registers a callback invoked whenever an envelope is received from any peer.
   */
  onReceive(handler: ReceiveHandler): void;

  /**
   * Returns true if a transport session is currently established with the peer.
   */
  isConnected(peerId: string): boolean;
}

/**
 * In-memory simulation transport for testing, development, and offline operation.
 *
 * Delivers envelopes directly or can be paired with another `SimulatedSyncTransport`
 * to simulate peer-to-peer transmission within test processes.
 */
export class SimulatedSyncTransport implements SyncTransport {
  private readonly connectedPeers = new Map<string, string>(); // peerId -> peerPublicKey
  private readonly handlers: ReceiveHandler[] = [];
  private peerTransport?: SimulatedSyncTransport | undefined;

  /**
   * Connects this simulated transport directly to another transport instance
   * so that `send()` on transport A triggers `onReceive` on transport B.
   */
  pairWith(other: SimulatedSyncTransport): void {
    this.peerTransport = other;
  }

  async connect(peerId: string, peerPublicKey: string): Promise<void> {
    this.connectedPeers.set(peerId, peerPublicKey);
  }

  async disconnect(peerId: string): Promise<void> {
    this.connectedPeers.delete(peerId);
  }

  isConnected(peerId: string): boolean {
    return this.connectedPeers.has(peerId);
  }

  async send(peerId: string, envelope: SyncEnvelope): Promise<void> {
    if (!this.connectedPeers.has(peerId)) {
      throw new Error(`[SimulatedSyncTransport] Cannot send: peer '${peerId}' is not connected.`);
    }

    if (this.peerTransport) {
      await this.peerTransport.deliver(peerId, envelope);
    }
  }

  onReceive(handler: ReceiveHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Directly delivers an envelope to registered handlers (used by tests or paired transports).
   */
  async deliver(peerId: string, envelope: SyncEnvelope): Promise<void> {
    for (const handler of this.handlers) {
      await handler(peerId, envelope);
    }
  }
}
