import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createRequestContext,
  AuthenticationError,
  AuthorizationError,
} from "@platform/core";
import { MemoryDatabaseConnection } from "@platform/database";
import {
  DeviceIdentityService,
  UserSessionService,
  type NativeAuthenticator,
} from "@platform/identity";
import { AuthorizationEngine } from "@platform/authorization";

describe("authentication trust boundary", () => {
  let db: MemoryDatabaseConnection;
  let deviceService: DeviceIdentityService;
  let sessionService: UserSessionService;
  let authEngine: AuthorizationEngine;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();

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
      CREATE TABLE core_roles (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        is_system INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE core_permissions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        resource_type TEXT NOT NULL
      );
      CREATE TABLE core_role_permissions (
        id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL,
        permission_id TEXT NOT NULL,
        scope_constraints_json TEXT
      );
      CREATE TABLE core_user_roles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT NOT NULL
      );
    `);

    deviceService = new DeviceIdentityService(db);
    sessionService = new UserSessionService(db);
    authEngine = new AuthorizationEngine(db);

    // Seed test device and user
    await deviceService.registerDevice({
      publicKey: "ed25519_pk_test",
      platform: "windows",
      applicationId: "demo",
    });
    await db.execute(
      "UPDATE core_devices SET status = 'ACTIVE' WHERE device_id = (SELECT device_id FROM core_devices LIMIT 1);",
    );
    await db.execute(
      "INSERT INTO core_users (id, created_at, updated_at, organisation_id, display_name, status) VALUES ('u_legit', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_corp', 'Legit User', 'ACTIVE');",
    );
    await db.execute(
      "INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name) VALUES ('role_editor', '2026-08-30T10:00:00Z', '2026-08-30T10:00:00Z', 'org_corp', 'Editor');",
    );
    await db.execute(
      "INSERT INTO core_permissions (id, name, resource_type) VALUES ('p_edit', 'widget:create', 'widget');",
    );
    await db.execute(
      "INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_1', 'role_editor', 'p_edit');",
    );
    await db.execute(
      "INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at) VALUES ('ur_1', 'u_legit', 'role_editor', 'org_corp', '2026-08-30T10:00:00Z');",
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it("does not let frontend request context select identity or credentials", () => {
    const context = createRequestContext({
      metadata: { requestedUserId: "user_claim" },
    });

    expect(context).toEqual({
      correlationId: expect.stringMatching(/^req_/),
      metadata: { requestedUserId: "user_claim" },
    });
    expect(context).not.toHaveProperty("userId");
    expect(context).not.toHaveProperty("deviceId");
    expect(context).not.toHaveProperty("organisationId");
    expect(context).not.toHaveProperty("password");
    expect(context).not.toHaveProperty("credential");
  });

  it("prevents obtaining a TrustedOperationContext without verified authentication (CS-003, CS-004)", async () => {
    await expect(sessionService.getTrustedOperationContext()).rejects.toThrow(
      AuthenticationError,
    );
  });

  it("rejects authentication and does not create session on invalid credentials", async () => {
    const rejectingGateway: NativeAuthenticator = {
      authenticateUser: async () => {
        throw new Error("Authentication failed: invalid credentials");
      },
    };

    await expect(
      sessionService.authenticate(
        { userId: "u_legit", password: "wrong_password" },
        rejectingGateway,
      ),
    ).rejects.toThrow(AuthenticationError);

    expect(sessionService.getCurrentSession()).toBeNull();
    await expect(sessionService.getTrustedOperationContext()).rejects.toThrow(
      AuthenticationError,
    );
  });

  it("establishes TrustedOperationContext from verified native boundary and enforces permissions (CS-004)", async () => {
    const legitimateGateway: NativeAuthenticator = {
      authenticateUser: async ({ user_id, password }) => {
        if (user_id === "u_legit" && password === "correct_password") {
          return {
            user_id: "u_legit",
            device_id: "dev_crypto_ed25519",
            organisation_id: "org_corp",
            permissions: ["widget:create"],
          };
        }
        throw new Error("Invalid credentials");
      },
      logoutUser: async () => undefined,
    };

    const session = await sessionService.authenticate(
      { userId: "u_legit", password: "correct_password" },
      legitimateGateway,
    );

    expect(session.userId).toBe("u_legit");
    expect(session.deviceId).toBe("dev_crypto_ed25519");

    const trustedContext = await sessionService.getTrustedOperationContext();

    // Verify AuthorizationEngine.requireTrusted succeeds for granted permissions
    await expect(
      authEngine.requireTrusted(trustedContext, "widget:create"),
    ).resolves.toBeUndefined();

    // Verify AuthorizationEngine.requireTrusted rejects ungranted permissions
    await expect(
      authEngine.requireTrusted(trustedContext, "admin:delete_org"),
    ).rejects.toThrow(AuthorizationError);

    // Verify logout terminates the session
    await sessionService.logout(legitimateGateway);
    expect(sessionService.getCurrentSession()).toBeNull();
    await expect(sessionService.getTrustedOperationContext()).rejects.toThrow(
      AuthenticationError,
    );
  });
});
