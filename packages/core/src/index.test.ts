import { describe, it, expect } from "vitest";
import {
  PlatformError,
  ValidationError,
  AuthorizationError,
  generateCorrelationId,
  getUtcIsoTimestamp,
  isValidUtcIsoTimestamp,
  createOperationContext,
  createRequestContext,
  createDefaultConfig,
} from "./index.js";

describe("@platform/core", () => {
  describe("PlatformError", () => {
    it("creates standard PlatformError with correct properties", () => {
      const error = new PlatformError({
        code: "VALIDATION_ERROR",
        message: "Invalid input field",
        userMessage: "Please check your input",
        correlationId: "req_123",
        retryable: false,
      });

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe("Invalid input field");
      expect(error.userMessage).toBe("Please check your input");
      expect(error.correlationId).toBe("req_123");
      expect(error.retryable).toBe(false);
      expect(error.toJSON()).toEqual({
        code: "VALIDATION_ERROR",
        message: "Invalid input field",
        userMessage: "Please check your input",
        correlationId: "req_123",
        retryable: false,
        severity: "error",
        technicalDetails: undefined,
      });
    });

    it("subclasses set the code automatically", () => {
      const valError = new ValidationError({
        message: "Name required",
        userMessage: "Name is required",
        correlationId: "req_123",
      });
      expect(valError.code).toBe("VALIDATION_ERROR");

      const authError = new AuthorizationError({
        message: "Permission denied",
        userMessage: "You are not allowed to perform this action",
        correlationId: "req_123",
      });
      expect(authError.code).toBe("AUTHORIZATION_ERROR");
    });
  });

  describe("CorrelationId", () => {
    it("generates IDs with expected prefix", () => {
      const id = generateCorrelationId("imp");
      expect(id.startsWith("imp_")).toBe(true);
      expect(id.length).toBeGreaterThan(15);
    });

    it("generates unique IDs", () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("Time", () => {
    it("formats and validates UTC ISO timestamps", () => {
      const ts = getUtcIsoTimestamp();
      expect(isValidUtcIsoTimestamp(ts)).toBe(true);
      expect(isValidUtcIsoTimestamp("invalid")).toBe(false);
    });
  });

  describe("OperationContext", () => {
    it("creates operation context with default correlation ID", () => {
      const ctx = createOperationContext({
        deviceId: "dev_1",
        organisationId: "org_1",
      });
      expect(ctx.deviceId).toBe("dev_1");
      expect(ctx.organisationId).toBe("org_1");
      expect(ctx.userId).toBeNull();
      expect(ctx.correlationId.startsWith("op_")).toBe(true);
    });

    it("creates request context without caller-controlled identity", () => {
      const ctx = createRequestContext();
      expect(ctx.correlationId.startsWith("req_")).toBe(true);
      expect(ctx).not.toHaveProperty("userId");
      expect(ctx).not.toHaveProperty("deviceId");
      expect(ctx).not.toHaveProperty("organisationId");
    });
  });

  describe("AppConfig", () => {
    it("creates default configuration with override support", () => {
      const config = createDefaultConfig({
        environment: "production",
      });
      expect(config.environment).toBe("production");
      expect(config.protocolVersion).toBe(1);
      expect(config.storage.enableWal).toBe(true);
    });
  });
});
