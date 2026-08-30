import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@platform/ui";
import {
  Activity,
  Database,
  ShieldCheck,
  Users,
  Cpu,
  RefreshCw,
} from "lucide-react";
import { usePlatform } from "../hooks/usePlatform.js";

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  badgeText: string;
  badgeVariant: "success" | "info" | "warning" | "default";
}

function StatCard({
  title,
  value,
  description,
  icon,
  badgeText,
  badgeVariant,
}: StatCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription>{title}</CardDescription>
          <div className="text-muted-foreground">{icon}</div>
        </div>
        <CardTitle className="text-3xl font-bold">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{description}</span>
          <Badge variant={badgeVariant}>{badgeText}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { platform, isReady, syncState } = usePlatform();

  const features = platform?.getRegisteredFeatures() ?? [];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Platform Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Local-first boilerplate — all subsystems status and runtime overview.
        </p>
      </div>

      {/* Platform Ready Alert */}
      {isReady && (
        <Alert variant="success">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Platform Initialised Successfully</AlertTitle>
          <AlertDescription>
            All {features.length} features registered, migrations applied, and
            subsystems online.
          </AlertDescription>
        </Alert>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Registered Features"
          value={String(features.length)}
          description="Features loaded via the feature registry"
          icon={<Cpu className="h-5 w-5" />}
          badgeText="Healthy"
          badgeVariant="success"
        />
        <StatCard
          title="P2P Sync State"
          value={syncState}
          description="iroh-based peer-to-peer transport status"
          icon={<RefreshCw className="h-5 w-5" />}
          badgeText={syncState === "IDLE" ? "Ready" : "Active"}
          badgeVariant={syncState === "ERROR" ? "warning" : "info"}
        />
        <StatCard
          title="Database"
          value="SQLite"
          description="In-memory (demo) — Tauri uses native SQLite"
          icon={<Database className="h-5 w-5" />}
          badgeText="Online"
          badgeVariant="success"
        />
        <StatCard
          title="Authorization"
          value="RBAC"
          description="Role-based access with 7-layer auth pipeline"
          icon={<ShieldCheck className="h-5 w-5" />}
          badgeText="Active"
          badgeVariant="success"
        />
        <StatCard
          title="Audit Log"
          value="Enabled"
          description="Append-only tamper-evident event log"
          icon={<Activity className="h-5 w-5" />}
          badgeText="Recording"
          badgeVariant="info"
        />
        <StatCard
          title="Device Identity"
          value="Ed25519"
          description="Cryptographic device identity with key pairs"
          icon={<Users className="h-5 w-5" />}
          badgeText="Secure"
          badgeVariant="success"
        />
      </div>

      {/* Registered Features List */}
      <Card>
        <CardHeader>
          <CardTitle>Registered Features</CardTitle>
          <CardDescription>
            All features loaded by the platform in topological dependency order
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {features.map((feature) => (
              <div
                key={feature.id}
                className="flex items-start justify-between rounded-lg border border-border p-3"
              >
                <div>
                  <div className="font-medium text-sm">{feature.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {feature.description}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {feature.permissions.map((p) => (
                      <Badge
                        key={p.name}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {p.name}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0 ml-4">
                  <Badge variant="success">v{feature.version}</Badge>
                  {feature.dependencies.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      deps: {feature.dependencies.join(", ")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
