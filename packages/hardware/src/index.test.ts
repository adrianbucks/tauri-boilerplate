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

  it("ignores a terminator that arrives after the scan timing window", () => {
    const scanner = new KeyboardWedgeScanner({ maxInterKeyDelayMs: 40 });
    const onScan = vi.fn();
    scanner.startListening(onScan);

    let timestamp = 1000;
    for (const char of "MANUAL") {
      scanner.handleKeyEvent(char, (timestamp += 10));
    }
    scanner.handleKeyEvent("Enter", (timestamp += 100));

    expect(onScan).not.toHaveBeenCalled();
  });

  it("rejects invalid scanner timing and length options", () => {
    expect(() => new KeyboardWedgeScanner({ maxInterKeyDelayMs: 0 })).toThrow(
      "maxInterKeyDelayMs must be a positive finite number",
    );
    expect(() => new KeyboardWedgeScanner({ minScanLength: 1.5 })).toThrow(
      "minScanLength must be a positive safe integer",
    );
    expect(() => new KeyboardWedgeScanner({ terminatorKey: "" })).toThrow(
      "terminatorKey must not be empty",
    );
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

  it("does not carry a partial scan across listener replacement", () => {
    const scanner = new KeyboardWedgeScanner({ maxInterKeyDelayMs: 50 });
    const previousListener = vi.fn();
    const nextListener = vi.fn();
    scanner.startListening(previousListener);
    scanner.handleKeyEvent("O", 1000);
    scanner.handleKeyEvent("L", 1010);
    scanner.handleKeyEvent("D", 1020);

    scanner.startListening(nextListener);
    scanner.handleKeyEvent("N", 1030);
    scanner.handleKeyEvent("E", 1040);
    scanner.handleKeyEvent("W", 1050);
    scanner.handleKeyEvent("Enter", 1060);

    expect(previousListener).not.toHaveBeenCalled();
    expect(nextListener).toHaveBeenCalledTimes(1);
    expect(nextListener.mock.calls[0]![0].text).toBe("NEW");
  });

  it("clears completed scan state before invoking a throwing listener", () => {
    const scanner = new KeyboardWedgeScanner({ maxInterKeyDelayMs: 50 });
    const throwingListener = vi.fn(() => {
      throw new Error("consumer failed");
    });
    scanner.startListening(throwingListener);

    expect(() => {
      scanner.handleKeyEvent("O", 1000);
      scanner.handleKeyEvent("L", 1010);
      scanner.handleKeyEvent("D", 1020);
      scanner.handleKeyEvent("Enter", 1030);
    }).toThrow("consumer failed");

    const nextListener = vi.fn();
    scanner.startListening(nextListener);
    scanner.handleKeyEvent("N", 1040);
    scanner.handleKeyEvent("E", 1050);
    scanner.handleKeyEvent("W", 1060);
    scanner.handleKeyEvent("Enter", 1070);

    expect(nextListener).toHaveBeenCalledTimes(1);
    expect(nextListener.mock.calls[0]![0].text).toBe("NEW");
  });
});
