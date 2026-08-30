import { ValidationError } from "@platform/core";

export interface HandshakeMessage {
  readonly applicationId: string;
  readonly applicationVersion: string;
  readonly protocolVersion: number;
  readonly deviceId: string;
  readonly organisationId: string;
  readonly supportedFeatures: readonly string[];
  readonly supportedEntityVersions: Readonly<Record<string, number>>;
  readonly timestamp: string;
  readonly signature?: string | undefined;
}

export interface HandshakeValidationOptions {
  expectedApplicationId: string;
  expectedOrganisationId: string;
  minimumProtocolVersion: number;
  currentProtocolVersion: number;
}

export interface HandshakeValidationResult {
  valid: boolean;
  code?:
    | "APP_ID_MISMATCH"
    | "ORG_ID_MISMATCH"
    | "PROTOCOL_INCOMPATIBLE"
    | "TIMESTAMP_SKEW"
    | "INVALID_PAYLOAD";
  reason?: string;
}

export class HandshakeValidator {
  /**
   * Validates an incoming peer handshake against local platform constraints.
   */
  static validate(
    message: HandshakeMessage,
    options: HandshakeValidationOptions,
  ): HandshakeValidationResult {
    if (!message || typeof message !== "object") {
      return {
        valid: false,
        code: "INVALID_PAYLOAD",
        reason: "Handshake message is malformed or missing",
      };
    }

    // 1. Verify Application ID
    if (message.applicationId !== options.expectedApplicationId) {
      return {
        valid: false,
        code: "APP_ID_MISMATCH",
        reason: `Application ID mismatch: expected '${options.expectedApplicationId}', received '${message.applicationId}'`,
      };
    }

    // 2. Verify Organisation ID
    if (message.organisationId !== options.expectedOrganisationId) {
      return {
        valid: false,
        code: "ORG_ID_MISMATCH",
        reason: `Organisation ID mismatch: expected '${options.expectedOrganisationId}', received '${message.organisationId}'`,
      };
    }

    // 3. Verify Protocol Version
    if (message.protocolVersion < options.minimumProtocolVersion) {
      return {
        valid: false,
        code: "PROTOCOL_INCOMPATIBLE",
        reason: `Protocol version ${message.protocolVersion} is below minimum supported version ${options.minimumProtocolVersion}`,
      };
    }

    return { valid: true };
  }

  /**
   * Enforces that handshake is valid, throwing a ValidationError if invalid.
   */
  static requireValid(
    message: HandshakeMessage,
    options: HandshakeValidationOptions,
    correlationId: string,
  ): void {
    const result = this.validate(message, options);
    if (!result.valid) {
      throw new ValidationError({
        message: `Handshake verification failed: ${result.reason} (${result.code})`,
        userMessage:
          "Peer handshake rejected due to compatibility or security constraints",
        correlationId,
      });
    }
  }
}
