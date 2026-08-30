import { text, integer } from "drizzle-orm/sqlite-core";

/**
 * Standard base metadata columns for all core and feature entities.
 */
export const baseEntityColumns = {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
};

/**
 * Columns required for synchronisable entities across P2P sync groups.
 */
export const syncableEntityColumns = {
  ...baseEntityColumns,
  entityId: text("entity_id").notNull().unique(),
  organisationId: text("organisation_id").notNull(),
  syncGroupId: text("sync_group_id").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  syncVersion: integer("sync_version").notNull().default(0),
  deletedAt: text("deleted_at"),
  deletedBy: text("deleted_by"),
  deleteOperationId: text("delete_operation_id"),
  dataClassification: text("data_classification").default("INTERNAL"),
};
