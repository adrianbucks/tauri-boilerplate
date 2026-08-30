export type BarcodeFormat =
  | "QR_CODE"
  | "DATA_MATRIX"
  | "CODE_128"
  | "CODE_39"
  | "EAN_13"
  | "EAN_8"
  | "UPC_A"
  | "UPC_E"
  | "UNKNOWN";

export interface BarcodeScanResult {
  readonly text: string;
  readonly format?: BarcodeFormat | undefined;
  readonly timestamp: string;
  readonly deviceType: "keyboard-wedge" | "camera" | "hardware-plugin";
}

export interface BarcodeScannerListener {
  (result: BarcodeScanResult): void;
}

export interface BarcodeScanner {
  readonly isAvailable: boolean;
  startListening(listener: BarcodeScannerListener): void;
  stopListening(): void;
}

export interface KeyboardWedgeOptions {
  /** Maximum elapsed time (ms) between keystrokes to consider it scanner input rather than typing. Default 50ms */
  maxInterKeyDelayMs?: number;
  /** Suffix character/key denoting end of barcode scan. Default 'Enter' */
  terminatorKey?: string;
  /** Minimum length of scanned barcode string. Default 3 */
  minScanLength?: number;
}
