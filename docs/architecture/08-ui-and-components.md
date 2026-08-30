# 11 — UI and Components

---

## Design decision: React-first

The platform does not generate UI from JSON schemas. It does not have a generic "JSON → entire screen" engine.

Metadata (from feature manifests) is used only for:

- Column definitions (labels, visibility, sort)
- Form field validation rules
- Permission-based field visibility
- Import/export column mappings
- Navigation metadata

Business screens are ordinary **React components**. This keeps application code readable and debuggable by both humans and AI agents.

---

## Package: `packages/ui`

```
packages/ui/
├── src/
│   ├── index.ts              ← Public API barrel export
│   ├── components/           ← shadcn/ui wrapped components
│   │   ├── Button/
│   │   ├── Input/
│   │   ├── Select/
│   │   ├── Combobox/
│   │   ├── Dialog/
│   │   ├── Drawer/
│   │   ├── Sheet/
│   │   ├── Tabs/
│   │   ├── Dropdown/
│   │   ├── Command/
│   │   ├── Toast/
│   │   ├── Alert/
│   │   ├── Badge/
│   │   ├── Card/
│   │   ├── Table/
│   │   ├── Form/
│   │   ├── Calendar/
│   │   ├── DatePicker/
│   │   ├── Tooltip/
│   │   └── Skeleton/
│   ├── shell/
│   │   ├── AppShell.tsx       ← Root layout
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   ├── Breadcrumbs.tsx
│   │   ├── CommandPalette.tsx
│   │   ├── NotificationArea.tsx
│   │   └── UserDeviceMenu.tsx
│   ├── data-table/
│   │   ├── DataTable.tsx      ← TanStack Table + shadcn primitives
│   │   ├── DataTableToolbar.tsx
│   │   ├── DataTablePagination.tsx
│   │   ├── DataTableColumnHeader.tsx
│   │   └── DataTableRowActions.tsx
│   └── tokens/
│       ├── colors.css         ← Design token CSS custom properties
│       ├── typography.css
│       └── spacing.css
```

---

## Component source: shadcn/ui

shadcn/ui provides **copy-paste component primitives**, not an npm component library. Components are owned by the platform — they are not re-exported from a shadcn package.

Reference: https://github.com/shadcn-ui/ui

### Why shadcn/ui

- Components are owned — no dependency on a third-party component runtime
- Built on Radix UI primitives (accessibility built in)
- Composable — no giant generic component that handles every case
- TanStack Table integration is documented in shadcn — use it
- No Tailwind required (shadcn supports Vanilla CSS)

### Component ownership rules

- Copy components into `packages/ui/src/components/` — do not import from the shadcn package at runtime
- Extend components for platform needs (e.g., add a `loading` prop to Button) — keep changes minimal
- Never build a different version of the same component for a feature — extend the platform component

---

## Application shell

```typescript
// packages/ui/src/shell/AppShell.tsx

interface AppShellProps {
  navigation: NavigationConfig; // Injected by platform from registered feature manifests
  children: React.ReactNode;
}

// Internal structure:
// AppShell
// ├── Sidebar (navigation items, sync status indicator)
// ├── Header (breadcrumbs, command palette trigger, user/device menu)
// └── Main (children — routed feature pages)
```

The AppShell knows about platform capabilities (sync state, user session, device identity) but not about application-specific entities. It receives navigation configuration from the platform, which aggregates it from registered feature manifests.

### Sync status in sidebar

The sidebar displays a live sync status indicator driven by `SyncDiagnostic`:

- Green dot: SYNCING or IDLE (connected)
- Yellow dot: CONNECTING or AUTHENTICATING
- Red dot: ERROR, REVOKED, INCOMPATIBLE
- Grey dot: DISCONNECTED

---

## DataTable with TanStack Table

The `DataTable` component is the standard way to display lists of records.

```typescript
// packages/ui/src/data-table/DataTable.tsx

interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData>[];
  pagination?: PaginationConfig;
  sorting?: boolean;
  filtering?: FilterConfig;
  selection?: boolean;
  rowActions?: RowAction<TData>[];
  virtualise?: boolean; // Enable TanStack Virtual for large datasets
  onPageChange?: (page: number) => void;
  isLoading?: boolean;
}
```

### Large dataset strategy

The UI must not load all rows into React state.

