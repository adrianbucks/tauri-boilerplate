import { describe, it, expect } from "vitest";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";
import { createMinimalConsumerApp } from "./index.js";
import { NOTES_PERMISSIONS } from "./notes/NotesManifest.js";

describe("Minimal Consumer Application (WP-019 / Gate G-12)", () => {
  it("initializes platform without demo features, runs migrations, and handles domain operations", async () => {
    const db = new MemoryDatabaseConnection(":memory:");
    await db.init();

    const app = await createMinimalConsumerApp({ db });

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
    const outboxRecords = await db.query<{ entity_id: string; operation: string; entity_type: string }>(
      "SELECT entity_id, operation, entity_type FROM core_sync_outbox WHERE entity_id = ?",
      [createdNote.id],
    );
    expect(outboxRecords).toHaveLength(1);
    expect(outboxRecords[0]?.entity_type).toBe("notes");
    expect(outboxRecords[0]?.operation).toBe("create");

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

    const tombstones = await db.query<{ entity_id: string; entity_type: string }>(
      "SELECT entity_id, entity_type FROM core_sync_tombstones WHERE entity_id = ?",
      [createdNote.id],
    );
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]?.entity_type).toBe("notes");

    await db.close();
  });
});
