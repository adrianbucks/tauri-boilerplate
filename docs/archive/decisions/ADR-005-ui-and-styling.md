# ADR-005: UI Component Library and Styling Engine

## Status

Accepted

## Context

The boilerplate requires a modular, high-performance UI component system that:

1. Supports rich, modern styling out of the box with zero runtime CSS-in-JS performance penalty.
2. Supports dark mode, light mode, and system preference detection with seamless local storage persistence.
3. Provides accessible, unstyled headless primitives (dialogs, dropdowns, tabs, tooltips, slots) paired with copy-pasteable styling.
4. Integrates cleanly into a Vite + React monorepo architecture without complex build tooling or configuration bloat.

## Decision

We adopt **Tailwind CSS v4** (`@tailwindcss/vite`) combined with **shadcn/ui** patterns and **Radix UI** primitives in `@platform/ui`.

### Technical Architecture

1. **Tailwind CSS v4 (CSS-First Engine)**:
   - Uses `@import "tailwindcss";` in `src/styles/globals.css`.
   - Replaces legacy `tailwind.config.js` with modern `@layer base` CSS custom property variables (`--background`, `--foreground`, `--primary`, `--card`, `--border`, `--radius`, etc.).
   - `.dark` class controls dark theme palette shifts with instant response.

2. **shadcn/ui Pattern**:
   - Components (`Button`, `Input`, `Badge`, `Card`, `Alert`, `Table`) are implemented using `class-variance-authority` (CVA) and `clsx` + `tailwind-merge` (`cn()` utility).
   - Unstyled headless primitives from `@radix-ui/react-*` provide full WAI-ARIA keyboard navigation and accessibility.

3. **Theme Management**:
   - `ThemeProvider` and `ThemeToggle` provide dynamic switching between `'dark'`, `'light'`, and `'system'` preferences with `localStorage` persistence.

4. **Data Grid**:
   - `DataTable` encapsulates `@tanstack/react-table` for client-side search filtering, multi-column sorting, and pagination.

## Consequences

- **Positive**:
  - Instant build and HMR times in Vite with Tailwind v4.
  - Zero runtime CSS overhead compared to CSS-in-JS libraries.
  - Clean separation: `@platform/ui` exports all components, themes, and styles via `./styles.css` for consumption by `apps/demo` and future applications.
  - Full dark and light mode aesthetics out of the box.
- **Negative / Constraints**:
  - Developers adding new features should use `@platform/ui` components and tokens rather than inventing ad-hoc CSS.
