import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { AuditService } from "./index.js";

describe("@platform/audit", () => {
  let db: MemoryDatabaseConnection;
  let auditService: AuditService;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    await db.execute(`
      CREATE TABLE core_audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        user_id TEXT,
        device_id TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata_json TEXT
      );
    `);

    auditService = new AuditService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("AuditService", () => {
    it("emits append-only audit events with full attribution", async () => {
      const event = await auditService.emit({
        eventType: "RECORD_CREATED",
        userId: "u_alice",
        deviceId: "dev_laptop_1",
        organisationId: "org_1",
        correlationId: "req_123",
        metadata: { entityType: "widget", entityId: "wid_99" },
      });

      expect(event.id.startsWith("aud_")).toBe(true);
      expect(event.eventType).toBe("RECORD_CREATED");
      expect(event.userId).toBe("u_alice");
      expect(event.deviceId).toBe("dev_laptop_1");
      expect(event.correlationId).toBe("req_123");
      expect(event.metadata).toEqual({
        entityType: "widget",
        entityId: "wid_99",
      });

      // Verify in database
      const list = await auditService.listEvents("org_1");
      expect(list).toHaveLength(1);
      expect(list[0]?.eventType).toBe("RECORD_CREATED");
      expect(list[0]?.correlationId).toBe("req_123");
    });

    it("filters audit events by eventType, userId, and correlationId", async () => {
      await auditService.emit({
        eventType: "USER_CREATED",
        userId: "u_admin",
        deviceId: "dev_1",
        organisationId: "org_1",
        correlationId: "req_001",
      });

      await auditService.emit({
        eventType: "ROLE_ASSIGNED",
        userId: "u_admin",
        deviceId: "dev_1",
        organisationId: "org_1",
        correlationId: "req_002",
      });

      const userCreatedEvents = await auditService.listEvents("org_1", {
        eventType: "USER_CREATED",
      });
      expect(userCreatedEvents).toHaveLength(1);
      expect(userCreatedEvents[0]?.eventType).toBe("USER_CREATED");

      const byCorrelation = await auditService.listEvents("org_1", {
        correlationId: "req_002",
      });
      expect(byCorrelation).toHaveLength(1);
      expect(byCorrelation[0]?.eventType).toBe("ROLE_ASSIGNED");
    });
  });
});
