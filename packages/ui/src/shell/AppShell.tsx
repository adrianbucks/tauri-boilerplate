import React, { useState } from "react";
import {
  PanelLeftClose,
  PanelLeft,
  Activity,
  ShieldCheck,
  User,
} from "lucide-react";
import { ThemeToggle } from "../theme/ThemeProvider.js";
import { Badge } from "../components/badge.js";
import { Button } from "../components/button.js";
import { cn } from "../lib/utils.js";

export type AppSyncState =
  | "IDLE"
  | "SYNCING"
  | "CONNECTING"
  | "CONNECTED"
  | "AUTHENTICATING"
  | "AUTHORISED"
  | "DISCOVERED"
  | "IDENTIFIED"
  | "DISCONNECTED"
  | "REVOKED"
  | "EXPIRED"
  | "INCOMPATIBLE"
  | "ERROR";

export interface AppShellNavGroup {
  label: string;
  items: {
    id: string;
    label: string;
    path: string;
    icon?: React.ReactNode | undefined;
    badge?: string | undefined;
    active?: boolean | undefined;
  }[];
}

export interface AppShellProps {
  appName?: string;
  version?: string;
  navGroups: AppShellNavGroup[];
  currentPath?: string;
  onNavigate?: (path: string) => void;
  syncState?: AppSyncState | undefined;
  userDisplayName?: string;
  organisationName?: string;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  appName = "Tauri Local-First App",
  version = "0.1.0",
  navGroups,
  currentPath = "/",
  onNavigate,
  syncState = "IDLE",
  userDisplayName = "Local User",
  organisationName = "Primary Organisation",
  children,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const getSyncBadge = () => {
    switch (syncState) {
      case "IDLE":
      case "AUTHORISED":
        return <Badge variant="success">P2P Idle</Badge>;
      case "SYNCING":
        return <Badge variant="info">Syncing...</Badge>;
      case "CONNECTING":
      case "CONNECTED":
      case "AUTHENTICATING":
      case "DISCOVERED":
      case "IDENTIFIED":
        return <Badge variant="warning">Connecting</Badge>;
      case "ERROR":
        return <Badge variant="destructive">Sync Error</Badge>;
      case "REVOKED":
      case "EXPIRED":
      case "INCOMPATIBLE":
      case "DISCONNECTED":
      default:
        return <Badge variant="outline">Offline</Badge>;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col justify-between border-r border-border bg-card transition-all duration-200 ease-in-out",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div>
          {/* Header */}
          <div className="flex h-14 items-center justify-between border-b border-border px-3.5">
            {!collapsed && (
              <div className="flex flex-col">
                <span className="font-bold text-sm text-primary tracking-tight">
                  {appName}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  v{version}
                </span>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              {collapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Nav Groups */}
          <nav className="space-y-4 p-2">
            {navGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                {!collapsed && (
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </div>
                )}
                {group.items.map((item) => {
                  const isSelected = item.active ?? currentPath === item.path;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onNavigate && onNavigate(item.path)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                        isSelected
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <div className="flex items-center gap-2.5">
                        {item.icon ? (
                          <span>{item.icon}</span>
                        ) : (
                          <Activity className="h-4 w-4 shrink-0" />
                        )}
                        {!collapsed && <span>{item.label}</span>}
                      </div>
                      {!collapsed && item.badge && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Footer */}
        <div className="border-t border-border p-3 space-y-2 bg-card">
          {!collapsed && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">
                  {organisationName}
                </span>
              </div>
              {getSyncBadge()}
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            {!collapsed && (
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground text-xs font-bold">
                  <User className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-medium truncate max-w-[110px]">
                  {userDisplayName}
                </span>
              </div>
            )}
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-y-auto bg-background">
        <div className="p-6 md:p-8 max-w-7xl mx-auto w-full">{children}</div>
      </main>
    </div>
  );
};
