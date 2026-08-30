import { getUtcIsoTimestamp, generateCorrelationId } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { SyncOperation } from "@platform/sync-protocol";
import { SyncStateMachine } from "./SyncStateMachine.js";
import type { SyncState, SyncDiagnostic, PeerInfo } from "../types.js";

export interface SyncManagerOptions {
  db: DatabaseConnection;
  deviceId: string;
  organisationId: string;
}

export class SyncManager {
  private readonly db: DatabaseConnection;
  private readonly deviceId: string;
  private readonly organisationId: string;
  private readonly peerStates = new Map<string, SyncStateMachine>();
  private readonly diagnosticsMap = new Map<string, SyncDiagnostic>();

  constructor(options: SyncManagerOptions) {
    this.db = options.db;
    this.deviceId = options.deviceId;
    this.organisationId = options.organisationId;
  }

  getPeerState(peerId: string): SyncState {
    const sm = this.peerStates.get(peerId);
    return sm ? sm.getState() : "DISCONNECTED";
  }

  async enqueueOperation(
    op: SyncOperation,
    tx?: TransactionClient,
  ): Promise<void> {
    const executor = tx ?? this.db;
    const now = getUtcIsoTimestamp();
    const sessionId = generateCorrelationId("sync_op");

    // Record in local sync session tracking
    await executor.execute(
      "INSERT INTO core_sync_sessions (id, peer_device_id, operation_id, started_at, state, bytes_exchanged, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [sessionId, op.deviceId, op.operationId, now, "IDLE", 0, op.operationId],
    );
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
