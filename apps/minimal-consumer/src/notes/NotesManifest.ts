import type { FeatureManifest } from "@platform/feature-system";

export const NOTES_PERMISSIONS = {
  READ: "notes.read",
  CREATE: "notes.create",
  UPDATE: "notes.update",
  DELETE: "notes.delete",
} as const;

export const notesSchemaSql = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  organisation_id TEXT NOT NULL,
  sync_group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  delete_operation_id TEXT
);
`;

export const notesFeatureManifest: FeatureManifest = {
  id: "notes",
  name: "Field Notes Feature",
  version: "1.0.0",
  description: "Minimal consumer domain feature for offline field notes and sync",
  dependencies: [],
  optionalDependencies: [],
  permissions: [
    { name: NOTES_PERMISSIONS.READ, description: "View notes" },
    { name: NOTES_PERMISSIONS.CREATE, description: "Create notes" },
    { name: NOTES_PERMISSIONS.UPDATE, description: "Update notes" },
    { name: NOTES_PERMISSIONS.DELETE, description: "Delete notes" },
  ],
  migrations: [
    {
      version: 1,
      name: "create_notes_table",
      sql: notesSchemaSql,
      checksum: "chk_notes_001",
    },
  ],
  syncPolicies: [
    {
      entityType: "notes",
      namespacePattern: "{application}/{organisation}/{syncGroup}/notes",
      conflictPolicy: { strategy: "lww" },
      syncable: true,
    },
  ],
};
