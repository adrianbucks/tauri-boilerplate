import { generateCorrelationId } from "../correlation/CorrelationId.js";

export interface OperationContext {
  readonly correlationId: string;
  readonly userId: string | null;
  readonly deviceId: string;
  readonly organisationId: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface CreateContextOptions {
  correlationId?: string | undefined;
  userId?: string | null | undefined;
  deviceId: string;
  organisationId: string;
  metadata?: Record<string, unknown> | undefined;
}

export function createOperationContext(
  options: CreateContextOptions,
): OperationContext {
  return {
    correlationId: options.correlationId ?? generateCorrelationId("op"),
    userId: options.userId ?? null,
    deviceId: options.deviceId,
    organisationId: options.organisationId,
    metadata: options.metadata
      ? Object.freeze({ ...options.metadata })
      : undefined,
  };
}
