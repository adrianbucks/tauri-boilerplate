import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Badge,
  Alert,
  AlertTitle,
  AlertDescription,
} from "@platform/ui";
import {
  Plus,
  CheckCircle,
  Package,
  Barcode,
  Upload,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { WidgetService, type WidgetRecord } from "@features/example-feature";
import {
  ImportEngine,
  ExportEngine,
  type ImportDefinition,
  type ExportDefinition,
} from "@platform/import-export";
import {
  KeyboardWedgeScanner,
  type BarcodeScanResult,
} from "@platform/hardware";
import { MemoryDatabaseConnection } from "@platform/database";
import { createOperationContext } from "@platform/core";

const ctx = createOperationContext({
  deviceId: "demo_device",
  organisationId: "org_demo",
  userId: "user_demo",
});

const DEMO_SYNC_GROUP = "grp_demo";

const widgetExportDef: ExportDefinition<WidgetRecord> = {
  sheetName: "Widgets",
  columns: [
    { header: "SKU", accessor: (r) => r.sku },
    { header: "Name", accessor: (r) => r.name },
    { header: "Quantity", accessor: (r) => r.quantity },
    { header: "Description", accessor: (r) => r.description ?? "" },
  ],
};

function WidgetRow({
  widget,
  isHighlighted,
}: {
  widget: WidgetRecord;
  isHighlighted: boolean;
}) {
  const isDeleted = Boolean(widget.deletedAt);
  return (
    <div
      className={`flex items-start justify-between rounded-lg border px-4 py-3 transition-all duration-300 ${
        isHighlighted
          ? "border-primary bg-primary/10 ring-2 ring-primary"
          : "border-border bg-card"
      } ${isDeleted ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Package className="h-4 w-4" />
        </div>
        <div>
          <div className="font-medium text-sm">{widget.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            SKU:{" "}
            <code className="bg-muted px-1 rounded font-mono">
              {widget.sku}
            </code>
          </div>
          {widget.description && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {widget.description}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        <div className="text-right">
          <div className="text-sm font-semibold">{widget.quantity}</div>
          <div className="text-[10px] text-muted-foreground">qty</div>
        </div>
        <Badge variant={isDeleted ? "secondary" : "success"}>
          {isDeleted ? "DELETED" : "ACTIVE"}
        </Badge>
      </div>
    </div>
  );
}

export function WidgetsPage() {
  const [widgets, setWidgets] = useState<WidgetRecord[]>([]);
  const [service, setService] = useState<WidgetService | null>(null);
  const [dbConn, setDbConn] = useState<MemoryDatabaseConnection | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hardware scanner state
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(
    null,
  );
  const [highlightedSku, setHighlightedSku] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initService = useCallback(async () => {
    if (service) return;
    const db = new MemoryDatabaseConnection(":memory:");
    await db.init();
    await db.execute(`
      CREATE TABLE widgets (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        entity_id TEXT NOT NULL UNIQUE,
        organisation_id TEXT NOT NULL,
        sync_group_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        sync_version INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        deleted_by TEXT,
        delete_operation_id TEXT,
        data_classification TEXT DEFAULT 'INTERNAL',
        name TEXT NOT NULL,
        sku TEXT NOT NULL UNIQUE,
        quantity INTEGER NOT NULL DEFAULT 0,
        description TEXT
      );
      CREATE TABLE core_audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        user_id TEXT,
        device_id TEXT NOT NULL,
        organisation_id TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata_json TEXT
      );
    `);
    const svc = new WidgetService(db);
    setDbConn(db);
    setService(svc);
  }, [service]);

  useEffect(() => {
    initService();
  }, [initService]);

  const loadWidgets = useCallback(async () => {
    if (!service) return;
    const list = await service.listWidgets(DEMO_SYNC_GROUP);
    setWidgets(list);
  }, [service]);

  useEffect(() => {
    if (service) loadWidgets();
  }, [service, loadWidgets]);

  // Connect Keyboard Wedge Barcode Scanner
  useEffect(() => {
    const scanner = new KeyboardWedgeScanner({ maxInterKeyDelayMs: 40 });

    const handleKeyDown = (e: KeyboardEvent) => {
      scanner.handleKeyEvent(e.key, Date.now());
    };

    scanner.startListening((result: BarcodeScanResult) => {
      setLastScannedBarcode(result.text);
      setHighlightedSku(result.text);
      setSuccess(`Barcode Scanner detected SKU: "${result.text}"`);

      // Clear highlight after 4 seconds
      setTimeout(() => {
        setHighlightedSku(null);
      }, 4000);
    });

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      scanner.stopListening();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleCreate = useCallback(async () => {
    if (!service || !name.trim() || !sku.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const w = await service.createWidget(
        {
          name: name.trim(),
          sku: sku.trim().toUpperCase(),
          quantity: Math.max(0, parseInt(quantity, 10) || 0),
          syncGroupId: DEMO_SYNC_GROUP,
        },
        ctx,
      );
      setSuccess(`Created widget "${w.name}" (SKU: ${w.sku})`);
      setName("");
      setSku("");
      setQuantity("0");
      await loadWidgets();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [service, name, sku, quantity, loadWidgets]);

  // Bulk Import handler using @platform/import-export
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !dbConn || !service) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const buffer = await file.arrayBuffer();
      const importEngine = new ImportEngine(dbConn);

      const widgetImportDef: ImportDefinition<any> = {
        id: "import_widgets",
        entityName: "Widgets",
        acceptedFormats: ["csv", "xlsx"],
        columns: [
          { key: "sku", label: "SKU", type: "string", required: true },
          { key: "name", label: "Name", type: "string", required: true },
          {
            key: "quantity",
            label: "Quantity",
            type: "number",
            required: true,
          },
        ],
        validateRow: (rawRow, rowIndex) => {
          const rawSku = String(rawRow["sku"] ?? rawRow["SKU"] ?? "").trim();
          const rawName = String(rawRow["name"] ?? rawRow["Name"] ?? "").trim();
          const rawQty = parseInt(
            String(rawRow["quantity"] ?? rawRow["Quantity"] ?? "0"),
            10,
          );

          if (!rawSku) {
            return {
              valid: false,
              errors: [
                {
                  rowIndex,
                  columnKey: "sku",
                  message: "SKU is required",
                  invalidValue: rawSku,
                },
              ],
            };
          }
          if (!rawName) {
            return {
              valid: false,
              errors: [
                {
                  rowIndex,
                  columnKey: "name",
                  message: "Name is required",
                  invalidValue: rawName,
                },
              ],
            };
          }

          return {
            valid: true,
            data: {
              sku: rawSku.toUpperCase(),
              name: rawName,
              quantity: isNaN(rawQty) ? 0 : Math.max(0, rawQty),
              description: String(
                rawRow["description"] ?? rawRow["Description"] ?? "",
              ),
            },
          };
        },
        commit: async (records, dbConnection, opCtx) => {
          for (const item of records) {
            await service.createWidget(
              {
                sku: item.sku,
                name: item.name,
                quantity: item.quantity,
                description: item.description || undefined,
                syncGroupId: DEMO_SYNC_GROUP,
              },
              opCtx,
            );
          }
          return { importedCount: records.length };
        },
      };

      const summary = await importEngine.executeImport(
        buffer,
        widgetImportDef,
        ctx,
      );
      if (summary.errors.length > 0) {
        setError(
          `Import failed: ${summary.errors[0]?.message} (Row ${summary.errors[0]?.rowIndex})`,
        );
      } else {
        setSuccess(
          `Bulk imported ${summary.successfulRows} widgets successfully in ${summary.durationMs}ms`,
        );
        await loadWidgets();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Export handlers
  const handleExportCsv = () => {
    const csvContent = ExportEngine.toCsv(widgets, widgetExportDef);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `widgets_export_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportXlsx = () => {
    const xlsxBuffer = ExportEngine.toXlsx(widgets, widgetExportDef);
    const blob = new Blob([xlsxBuffer as Uint8Array<ArrayBuffer>], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `widgets_export_${Date.now()}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Widgets</h1>
          <p className="text-muted-foreground mt-1">
            Example domain feature — demonstrates SQLite repository, Bulk
            Import/Export, and Barcode Hardware scanning.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success" className="flex items-center gap-1">
            <Barcode className="h-3.5 w-3.5" />
            Scanner Active
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            <Upload className="h-4 w-4 mr-1" />
            Import (CSV/XLSX)
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".csv,.xlsx,.xls"
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={widgets.length === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportXlsx}
            disabled={widgets.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            Export XLSX
          </Button>
        </div>
      </div>

      {lastScannedBarcode && (
        <Alert variant="info">
          <Barcode className="h-4 w-4" />
          <AlertTitle>Hardware Barcode Listener</AlertTitle>
          <AlertDescription>
            Scanned SKU:{" "}
            <code className="font-mono font-bold bg-muted px-1.5 py-0.5 rounded">
              {lastScannedBarcode}
            </code>
          </AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert variant="success">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create Widget</CardTitle>
          <CardDescription>
            Add a new widget to SQLite store via{" "}
            <code>WidgetService.createWidget()</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 max-w-3xl">
            <div className="flex-[2] min-w-[160px]">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Titanium Sprocket"
                label="Widget Name *"
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <Input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="SKU-100"
                label="SKU *"
              />
            </div>
            <div className="w-24">
              <Input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                type="number"
                min="0"
                label="Qty"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleCreate}
                isLoading={loading}
                disabled={!service || !name.trim() || !sku.trim()}
              >
                <Plus className="h-4 w-4 mr-1" />
                Create
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Widget Inventory ({widgets.length})</CardTitle>
          <CardDescription>
            All widgets in sync group <code>{DEMO_SYNC_GROUP}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {widgets.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              No widgets yet — create one above or click "Import (CSV/XLSX)".
            </div>
          ) : (
            <div className="space-y-3">
              {widgets.map((w) => (
                <WidgetRow
                  key={w.id}
                  widget={w}
                  isHighlighted={highlightedSku === w.sku}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
