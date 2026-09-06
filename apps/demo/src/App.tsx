import React, { useState } from "react";
import { AppShell, ThemeProvider } from "@platform/ui";
import {
  LayoutDashboard,
  Box,
  Building2,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { PlatformProvider, usePlatform } from "./hooks/usePlatform.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { WidgetsPage } from "./pages/WidgetsPage.js";
import { OrganisationsPage } from "./pages/OrganisationsPage.js";
import { AdminPage } from "./pages/AdminPage.js";
import { DiagnosticsPage } from "./pages/DiagnosticsPage.js";
import { LoginPage } from "./pages/LoginPage.js";

type Route =
  "/dashboard" | "/widgets" | "/organisations" | "/admin" | "/diagnostics";

function AppContent() {
  const [route, setRoute] = useState<Route>("/dashboard");
  const { syncState, isReady, nativeSession } = usePlatform();

  if (!nativeSession) {
    return <LoginPage />;
  }

  const navGroups = [
    {
      label: "Overview",
      items: [
        {
          id: "nav-dashboard",
          label: "Dashboard",
          path: "/dashboard",
          icon: <LayoutDashboard className="h-4 w-4" />,
          active: route === "/dashboard",
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
          active: route === "/widgets",
          badge: "Example",
        },
        {
          id: "nav-orgs",
          label: "Organisations",
          path: "/organisations",
          icon: <Building2 className="h-4 w-4" />,
          active: route === "/organisations",
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
          active: route === "/admin",
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

  const renderPage = () => {
    switch (route) {
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
      navGroups={navGroups}
      currentPath={route}
      onNavigate={(path) => setRoute(path as Route)}
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
