import { describe, expect, it } from "vitest";
import { createRequestContext } from "@platform/core";

describe("authentication trust boundary", () => {
  it("does not let frontend request context select identity or credentials", () => {
    const context = createRequestContext({
      metadata: { requestedUserId: "user_claim" },
    });

    expect(context).toEqual({
      correlationId: expect.stringMatching(/^req_/),
      metadata: { requestedUserId: "user_claim" },
    });
    expect(context).not.toHaveProperty("userId");
    expect(context).not.toHaveProperty("deviceId");
    expect(context).not.toHaveProperty("organisationId");
    expect(context).not.toHaveProperty("password");
    expect(context).not.toHaveProperty("credential");
  });
});
