"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuditExport } from "@/hooks/use-audit";
import { cn } from "@/lib/utils";
import { useAdminT } from "../../_lib/admin-i18n";

const EXPORT_COLUMN_IDS = [
  "created_at",
  "user_email",
  "action",
  "resource_type",
  "resource_id",
  "severity",
  "ip_address",
  "user_agent",
  "service",
  "correlation_id",
] as const;

export function AuditExportForm() {
  const labels = useAdminT();
  const EXPORT_COLUMNS: Array<{ id: string; label: string }> = [
    { id: "created_at", label: labels.audit.colTimestampExp },
    { id: "user_email", label: labels.audit.colUserEmail },
    { id: "action", label: labels.audit.colAction },
    { id: "resource_type", label: labels.audit.colResourceType },
    { id: "resource_id", label: labels.audit.colResourceId },
    { id: "severity", label: labels.audit.colSeverity },
    { id: "ip_address", label: labels.audit.colIpAddress },
    { id: "user_agent", label: labels.audit.colUserAgent },
    { id: "service", label: labels.audit.colService },
    { id: "correlation_id", label: labels.audit.colCorrelationId },
  ];
  const SERVICE_OPTIONS = [
    { value: "iam-service", label: labels.audit.svcIam },
    { value: "cyber-service", label: labels.audit.svcCyber },
    { value: "data-service", label: labels.audit.svcData },
    { value: "file-service", label: labels.audit.svcFile },
    { value: "notification-service", label: labels.audit.svcNotification },
    { value: "audit-service", label: labels.audit.svcAudit },
  ];
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const [exportFormat, setExportFormat] = useState<"csv" | "ndjson">("csv");
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [selectedService, setSelectedService] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    () => new Set(EXPORT_COLUMN_IDS)
  );

  const exportMutation = useAuditExport();

  const toggleColumn = (columnId: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      return next;
    });
  };

  const handleExport = () => {
    exportMutation.mutate({
      format: exportFormat,
      date_from: new Date(dateFrom).toISOString(),
      date_to: new Date(dateTo + "T23:59:59").toISOString(),
      service: selectedService || undefined,
      columns: Array.from(selectedColumns),
    });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            {labels.audit.exportConfiguration}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>{labels.audit.format}</Label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setExportFormat("csv")}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors",
                  exportFormat === "csv"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted/50"
                )}
              >
                <FileSpreadsheet className="h-4 w-4" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => setExportFormat("ndjson")}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors",
                  exportFormat === "ndjson"
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted/50"
                )}
              >
                <FileJson className="h-4 w-4" />
                NDJSON
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="export-date-from">{labels.audit.from}</Label>
              <Input
                id="export-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                max={dateTo}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="export-date-to">{labels.audit.to}</Label>
              <Input
                id="export-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                min={dateFrom}
                max={today}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="export-service">{labels.audit.serviceOptional}</Label>
            <select
              id="export-service"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={selectedService}
              onChange={(e) => setSelectedService(e.target.value)}
            >
              <option value="">{labels.audit.allServices}</option>
              {SERVICE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <Label>{labels.audit.columns}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EXPORT_COLUMNS.map((col) => (
                <label
                  key={col.id}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={selectedColumns.has(col.id)}
                    onCheckedChange={() => toggleColumn(col.id)}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>

          <Button
            onClick={handleExport}
            disabled={exportMutation.isPending || selectedColumns.size === 0}
            className="w-full"
          >
            <Download className="me-2 h-4 w-4" />
            {exportMutation.isPending ? labels.audit.exporting : labels.audit.exportButton}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
