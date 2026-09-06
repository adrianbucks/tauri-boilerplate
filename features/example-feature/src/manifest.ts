import { WIDGET_PERMISSIONS } from "./permissions.js";
import type { FeatureManifest } from "@platform/feature-system";
import widgetsSchemaSql from "./migrations/widgets-schema.sql?raw";

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
      sql: widgetsSchemaSql,
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
