export const WIDGET_PERMISSIONS = {
  READ: "widgets.read",
  CREATE: "widgets.create",
  UPDATE: "widgets.update",
  DELETE: "widgets.delete",
  IMPORT: "widgets.import",
  EXPORT: "widgets.export",
} as const;

export type WidgetPermission =
  (typeof WIDGET_PERMISSIONS)[keyof typeof WIDGET_PERMISSIONS];
