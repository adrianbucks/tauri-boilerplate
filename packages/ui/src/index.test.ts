import { describe, it, expect } from "vitest";
import { Button, Input, Badge, Card, Alert } from "./index.js";

describe("@platform/ui", () => {
  it("exports core UI components properly", () => {
    expect(Button).toBeDefined();
    expect(Input).toBeDefined();
    expect(Badge).toBeDefined();
    expect(Card).toBeDefined();
    expect(Alert).toBeDefined();
  });
});
