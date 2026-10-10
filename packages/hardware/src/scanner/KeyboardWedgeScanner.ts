import { getUtcIsoTimestamp } from "@platform/core";
import type {
  BarcodeScanner,
  BarcodeScannerListener,
  BarcodeScanResult,
  KeyboardWedgeOptions,
} from "./types.js";

export class KeyboardWedgeScanner implements BarcodeScanner {
  public readonly isAvailable: boolean = true;
  private readonly maxInterKeyDelayMs: number;
  private readonly terminatorKey: string;
  private readonly minScanLength: number;

  private listener: BarcodeScannerListener | null = null;
  private buffer: string[] = [];
  private lastKeyTime: number | null = null;

  constructor(options?: KeyboardWedgeOptions) {
    this.maxInterKeyDelayMs = options?.maxInterKeyDelayMs ?? 50;
    this.terminatorKey = options?.terminatorKey ?? "Enter";
    this.minScanLength = options?.minScanLength ?? 3;

    if (!Number.isFinite(this.maxInterKeyDelayMs) || this.maxInterKeyDelayMs <= 0) {
      throw new RangeError("maxInterKeyDelayMs must be a positive finite number");
    }
    if (!this.terminatorKey) {
      throw new TypeError("terminatorKey must not be empty");
    }
    if (!Number.isSafeInteger(this.minScanLength) || this.minScanLength < 1) {
      throw new RangeError("minScanLength must be a positive safe integer");
    }
  }

  public startListening(listener: BarcodeScannerListener): void {
    // A listener owns only scans that begin during its active lifetime.
    this.buffer = [];
    this.lastKeyTime = null;
    this.listener = listener;
  }

  public stopListening(): void {
    this.listener = null;
    this.buffer = [];
    this.lastKeyTime = null;
  }

  /**
   * Processes a raw keydown event (can be called from Window keydown listener or unit tests).
   */
  public handleKeyEvent(key: string, timestamp: number = Date.now()): void {
    if (!this.listener) return;
    if (!Number.isFinite(timestamp)) return;

    const timeSinceLastKey = this.lastKeyTime === null ? null : timestamp - this.lastKeyTime;
    if (timeSinceLastKey !== null && timeSinceLastKey < 0) {
      this.buffer = [];
    }
    this.lastKeyTime = timestamp;

    if (key === this.terminatorKey) {
      const terminatorWasPrompt =
        timeSinceLastKey !== null &&
        timeSinceLastKey >= 0 &&
        timeSinceLastKey <= this.maxInterKeyDelayMs;
      if (terminatorWasPrompt && this.buffer.length >= this.minScanLength) {
        const text = this.buffer.join("");
        const scanResult: BarcodeScanResult = {
          text,
          timestamp: getUtcIsoTimestamp(),
          deviceType: "keyboard-wedge",
        };
        const listener = this.listener;
        this.buffer = [];
        this.lastKeyTime = null;
        listener?.(scanResult);
        return;
      }
      this.buffer = [];
      this.lastKeyTime = null;
      return;
    }

    // Single character input
    if (key.length === 1) {
      // If delay between keys was too long (human typing speed), reset buffer
      if (
        this.buffer.length > 0 &&
        timeSinceLastKey !== null &&
        timeSinceLastKey > this.maxInterKeyDelayMs
      ) {
        this.buffer = [];
      }
      this.buffer.push(key);
    }
  }
}
