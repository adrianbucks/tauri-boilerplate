import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { syncableEntityColumns } from "@platform/database";

export const widgets = sqliteTable(
  "widgets",
  {
    ...syncableEntityColumns,
    name: text("name").notNull(),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull().default(0),
    description: text("description"),
  },
  (table) => [
    index("idx_widgets_org").on(table.organisationId),
    index("idx_widgets_sync_group").on(table.syncGroupId),
    uniqueIndex("idx_widgets_org_active_sku")
      .on(table.organisationId, table.sku)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type WidgetRecord = typeof widgets.$inferSelect;
export type InsertWidgetRecord = typeof widgets.$inferInsert;
