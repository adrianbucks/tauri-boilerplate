# UI & Component Architecture

## Current Implementation

**Status**: ✅ React-first presentation layer with accessible shadcn/ui primitives, typed AppShell, live P2P sync status indicator, theme provider, and generic TanStack/Drizzle-ready DataTable.

Implemented in `packages/ui` (`@platform/ui`) with full styling isolation and design tokens in Vanilla CSS.

---

## 1. Design Philosophy: React-First, Not Schema-Driven

The platform intentionally rejects generic "JSON-to-entire-screen" declarative UI engines. 

- **Ordinary React Components**: Business screens are standard React components with clear JSX, typed hooks, and predictable render cycles.
- **Metadata for Infrastructure Only**: Manifest metadata is reserved strictly for column formatting, form validation rules, permission visibility checks, import mappings, and shell navigation routing.
- **Code Understandability**: Ensures that both human engineers and AI coding assistants can inspect, modify, and refactor UI code using standard React idioms.

---

## 2. Component Catalogue & Structure

```text
packages/ui/src/
├── index.ts                   # Public component exports
├── lib/
│   └── utils.ts               # cn() class name merger (clsx + tailwind-merge)
├── theme/
│   └── ThemeProvider.tsx      # Dark / Light / System theme context & toggle
├── components/
│   ├── button.tsx             # Button variants (default, destructive, outline, ghost)
│   ├── input.tsx              # Accessible text input with focus rings
│   ├── badge.tsx              # Status badge (default, secondary, destructive, outline)
│   ├── card.tsx               # Card, CardHeader, CardTitle, CardContent, CardFooter
│   ├── alert.tsx              # Alert, AlertTitle, AlertDescription
│   └── table.tsx              # Semantic Table, TableHeader, TableRow, TableCell
├── data-table/
│   └── DataTable.tsx          # Generic sortable, filterable table component
├── shell/
│   └── AppShell.tsx           # Responsive application layout shell
└── tokens/
    └── tokens.css             # CSS custom properties (colors, radius, typography)
```

---

## 3. Application Shell (`AppShell`)

`AppShell` provides the unified layout for desktop and mobile form factors:

```typescript
// packages/ui/src/shell/AppShell.tsx

export type AppSyncState =
  | 'IDLE'
  | 'SYNCING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'AUTHENTICATING'
  | 'AUTHORISED'
  | 'DISCOVERED'
  | 'IDENTIFIED'
  | 'DISCONNECTED'
  | 'REVOKED'
  | 'EXPIRED'
  | 'INCOMPATIBLE'
  | 'ERROR';

export interface AppShellNavGroup {
  label: string;
  items: {
    id: string;
    label: string;
    path: string;
    icon?: React.ReactNode;
    badge?: string;
    active?: boolean;
  }[];
}

export interface AppShellProps {
  appName?: string;
  version?: string;
  navGroups: AppShellNavGroup[];
  currentPath?: string;
  onNavigate?: (path: string) => void;
  syncState?: AppSyncState;
  userDisplayName?: string;
  organisationName?: string;
  children: React.ReactNode;
}
```

### Visual Shell Structure

```text
┌────────────────────────────────────────────────────────────────────────┐
│ AppShell                                                               │
│ ┌───────────────────────────┬────────────────────────────────────────┐ │
│ │ Sidebar                   │ Top Header                             │ │
│ │ ├── App Title & Version   │ ├── Navigation Breadcrumbs             │ │
│ │ ├── Feature Nav Groups    │ ├── Tenant / Organisation Indicator    │ │
│ │ ├── Sync Status Pill      │ ├── Dark / Light Theme Toggle          │ │
│ │ └── Collapsible Toggle    │ └── Active User Menu                   │ │
│ │                           ├────────────────────────────────────────┤ │
│ │                           │ Main Content Viewport                  │ │
│ │                           │ (Rendered feature routes)              │ │
│ └───────────────────────────┴────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### Sync Status Indicator

The sidebar displays a live sync status indicator that reflects current transport and replication diagnostics:

| State | Badge Variant | Dot Color | Meaning |
| :--- | :--- | :--- | :--- |
| `IDLE` / `CONNECTED` | `outline` | Green (`#22c55e`) | Peer connected, outbox empty, up to date |
| `SYNCING` | `secondary` | Blue (`#3b82f6`) | Actively transmitting or ingesting envelopes |
| `CONNECTING` / `AUTHENTICATING` | `secondary` | Amber (`#f59e0b`) | Establishing transport / handshaking |
| `DISCONNECTED` | `outline` | Muted (`#6b7280`) | Offline, local-first mode operational |
| `REVOKED` / `ERROR` | `destructive` | Red (`#ef4444`) | Device revoked or protocol incompatibility |

---

## 4. Theme System & Styling Tokens

Styling utilizes semantic CSS variables that toggle seamlessly between light and dark modes:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --radius: 0.5rem;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --card: 222.2 84% 4.9%;
  --primary: 210 40% 98%;
  --border: 217.2 32.6% 17.5%;
}
```

---

## 5. Generic Data Table (`DataTable`)

The `DataTable` component abstracts tabular display, sorting, filtering, and row selection:

```tsx
<DataTable
  columns={[
    { key: 'name', label: 'Widget Name', sortable: true },
    { key: 'sku', label: 'SKU' },
    { key: 'quantity', label: 'Stock Level', align: 'right' },
    { key: 'status', label: 'Status', render: (val) => <Badge>{val}</Badge> },
  ]}
  data={widgets}
  keyExtractor={(w) => w.id}
  onRowClick={(w) => navigate(`/widgets/${w.id}`)}
/>
```

---

## 6. UI Security & Best Practices

1. **No Direct Data Layer Access**: UI components never call `db.select()` or native Tauri commands directly. They always interact via strongly typed repository hooks (`useWidgets()`, `useSync()`).
2. **Permission-Aware Rendering**: Action buttons (Delete, Edit, Export) evaluate permissions via `useAuthorization()`:
   ```tsx
   const { can } = useAuthorization();
   return can('widgets.delete', widget) ? <Button variant="destructive">Delete</Button> : null;
   ```
3. **No Secret Ingestion**: Forms and UI memory never retain cleartext credentials longer than required for immediate authentication.
