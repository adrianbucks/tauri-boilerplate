import { describe, it, expect } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { createMinimalConsumerApp } from "./index.js";
import { NotesService } from "./notes/NotesService.js";
import { NOTES_PERMISSIONS } from "./notes/NotesManifest.js";

describe("Minimal Consumer Application (WP-019 / Gate G-12)", () => {
  it("initializes platform without demo features, runs migrations, and handles domain operations", async () => {
    const db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    const app = await createMinimalConsumerApp({
      db,
      notesSigner: {
        publicKey: `ed25519_pk_${"a".repeat(64)}`,
        sign: async () => "a".repeat(128),
      },
    });

    // 1. Verify platform core tables exist
    const coreTables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'core_%'",
    );
    expect(coreTables.some((t) => t.name === "core_devices")).toBe(true);
    expect(coreTables.some((t) => t.name === "core_organisations")).toBe(true);
    expect(coreTables.some((t) => t.name === "core_sync_outbox")).toBe(true);
    expect(coreTables.some((t) => t.name === "core_background_tasks")).toBe(true);

    // 2. Verify consumer domain table 'notes' exists
    const notesTable = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='notes'",
    );
    expect(notesTable).toHaveLength(1);

    // 3. Verify demo-specific table 'widgets' DOES NOT exist (proving isolation)
    const widgetTable = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='widgets'",
    );
    expect(widgetTable).toHaveLength(0);

    // 4. Setup organisation, user, and roles for testing
    await db.execute(`
      INSERT INTO core_organisations (id, created_at, updated_at, name, status)
      VALUES ('org_acme', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'Acme Corp', 'ACTIVE');

      INSERT INTO core_users (id, created_at, updated_at, organisation_id, display_name, status)
      VALUES ('usr_alice', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'org_acme', 'Alice', 'ACTIVE');

      INSERT INTO core_devices (
        id, created_at, updated_at, user_id, device_id, public_key, platform,
        application_id, status, registered_at
      ) VALUES (
        'device_alice_01', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z',
        'usr_alice', 'dev_alice_01', 'test-public-key', 'linux',
        'minimal-consumer-test', 'APPROVED', '2026-09-13T00:00:00Z'
      );

      INSERT INTO core_sync_groups (id, created_at, updated_at, organisation_id, name, status)
      VALUES ('grp_warehouse', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'org_acme', 'Warehouse', 'ACTIVE');
      INSERT INTO core_sync_group_members (id, group_id, device_id, user_id, status, joined_at)
      VALUES ('mbr_alice_warehouse', 'grp_warehouse', 'dev_alice_01', 'usr_alice', 'APPROVED', '2026-09-13T00:00:00Z');

      INSERT INTO core_roles (id, created_at, updated_at, organisation_id, name)
      VALUES ('role_notes_admin', '2026-09-13T00:00:00Z', '2026-09-13T00:00:00Z', 'org_acme', 'Notes Admin');

      INSERT OR IGNORE INTO core_permissions (id, name) VALUES ('p_create', '${NOTES_PERMISSIONS.CREATE}');
      INSERT OR IGNORE INTO core_permissions (id, name) VALUES ('p_read', '${NOTES_PERMISSIONS.READ}');
      INSERT OR IGNORE INTO core_permissions (id, name) VALUES ('p_update', '${NOTES_PERMISSIONS.UPDATE}');
      INSERT OR IGNORE INTO core_permissions (id, name) VALUES ('p_delete', '${NOTES_PERMISSIONS.DELETE}');

      INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_1', 'role_notes_admin', 'p_create');
      INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_2', 'role_notes_admin', 'p_read');
      INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_3', 'role_notes_admin', 'p_update');
      INSERT INTO core_role_permissions (id, role_id, permission_id) VALUES ('rp_4', 'role_notes_admin', 'p_delete');

      INSERT INTO core_user_roles (id, user_id, role_id, organisation_id, granted_at)
      VALUES ('ur_1', 'usr_alice', 'role_notes_admin', 'org_acme', '2026-09-13T00:00:00Z');
    `);

    const ctx = createOperationContext({
      userId: "usr_alice",
      organisationId: "org_acme",
      deviceId: "dev_alice_01",
    });

    await expect(
      app.notes.createNote(ctx, {
        title: 42 as unknown as string,
        content: "Invalid title types must be rejected",
        syncGroupId: "grp_warehouse",
      }),
    ).rejects.toThrow("Note title cannot be empty");
    await expect(
      app.notes.createNote(ctx, {
        title: "Invalid content type",
        content: 42 as unknown as string,
        syncGroupId: "grp_warehouse",
      }),
    ).rejects.toThrow("Note content must be a string");
    expect(await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM notes")).toEqual([
      { count: 0 },
    ]);

    const failingSignerNotes = new NotesService({
      db,
      auth: app.platform.auth,
      signer: {
        publicKey: `ed25519_pk_${"a".repeat(64)}`,
        sign: async () => {
          throw new Error("native signing unavailable");
        },
      },
    });
    await expect(
      failingSignerNotes.createNote(ctx, {
        title: "Should Roll Back",
        content: "No unsigned record should commit",
        syncGroupId: "grp_warehouse",
      }),
    ).rejects.toThrow("native signing unavailable");
    expect(await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM notes")).toEqual([
      { count: 0 },
    ]);
    expect(
      await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM core_sync_outbox"),
    ).toEqual([{ count: 0 }]);

    // 5. Create a note
    const createdNote = await app.notes.createNote(ctx, {
      title: "Site Survey Findings",
      content: "All wireless access points verified in warehouse zone B.",
      syncGroupId: "grp_warehouse",
    });

    expect(createdNote.id).toBeDefined();
    expect(createdNote.title).toBe("Site Survey Findings");
    expect(createdNote.authorId).toBe("usr_alice");

    // 6. List notes within organisation
    const notes = await app.notes.listNotes(ctx, "grp_warehouse");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe(createdNote.id);

    // 7. Verify outbox replication record was created atomically
    const outboxRecords = await db.query<{
      entity_id: string;
      operation: string;
      entity_type: string;
      signer_public_key: string;
      signature: string;
    }>(
      "SELECT entity_id, operation, entity_type, signer_public_key, signature FROM core_sync_outbox WHERE entity_id = ?",
      [createdNote.id],
    );
    expect(outboxRecords).toHaveLength(1);
    expect(outboxRecords[0]?.entity_type).toBe("notes");
    expect(outboxRecords[0]?.operation).toBe("create");
    expect(outboxRecords[0]?.signer_public_key).toBe(`ed25519_pk_${"a".repeat(64)}`);
    expect(outboxRecords[0]?.signature).toMatch(/^[0-9a-f]{128}$/);

    await expect(app.notes.updateNote(ctx, { id: createdNote.id, title: "   " })).rejects.toThrow(
      "Updated note title cannot be empty",
    );
    await expect(app.notes.updateNote(ctx, { id: createdNote.id })).rejects.toThrow(
      "Note update must include at least one field",
    );
    expect(
      await db.query<{ count: number }>("SELECT COUNT(*) AS count FROM core_sync_outbox"),
    ).toEqual([{ count: 1 }]);

    // 8. Update note
    const updatedNote = await app.notes.updateNote(ctx, {
      id: createdNote.id,
      title: "Site Survey Findings (Updated)",
    });
    expect(updatedNote.title).toBe("Site Survey Findings (Updated)");

    // 9. Soft-delete note and verify tombstone
    await app.notes.deleteNote(ctx, createdNote.id);
    const notesAfterDelete = await app.notes.listNotes(ctx, "grp_warehouse");
    expect(notesAfterDelete).toHaveLength(0);
    expect(await app.notes.getNote(ctx, createdNote.id)).toBeNull();
    await expect(
      app.notes.updateNote(ctx, { id: createdNote.id, content: "after deletion" }),
    ).rejects.toThrow(`Note '${createdNote.id}' not found`);

    const tombstones = await db.query<{
      entity_id: string;
      entity_type: string;
    }>("SELECT entity_id, entity_type FROM core_sync_tombstones WHERE entity_id = ?", [
      createdNote.id,
    ]);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]?.entity_type).toBe("notes");

    const deletionMetadata = await db.query<{
      note_delete_operation_id: string;
      note_deleted_at: string;
      tombstone_delete_operation_id: string;
      tombstone_deleted_at: string;
      outbox_operation_id: string;
    }>(
      `SELECT n.delete_operation_id AS note_delete_operation_id,
              n.deleted_at AS note_deleted_at,
              t.delete_operation_id AS tombstone_delete_operation_id,
              t.deleted_at AS tombstone_deleted_at,
              o.envelope_id AS outbox_operation_id
       FROM notes n
       INNER JOIN core_sync_tombstones t ON t.entity_id = n.id
       INNER JOIN core_sync_outbox o ON o.entity_id = n.id AND o.operation = 'delete'
       WHERE n.id = ?`,
      [createdNote.id],
    );
    expect(deletionMetadata).toHaveLength(1);
    expect(deletionMetadata[0]?.note_delete_operation_id).toBe(
      deletionMetadata[0]?.tombstone_delete_operation_id,
    );
    expect(deletionMetadata[0]?.note_delete_operation_id).toBe(
      deletionMetadata[0]?.outbox_operation_id,
    );
    expect(deletionMetadata[0]?.note_deleted_at).toBe(deletionMetadata[0]?.tombstone_deleted_at);

    await db.close();
  });
});
