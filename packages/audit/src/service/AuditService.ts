import { getUtcIsoTimestamp, generateCorrelationId } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type {
  AuditEvent,
  EmitAuditEventInput,
  AuditEventType,
} from "../types.js";

export interface QueryAuditOptions {
  eventType?: AuditEventType | undefined;
  userId?: string | undefined;
  deviceId?: string | undefined;
  correlationId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export class AuditService {
  private readonly db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  async emit(
    input: EmitAuditEventInput,
    tx?: TransactionClient,
  ): Promise<AuditEvent> {
    const executor = tx ?? this.db;
    const id = generateCorrelationId("aud");
    const timestamp = getUtcIsoTimestamp();
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

    const sql = `
      INSERT INTO core_audit_events (
        id, event_type, user_id, device_id, organisation_id, correlation_id, timestamp, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await executor.execute(sql, [
      id,
      input.eventType,
      input.userId ?? null,
      input.deviceId,
      input.organisationId,
      input.correlationId,
      timestamp,
      metadataJson,
    ]);

    return {
      id,
      eventType: input.eventType,
      userId: input.userId ?? null,
      deviceId: input.deviceId,
      organisationId: input.organisationId,
      correlationId: input.correlationId,
      timestamp,
      metadata: input.metadata
        ? Object.freeze({ ...input.metadata })
        : undefined,
    };
  }

  async listEvents(
    organisationId: string,
    options?: QueryAuditOptions,
    tx?: TransactionClient,
  ): Promise<AuditEvent[]> {
    const executor = tx ?? this.db;
    let sql = "SELECT * FROM core_audit_events WHERE organisation_id = ?";
    const params: unknown[] = [organisationId];

    if (options?.eventType) {
      sql += " AND event_type = ?";
      params.push(options.eventType);
    }
    if (options?.userId) {
      sql += " AND user_id = ?";
      params.push(options.userId);
    }
    if (options?.deviceId) {
      sql += " AND device_id = ?";
      params.push(options.deviceId);
    }
    if (options?.correlationId) {
      sql += " AND correlation_id = ?";
      params.push(options.correlationId);
    }

    sql += " ORDER BY timestamp DESC";

    if (typeof options?.limit === "number") {
      sql += " LIMIT ?";
      params.push(options.limit);
      if (typeof options?.offset === "number") {
        sql += " OFFSET ?";
        params.push(options.offset);
      }
    }

    const rows = await executor.query<{
      id: string;
      event_type: AuditEventType;
      user_id: string | null;
      device_id: string;
      organisation_id: string;
      correlation_id: string;
      timestamp: string;
      metadata_json: string | null;
    }>(sql, params);

    return rows.map((r) => {
      let metadata: Record<string, unknown> | undefined = undefined;
      if (r.metadata_json) {
        try {
          metadata = JSON.parse(r.metadata_json);
        } catch {
          // Ignore parse errors
        }
      }
      return {
        id: r.id,
        eventType: r.event_type,
        userId: r.user_id,
        deviceId: r.device_id,
        organisationId: r.organisation_id,
        correlationId: r.correlation_id,
        timestamp: r.timestamp,
        metadata: metadata ? Object.freeze(metadata) : undefined,
      };
    });
  }
}
