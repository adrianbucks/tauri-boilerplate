import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { SyncOperation } from "@platform/sync-protocol";
import { SyncEnvelopeBuilder, type SignFn } from "@platform/sync-protocol";
import { SyncStateMachine } from "./SyncStateMachine.js";
import { OutboxService, type OutboxRecord } from "../outbox/OutboxService.js";
import type { SyncTransport } from "../transport/SyncTransport.js";
import type { SyncState, SyncDiagnostic, PeerInfo } from "../types.js";

export interface SyncManagerOptions {
  db: DatabaseConnection;
  deviceId: string;
  organisationId: string;
  signerPublicKey?: string | undefined;
  signFn?: SignFn | undefined;
  outboxService?: OutboxService | undefined;
  transport?: SyncTransport | undefined;
}

export class SyncManager {
  private readonly db: DatabaseConnection;
  private readonly deviceId: string;
  private readonly organisationId: string;
  private readonly signerPublicKey?: string | undefined;
  private readonly signFn?: SignFn | undefined;
  private readonly outboxService: OutboxService;
  private readonly transport?: SyncTransport | undefined;
  private readonly peerStates = new Map<string, SyncStateMachine>();
  private readonly diagnosticsMap = new Map<string, SyncDiagnostic>();
  private currentState: SyncState = "DISCONNECTED";
  private readonly stateListeners = new Set<(state: SyncState) => void>();

  constructor(options: SyncManagerOptions) {
    this.db = options.db;
    this.deviceId = options.deviceId;
    this.organisationId = options.organisationId;
    this.signerPublicKey = options.signerPublicKey;
    this.signFn = options.signFn;
    this.outboxService = options.outboxService ?? new OutboxService(options.db);
    this.transport = options.transport;
    this.currentState = options.transport ? "IDLE" : "DISCONNECTED";
  }

  getState(): SyncState {
    return this.currentState;
  }

  setState(state: SyncState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch {
        // Suppress listener errors
      }
    }
  }

  onStateChange(listener: (state: SyncState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  getPeerState(peerId: string): SyncState {
    const sm = this.peerStates.get(peerId);
    return sm ? sm.getState() : "DISCONNECTED";
  }

  getOutboxService(): OutboxService {
    return this.outboxService;
  }

  getTransport(): SyncTransport | undefined {
    return this.transport;
  }

  /**
   * Enqueues a business operation into the durable outbox.
   *
   * Automatically signs the operation into a canonical SyncEnvelope and
   * writes it to core_sync_outbox atomically (using the caller's transaction
   * if supplied).
   */
  async enqueueOperation(op: SyncOperation, tx?: TransactionClient): Promise<OutboxRecord> {
    if (!this.signerPublicKey || !this.signFn) {
      throw new Error(
        "[SyncManager] Cannot enqueue operation: signerPublicKey and signFn must be configured on SyncManager.",
      );
    }

    const envelope = await SyncEnvelopeBuilder.build(op, this.signerPublicKey, this.signFn);

    if (tx) {
      return this.outboxService.enqueue(envelope, tx);
    }

    return this.db.transaction(async (trx) => {
      return this.outboxService.enqueue(envelope, trx);
    });
  }

  async connect(peer: PeerInfo): Promise<void> {
    let sm = this.peerStates.get(peer.peerId);
    if (!sm) {
      sm = new SyncStateMachine();
      this.peerStates.set(peer.peerId, sm);
    }

    // Tenant metadata is a useful early rejection check, but is not admission proof.
    if (peer.organisationId !== this.organisationId) {
      sm.transition("ERROR", "Organisation mismatch");
      this.setState("ERROR");
      return;
    }

    // This method does not establish a transport connection, and caller-provided
    // peer metadata is not proof of the seven admission gates. Until a trusted
    // verifier is supplied, fail closed instead of claiming a connected/authorized peer.
    sm.transition("ERROR", "Peer admission verifier is not configured");
    this.setState("ERROR");
  }

  async disconnect(peerId: string): Promise<void> {
    const sm = this.peerStates.get(peerId);
    if (sm) {
      sm.transition("DISCONNECTED");
    }
    const anyConnected = Array.from(this.peerStates.values()).some(
      (s) => s.getState() !== "DISCONNECTED",
    );
    this.setState(anyConnected ? this.currentState : this.transport ? "IDLE" : "DISCONNECTED");
  }

  getDiagnostics(): SyncDiagnostic[] {
    return Array.from(this.diagnosticsMap.values());
  }
}
