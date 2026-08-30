import type { PlatformErrorCode, ErrorSeverity } from "./codes.js";

export interface PlatformErrorPayload {
  readonly code: PlatformErrorCode;
  readonly message: string;
  readonly userMessage: string;
  readonly correlationId: string;
  readonly retryable?: boolean;
  readonly severity?: ErrorSeverity;
  readonly technicalDetails?: string | undefined;
  readonly cause?: unknown;
}

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly userMessage: string;
  readonly correlationId: string;
  readonly retryable: boolean;
  readonly severity: ErrorSeverity;
  readonly technicalDetails: string | undefined;
  override readonly cause: unknown;

  constructor(payload: PlatformErrorPayload) {
    super(payload.message);
    this.name = this.constructor.name;
    this.code = payload.code;
    this.userMessage = payload.userMessage;
    this.correlationId = payload.correlationId;
    this.retryable = payload.retryable ?? false;
    this.severity = payload.severity ?? "error";
    this.technicalDetails = payload.technicalDetails;
    this.cause = payload.cause;

    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      correlationId: this.correlationId,
      retryable: this.retryable,
      severity: this.severity,
      technicalDetails: this.technicalDetails,
    };
  }
}

export class ValidationError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "VALIDATION_ERROR" });
  }
}

export class AuthorizationError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "AUTHORIZATION_ERROR" });
  }
}

export class AuthenticationError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "AUTHENTICATION_ERROR" });
  }
}

export class SyncError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "SYNC_ERROR" });
  }
}

export class ConflictError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "CONFLICT_ERROR" });
  }
}

export class DatabaseError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "DATABASE_ERROR" });
  }
}

export class MigrationError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "MIGRATION_ERROR" });
  }
}

export class FileError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "FILE_ERROR" });
  }
}

export class HardwareError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "HARDWARE_ERROR" });
  }
}

export class NetworkError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({
      ...payload,
      code: "NETWORK_ERROR",
      retryable: payload.retryable ?? true,
    });
  }
}

export class CompatibilityError extends PlatformError {
  constructor(payload: Omit<PlatformErrorPayload, "code">) {
    super({ ...payload, code: "COMPATIBILITY_ERROR" });
  }
}
