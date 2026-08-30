import { describe, it, expect, vi } from "vitest";
import { KeyboardWedgeScanner, type BarcodeScanResult } from "./index.js";

describe("@platform/hardware", () => {
  it("detects high-speed barcode scan with Enter terminator", () => {
    const scanner = new KeyboardWedgeScanner({ maxInterKeyDelayMs: 40 });
    const onScan = vi.fn();
    scanner.startListening(onScan);

    let t = 1000;
    // Simulate fast barcode scanner keystrokes (10ms intervals)
    for (const char of "LOC-COV-A102") {
      scanner.handleKeyEvent(char, (t += 10));
    }
    scanner.handleKeyEvent("Enter", (t += 10));

    expect(onScan).toHaveBeenCalledTimes(1);
    const result: BarcodeScanResult = onScan.mock.calls[0]![0];
    expect(result.text).toBe("LOC-COV-A102");
    expect(result.deviceType).toBe("keyboard-wedge");
  });

  it("ignores slow manual typing keystrokes", () => {
    const scanner = new KeyboardWedgeScanner({ maxInterKeyDelayMs: 30 });
    const onScan = vi.fn();
    scanner.startListening(onScan);

    let t = 1000;
    // Simulate slow manual human typing (250ms intervals)
    for (const char of "SLOW") {
      scanner.handleKeyEvent(char, (t += 250));
    }
    scanner.handleKeyEvent("Enter", (t += 250));

    // Should not trigger scanner listener because inter-key delay was exceeded
    expect(onScan).not.toHaveBeenCalled();
  });

  it("accepts custom terminator characters (Tab)", () => {
    const scanner = new KeyboardWedgeScanner({
      maxInterKeyDelayMs: 50,
      terminatorKey: "Tab",
    });
    const onScan = vi.fn();
    scanner.startListening(onScan);

    let t = 2000;
    for (const char of "QR-CODE-123") {
      scanner.handleKeyEvent(char, (t += 10));
    }
    scanner.handleKeyEvent("Tab", (t += 10));

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan.mock.calls[0]![0].text).toBe("QR-CODE-123");
  });

  it("does not emit scan after stopListening is called", () => {
    const scanner = new KeyboardWedgeScanner({ maxInterKeyDelayMs: 50 });
    const onScan = vi.fn();
    scanner.startListening(onScan);
    scanner.stopListening();

    let t = 3000;
    for (const char of "BARCODE") {
      scanner.handleKeyEvent(char, (t += 10));
    }
    scanner.handleKeyEvent("Enter", (t += 10));

    expect(onScan).not.toHaveBeenCalled();
  });
});
