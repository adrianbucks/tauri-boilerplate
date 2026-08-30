export type PlatformErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "SYNC_ERROR"
  | "CONFLICT_ERROR"
  | "DATABASE_ERROR"
  | "MIGRATION_ERROR"
  | "FILE_ERROR"
  | "HARDWARE_ERROR"
  | "NETWORK_ERROR"
  | "COMPATIBILITY_ERROR"
  | "INTERNAL_ERROR";

export type ErrorSeverity = "fatal" | "error" | "warning" | "info";
