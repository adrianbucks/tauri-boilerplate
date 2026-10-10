import { generateCorrelationId, getUtcIsoTimestamp, ValidationError } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { SyncEnvelope, VerifyFn } from "@platform/sync-protocol";
import { SyncEnvelopeBuilder } from "@platform/sync-protocol";

export type VerificationStatus = "UNVERIFIED" | "VERIFIED" | "REJECTED";
export type ApplyStatus = "PENDING" | "APPLIED" | "CONFLICT" | "FAILED";

export interface InboxRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly envelopeId: string;
  readonly organisationId: string;
  readonly fromDeviceId: string;
  readonly syncGroupId: string;
  readonly featureId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: string;
  readonly payloadJson: string;
  readonly logicalTimestamp: string;
  readonly schemaVersion: number;
  readonly protocolVersion: number;
  readonly signerPublicKey: string;
  readonly signature: string;
  readonly verificationStatus: VerificationStatus;
  readonly applyStatus: ApplyStatus;
  readonly appliedAt: string | null;
  readonly conflictId: string | null;
}

/**
 * Manages the durable inbound operation queue.
 *
 * Received envelopes are persisted with signature verification before apply.
 * Apply is idempotent: duplicate `envelope_id` rows are silently ignored
 * (`ON CONFLICT (envelope_id) DO NOTHING`).
 */
export class InboxService {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  /**
   * Persists a received envelope and verifies its signature.
   *
   * If the envelope's `envelope_id` is already in the inbox (duplicate delivery),
   * the insert is silently ignored and the existing record is returned.
   *
   * @param envelope - The received SyncEnvelope.
   * @param verifyFn - Callback for Ed25519 signature verification.
   * @param tx - Optional external transaction client.
   */
  async receive(
    envelope: SyncEnvelope,
    verifyFn: VerifyFn,
    tx?: TransactionClient,
  ): Promise<InboxRecord> {
    try {
      SyncEnvelopeBuilder.validateEnvelope(envelope);
    } catch (error) {
      throw new ValidationError({
        message: `Invalid inbound sync envelope: ${error instanceof Error ? error.message : String(error)}`,
        userMessage: "The received sync operation is invalid",
        correlationId: generateCorrelationId("inbox_invalid"),
      });
    }

    const executor = tx ?? this.db;
    const id = generateCorrelationId("inbox");
    const now = getUtcIsoTimestamp();
    const op = envelope.operation;

    // Verify the signature
    let verificationStatus: VerificationStatus;
    try {
      const isValid = await SyncEnvelopeBuilder.verify(envelope, verifyFn);
      verificationStatus = isValid ? "VERIFIED" : "REJECTED";
    } catch {
      verificationStatus = "REJECTED";
    }

    await executor.execute(
      `INSERT INTO core_sync_inbox (
        id, created_at, envelope_id, organisation_id, from_device_id,
        sync_group_id, feature_id, entity_type, entity_id, operation,
        payload_json, logical_timestamp, schema_version, protocol_version,
        signer_public_key, signature, verification_status, apply_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
      ON CONFLICT(envelope_id) DO NOTHING`,
      [
        id,
        now,
        envelope.envelopeId,
        op.organisationId,
        op.deviceId,
        op.syncGroupId,
        op.featureId,
        op.entityType,
        op.entityId,
        op.operation,
        JSON.stringify(op.payload),
        op.logicalTimestamp,
        op.schemaVersion,
        op.protocolVersion,
        envelope.signerPublicKey,
        envelope.signature,
        verificationStatus,
      ],
    );

    const rows = await executor.query<InboxRow>(
      "SELECT * FROM core_sync_inbox WHERE envelope_id = ? LIMIT 1",
      [envelope.envelopeId],
    );
    const stored = rows[0];
    if (!stored) {
      throw new ValidationError({
        message: `Inbox insert for envelope '${envelope.envelopeId}' completed without a stored row`,
        userMessage: "The received sync operation could not be stored",
        correlationId: generateCorrelationId("inbox_store"),
      });
    }
    if (
      stored.signer_public_key !== envelope.signerPublicKey ||
      stored.signature !== envelope.signature ||
      (stored.id !== id && verificationStatus !== "VERIFIED")
    ) {
      throw new ValidationError({
        message: `Envelope ID '${envelope.envelopeId}' is already bound to a different signed operation`,
        userMessage: "The received sync operation conflicts with an existing operation",
        correlationId: generateCorrelationId("inbox_collision"),
      });
    }

    return mapRow(stored);
  }

