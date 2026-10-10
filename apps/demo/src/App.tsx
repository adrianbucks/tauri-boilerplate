import React, { useState } from "react";
import { AppShell, ThemeProvider } from "@platform/ui";
import { LayoutDashboard, Box, Building2, ShieldCheck, Activity } from "lucide-react";
import { PlatformProvider, usePlatform } from "./hooks/usePlatform.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { WidgetsPage } from "./pages/WidgetsPage.js";
import { OrganisationsPage } from "./pages/OrganisationsPage.js";
import { AdminPage } from "./pages/AdminPage.js";
import { DiagnosticsPage } from "./pages/DiagnosticsPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { WIDGET_PERMISSIONS } from "@features/example-feature";
import { ORGANISATION_PERMISSIONS } from "@features/organisations";
import { IDENTITY_ADMIN_PERMISSIONS } from "@features/identity-admin";

type Route = "/dashboard" | "/widgets" | "/organisations" | "/admin" | "/diagnostics";

function AppContent() {
  const [route, setRoute] = useState<Route>("/dashboard");
  const { syncState, isReady, nativeSession, logout } = usePlatform();

  if (!nativeSession) {
    return <LoginPage />;
  }

  const sessionPermissions = new Set(nativeSession.permissions);
  const canAccess = (requiredPermissions: readonly string[]) =>
    requiredPermissions.some((permission) => sessionPermissions.has(permission));
  const routePermissions: Partial<Record<Route, readonly string[]>> = {
    "/widgets": [WIDGET_PERMISSIONS.READ],
    "/organisations": [ORGANISATION_PERMISSIONS.MANAGE],
    "/admin": [
      IDENTITY_ADMIN_PERMISSIONS.USERS_READ,
      IDENTITY_ADMIN_PERMISSIONS.DEVICES_READ,
      IDENTITY_ADMIN_PERMISSIONS.SYNC_MANAGE,
    ],
  };
  const visibleRoute =
    routePermissions[route] && !canAccess(routePermissions[route]) ? "/dashboard" : route;

  const navGroups = [
    {
      label: "Overview",
      items: [
        {
          id: "nav-dashboard",
          label: "Dashboard",
          path: "/dashboard",
          icon: <LayoutDashboard className="h-4 w-4" />,
          active: visibleRoute === "/dashboard",
        },
      ],
    },
    {
      label: "Features",
      items: [
        {
          id: "nav-widgets",
          label: "Widgets",
          path: "/widgets",
          icon: <Box className="h-4 w-4" />,
          active: visibleRoute === "/widgets",
          badge: "Example",
          requiredPermissions: routePermissions["/widgets"],
        },
        {
          id: "nav-orgs",
          label: "Organisations",
          path: "/organisations",
          icon: <Building2 className="h-4 w-4" />,
          active: visibleRoute === "/organisations",
          requiredPermissions: routePermissions["/organisations"],
        },
      ],
    },
    {
      label: "Administration",
      items: [
        {
          id: "nav-admin",
          label: "Identity & Access",
          path: "/admin",
          icon: <ShieldCheck className="h-4 w-4" />,
          active: visibleRoute === "/admin",
          requiredPermissions: routePermissions["/admin"],
        },
        {
          id: "nav-diagnostics",
          label: "Diagnostics",
          path: "/diagnostics",
          icon: <Activity className="h-4 w-4" />,
          active: route === "/diagnostics",
        },
      ],
    },
  ];

  const visibleNavGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.requiredPermissions || canAccess(item.requiredPermissions),
      ),
    }))
    .filter((group) => group.items.length > 0);

  const renderPage = () => {
    switch (visibleRoute) {
      case "/dashboard":
        return <DashboardPage />;
      case "/widgets":
        return <WidgetsPage />;
      case "/organisations":
        return <OrganisationsPage />;
      case "/admin":
        return <AdminPage />;
      case "/diagnostics":
        return <DiagnosticsPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <AppShell
      appName="Platform Boilerplate Demo"
      version="0.1.0"
      navGroups={visibleNavGroups}
      currentPath={visibleRoute}
      onNavigate={(path) => setRoute(path as Route)}
      onLogout={logout}
      syncState={isReady ? syncState : "DISCONNECTED"}
      userDisplayName={nativeSession.user_id}
      organisationName={nativeSession.organisation_id}
    >
      {renderPage()}
    </AppShell>
  );
}

export function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <PlatformProvider>
        <AppContent />
      </PlatformProvider>
    </ThemeProvider>
  );
}
