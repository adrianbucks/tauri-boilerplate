import { WIDGET_PERMISSIONS } from "./permissions.js";
import type { FeatureManifest } from "@platform/feature-system";

export const exampleFeatureManifest: FeatureManifest = {
  id: "example-feature",
  name: "Example Widgets Feature",
  version: "1.0.0",
  description:
    "Reference feature demonstrating repositories, Drizzle schemas, permissions, and sync policies.",
  dependencies: [],
  optionalDependencies: [],
  permissions: [
    {
      name: WIDGET_PERMISSIONS.READ,
      description: "View widget inventory records",
    },
    {
      name: WIDGET_PERMISSIONS.CREATE,
      description: "Create new widget records",
    },
    {
      name: WIDGET_PERMISSIONS.UPDATE,
      description: "Update existing widget records",
    },
    {
      name: WIDGET_PERMISSIONS.DELETE,
      description: "Soft delete widget records",
    },
    {
      name: WIDGET_PERMISSIONS.IMPORT,
      description: "Import widget records from spreadsheets",
    },
    {
      name: WIDGET_PERMISSIONS.EXPORT,
      description: "Export widget records to spreadsheets",
    },
  ],
  migrations: [
    {
      version: 1,
      name: "create_widgets_table",
      sql: `
        CREATE TABLE IF NOT EXISTS widgets (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT,
          updated_by TEXT,
          entity_id TEXT NOT NULL UNIQUE,
          organisation_id TEXT NOT NULL,
          sync_group_id TEXT NOT NULL,
          schema_version INTEGER NOT NULL DEFAULT 1,
          sync_version INTEGER NOT NULL DEFAULT 0,
          deleted_at TEXT,
          deleted_by TEXT,
          delete_operation_id TEXT,
          data_classification TEXT DEFAULT 'INTERNAL',
          name TEXT NOT NULL,
          sku TEXT NOT NULL UNIQUE,
          quantity INTEGER NOT NULL DEFAULT 0,
          description TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_widgets_org ON widgets(organisation_id);
        CREATE INDEX IF NOT EXISTS idx_widgets_sync_group ON widgets(sync_group_id);
      `,
      checksum: "chk_widgets_001",
    },
  ],
  syncPolicies: [
    {
      entityType: "widgets",
      namespacePattern: "{application}/{organisation}/{syncGroup}/widgets",
      conflictPolicy: { strategy: "lww" },
      syncable: true,
    },
  ],
  navigation: [
    {
      id: "nav-widgets",
      label: "Widgets",
      path: "/widgets",
      icon: "box",
      requiredPermission: WIDGET_PERMISSIONS.READ,
      order: 10,
    },
  ],
};
