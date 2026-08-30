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
  RefreshCw,
  Cpu,
  Clock,
  Server,
  Globe,
} from "lucide-react";
import { usePlatform } from "../hooks/usePlatform.js";

interface DiagnosticRowProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  status?: "ok" | "warn" | "error";
}

function DiagnosticRow({
  label,
  value,
  icon,
  status = "ok",
}: DiagnosticRowProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0 border-border">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <span className="text-foreground">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-medium">{value}</span>
        <div
          className={`h-2 w-2 rounded-full ${
            status === "ok"
              ? "bg-emerald-500"
              : status === "warn"
                ? "bg-amber-500"
                : "bg-red-500"
          }`}
        />
      </div>
    </div>
  );
}

export function DiagnosticsPage() {
  const { platform, isReady, syncState } = usePlatform();
  const features = platform?.getRegisteredFeatures() ?? [];
  const syncDiagnostics = platform?.sync.getDiagnostics() ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Diagnostics</h1>
        <p className="text-muted-foreground mt-1">
          Real-time platform health, subsystem status, and sync diagnostic
          records.
        </p>
      </div>

      {!isReady && (
        <Alert variant="warning">
          <AlertTitle>Platform Initialising</AlertTitle>
          <AlertDescription>
            Waiting for the platform to complete bootstrap...
          </AlertDescription>
        </Alert>
      )}

      {/* Platform Subsystems */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Subsystems</CardTitle>
          <CardDescription>
            Runtime status of all core platform services
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DiagnosticRow
            label="Database Engine"
            value="SQLite / sql.js (demo)"
            icon={<Database className="h-4 w-4" />}
            status="ok"
          />
          <DiagnosticRow
            label="Feature Registry"
            value={`${features.length} features loaded`}
            icon={<Cpu className="h-4 w-4" />}
            status="ok"
          />
          <DiagnosticRow
            label="Authorization Engine"
            value="RBAC with scope evaluation"
            icon={<ShieldCheck className="h-4 w-4" />}
            status="ok"
          />
          <DiagnosticRow
            label="P2P Sync (iroh)"
            value={syncState}
            icon={<RefreshCw className="h-4 w-4" />}
            status={
              syncState === "ERROR"
                ? "error"
                : syncState === "DISCONNECTED"
                  ? "warn"
                  : "ok"
            }
          />
          <DiagnosticRow
            label="Audit Service"
            value="Append-only log active"
            icon={<Activity className="h-4 w-4" />}
            status="ok"
          />
          <DiagnosticRow
            label="HLC (Hybrid Logical Clock)"
            value="Monotonic timestamps active"
            icon={<Clock className="h-4 w-4" />}
            status="ok"
          />
          <DiagnosticRow
            label="Platform Version"
            value={platform?.config.applicationVersion ?? "—"}
            icon={<Server className="h-4 w-4" />}
            status="ok"
          />
          <DiagnosticRow
            label="Environment"
            value={platform?.config.environment ?? "—"}
            icon={<Globe className="h-4 w-4" />}
            status="ok"
          />
        </CardContent>
      </Card>

      {/* Sync Diagnostic Records */}
      <Card>
        <CardHeader>
          <CardTitle>Active Peer Connections</CardTitle>
          <CardDescription>
            Real-time P2P sync diagnostic records for connected peers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {syncDiagnostics.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              No peer connections — in a Tauri app, peers are discovered via
              iroh rendezvous or local network.
            </div>
          ) : (
            <div className="space-y-2">
              {syncDiagnostics.map((diag) => (
                <div
                  key={diag.peerId}
                  className="rounded-lg border border-border p-4 flex items-start justify-between"
                >
                  <div>
                    <div className="font-medium text-sm">{diag.peerId}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Device: {diag.deviceId} · Mode: {diag.connectionMode}
                    </div>
                  </div>
                  <Badge
                    variant={
                      diag.state === "IDLE"
                        ? "success"
                        : diag.state === "SYNCING"
                          ? "info"
                          : "warning"
                    }
                  >
                    {diag.state}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Feature Details */}
      <Card>
        <CardHeader>
          <CardTitle>Feature Graph</CardTitle>
          <CardDescription>
            Dependency topology and permission surface of loaded features
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {features.map((f, i) => (
              <div key={f.id} className="flex items-center gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{f.id}</span>
                    {f.dependencies.map((dep) => (
                      <span
                        key={dep}
                        className="text-[10px] text-muted-foreground"
                      >
                        ← {dep}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {f.permissions.map((p) => (
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
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
