import { getUtcIsoTimestamp } from "@platform/core";
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

  constructor(options: SyncManagerOptions) {
    this.db = options.db;
    this.deviceId = options.deviceId;
    this.organisationId = options.organisationId;
    this.signerPublicKey = options.signerPublicKey;
    this.signFn = options.signFn;
    this.outboxService = options.outboxService ?? new OutboxService(options.db);
    this.transport = options.transport;
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
  async enqueueOperation(
    op: SyncOperation,
    tx?: TransactionClient,
  ): Promise<OutboxRecord> {
    if (!this.signerPublicKey || !this.signFn) {
      throw new Error(
        "[SyncManager] Cannot enqueue operation: signerPublicKey and signFn must be configured on SyncManager.",
      );
    }

    const envelope = await SyncEnvelopeBuilder.build(
      op,
      this.signerPublicKey,
      this.signFn,
    );

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

    sm.transition("DISCOVERED");
    sm.transition("IDENTIFIED");
    sm.transition("CONNECTING");
    sm.transition("CONNECTED");
    sm.transition("AUTHENTICATING");

    // 7-layer auth verification: must match organisation
    if (peer.organisationId !== this.organisationId) {
      sm.transition("ERROR", "Organisation mismatch");
      return;
    }

    sm.transition("AUTHORISED");
    sm.transition("IDLE");

    this.diagnosticsMap.set(peer.peerId, {
      peerId: peer.peerId,
      deviceId: peer.deviceId,
      connectionMode: "direct",
      relayUsed: null,
      lastConnected: getUtcIsoTimestamp(),
      lastSuccessfulSync: null,
      pendingOperations: 0,
      failedOperations: 0,
      conflicts: 0,
      state: "IDLE",
      protocolVersion: 1,
    });
  }

  async disconnect(peerId: string): Promise<void> {
    const sm = this.peerStates.get(peerId);
    if (sm) {
      sm.transition("DISCONNECTED");
    }
  }

  getDiagnostics(): SyncDiagnostic[] {
    return Array.from(this.diagnosticsMap.values());
  }
}
