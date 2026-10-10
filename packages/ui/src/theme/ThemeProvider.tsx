import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Sun, Moon, Laptop } from "lucide-react";

export type Theme = "dark" | "light" | "system";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light" || value === "system";
}

function getInitialTheme(defaultTheme: Theme, storageKey: string): Theme {
  const fallback = isTheme(defaultTheme) ? defaultTheme : "system";
  if (typeof window === "undefined") return fallback;

  try {
    const storedTheme = window.localStorage.getItem(storageKey);
    return isTheme(storedTheme) ? storedTheme : fallback;
  } catch {
    return fallback;
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "platform-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme(defaultTheme, storageKey));

  const [isDark, setIsDark] = useState<boolean>(false);

  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery =
      theme === "system" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    const applyTheme = () => {
      const resolvedTheme = mediaQuery ? (mediaQuery.matches ? "dark" : "light") : theme;
      root.classList.remove("light", "dark");
      root.classList.add(resolvedTheme);
      setIsDark(resolvedTheme === "dark");
    };

    applyTheme();
    mediaQuery?.addEventListener("change", applyTheme);

    return () => mediaQuery?.removeEventListener("change", applyTheme);
  }, [theme]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      if (!isTheme(newTheme)) return;
      try {
        window.localStorage.setItem(storageKey, newTheme);
      } catch {
        // Theme state still applies when browser storage is unavailable.
      }
      setThemeState(newTheme);
    },
    [storageKey],
  );
  const value = useMemo(() => ({ theme, isDark, setTheme }), [theme, isDark, setTheme]);

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 text-card-foreground ${className ?? ""}`}
    >
      <button
        type="button"
        aria-label="Use light theme"
        aria-pressed={theme === "light"}
        onClick={() => setTheme("light")}
        className={`rounded-md p-1.5 transition-colors ${theme === "light" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
        title="Light Mode"
      >
        <Sun className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Use dark theme"
        aria-pressed={theme === "dark"}
        onClick={() => setTheme("dark")}
        className={`rounded-md p-1.5 transition-colors ${theme === "dark" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
        title="Dark Mode"
      >
        <Moon className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Use system theme"
        aria-pressed={theme === "system"}
        onClick={() => setTheme("system")}
        className={`rounded-md p-1.5 transition-colors ${theme === "system" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
        title="System Preference"
      >
        <Laptop className="h-4 w-4" />
      </button>
    </div>
  );
}
