import { generateCorrelationId, getUtcIsoTimestamp, ValidationError } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import { SyncEnvelopeBuilder, type SyncEnvelope } from "@platform/sync-protocol";

export type OutboxStatus = "PENDING" | "SENT" | "FAILED";

export const MAX_OUTBOX_BATCH_SIZE = 50;

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
  readonly envelopeJson: string;
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
  async enqueue(envelope: SyncEnvelope, tx: TransactionClient): Promise<OutboxRecord> {
    try {
      SyncEnvelopeBuilder.validateEnvelope(envelope);
    } catch (error) {
      throw new ValidationError({
        message: `Invalid outbox envelope: ${error instanceof Error ? error.message : String(error)}`,
        userMessage: "The sync operation is invalid or too large",
        correlationId: generateCorrelationId("outbox_envelope_invalid"),
      });
    }

    const id = generateCorrelationId("outbox");
    const now = getUtcIsoTimestamp();
    const op = envelope.operation;

    await tx.execute(
      `INSERT INTO core_sync_outbox (
        id, created_at, envelope_id, envelope_json, organisation_id, sync_group_id, feature_id,
        entity_type, entity_id, operation, payload_json, author_id, device_id,
        logical_timestamp, schema_version, protocol_version,
        signer_public_key, signature, status, attempt_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
      [
        id,
        now,
        envelope.envelopeId,
        JSON.stringify(envelope),
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
      envelopeJson: JSON.stringify(envelope),
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
      `UPDATE core_sync_outbox
       SET status = 'SENT', sent_at = ?
       WHERE envelope_id = ? AND status = 'PENDING'`,
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
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
      throw new ValidationError({
        message: "Outbox maxAttempts must be a positive safe integer",
        userMessage: "The sync retry limit is invalid",
        correlationId: generateCorrelationId("outbox_max_attempts"),
      });
    }

    const now = getUtcIsoTimestamp();
    await this.db.execute(
      `UPDATE core_sync_outbox
         SET attempt_count = attempt_count + 1,
             last_attempt_at = ?,
             status = CASE WHEN attempt_count + 1 >= ? THEN 'FAILED' ELSE status END
       WHERE envelope_id = ? AND status = 'PENDING'`,
      [now, maxAttempts, envelopeId],
    );
  }

  /**
   * Returns up to `limit` PENDING rows for one organisation, ordered oldest first.
   * Used by the transport layer to pick up work.
   */
  async pendingBatch(
    organisationId: string,
    limit = MAX_OUTBOX_BATCH_SIZE,
  ): Promise<OutboxRecord[]> {
    if (typeof organisationId !== "string" || organisationId.trim().length === 0) {
      throw new ValidationError({
        message: "Outbox organisationId must be a non-empty string",
        userMessage: "The sync organisation is invalid",
        correlationId: generateCorrelationId("outbox_organisation"),
      });
    }

    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_OUTBOX_BATCH_SIZE) {
      throw new ValidationError({
        message: `Outbox batch limit must be a positive safe integer no greater than ${MAX_OUTBOX_BATCH_SIZE}`,
        userMessage: "The sync batch size is invalid",
        correlationId: generateCorrelationId("outbox_batch_limit"),
      });
    }

    const rows = await this.db.query<{
      id: string;
      created_at: string;
      envelope_id: string;
      envelope_json: string | null;
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
      `SELECT * FROM core_sync_outbox
       WHERE status = 'PENDING' AND organisation_id = ?
       ORDER BY created_at ASC LIMIT ?`,
      [organisationId, limit],
    );

    const validatedEnvelopes = rows.map((row) => {
      try {
        if (typeof row.envelope_json !== "string") {
          throw new Error("Pending outbox row predates full-envelope persistence");
        }

        const envelope: unknown = JSON.parse(row.envelope_json);
        SyncEnvelopeBuilder.validateEnvelope(envelope);
        const operation = envelope.operation;
        if (
          envelope.envelopeId !== row.envelope_id ||
          envelope.signerPublicKey !== row.signer_public_key ||
          envelope.signature !== row.signature ||
          operation.organisationId !== row.organisation_id ||
          operation.syncGroupId !== row.sync_group_id ||
          operation.featureId !== row.feature_id ||
          operation.entityType !== row.entity_type ||
          operation.entityId !== row.entity_id ||
          operation.operation !== row.operation ||
          JSON.stringify(operation.payload) !== row.payload_json ||
          operation.authorId !== row.author_id ||
          operation.deviceId !== row.device_id ||
          operation.logicalTimestamp !== row.logical_timestamp ||
          operation.schemaVersion !== row.schema_version ||
          operation.protocolVersion !== row.protocol_version
        ) {
          throw new Error("Persisted sync envelope does not match its outbox metadata");
        }
        return row.envelope_json;
      } catch (error) {
        throw new ValidationError({
          message: `Invalid persisted outbox envelope: ${error instanceof Error ? error.message : String(error)}`,
          userMessage: "A queued sync operation requires repair before it can be sent",
          correlationId: generateCorrelationId("outbox_envelope_corrupt"),
        });
      }
    });

    return rows.map((r, index) => ({
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
      envelopeJson: validatedEnvelopes[index]!,
      status: r.status,
      attemptCount: r.attempt_count,
      lastAttemptAt: r.last_attempt_at,
      sentAt: r.sent_at,
    }));
  }
}
