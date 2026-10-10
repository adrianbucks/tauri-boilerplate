import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { AuditEventType } from "../types.js";

export interface AuditEventRow {
  id: string;
  event_type: AuditEventType;
  user_id: string | null;
  device_id: string;
  organisation_id: string;
  correlation_id: string;
  timestamp: string;
  metadata_json: string | null;
}

export interface AuditEventFilters {
  eventType?: AuditEventType | undefined;
  userId?: string | undefined;
  deviceId?: string | undefined;
  correlationId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export class AuditRepository {
  constructor(private readonly db: DatabaseConnection) {}

  async insert(values: readonly unknown[], tx?: TransactionClient): Promise<void> {
    const executor = tx ?? this.db;
    await executor.execute(
      `INSERT INTO core_audit_events (
        id, event_type, user_id, device_id, organisation_id, correlation_id, timestamp, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [...values],
    );
  }

  async findByOrganisation(
    organisationId: string,
    filters: AuditEventFilters = {},
    tx?: TransactionClient,
  ): Promise<AuditEventRow[]> {
    const executor = tx ?? this.db;
    let sql = "SELECT * FROM core_audit_events WHERE organisation_id = ?";
    const params: unknown[] = [organisationId];

    if (filters.eventType) {
      sql += " AND event_type = ?";
      params.push(filters.eventType);
    }
    if (filters.userId) {
      sql += " AND user_id = ?";
      params.push(filters.userId);
    }
    if (filters.deviceId) {
      sql += " AND device_id = ?";
      params.push(filters.deviceId);
    }
    if (filters.correlationId) {
      sql += " AND correlation_id = ?";
      params.push(filters.correlationId);
    }

    sql += " ORDER BY timestamp DESC";
    if (typeof filters.limit === "number") {
      sql += " LIMIT ?";
      params.push(filters.limit);
      if (typeof filters.offset === "number") {
        sql += " OFFSET ?";
        params.push(filters.offset);
      }
    }

    return executor.query<AuditEventRow>(sql, params);
  }
}
