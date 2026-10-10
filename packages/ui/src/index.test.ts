import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Button,
  Input,
  Badge,
  Card,
  Alert,
  DataTable,
  AppShell,
  ThemeProvider,
  ThemeToggle,
  useTheme,
} from "./index.js";

describe("@platform/ui", () => {
  it("exports core UI components properly", () => {
    expect(Button).toBeDefined();
    expect(Input).toBeDefined();
    expect(Badge).toBeDefined();
    expect(Card).toBeDefined();
    expect(Alert).toBeDefined();
  });

  it("renders sortable data-table headers as accessible buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(DataTable<{ name: string }>, {
        data: [{ name: "Alpha" }],
        columns: [{ accessorKey: "name", header: "Name" }],
      }),
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Sort by name"');
    expect(markup).toContain('aria-sort="none"');
    expect(markup).toContain('aria-label="Filter records..."');
  });

  it("makes clickable data-table rows keyboard reachable", () => {
    const markup = renderToStaticMarkup(
      createElement(DataTable<{ name: string }>, {
        data: [{ name: "Alpha" }],
        columns: [{ accessorKey: "name", header: "Name" }],
        onRowClick: () => undefined,
      }),
    );

    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-description="Press Enter or Space to open this row"');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid data-table page sizes (%s)",
    (pageSize) => {
      expect(() =>
        renderToStaticMarkup(
          createElement(DataTable<{ name: string }>, {
            data: [],
            columns: [{ accessorKey: "name", header: "Name" }],
            pageSize,
          }),
        ),
      ).toThrow("pageSize must be a positive safe integer");
    },
  );

  it("exposes accessible theme controls and pressed state", () => {
    const markup = renderToStaticMarkup(
      createElement(ThemeProvider, {
        defaultTheme: "system",
        children: createElement(ThemeToggle),
      }),
    );

    expect(markup.match(/type="button"/g)).toHaveLength(3);
    expect(markup).toContain('aria-label="Use light theme"');
    expect(markup).toContain('aria-label="Use dark theme"');
    expect(markup).toContain('aria-label="Use system theme"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it("throws when theme context is used outside its provider", () => {
    function ThemeConsumer() {
      useTheme();
      return null;
    }

    expect(() => renderToStaticMarkup(createElement(ThemeConsumer))).toThrow(
      "useTheme must be used within a ThemeProvider",
    );
  });

  it("keeps collapsed app-shell navigation controls accessible", () => {
    const markup = renderToStaticMarkup(
      createElement(ThemeProvider, {
        children: createElement(AppShell, {
          navGroups: [
            {
              label: "Workspace",
              items: [{ id: "home", label: "Home", path: "/", icon: "H" }],
            },
          ],
          children: "Content",
        }),
      }),
    );

    expect(markup).toContain('aria-label="Main navigation"');
    expect(markup).toContain('aria-label="Home"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="Collapse sidebar"');
    expect(markup).toContain('aria-expanded="true"');
  });

  it("links input validation messages to invalid fields", () => {
    const markup = renderToStaticMarkup(
      createElement(Input, {
        label: "Email",
        error: "Enter a valid email address",
        "aria-describedby": "email-help",
      }),
    );

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toMatch(/id="([^"]+)"[^>]*aria-describedby="email-help \1-error"/);
    expect(markup).toContain("Enter a valid email address");
  });
});
