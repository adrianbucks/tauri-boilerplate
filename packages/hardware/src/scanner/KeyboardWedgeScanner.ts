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
  private lastKeyTime: number = 0;

  constructor(options?: KeyboardWedgeOptions) {
    this.maxInterKeyDelayMs = options?.maxInterKeyDelayMs ?? 50;
    this.terminatorKey = options?.terminatorKey ?? "Enter";
    this.minScanLength = options?.minScanLength ?? 3;
  }

  public startListening(listener: BarcodeScannerListener): void {
    this.listener = listener;
  }

  public stopListening(): void {
    this.listener = null;
    this.buffer = [];
  }

  /**
   * Processes a raw keydown event (can be called from Window keydown listener or unit tests).
   */
  public handleKeyEvent(key: string, timestamp: number = Date.now()): void {
    if (!this.listener) return;

    const timeSinceLastKey = timestamp - this.lastKeyTime;
    this.lastKeyTime = timestamp;

    if (key === this.terminatorKey) {
      if (this.buffer.length >= this.minScanLength) {
        const text = this.buffer.join("");
        const scanResult: BarcodeScanResult = {
          text,
          timestamp: getUtcIsoTimestamp(),
          deviceType: "keyboard-wedge",
        };
        this.listener(scanResult);
      }
      this.buffer = [];
      return;
    }

    // Single character input
    if (key.length === 1) {
      // If delay between keys was too long (human typing speed), reset buffer
      if (
        this.buffer.length > 0 &&
        timeSinceLastKey > this.maxInterKeyDelayMs
      ) {
        this.buffer = [];
      }
      this.buffer.push(key);
    }
  }
}
