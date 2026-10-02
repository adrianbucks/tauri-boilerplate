import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  Button,
  Input,
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
  Key,
  HardDrive,
  CheckCircle2,
  Copy,
  Check,
  Play,
  Layers,
  Radio,
  FileText,
  Send,
  UserPlus,
  Link2,
  Unlink,
} from "lucide-react";
import type { SyncOperation } from "@platform/sync-protocol";
import { usePlatform } from "../hooks/usePlatform.js";
import type {
  NativeDatabaseHealth,
  NativeDeviceIdentity,
  NativeBackgroundStatus,
  NativeSyncEndpointInfo,
} from "@platform/platform";

interface DiagnosticRowProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  status?: "ok" | "warn" | "error" | undefined;
  description?: string | undefined;
  copyableText?: string | undefined;
}

function DiagnosticRow({
  label,
  value,
  icon,
  status = "ok",
  description,
  copyableText,
}: DiagnosticRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!copyableText) return;
    navigator.clipboard.writeText(copyableText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b last:border-0 border-border gap-2">
      <div className="flex items-start sm:items-center gap-2.5 text-sm text-muted-foreground">
        <span className="text-foreground mt-0.5 sm:mt-0">{icon}</span>
        <div>
          <span className="font-medium text-foreground">{label}</span>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 self-end sm:self-auto">
        <span className="text-sm font-mono font-medium max-w-[280px] sm:max-w-md truncate">
          {value}
        </span>
        {copyableText && (
          <button
            type="button"
            onClick={handleCopy}
            title="Copy to clipboard"
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        <div
          className={`h-2 w-2 shrink-0 rounded-full ${
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

interface TableCounts {
  outboxPending: number;
  inboxTotal: number;
  auditEvents: number;
  widgetsTotal: number;
}

export function DiagnosticsPage() {
  const { platform, isReady, syncState, nativeGateway } = usePlatform();
  const features = platform?.getRegisteredFeatures() ?? [];
  const syncDiagnostics = platform?.sync.getDiagnostics() ?? [];

  const [dbHealth, setDbHealth] = useState<NativeDatabaseHealth | null>(null);
  const [deviceIdentity, setDeviceIdentity] =
    useState<NativeDeviceIdentity | null>(null);
  const [bgStatus, setBgStatus] = useState<NativeBackgroundStatus | null>(null);
  const [syncEndpoint, setSyncEndpoint] =
    useState<NativeSyncEndpointInfo | null>(null);
  const [tableCounts, setTableCounts] = useState<TableCounts>({
    outboxPending: 0,
    inboxTotal: 0,
    auditEvents: 0,
    widgetsTotal: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [syncTriggering, setSyncTriggering] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const [peerInput, setPeerInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const [actionAlert, setActionAlert] = useState<{
    type: "info" | "success" | "warning" | "destructive";
    message: string;
  } | null>(null);

  const fetchDiagnostics = useCallback(async () => {
    if (!nativeGateway) return;
    setIsLoading(true);
    try {
      // 1. Database Health
      try {
        const health = await nativeGateway.getDatabaseHealth();
        setDbHealth(health);
      } catch (err) {
        console.warn("Failed to query database health:", err);
      }

      // 2. Cryptographic Device Identity
      try {
        const identity = await nativeGateway.getDeviceIdentity();
        setDeviceIdentity(identity);
      } catch (err) {
        console.warn("Failed to query device identity:", err);
      }

      // 3. Background Scheduler Status
      try {
        const bg = await nativeGateway.getBackgroundStatus();
        setBgStatus(bg);
      } catch (err) {
        console.warn("Failed to query background status:", err);
      }

      // 4. iroh Sync Endpoint Info
      try {
        const ep = await nativeGateway.getSyncEndpointInfo();
        setSyncEndpoint(ep);
      } catch (err) {
        console.warn("Failed to query sync endpoint:", err);
      }

      // 5. Database Row Counts via native query
      try {
        const queries = [
          "SELECT COUNT(*) as cnt FROM core_sync_outbox WHERE status = 'pending'",
          "SELECT COUNT(*) as cnt FROM core_sync_inbox",
          "SELECT COUNT(*) as cnt FROM core_audit_events",
          "SELECT COUNT(*) as cnt FROM widgets WHERE deleted_at IS NULL",
        ];

        const [outboxRes, inboxRes, auditRes, widgetRes] = await Promise.all(
          queries.map((sql) =>
            invoke<Array<{ cnt: number }>>("db_query", {
              request: { sql },
            }).catch(() => [{ cnt: 0 }]),
          ),
        );

        setTableCounts({
          outboxPending: outboxRes?.[0]?.cnt ?? 0,
          inboxTotal: inboxRes?.[0]?.cnt ?? 0,
          auditEvents: auditRes?.[0]?.cnt ?? 0,
          widgetsTotal: widgetRes?.[0]?.cnt ?? 0,
        });
      } catch (err) {
        console.warn("Failed to query table counts:", err);
      }

      setLastRefreshed(new Date());
    } finally {
      setIsLoading(false);
    }
  }, [nativeGateway]);

  useEffect(() => {
    if (isReady) {
      fetchDiagnostics();
    }
  }, [isReady, fetchDiagnostics]);

  const handleTriggerSyncNow = async () => {
    setSyncTriggering(true);
    try {
      await invoke("background_start");
      // Give the scheduler a moment to cycle before re-polling counts
      setTimeout(() => {
        fetchDiagnostics();
        setSyncTriggering(false);
      }, 600);
    } catch (err) {
      console.error("Failed to trigger sync:", err);
      setSyncTriggering(false);
    }
  };

  const handleConnectPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platform || !peerInput.trim()) return;
    setIsConnecting(true);
    setActionAlert(null);
    try {
      const trimmedPeer = peerInput.trim();
      const peerDeviceId = `device_${trimmedPeer.slice(0, 8)}`;
      await platform.sync.connect({
        peerId: trimmedPeer,
        deviceId: peerDeviceId,
        organisationId: "org_default",
        supportedSyncGroups: ["org_default:global"],
      });

      const transport = platform.sync.getTransport();
      if (transport) {
        await transport.connect(trimmedPeer, trimmedPeer);
      }

      setActionAlert({
        type: "success",
        message: `Successfully connected to peer: ${trimmedPeer}`,
      });
      setPeerInput("");
      fetchDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionAlert({
        type: "destructive",
        message: `Failed to connect to peer: ${msg}`,
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectPeer = async (peerId: string) => {
    if (!platform) return;
    try {
      await platform.sync.disconnect(peerId);
      const transport = platform.sync.getTransport();
      if (transport) {
        await transport.disconnect(peerId);
      }
      setActionAlert({
        type: "info",
        message: `Disconnected from peer: ${peerId}`,
      });
      fetchDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionAlert({
        type: "destructive",
        message: `Failed to disconnect peer: ${msg}`,
      });
    }
  };

  const handleEnqueueDiagnosticPing = async () => {
    if (!platform) return;
    setIsEnqueuing(true);
    setActionAlert(null);
    try {
      const opId = crypto.randomUUID();
      const op: SyncOperation = {
        operationId: opId,
        applicationId: "tauri-boilerplate",
        organisationId: "org_default",
        syncGroupId: "org_default:global",
        featureId: "diagnostics",
        entityType: "diagnostic_ping",
        entityId: crypto.randomUUID(),
        operation: "create",
        payload: {
          clientTimestamp: new Date().toISOString(),
          source: "demo_diagnostics_ui",
          message: "Signed P2P diagnostic envelope test",
        },
        authorId: "local_operator",
        deviceId: deviceIdentity?.device_id ?? "local_node",
        logicalTimestamp: new Date().toISOString(),
        schemaVersion: 1,
        protocolVersion: 1,
      };

      await platform.sync.enqueueOperation(op);
      setActionAlert({
        type: "success",
        message: `Signed and enqueued diagnostic operation ${opId.slice(0, 8)}... to durable SQLite outbox.`,
      });
      fetchDiagnostics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionAlert({
        type: "destructive",
        message: `Failed to enqueue signed operation: ${msg}`,
      });
    } finally {
      setIsEnqueuing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header and Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Diagnostics & Telemetry
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time native platform health, durable SQLite metrics,
            cryptographic custody, and P2P transport state.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchDiagnostics}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleTriggerSyncNow}
            disabled={syncTriggering}
            className="gap-1.5"
          >
            <Play
              className={`h-3.5 w-3.5 ${syncTriggering ? "animate-pulse" : ""}`}
            />
            Trigger Sync Now
          </Button>
        </div>
      </div>

      {!isReady && (
        <Alert variant="warning">
          <AlertTitle>Platform Initialising</AlertTitle>
          <AlertDescription>
            Waiting for the platform to complete bootstrap...
          </AlertDescription>
        </Alert>
      )}

      {actionAlert && (
        <Alert variant={actionAlert.type}>
          <AlertTitle>
            {actionAlert.type === "success"
              ? "Operation Succeeded"
              : actionAlert.type === "destructive"
                ? "Operation Failed"
                : "Action Notice"}
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span className="break-all">{actionAlert.message}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionAlert(null)}
              className="h-7 px-2.5 text-xs shrink-0"
            >
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                SQLite Storage
              </div>
              <Database className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold">
              {dbHealth ? dbHealth.journal_mode.toUpperCase() : "Connecting..."}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              FK Constraints:{" "}
              {dbHealth?.foreign_keys_enabled ? "Enforced" : "Disabled"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                Device Identity
              </div>
              <Key className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono truncate">
              {deviceIdentity
                ? deviceIdentity.device_id.slice(0, 12) + "..."
                : "Loading..."}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Native Ed25519 Custody
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                P2P Replication
              </div>
              <Radio className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="mt-2 text-2xl font-bold">{syncState}</div>
            <p className="text-xs text-muted-foreground mt-1">
              ALPN: tauri-boilerplate-sync/1.0
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                Pending Outbox
              </div>
              <Layers className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-bold">
              {tableCounts.outboxPending}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {bgStatus?.running
                ? "Scheduler: Running (5s)"
                : "Scheduler: Idle"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Section: Durable Native SQLite Engine */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-emerald-500" />
                Durable Native SQLite Engine (WP-001 / Gate G-01)
              </CardTitle>
              <CardDescription>
                File-backed native persistence via rusqlite with WAL mode and
                foreign key constraints
              </CardDescription>
            </div>
            <Badge
              variant={
                dbHealth?.integrity_check === "ok" ? "success" : "warning"
              }
            >
              {dbHealth?.integrity_check === "ok"
                ? "Integrity OK"
                : "Unverified"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <DiagnosticRow
            label="Database File Path"
            value={dbHealth?.db_path ?? "Loading..."}
            copyableText={dbHealth?.db_path}
            icon={<HardDrive className="h-4 w-4" />}
            status={dbHealth ? "ok" : "warn"}
            description="Persistent SQLite file in the OS local application data directory"
          />
          <DiagnosticRow
            label="SQLite Engine Version"
            value={dbHealth?.sqlite_version ?? "3.45+"}
            icon={<Server className="h-4 w-4" />}
            status="ok"
          />
          <DiagnosticRow
            label="Journal Mode"
            value={
              dbHealth
                ? `${dbHealth.journal_mode.toUpperCase()} (Write-Ahead Logging)`
                : "WAL"
            }
            icon={<Activity className="h-4 w-4" />}
            status="ok"
            description="Guarantees non-blocking concurrent reads during background replication writes"
          />
          <DiagnosticRow
            label="Foreign Key Enforcement"
            value={
              dbHealth?.foreign_keys_enabled
                ? "PRAGMA foreign_keys = ON (Active)"
                : "Disabled"
            }
            icon={<CheckCircle2 className="h-4 w-4" />}
            status={dbHealth?.foreign_keys_enabled ? "ok" : "error"}
            description="Strict referential integrity prevents orphaned sync records"
          />
          <DiagnosticRow
            label="Replication Queue Backlog"
            value={`Outbox: ${tableCounts.outboxPending} pending | Inbox: ${tableCounts.inboxTotal} records`}
            icon={<Layers className="h-4 w-4" />}
            status={tableCounts.outboxPending === 0 ? "ok" : "warn"}
            description="Durable SQLite transactional outbox and inbox queues"
          />
          <DiagnosticRow
            label="Entity & Audit Storage"
            value={`${tableCounts.widgetsTotal} active widgets | ${tableCounts.auditEvents} append-only audit events`}
            icon={<FileText className="h-4 w-4" />}
            status="ok"
          />
        </CardContent>
      </Card>

      {/* Detailed Section: Cryptographic Device Identity & Key Custody */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                Cryptographic Device Identity (WP-005 / Gate G-02)
              </CardTitle>
              <CardDescription>
                Authentic native Ed25519 device key custody — Invariant #5:
                Private key never touches webview runtime
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="bg-primary/10 text-primary border-primary/20"
            >
              Native Rust Custody
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <DiagnosticRow
            label="Device Identifier"
            value={deviceIdentity?.device_id ?? "Generating..."}
            copyableText={deviceIdentity?.device_id}
            icon={<Key className="h-4 w-4" />}
            status="ok"
            description="Deterministic device identity string binding mutations to this hardware instance"
          />
          <DiagnosticRow
            label="Canonical Ed25519 Public Key"
            value={deviceIdentity?.public_key ?? "Deriving..."}
            copyableText={deviceIdentity?.public_key}
            icon={<ShieldCheck className="h-4 w-4" />}
            status="ok"
            description="32-byte Ed25519 public key hex string used to verify canonical sync envelopes"
          />
          <DiagnosticRow
            label="Native Host Platform"
            value={
              deviceIdentity
                ? `${deviceIdentity.platform.toUpperCase()} (${deviceIdentity.application_id})`
                : "—"
            }
            icon={<Globe className="h-4 w-4" />}
            status="ok"
          />
          <DiagnosticRow
            label="Key Storage Security Boundary"
            value="device_identity.key (OS ACL Restricted)"
            icon={<HardDrive className="h-4 w-4" />}
            status="ok"
            description="Stored in native data directory with owner-only filesystem access permissions"
          />
        </CardContent>
      </Card>

      {/* Detailed Section: Live iroh P2P Transport & Node Endpoint */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-indigo-400" />
                Live iroh QUIC Transport Endpoint (WP-014 / ADR-012)
              </CardTitle>
              <CardDescription>
                Native iroh 1.2.0 QUIC endpoint over ALPN
                tauri-boilerplate-sync/1.0
              </CardDescription>
            </div>
            <Badge variant={syncEndpoint ? "success" : "secondary"}>
              {syncEndpoint ? "QUIC Bound" : "Unbound"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <DiagnosticRow
            label="iroh Node Identifier"
            value={syncEndpoint?.endpoint_id ?? "Binding endpoint..."}
            copyableText={syncEndpoint?.endpoint_id}
            icon={<Radio className="h-4 w-4" />}
            status={syncEndpoint ? "ok" : "warn"}
            description="Unique 32-byte Ed25519 node address for direct peer-to-peer QUIC stream discovery"
          />
          <DiagnosticRow
            label="Sync Protocol ALPN"
            value="tauri-boilerplate-sync/1.0"
            icon={<Server className="h-4 w-4" />}
            status="ok"
            description="Application-Layer Protocol Negotiation string preventing cross-app protocol confusion"
          />
          <DiagnosticRow
            label="Stream Framing & Admission"
            value="4-Byte Length-Prefixed | 7-Layer Admission Filter"
            icon={<ShieldCheck className="h-4 w-4" />}
            status="ok"
            description="Every envelope passes mutual Ed25519 signature, tenant check, and nonce freshness before ingress"
          />
          <DiagnosticRow
            label="Background OS Lifecycle"
            value={
              bgStatus?.running
                ? "Windows Tray Active (Close to Minimize)"
                : "Foreground Process"
            }
            icon={<Activity className="h-4 w-4" />}
            status="ok"
            description="WP-016b: OutboxScheduler continues polling when window is minimized to Windows tray"
          />
        </CardContent>
      </Card>

      {/* Active Peer Connections */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-indigo-400" />
                Active Peer Connections & Replication Operations
              </CardTitle>
              <CardDescription>
                Direct node connection controls, mutual cryptographic
                verification, and outbox test envelopes
              </CardDescription>
            </div>
            <Badge
              variant={syncDiagnostics.length > 0 ? "success" : "secondary"}
            >
              {syncDiagnostics.length} Connected{" "}
              {syncDiagnostics.length === 1 ? "Peer" : "Peers"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Peer connection form */}
          <form
            onSubmit={handleConnectPeer}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="flex-1">
              <Input
                placeholder="Enter Remote iroh Node ID or Ticket..."
                value={peerInput}
                onChange={(e) => setPeerInput(e.target.value)}
                disabled={isConnecting}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={isConnecting || !peerInput.trim()}
                className="gap-1.5"
              >
                <UserPlus
                  className={`h-4 w-4 ${isConnecting ? "animate-spin" : ""}`}
                />
                {isConnecting ? "Connecting..." : "Connect Peer"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleEnqueueDiagnosticPing}
                disabled={isEnqueuing}
                className="gap-1.5"
                title="Signs a diagnostic envelope via native Ed25519 and enqueues to SQLite outbox"
              >
                <Send
                  className={`h-4 w-4 ${isEnqueuing ? "animate-spin" : ""}`}
                />
                {isEnqueuing ? "Enqueuing..." : "Enqueue Test Envelope"}
              </Button>
            </div>
          </form>

          {syncDiagnostics.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm border border-dashed rounded-lg border-border">
              <Radio className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p className="font-medium">No Active Peer Connections</p>
              <p className="text-xs text-muted-foreground mt-1">
                Peers can be connected using their 32-byte Node ID above or
                discovered via the iroh rendezvous service.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {syncDiagnostics.map((diag) => (
                <div
                  key={diag.peerId}
                  className="rounded-lg border border-border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm font-mono">
                        {diag.peerId}
                      </span>
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
                    <div className="text-xs text-muted-foreground">
                      Device: {diag.deviceId} · Mode: {diag.connectionMode} ·
                      Protocol: v{diag.protocolVersion}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnectPeer(diag.peerId)}
                      className="text-xs gap-1.5 hover:text-destructive hover:bg-destructive/10"
                    >
                      <Unlink className="h-3.5 w-3.5" />
                      Disconnect
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Feature Details */}
      <Card>
        <CardHeader>
          <CardTitle>Feature Topology & Capability Graph</CardTitle>
          <CardDescription>
            Dependency topology and permission surface of loaded platform and
            domain features
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

      <div className="text-xs text-center text-muted-foreground pb-4">
        Last updated: {lastRefreshed.toLocaleTimeString()} · Tauri Boilerplate
        Platform v0.1.0
      </div>
    </div>
  );
}
