# ADR-018: Hardware Scanner and Peripheral Integration

## Status

Accepted

## Context

Industrial and warehousing applications rely heavily on high-speed 1D/2D barcode scanners. On Windows desktops, the vast majority of USB/Bluetooth industrial scanners operate in **keyboard-wedge mode**, generating high-speed burst keypresses terminated by an `Enter` character. On Android tablets, cameras or integrated scanning hardware require dedicated plugin APIs.

## Decision

We implement a decoupled `@platform/hardware` package:

1. `KeyboardWedgeScanner` provides burst-detection (<50ms inter-key delay) to reliably differentiate scanner bursts from human manual keyboard entry, dispatching typed `BarcodeScanResult` events on terminator detection.
2. `BarcodeScanner` interface abstracts device hardware so feature code interacts with an observable scan stream regardless of whether the underlying device is a Windows USB wedge scanner or an Android camera scanner.

## Consequences

- **Pros**: Zero native driver installation required for standard USB scanners on Windows; clean decoupling between UI inputs and physical barcode hardware.
- **Cons**: Requires active window focus on desktop when scanning in keyboard-wedge mode.