  /**
   * Applies PENDING + VERIFIED inbox rows in logical_timestamp order.
   *
   * @param applyFn - Caller-provided function that applies a single envelope to the domain.
   *                  Should throw on conflict or failure.
   */
  async applyPending(
    applyFn: (record: InboxRecord) => Promise<void>,
    tx?: TransactionClient,
  ): Promise<{ applied: number; failed: number; conflicts: number }> {
    const executor = tx ?? this.db;

    const rows = await executor.query<{
      id: string;
      created_at: string;
      envelope_id: string;
      organisation_id: string;
      from_device_id: string;
      sync_group_id: string;
      feature_id: string;
      entity_type: string;
      entity_id: string;
      operation: string;
      payload_json: string;
      logical_timestamp: string;
      schema_version: number;
      protocol_version: number;
      signer_public_key: string;
      signature: string;
      verification_status: VerificationStatus;
      apply_status: ApplyStatus;
      applied_at: string | null;
      conflict_id: string | null;
    }>(
      `SELECT * FROM core_sync_inbox
       WHERE apply_status = 'PENDING' AND verification_status = 'VERIFIED'
       ORDER BY logical_timestamp ASC`,
    );

    let applied = 0;
    let failed = 0;
    let conflicts = 0;

    for (const row of rows) {
      const record = mapRow(row);
      try {
        await applyFn(record);
        const now = getUtcIsoTimestamp();
        await executor.execute(
          `UPDATE core_sync_inbox SET apply_status = 'APPLIED', applied_at = ? WHERE id = ?`,
          [now, record.id],
        );
        applied++;
      } catch (err) {
        const isConflict = err instanceof Error && err.message.toLowerCase().includes("conflict");
        const newStatus = isConflict ? "CONFLICT" : "FAILED";
        await executor.execute(`UPDATE core_sync_inbox SET apply_status = ? WHERE id = ?`, [
          newStatus,
          record.id,
        ]);
        if (isConflict) {
          conflicts++;
        } else {
          failed++;
        }
      }
    }

    return { applied, failed, conflicts };
  }

  /**
   * Returns inbox records by apply status for diagnostics.
   */
  async getByApplyStatus(status: ApplyStatus): Promise<InboxRecord[]> {
    const rows = await this.db.query<{
      id: string;
      created_at: string;
      envelope_id: string;
      organisation_id: string;
      from_device_id: string;
      sync_group_id: string;
      feature_id: string;
      entity_type: string;
      entity_id: string;
      operation: string;
      payload_json: string;
      logical_timestamp: string;
      schema_version: number;
      protocol_version: number;
      signer_public_key: string;
      signature: string;
      verification_status: VerificationStatus;
      apply_status: ApplyStatus;
      applied_at: string | null;
      conflict_id: string | null;
    }>(`SELECT * FROM core_sync_inbox WHERE apply_status = ? ORDER BY logical_timestamp ASC`, [
      status,
    ]);
    return rows.map(mapRow);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InboxRow {
  id: string;
  created_at: string;
  envelope_id: string;
  organisation_id: string;
  from_device_id: string;
  sync_group_id: string;
  feature_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload_json: string;
  logical_timestamp: string;
  schema_version: number;
  protocol_version: number;
  signer_public_key: string;
  signature: string;
  verification_status: VerificationStatus;
  apply_status: ApplyStatus;
  applied_at: string | null;
  conflict_id: string | null;
}

function mapRow(r: InboxRow): InboxRecord {
  return {
    id: r.id,
    createdAt: r.created_at,
    envelopeId: r.envelope_id,
    organisationId: r.organisation_id,
    fromDeviceId: r.from_device_id,
    syncGroupId: r.sync_group_id,
    featureId: r.feature_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    payloadJson: r.payload_json,
    logicalTimestamp: r.logical_timestamp,
    schemaVersion: r.schema_version,
    protocolVersion: r.protocol_version,
    signerPublicKey: r.signer_public_key,
    signature: r.signature,
    verificationStatus: r.verification_status,
    applyStatus: r.apply_status,
    appliedAt: r.applied_at,
    conflictId: r.conflict_id,
  };
}
