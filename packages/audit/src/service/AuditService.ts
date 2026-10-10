import { getUtcIsoTimestamp, generateCorrelationId } from "@platform/core";
import type { DatabaseConnection, TransactionClient } from "@platform/database";
import type { AuditEvent, EmitAuditEventInput, AuditEventType } from "../types.js";
import { AuditRepository } from "../repositories/AuditRepository.js";

export interface QueryAuditOptions {
  eventType?: AuditEventType | undefined;
  userId?: string | undefined;
  deviceId?: string | undefined;
  correlationId?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export class AuditService {
  private readonly repository: AuditRepository;

  constructor(db: DatabaseConnection) {
    this.repository = new AuditRepository(db);
  }

  async emit(input: EmitAuditEventInput, tx?: TransactionClient): Promise<AuditEvent> {
    const id = generateCorrelationId("aud");
    const timestamp = getUtcIsoTimestamp();
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

    await this.repository.insert(
      [
        id,
        input.eventType,
        input.userId ?? null,
        input.deviceId,
        input.organisationId,
        input.correlationId,
        timestamp,
        metadataJson,
      ],
      tx,
    );

    return {
      id,
      eventType: input.eventType,
      userId: input.userId ?? null,
      deviceId: input.deviceId,
      organisationId: input.organisationId,
      correlationId: input.correlationId,
      timestamp,
      metadata: input.metadata ? Object.freeze({ ...input.metadata }) : undefined,
    };
  }

  async listEvents(
    organisationId: string,
    options?: QueryAuditOptions,
    tx?: TransactionClient,
  ): Promise<AuditEvent[]> {
    const rows = await this.repository.findByOrganisation(organisationId, options, tx);

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
