export type SyncState =
  | "DISCOVERED"
  | "IDENTIFIED"
  | "CONNECTING"
  | "CONNECTED"
  | "AUTHENTICATING"
  | "AUTHORISED"
  | "SYNCING"
  | "IDLE"
  | "DISCONNECTED"
  | "REVOKED"
  | "EXPIRED"
  | "INCOMPATIBLE"
  | "ERROR";

export interface SyncDiagnostic {
  readonly peerId: string;
  readonly deviceId: string;
  readonly connectionMode: "direct" | "relay";
  readonly relayUsed: string | null;
  readonly lastConnected: string | null;
  readonly lastSuccessfulSync: string | null;
  readonly pendingOperations: number;
  readonly failedOperations: number;
  readonly conflicts: number;
  readonly state: SyncState;
  readonly protocolVersion: number;
}

export interface PeerInfo {
  readonly peerId: string;
  readonly deviceId: string;
  readonly organisationId: string;
  readonly supportedSyncGroups: readonly string[];
}
