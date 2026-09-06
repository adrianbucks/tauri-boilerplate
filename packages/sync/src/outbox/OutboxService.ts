import { generateCorrelationId, getUtcIsoTimestamp } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { SyncEnvelope } from "@platform/sync-protocol";

export type OutboxStatus = "PENDING" | "SENT" | "FAILED";

export interface OutboxRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly envelopeId: string;
  readonly organisationId: string;
  readonly syncGroupId: string;
  readonly featureId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: string;
  readonly payloadJson: string;
  readonly authorId: string;
  readonly deviceId: string;
  readonly logicalTimestamp: string;
  readonly schemaVersion: number;
  readonly protocolVersion: number;
  readonly signerPublicKey: string;
  readonly signature: string;
  readonly status: OutboxStatus;
  readonly attemptCount: number;
  readonly lastAttemptAt: string | null;
  readonly sentAt: string | null;
}

/**
 * Manages the durable outbound operation queue.
 *
 * Operations are enqueued atomically with business mutations by passing the
 * caller's transaction client. A transport layer later picks up PENDING rows.
 */
export class OutboxService {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  /**
   * Enqueues a signed envelope into the outbox.
   *
   * MUST be called inside the same transaction as the business mutation so that
   * the outbox row and the mutation succeed or fail together.
   *
   * @param envelope - The signed SyncEnvelope to persist.
   * @param tx - The transaction client from the calling service.
   */
  async enqueue(
    envelope: SyncEnvelope,
    tx: TransactionClient,
  ): Promise<OutboxRecord> {
    const id = generateCorrelationId("outbox");
    const now = getUtcIsoTimestamp();
    const op = envelope.operation;

    await tx.execute(
      `INSERT INTO core_sync_outbox (
        id, created_at, envelope_id, organisation_id, sync_group_id, feature_id,
        entity_type, entity_id, operation, payload_json, author_id, device_id,
        logical_timestamp, schema_version, protocol_version,
        signer_public_key, signature, status, attempt_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
      [
        id,
        now,
        envelope.envelopeId,
        op.organisationId,
        op.syncGroupId,
        op.featureId,
        op.entityType,
        op.entityId,
        op.operation,
        JSON.stringify(op.payload),
        op.authorId,
        op.deviceId,
        op.logicalTimestamp,
        op.schemaVersion,
        op.protocolVersion,
        envelope.signerPublicKey,
        envelope.signature,
      ],
    );

    return {
      id,
      createdAt: now,
      envelopeId: envelope.envelopeId,
      organisationId: op.organisationId,
      syncGroupId: op.syncGroupId,
      featureId: op.featureId,
      entityType: op.entityType,
      entityId: op.entityId,
      operation: op.operation,
      payloadJson: JSON.stringify(op.payload),
      authorId: op.authorId,
      deviceId: op.deviceId,
      logicalTimestamp: op.logicalTimestamp,
      schemaVersion: op.schemaVersion,
      protocolVersion: op.protocolVersion,
      signerPublicKey: envelope.signerPublicKey,
      signature: envelope.signature,
      status: "PENDING",
      attemptCount: 0,
      lastAttemptAt: null,
      sentAt: null,
    };
  }

  /**
   * Marks an outbox row as successfully sent.
   */
  async markSent(envelopeId: string): Promise<void> {
    const now = getUtcIsoTimestamp();
    await this.db.execute(
      `UPDATE core_sync_outbox SET status = 'SENT', sent_at = ? WHERE envelope_id = ?`,
      [now, envelopeId],
    );
  }

  /**
   * Records a failed send attempt. After `maxAttempts`, sets status to FAILED.
   *
   * @param envelopeId - The envelope to update.
   * @param maxAttempts - Maximum retries before marking FAILED (default 5).
   */
  async markFailed(envelopeId: string, maxAttempts = 5): Promise<void> {
    const now = getUtcIsoTimestamp();
    await this.db.execute(
      `UPDATE core_sync_outbox
         SET attempt_count = attempt_count + 1,
             last_attempt_at = ?,
             status = CASE WHEN attempt_count + 1 >= ? THEN 'FAILED' ELSE status END
       WHERE envelope_id = ?`,
      [now, maxAttempts, envelopeId],
    );
  }

  /**
   * Returns up to `limit` PENDING outbox rows ordered by `created_at` (oldest first).
   * Used by the transport layer to pick up work.
   */
  async pendingBatch(limit = 50): Promise<OutboxRecord[]> {
    const rows = await this.db.query<{
      id: string;
      created_at: string;
      envelope_id: string;
      organisation_id: string;
      sync_group_id: string;
      feature_id: string;
      entity_type: string;
      entity_id: string;
      operation: string;
      payload_json: string;
      author_id: string;
      device_id: string;
      logical_timestamp: string;
      schema_version: number;
      protocol_version: number;
      signer_public_key: string;
      signature: string;
      status: OutboxStatus;
      attempt_count: number;
      last_attempt_at: string | null;
      sent_at: string | null;
    }>(
      `SELECT * FROM core_sync_outbox WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?`,
      [limit],
    );

    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      envelopeId: r.envelope_id,
      organisationId: r.organisation_id,
      syncGroupId: r.sync_group_id,
      featureId: r.feature_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      operation: r.operation,
      payloadJson: r.payload_json,
      authorId: r.author_id,
      deviceId: r.device_id,
      logicalTimestamp: r.logical_timestamp,
      schemaVersion: r.schema_version,
      protocolVersion: r.protocol_version,
      signerPublicKey: r.signer_public_key,
      signature: r.signature,
      status: r.status,
      attemptCount: r.attempt_count,
      lastAttemptAt: r.last_attempt_at,
      sentAt: r.sent_at,
    }));
  }
}
