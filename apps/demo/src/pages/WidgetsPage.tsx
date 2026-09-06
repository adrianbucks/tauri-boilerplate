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
import type { WidgetRecord } from "@features/example-feature";
import {
  ExportEngine,
  type ImportDefinition,
  type ExportDefinition,
} from "@platform/import-export";
import {
  KeyboardWedgeScanner,
  type BarcodeScanResult,
} from "@platform/hardware";
import { createOperationContext } from "@platform/core";
import { usePlatform } from "../hooks/usePlatform.js";

const DEMO_SYNC_GROUP = "grp_demo";

interface WidgetImportRecord {
  sku: string;
  name: string;
  quantity: number;
  description: string;
}

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
  const { importEngine, nativeGateway, nativeSession } = usePlatform();
  const [widgets, setWidgets] = useState<WidgetRecord[]>([]);
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

  const loadWidgets = useCallback(async () => {
    if (nativeGateway && nativeSession) {
      const nativeWidgets = await nativeGateway.listWidgets(
        nativeSession.organisation_id,
      );
      setWidgets(
        nativeWidgets.map((widget) => ({
          id: widget.id,
          createdAt: "",
          updatedAt: "",
          createdBy: null,
          updatedBy: null,
          entityId: "",
          organisationId: widget.organisation_id,
          syncGroupId: DEMO_SYNC_GROUP,
          schemaVersion: 1,
          syncVersion: 0,
          deletedAt: widget.deleted_at,
          deletedBy: null,
          deleteOperationId: null,
          dataClassification: "INTERNAL",
          name: widget.name,
          sku: widget.sku,
          quantity: widget.quantity,
          description: null,
        })),
      );
      return;
    }
  }, [nativeGateway, nativeSession]);

  useEffect(() => {
    if (nativeGateway && nativeSession) {
      loadWidgets().catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    }
  }, [nativeGateway, nativeSession, loadWidgets]);

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
    if (!nativeGateway || !nativeSession || !name.trim() || !sku.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const w = await nativeGateway.createWidget({
        organisation_id: nativeSession.organisation_id,
        sync_group_id: DEMO_SYNC_GROUP,
        name: name.trim(),
        sku: sku.trim().toUpperCase(),
        quantity: Math.max(0, parseInt(quantity, 10) || 0),
        correlation_id: createOperationContext({
          deviceId: "native",
          organisationId: nativeSession.organisation_id,
          userId: nativeSession.user_id,
        }).correlationId,
      });
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
  }, [nativeGateway, nativeSession, name, sku, quantity, loadWidgets]);

  // Bulk Import handler using @platform/import-export
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !importEngine || !nativeGateway || !nativeSession) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const buffer = await file.arrayBuffer();
      const widgetImportDef: Pick<
        ImportDefinition<WidgetImportRecord>,
        "validateRow"
      > = {
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
      };

      const validation = importEngine.validateBuffer(buffer, widgetImportDef);
      if (validation.errors.length > 0) {
        setError(
          `Import failed: ${validation.errors[0]?.message} (Row ${validation.errors[0]?.rowIndex})`,
        );
      } else {
        const importStartedAt = Date.now();
        await nativeGateway.createWidgets({
          organisation_id: nativeSession.organisation_id,
          sync_group_id: DEMO_SYNC_GROUP,
          correlation_id: createOperationContext({
            deviceId: "native",
            organisationId: nativeSession.organisation_id,
            userId: nativeSession.user_id,
          }).correlationId,
          widgets: validation.validRows,
        });
        setSuccess(
          `Bulk imported ${validation.validRows.length} widgets successfully in ${Date.now() - importStartedAt}ms`,
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
            Add a widget to the authenticated native database.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 max-w-3xl">
            <div className="flex-2 min-w-40">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Titanium Sprocket"
                label="Widget Name *"
              />
            </div>
            <div className="flex-1 min-w-30">
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
                disabled={
                  !nativeGateway ||
                  !nativeSession ||
                  !name.trim() ||
                  !sku.trim()
                }
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
