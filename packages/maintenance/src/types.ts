import type { DatabaseConnection } from "@platform/database";

export interface PruningContext {
  connection: DatabaseConnection;
  cutoffDate: Date;
  batchSize: number;
  signal?: AbortSignal | undefined;
}

export interface PruningResult {
  handlerId: string;
  displayName: string;
  rowsPruned: number;
  durationMs: number;
  error?: string | undefined;
}

export interface PruningCandidateStats {
  handlerId: string;
  displayName: string;
  description: string;
  retentionDays: number;
  cutoffDate: string;
  eligibleRowCount: number;
}

export interface PruningHandler {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly defaultRetentionDays: number;

  /** Counts rows currently eligible for pruning */
  countEligible(connection: DatabaseConnection, cutoff: Date): Promise<number>;

  /** Executes the pruning in safe transaction batches */
  prune(ctx: PruningContext): Promise<PruningResult>;
}

import type { DeclarativePruningPolicy } from "@platform/core";
export type { DeclarativePruningPolicy };

export interface MaintenanceReport {
  timestamp: string;
  durationMs: number;
  totalRowsPruned: number;
  results: PruningResult[];
  vacuumExecuted: boolean;
  success: boolean;
  aborted: boolean;
}
