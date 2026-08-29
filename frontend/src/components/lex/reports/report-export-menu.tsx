"use client";

import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ReportExportKind = "csv" | "xlsx" | null;

export interface ReportExportMenuProps {
  onCsv?: () => void | Promise<void>;
  onXlsx?: () => void | Promise<void>;
  onPdf?: () => void | Promise<void>;
  exporting?: ReportExportKind;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export function ReportExportMenu({
  onCsv,
  onXlsx,
  onPdf,
  exporting = null,
  disabled = false,
  className,
  label,
}: ReportExportMenuProps) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const busy = exporting !== null;
  const runPdf = onPdf ?? (() => window.print());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={className}
          disabled={disabled || busy}
          data-report-no-print="true"
        >
          <Download className="me-2 h-4 w-4" aria-hidden />
          {busy
            ? ar
              ? "جارٍ التصدير…"
              : "Exporting…"
            : label ?? (ar ? "تصدير" : "Export")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => void runPdf()}>
          <Printer className="me-2 h-4 w-4" aria-hidden />
          {ar ? "PDF (عرضي)" : "PDF (landscape)"}
        </DropdownMenuItem>
        {onXlsx ? (
          <DropdownMenuItem onSelect={() => void onXlsx()}>
            <FileSpreadsheet className="me-2 h-4 w-4" aria-hidden />
            {ar ? "Excel (.xlsx)" : "Excel (.xlsx)"}
          </DropdownMenuItem>
        ) : null}
        {onCsv ? (
          <DropdownMenuItem onSelect={() => void onCsv()}>
            <FileText className="me-2 h-4 w-4" aria-hidden />
            {ar ? "CSV (.csv)" : "CSV (.csv)"}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