```
SQLite query (with WHERE + ORDER BY + LIMIT + OFFSET)
    ↓
Filtered, paginated result (e.g., 100 rows)
    ↓
DataTable (TanStack Table)
    ↓ (if virtualise=true)
TanStack Virtual (renders only visible rows)
```

Apply SQLite indexes before adding complex client-side caching. See doc 06 for indexing guidance.

---

## Feature UI conventions

Every feature organises its UI components in a consistent structure:

```
features/<name>/src/
├── pages/
│   ├── <Entity>ListPage.tsx      ← DataTable + filters + toolbar
│   ├── <Entity>DetailPage.tsx    ← Read view
│   ├── <Entity>EditPage.tsx      ← Form view
│   └── <Entity>ImportPage.tsx    ← Import wizard (if feature supports import)
│
└── components/
    ├── <Entity>Table.tsx         ← Table column definitions for this entity
    ├── <Entity>Filters.tsx       ← Filter controls
    ├── <Entity>Form.tsx          ← Create/edit form
    └── <Entity>Badge.tsx         ← Status badge or compact display
```

### Page structure rules

- Each page is a named export, not a default export
- Pages never access the database directly — they call services via hooks
- Pages use `useAuthorization()` to check permissions before rendering actions
- Pages include SEO-relevant `<title>` via the router's head management

---

## Styling: Tailwind CSS v4 + shadcn/ui

The platform uses Tailwind CSS v4 with CSS custom properties for theming and dark/light mode.

```css
/* packages/ui/src/styles/globals.css */
@import "tailwindcss";

@layer base {
  :root {
    --background: hsl(0 0% 100%);
    --foreground: hsl(222.2 84% 4.9%);
    --card: hsl(0 0% 100%);
    --primary: hsl(221.2 83.2% 53.3%);
    --border: hsl(214.3 31.8% 91.4%);
    --radius: 0.5rem;
  }
  .dark {
    --background: hsl(222.2 84% 4.9%);
    --foreground: hsl(210 40% 98%);
    --card: hsl(222.2 84% 6.5%);
    --primary: hsl(217.2 91.2% 59.8%);
    --border: hsl(217.2 32.6% 17.5%);
  }
}
```

Feature-specific styles live in the feature package and use only platform tokens — no hardcoded colour values.

---

## Forms

Forms use React Hook Form (evaluate against alternatives during Phase 1) with Zod for schema validation.

**RESEARCH REQUIRED** — validate React Hook Form + shadcn/ui integration works without conflicts in the Tauri webview context.

```typescript
// Feature form pattern
const widgetSchema = z.object({
  name: z.string().min(1).max(100),
  warehouseId: z.string().uuid(),
  quantity: z.number().int().min(0),
});

type WidgetFormValues = z.infer<typeof widgetSchema>;
```

Validation errors surface through the Form component — never raw `alert()` or `console.log()`.

---

## Notifications and toasts

All user-facing feedback goes through the Toast system from `packages/ui`:

```typescript
import { toast } from "@platform/ui";

// Success
toast.success("Widget created", { correlationId: ctx.correlationId });

// Error
toast.error("Failed to create widget", {
  message: error.userMessage,
  correlationId: error.correlationId,
  retryable: error.retryable,
});

// Sync status
toast.info("Sync pending — changes saved locally");
```

Toast messages include the correlation ID as a small copyable tag — enables users to report issues precisely.

---

## Command palette

The command palette (keyboard shortcut: `Ctrl+K` / `Cmd+K`) aggregates:

- Navigation to any registered feature page
- Common actions (create record, open import wizard, view diagnostics)
- Admin actions (if the current user has admin permissions)

Feature manifests contribute command palette entries via the `navigation` field.

---

## Responsive layout

The AppShell must work on:

- Windows desktop: full sidebar, wide data table
- Android tablet landscape: collapsible sidebar, full data table
- Android tablet portrait: bottom navigation, scrollable table

The platform does not target mobile phones. Minimum supported display: 10" Android tablet.

---

## Accessibility

All interactive components must meet WCAG 2.1 AA:

- Keyboard navigable
- Screen reader compatible (Radix UI handles most of this via ARIA)
- Colour contrast compliant
- Focus indicators visible

Tauri's webview uses the OS-native web renderer — test on both Windows WebView2 and Android WebView.
