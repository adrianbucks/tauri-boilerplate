import { getUtcIsoTimestamp } from "../time/time.js";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  correlationId?: string | undefined;
  feature?: string | undefined;
  operation?: string | undefined;
  deviceId?: string | undefined;
  userId?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface Logger {
  trace(message: string, context?: Partial<LogEntry>): void;
  debug(message: string, context?: Partial<LogEntry>): void;
  info(message: string, context?: Partial<LogEntry>): void;
  warn(message: string, context?: Partial<LogEntry>): void;
  error(message: string, error?: unknown, context?: Partial<LogEntry>): void;
}

const REDACTED_KEYS = new Set([
  "privatekey",
  "private_key",
  "password",
  "secret",
  "token",
  "credential",
  "keystore",
  "authorization",
]);

function sanitizeData(
  data?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export class ConsoleLogger implements Logger {
  private readonly minLevel: LogLevel;
  private readonly levelWeights: Record<LogLevel, number> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
  };

  constructor(minLevel: LogLevel = "info") {
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelWeights[level] >= this.levelWeights[this.minLevel];
  }

  private formatEntry(entry: LogEntry): string {
    return JSON.stringify({
      timestamp: entry.timestamp,
      level: entry.level.toUpperCase(),
      message: entry.message,
      ...(entry.correlationId ? { correlationId: entry.correlationId } : {}),
      ...(entry.feature ? { feature: entry.feature } : {}),
      ...(entry.operation ? { operation: entry.operation } : {}),
      ...(entry.deviceId ? { deviceId: entry.deviceId } : {}),
      ...(entry.userId ? { userId: entry.userId } : {}),
      ...(entry.data ? { data: sanitizeData(entry.data) } : {}),
    });
  }

  trace(message: string, context?: Partial<LogEntry>): void {
    if (!this.shouldLog("trace")) return;
    const entry: LogEntry = {
      level: "trace",
      message,
      timestamp: getUtcIsoTimestamp(),
      ...context,
    };
    console.debug(this.formatEntry(entry));
  }

  debug(message: string, context?: Partial<LogEntry>): void {
    if (!this.shouldLog("debug")) return;
    const entry: LogEntry = {
      level: "debug",
      message,
      timestamp: getUtcIsoTimestamp(),
      ...context,
    };
    console.debug(this.formatEntry(entry));
  }

  info(message: string, context?: Partial<LogEntry>): void {
    if (!this.shouldLog("info")) return;
    const entry: LogEntry = {
      level: "info",
      message,
      timestamp: getUtcIsoTimestamp(),
      ...context,
    };
    console.info(this.formatEntry(entry));
  }

  warn(message: string, context?: Partial<LogEntry>): void {
    if (!this.shouldLog("warn")) return;
    const entry: LogEntry = {
      level: "warn",
      message,
      timestamp: getUtcIsoTimestamp(),
      ...context,
    };
    console.warn(this.formatEntry(entry));
  }

  error(message: string, error?: unknown, context?: Partial<LogEntry>): void {
    if (!this.shouldLog("error")) return;
    const entry: LogEntry = {
      level: "error",
      message:
        error instanceof Error ? `${message}: ${error.message}` : message,
      timestamp: getUtcIsoTimestamp(),
      ...context,
      data: {
        ...(context?.data ?? {}),
        ...(error instanceof Error && error.stack
          ? { stack: error.stack }
          : {}),
      },
    };
    console.error(this.formatEntry(entry));
  }
}
