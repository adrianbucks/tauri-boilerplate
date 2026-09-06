# UI Architecture

## Current

The demo uses React 19, Tailwind CSS 4, reusable UI primitives under `@platform/ui`, feature pages and a `PlatformProvider` hook. UI package components include buttons, inputs, cards, tables, data tables, app shell and theme support.

## Target layering

```text
App shell
  ↓
feature pages/workflows
  ↓
feature services/hooks
  ↓
platform services
  ↓
native boundary
```

UI components must not own persistence, authorization truth or cryptographic operations.

## UI state

Separate:

- server/local domain state;
- transient form state;
- session state;
- synchronization status;
- diagnostics state.

Do not use UI state as the source of truth for authorization.

## Error handling

Map `PlatformError` to user-safe presentation using its `userMessage`, while preserving correlation IDs for support/diagnostics. Technical details must not be rendered to ordinary users unless explicitly safe.

## Accessibility and resilience

New UI should provide keyboard navigation, semantic controls, visible focus, useful labels, loading/error/empty states and graceful offline behavior. Destructive actions should be explicit and auditable.
