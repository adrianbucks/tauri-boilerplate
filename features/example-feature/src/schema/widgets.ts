import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { syncableEntityColumns } from "@platform/database";

export const widgets = sqliteTable("widgets", {
  ...syncableEntityColumns,
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(),
  quantity: integer("quantity").notNull().default(0),
  description: text("description"),
});

export type WidgetRecord = typeof widgets.$inferSelect;
export type InsertWidgetRecord = typeof widgets.$inferInsert;
