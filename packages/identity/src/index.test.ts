import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { DeviceIdentityService, UserSessionService } from "./index.js";

describe("@platform/identity", () => {
  let db: MemoryDatabaseConnection;
  let deviceService: DeviceIdentityService;
  let sessionService: UserSessionService;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    // Create required tables
    await db.execute(`
      CREATE TABLE core_devices (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        user_id TEXT,
        device_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        platform TEXT NOT NULL,
        application_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNREGISTERED',
        registered_at TEXT NOT NULL,
        last_seen_at TEXT
      );
      CREATE TABLE core_users (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        email TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
    `);

    deviceService = new DeviceIdentityService(db);
    sessionService = new UserSessionService(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("DeviceIdentityService", () => {
    it("registers local device with initial UNREGISTERED status", async () => {
      const device = await deviceService.registerDevice({
        publicKey: "MCowBQYDK2VwAyEA94...",
        platform: "windows",
        applicationId: "tauri-boilerplate-demo",
      });

      expect(device.deviceId.startsWith("dev_")).toBe(true);
      expect(device.status).toBe("UNREGISTERED");
      expect(device.platform).toBe("windows");

      const loaded = await deviceService.getLocalDevice();
      expect(loaded?.deviceId).toBe(device.deviceId);
      expect(loaded?.publicKey).toBe("MCowBQYDK2VwAyEA94...");
    });

    it("updates device status", async () => {
      const device = await deviceService.registerDevice({
        publicKey: "pub_key_123",
        platform: "android",
        applicationId: "tauri-boilerplate-demo",
      });

      await deviceService.updateDeviceStatus(device.deviceId, "ACTIVE");
      const updated = await deviceService.getLocalDevice();
      expect(updated?.status).toBe("ACTIVE");
    });
  });

  describe("UserSessionService", () => {
    it("creates and validates session for an active user and approved device", async () => {
      await deviceService.registerDevice({
        publicKey: "pub_key_123",
        platform: "windows",
        applicationId: "demo",
      });

      // Insert active user
      await db.execute(
        "INSERT INTO core_users (id, created_at, updated_at, organisation_id, display_name, status) VALUES ('u_alice', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_1', 'Alice', 'ACTIVE');",
      );

      const session = await sessionService.createSession({
        userId: "u_alice",
        organisationId: "org_1",
        roles: ["role_admin"],
      });

      expect(session.sessionId.startsWith("sess_")).toBe(true);
      expect(session.userId).toBe("u_alice");
      expect(session.roles).toContain("role_admin");

      const validated = await sessionService.validateCurrentSession();
      expect(validated.sessionId).toBe(session.sessionId);
    });

    it("rejects session if device is REVOKED", async () => {
      const device = await deviceService.registerDevice({
        publicKey: "pub_key_123",
        platform: "windows",
        applicationId: "demo",
      });
      await deviceService.updateDeviceStatus(device.deviceId, "REVOKED");

      await db.execute(
        "INSERT INTO core_users (id, created_at, updated_at, organisation_id, display_name, status) VALUES ('u_bob', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_1', 'Bob', 'ACTIVE');",
      );

      await expect(
        sessionService.createSession({
          userId: "u_bob",
          organisationId: "org_1",
          roles: ["role_user"],
        }),
      ).rejects.toThrow("Device has been revoked");
    });

    it("rejects session if device is SUSPENDED", async () => {
      const device = await deviceService.registerDevice({
        publicKey: "pub_key_456",
        platform: "android",
        applicationId: "demo",
      });
      await deviceService.updateDeviceStatus(device.deviceId, "SUSPENDED");

      await db.execute(
        "INSERT INTO core_users (id, created_at, updated_at, organisation_id, display_name, status) VALUES ('u_carol', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_1', 'Carol', 'ACTIVE');",
      );

      await expect(
        sessionService.createSession({
          userId: "u_carol",
          organisationId: "org_1",
          roles: ["role_user"],
        }),
      ).rejects.toThrow();
    });

    it("returns null for validateCurrentSession when no session exists", async () => {
      await expect(sessionService.validateCurrentSession()).rejects.toThrow();
    });
  });
});
