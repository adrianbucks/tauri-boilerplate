# UI and Component Architecture

## Current implementation

`@platform/ui` provides reusable React presentation components, styling utilities, a theme provider, a TanStack Table wrapper, and an application shell. Components receive data and callbacks from their callers; the package does not load application data, access repositories, or perform authorization decisions.

The public entry point is `packages/ui/src/index.ts`. The stylesheet is exposed through the `@platform/ui/styles.css` package export and imported by the demo app. Styling uses Tailwind CSS 4 and semantic CSS custom properties defined in `packages/ui/src/styles/globals.css`.

## Component catalogue

| Component                       | Current behavior                                                                                                                                       |
| :------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                        | Native button with CVA variants and sizes; supports Radix `Slot` composition through `asChild` and an `isLoading` presentation state.                  |
| `Input`                         | Native input with optional visible label and error text; generates an ID and associates the error with the input.                                      |
| `Badge`                         | Status label with default, secondary, destructive, outline, success, warning, and info variants.                                                       |
| `Card`                          | Card container with header, title, description, content, and footer primitives.                                                                        |
| `Alert`                         | Alert container with default, destructive, warning, success, and info variants and title/description primitives.                                       |
| `Table`                         | Semantic table, header, body, footer, row, head, cell, and caption primitives.                                                                         |
| `DataTable`                     | Client-side filtering, sorting, pagination, empty state, and optional clickable rows. It requires a positive safe-integer `pageSize`.                  |
| `AppShell`                      | Sidebar navigation, sync-state badge, organization and user labels, theme toggle, and main content viewport.                                           |
| `ThemeProvider` / `ThemeToggle` | Dark, light, and system theme selection, stored in local storage with a configurable key. System selection tracks OS preference changes while mounted. |

`cn()` combines `clsx` and `tailwind-merge` for conditional class names. The exported components do not include generic schema-driven forms, permission hooks, a repository layer, or Drizzle integration.

## Application shell

`AppShell` accepts navigation groups and calls `onNavigate(path)` when an item is selected. The caller owns routing and active-page state. An item's explicit `active` value takes precedence over equality with `currentPath`. Navigation items are buttons, not links.

The shell has a collapsible sidebar and a main content area. The sidebar contains the app name/version, grouped navigation, a sync badge, organization/user labels, and theme controls. The main area wraps its children in a centered, max-width content container. It does not render the header, breadcrumbs, user menu, or responsive mobile navigation shown in older design sketches.

Navigation exposes a named landmark, item accessible names and current-page state. The sidebar control exposes its action and expanded state. Sync states are displayed in these groups:

| Input states                                                            | Badge text | Variant     |
| :---------------------------------------------------------------------- | :--------- | :---------- |
| `IDLE`, `AUTHORISED`                                                    | P2P Idle   | success     |
| `SYNCING`                                                               | Syncing... | info        |
| `CONNECTING`, `CONNECTED`, `AUTHENTICATING`, `DISCOVERED`, `IDENTIFIED` | Connecting | warning     |
| `ERROR`                                                                 | Sync Error | destructive |
| `DISCONNECTED`, `REVOKED`, `EXPIRED`, `INCOMPATIBLE`                    | Offline    | outline     |

## Theme behavior

`ThemeProvider` initializes from the configured local-storage key when browser storage is available, otherwise it uses `defaultTheme` (default: `system`). Invalid stored values are ignored. Storage read/write errors do not prevent theme selection. In system mode the provider listens for `prefers-color-scheme` changes, updates `light`/`dark` classes on the document root, and exposes the resolved `isDark` state.

The stylesheet defines light semantic tokens on `:root` and dark overrides on `.dark`. Consumers should import the exported stylesheet in their application entry styles and use semantic utility classes such as `bg-background`, `text-foreground`, and `border-border`.

## Data table behavior

`DataTable<TData>` accepts `ColumnDef<TData, any>[]` from TanStack Table and an in-memory array of rows. It enables global filtering, sortable columns, and client-side pagination. `pageSize` defaults to 10 and must be a positive safe integer. `onRowClick`, when supplied, makes rows focusable and activates them with Enter or Space; events from nested links and controls do not activate the row. The table does not implement selection, remote pagination, data loading, or persistence.

## Dependency boundaries

The package should remain presentation-only. Application and feature layers supply data, authorization decisions, and navigation callbacks. `@platform/ui` declares React as a peer dependency so the consuming application provides the shared React runtime. React and React DOM are development dependencies for local tests; the component code imports React, TanStack Table, Radix Slot, CVA, Lucide icons, and styling utilities.
