import { generateCorrelationId, getUtcIsoTimestamp } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";

export interface TombstoneRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly organisationId: string;
  readonly syncGroupId: string;
  readonly featureId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly deletedAt: string;
  readonly deletedBy: string;
  readonly deleteOperationId: string;
  readonly replicatedAt: string | null;
}

/**
 * Records and queries replication-safe entity deletions.
 *
 * Synchronisable entities MUST NOT be deleted with raw DELETE statements.
 * Instead, call `TombstoneService.record()` to write a tombstone row and
 * enqueue a delete operation for replication (Invariant #6).
 */
export class TombstoneService {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  /**
   * Records a tombstone for a deleted synchronisable entity.
   *
   * MUST be called inside the same transaction as any soft-delete field update
   * (e.g., setting `deleted_at` on the entity row).
   *
   * @param entityType - The entity type (e.g., 'widgets').
   * @param entityId - The entity's primary key.
   * @param deletedBy - The user ID performing the deletion.
   * @param deleteOperationId - A globally unique ID for this delete operation.
   * @param orgId - The owning organisation.
   * @param syncGroupId - The sync group to propagate within.
   * @param featureId - The feature that owns the entity.
   * @param tx - Transaction client (required for atomicity).
   */
  async record(
    entityType: string,
    entityId: string,
    deletedBy: string,
    deleteOperationId: string,
    orgId: string,
    syncGroupId: string,
    featureId: string,
    tx: TransactionClient,
  ): Promise<TombstoneRecord> {
    const id = generateCorrelationId("tomb");
    const now = getUtcIsoTimestamp();

    await tx.execute(
      `INSERT INTO core_sync_tombstones (
        id, created_at, organisation_id, sync_group_id, feature_id,
        entity_type, entity_id, deleted_at, deleted_by, delete_operation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        now,
        orgId,
        syncGroupId,
        featureId,
        entityType,
        entityId,
        now,
        deletedBy,
        deleteOperationId,
      ],
    );

    return {
      id,
      createdAt: now,
      organisationId: orgId,
      syncGroupId,
      featureId,
      entityType,
      entityId,
      deletedAt: now,
      deletedBy,
      deleteOperationId,
      replicatedAt: null,
    };
  }

  /**
   * Returns true if a tombstone exists for the given entity within the organisation.
   */
  async isDeleted(
    entityType: string,
    entityId: string,
    orgId: string,
    tx?: TransactionClient,
  ): Promise<boolean> {
    const executor = tx ?? this.db;
    const rows = await executor.query<{ id: string }>(
      `SELECT id FROM core_sync_tombstones
       WHERE organisation_id = ? AND entity_type = ? AND entity_id = ?
       LIMIT 1`,
      [orgId, entityType, entityId],
    );
    return rows.length > 0;
  }

  /**
   * Returns tombstone records that have not yet been replicated to peers.
   * Used by the replication transport to propagate delete operations.
   */
  async propagatePending(): Promise<TombstoneRecord[]> {
    const rows = await this.db.query<{
      id: string;
      created_at: string;
      organisation_id: string;
      sync_group_id: string;
      feature_id: string;
      entity_type: string;
      entity_id: string;
      deleted_at: string;
      deleted_by: string;
      delete_operation_id: string;
      replicated_at: string | null;
    }>(
      `SELECT * FROM core_sync_tombstones WHERE replicated_at IS NULL ORDER BY deleted_at ASC`,
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      organisationId: r.organisation_id,
      syncGroupId: r.sync_group_id,
      featureId: r.feature_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      deletedAt: r.deleted_at,
      deletedBy: r.deleted_by,
      deleteOperationId: r.delete_operation_id,
      replicatedAt: r.replicated_at,
    }));
  }

  /**
   * Marks a tombstone as replicated after successful transport delivery.
   */
  async markReplicated(deleteOperationId: string): Promise<void> {
    const now = getUtcIsoTimestamp();
    await this.db.execute(
      `UPDATE core_sync_tombstones SET replicated_at = ? WHERE delete_operation_id = ?`,
      [now, deleteOperationId],
    );
  }
}
