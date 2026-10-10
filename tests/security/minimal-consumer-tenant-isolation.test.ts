import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOperationContext } from "@platform/core";
import { MemoryDatabaseConnection } from "@platform/database";
import {
  createMinimalConsumerApp,
  NOTES_PERMISSIONS,
} from "../../apps/minimal-consumer/src/index.js";
import { NotesService } from "../../apps/minimal-consumer/src/notes/NotesService.js";

describe("Security Regression Suite — minimal consumer tenant isolation", () => {
  let db: MemoryDatabaseConnection;
  let app: Awaited<ReturnType<typeof createMinimalConsumerApp>>;

  beforeEach(async () => {
    db = new MemoryDatabaseConnection(":memory:");
    await db.init();
    app = await createMinimalConsumerApp({
      db,
      notesSigner: {
        publicKey: `ed25519_pk_${"a".repeat(64)}`,
        sign: async () => "a".repeat(128),
      },
    });

    await db.execute(`
      INSERT INTO core_organisations (id, created_at, updated_at, name, status)
      VALUES
        ('org_notes_a', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'Organisation A', 'ACTIVE'),
        ('org_notes_b', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'Organisation B', 'ACTIVE');
      INSERT INTO core_users (id, created_at, updated_at, organisation_id, display_name, status)
      VALUES ('usr_notes_a', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'org_notes_a', 'User A', 'ACTIVE');
      INSERT INTO core_devices (
        id, created_at, updated_at, user_id, device_id, public_key, platform,
        application_id, status, registered_at
      ) VALUES (
        'device_notes_a', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z',
        'usr_notes_a', 'device_notes_a', 'test-public-key', 'linux',
        'minimal-consumer-security-test', 'APPROVED', '2026-09-13T00:00:00Z'
      );
      INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name)
      VALUES ('role_notes_a', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'org_notes_a', 'Notes Reader');
      INSERT INTO core_permissions (id, name) VALUES ('permission_notes_read', '${NOTES_PERMISSIONS.READ}');
      INSERT INTO core_permissions (id, name) VALUES ('permission_notes_create', '${NOTES_PERMISSIONS.CREATE}');
      INSERT INTO core_permissions (id, name) VALUES ('permission_notes_update', '${NOTES_PERMISSIONS.UPDATE}');
      INSERT INTO core_role_permissions (id, role_id, permission_id)
      VALUES
        ('role_permission_notes_read', 'role_notes_a', 'permission_notes_read'),
        ('role_permission_notes_create', 'role_notes_a', 'permission_notes_create'),
        ('role_permission_notes_update', 'role_notes_a', 'permission_notes_update');
      INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at)
      VALUES ('user_role_notes_a', 'usr_notes_a', 'role_notes_a', 'org_notes_a', '2026-09-13T00:00:00Z');
      INSERT INTO core_sync_groups (id, created_at, updated_at, organisation_id, name, status)
      VALUES
        ('group_a', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'org_notes_a', 'Group A', 'ACTIVE'),
        ('group_b', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'org_notes_b', 'Group B', 'ACTIVE'),
        ('group_unapproved', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'org_notes_a', 'Unapproved Group', 'ACTIVE');
      INSERT INTO core_sync_group_members (id, group_id, device_id, user_id, status, joined_at)
      VALUES ('member_notes_a', 'group_a', 'device_notes_a', 'usr_notes_a', 'APPROVED', '2026-09-13T00:00:00Z');

      INSERT INTO notes (
        id, created_at, updated_at, organisation_id, sync_group_id, title, content, author_id,
        deleted_at, deleted_by, delete_operation_id
      ) VALUES
        ('note_org_a', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'org_notes_a', 'group_a', 'Private A', 'A', 'usr_notes_a', NULL, NULL, NULL),
        ('note_org_b', '2026-09-14T00:00:00Z', '2026-09-14T00:00:00Z', 'org_notes_b', 'group_b', 'Private B', 'B', 'usr_notes_b', NULL, NULL, NULL),
        ('note_unapproved_a', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z', 'org_notes_a', 'group_unapproved', 'Unapproved A', 'hidden', 'usr_notes_a', NULL, NULL, NULL),
        ('note_deleted_a', '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z', 'org_notes_a', 'group_a', 'Deleted A', 'deleted', 'usr_notes_a', '2026-09-15T00:00:00Z', 'usr_notes_a', 'delete_note_deleted_a');
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it("does not list notes from another organisation or include deleted notes", async () => {
    const context = createOperationContext({
      userId: "usr_notes_a",
      organisationId: "org_notes_a",
      deviceId: "device_notes_a",
    });
    await db.execute(`
      INSERT INTO core_sync_group_members (id, group_id, device_id, user_id, status, joined_at)
      VALUES ('member_cross_tenant', 'group_b', 'device_notes_a', 'usr_notes_a', 'APPROVED', '2026-09-13T00:00:00Z');
      INSERT INTO notes (
        id, created_at, updated_at, organisation_id, sync_group_id, title, content, author_id,
        deleted_at, deleted_by, delete_operation_id
      ) VALUES (
        'note_mismatched_group', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z',
        'org_notes_a', 'group_b', 'Mismatched Group', 'hidden', 'usr_notes_a', NULL, NULL, NULL
      );
    `);

    const notes = await app.notes.listNotes(context);

    expect(notes.map((note) => note.id)).toEqual(["note_org_a"]);
    expect(await app.notes.getNote(context, "note_deleted_a")).toBeNull();
    await expect(app.notes.getNote(context, "note_unapproved_a")).rejects.toThrow(
      "not an approved member",
    );
    await expect(
      app.notes.updateNote(context, { id: "note_deleted_a", content: "resurrected" }),
    ).rejects.toThrow("Note 'note_deleted_a' not found");
  });

  it("does not list notes to a device that is globally revoked", async () => {
    const context = createOperationContext({
      userId: "usr_notes_a",
      organisationId: "org_notes_a",
      deviceId: "device_notes_a",
    });
    await db.execute("UPDATE core_devices SET status = 'REVOKED' WHERE device_id = ?", [
      "device_notes_a",
    ]);

    await expect(app.notes.listNotes(context)).resolves.toEqual([]);
    await expect(app.notes.listNotes(context, "group_a")).rejects.toThrow("not active or approved");
  });

  it("returns an authorization error and leaves no writes for an unauthenticated subject", async () => {
    const context = createOperationContext({
      organisationId: "org_notes_a",
      deviceId: "device_notes_a",
    });

    await expect(
      app.notes.createNote(context, {
        title: "Unauthenticated write",
        content: "This must not persist",
        syncGroupId: "group_a",
      }),
    ).rejects.toThrow("Unauthenticated subject cannot perform operation");

    expect(
      await db.query<{ id: string }>("SELECT id FROM notes WHERE title = ?", [
        "Unauthenticated write",
      ]),
    ).toEqual([]);
    expect(await db.query<{ id: string }>("SELECT id FROM core_sync_outbox")).toEqual([]);
  });

  it("rolls back a note when the native signer returns a malformed signature", async () => {
    const context = createOperationContext({
      userId: "usr_notes_a",
      organisationId: "org_notes_a",
      deviceId: "device_notes_a",
    });
    const notes = new NotesService({
      db,
      auth: app.platform.auth,
      signer: {
        publicKey: `ed25519_pk_${"a".repeat(64)}`,
        sign: async () => "malformed-signature",
      },
    });

    await expect(
      notes.createNote(context, {
        title: "Must Roll Back",
        content: "Malformed signatures must not be enqueued",
        syncGroupId: "group_a",
      }),
    ).rejects.toThrow("Invalid signature format");

    expect(
      await db.query<{ id: string }>("SELECT id FROM notes WHERE title = ?", ["Must Roll Back"]),
    ).toEqual([]);
    expect(await db.query<{ id: string }>("SELECT id FROM core_sync_outbox")).toEqual([]);
  });

  it("authorizes note creation through the same transaction as its write", async () => {
    const context = createOperationContext({
      userId: "usr_notes_a",
      organisationId: "org_notes_a",
      deviceId: "device_notes_a",
    });
    const authorization = vi.spyOn(app.platform.auth, "requireForSubject");

    await app.notes.createNote(context, {
      title: "Transaction-bound admission",
      content: "Permission lookup must share the write transaction",
      syncGroupId: "group_a",
    });

    expect(authorization).toHaveBeenCalledWith(
      "usr_notes_a",
      "org_notes_a",
      NOTES_PERMISSIONS.CREATE,
      undefined,
      expect.anything(),
    );
  });

  it("does not queue notes for an organisation group without active device membership", async () => {
    const context = createOperationContext({
      userId: "usr_notes_a",
      organisationId: "org_notes_a",
      deviceId: "device_notes_a",
    });

    await expect(
      app.notes.createNote(context, {
        title: "Unapproved Group Write",
        content: "This must not be queued",
        syncGroupId: "group_unapproved",
      }),
    ).rejects.toThrow("not an approved member");

    expect(
      await db.query<{ id: string }>("SELECT id FROM notes WHERE title = ?", [
        "Unapproved Group Write",
      ]),
    ).toEqual([]);
    expect(await db.query<{ id: string }>("SELECT id FROM core_sync_outbox")).toEqual([]);
  });
});
