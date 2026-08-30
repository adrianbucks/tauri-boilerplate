import type { LogLevel } from "../logging/Logger.js";

export interface AppConfig {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly applicationVersion: string;
  readonly protocolVersion: number;
  readonly environment: "development" | "test" | "production";
  readonly logLevel: LogLevel;
  readonly storage: {
    readonly dbName: string;
    readonly enableWal: boolean;
  };
  readonly sync: {
    readonly enableAutoSync: boolean;
    readonly syncIntervalMs: number;
    readonly maxRetryAttempts: number;
  };
}

export function createDefaultConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    applicationId: "tauri-boilerplate-demo",
    applicationName: "Tauri Boilerplate Demo",
    applicationVersion: "0.1.0",
    protocolVersion: 1,
    environment: "development",
    logLevel: "info",
    storage: {
      dbName: "local_platform.db",
      enableWal: true,
      ...(overrides?.storage ?? {}),
    },
    sync: {
      enableAutoSync: true,
      syncIntervalMs: 5000,
      maxRetryAttempts: 5,
      ...(overrides?.sync ?? {}),
    },
    ...(overrides ?? {}),
  };
}
