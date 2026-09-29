# Import, Export and Hardware

## Import/export

The platform currently exposes a SheetJS-based import/export abstraction.

### Target import pipeline

```text
file selection
  ↓ capability-controlled native file access
size/type validation
  ↓
bounded parsing
  ↓
schema/field validation
  ↓
preview
  ↓
authorization
  ↓
transactional domain write
  ├── audit
  └── outbox where synchronisable
```

### Required limits

Define and enforce:

- maximum file size;
- maximum sheets;
- maximum rows/cells;
- maximum string/cell size;
- supported workbook formats;
- parsing timeout/resource budget;
- duplicate policy;
- partial-failure policy.

Treat uploaded spreadsheets as hostile input.

### Export safety

Exports must define handling for spreadsheet formula injection. Values beginning with formula-triggering characters must be neutralised or encoded according to the application's export policy.

## Hardware

The current hardware package contains a keyboard-wedge scanner abstraction.

Target scanner behavior:

- explicit activation/focus lifecycle;
- bounded input length;
- terminator handling;
- timing/keystroke burst detection;
- cancellation/reset;
- malformed input rejection;
- no global capture beyond the required scope.

Camera/native scanner integrations are separate future adapters and must not leak device-specific code into domain features.
