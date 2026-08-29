"use client";
import { useState } from "react";
import { Download, Rows2, Rows3, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Column } from "@tanstack/react-table";
import { DataTableFilter } from "./data-table-filter";
import { DataTableActiveFilters } from "./data-table-active-filters";
import { getColumnLabel } from "./column-meta";
import { useT } from "@/components/providers/locale-provider";
import { useFormat } from "@/lib/format/index";
// Side-effect import: registers the shared 'table' i18n namespace.
import "@/lib/i18n/table-messages";
import type { TableDensity } from "./use-table-prefs";
import type { FilterConfig, BulkAction } from "@/types/table";

interface DataTableToolbarProps<TData> {
  searchSlot?: React.ReactNode; // pass in SearchInput component
  filters?: FilterConfig[];
  activeFilters?: Record<string, string | string[]>;
  onFilterChange?: (key: string, value: string | string[] | undefined) => void;
  onClearFilters?: () => void;
  columns?: Column<TData>[];
  columnVisibility?: Record<string, boolean>;
  onColumnVisibilityChange?: (visibility: Record<string, boolean>) => void;
  enableColumnToggle?: boolean;
  enableExport?: boolean;
  onExport?: (format: "csv" | "json") => void;
  selectedCount?: number;
  bulkActions?: BulkAction[];
  getSelectedIds?: () => string[];
  /** Current row density (comfortable/compact). */
  density?: TableDensity;
  /** Enables the density toggle control when provided. */
  onDensityChange?: (density: TableDensity) => void;
}

export function DataTableToolbar<TData>({
  searchSlot,
  filters,
  activeFilters = {},
  onFilterChange,
  onClearFilters,
  columns,
  columnVisibility = {},
  onColumnVisibilityChange,
  enableColumnToggle = true,
  enableExport = false,
  onExport,
  selectedCount = 0,
  bulkActions,
  getSelectedIds,
  density = "comfortable",
  onDensityChange,
}: DataTableToolbarProps<TData>) {
  const t = useT("table");
  const { formatNumber } = useFormat();
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);

  const hasActiveFilters = Object.values(activeFilters).some(
    (v) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
  );

  const handleBulkAction = async (action: BulkAction) => {
    const ids = getSelectedIds?.() ?? [];
    setBulkLoading(action.label);
    try {
      await action.onClick(ids);
    } finally {
      setBulkLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="data-table-toolbar-surface relative flex flex-wrap items-center gap-2 overflow-hidden rounded-xl border border-primary/15 bg-card p-3 ps-4 shadow-none before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-brand-accent-500">
        {searchSlot && (
          <div className="min-w-[220px] flex-1 max-w-md">{searchSlot}</div>
        )}

        {filters?.map((filter) => (
          <DataTableFilter
            key={filter.key}
            config={filter}
            value={activeFilters[filter.key]}
            onChange={onFilterChange ?? (() => {})}
          />
        ))}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-muted-foreground"
            onClick={onClearFilters}
          >
            <X className="me-1 h-4 w-4" />
            {t("toolbar.clear")}
          </Button>
        )}

        <div className="ms-auto flex items-center gap-2">
          {onDensityChange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  aria-label={t("toolbar.rowDensity")}
                >
                  {density === "compact" ? (
                    <Rows3 className="me-2 h-4 w-4" aria-hidden />
                  ) : (
                    <Rows2 className="me-2 h-4 w-4" aria-hidden />
                  )}
                  {t("toolbar.density")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>{t("toolbar.rowDensity")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={density === "comfortable"}
                  onCheckedChange={() => onDensityChange("comfortable")}
                >
                  <Rows2 className="me-2 h-4 w-4" aria-hidden />
                  {t("toolbar.comfortable")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={density === "compact"}
                  onCheckedChange={() => onDensityChange("compact")}
                >
                  <Rows3 className="me-2 h-4 w-4" aria-hidden />
                  {t("toolbar.compact")}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {enableColumnToggle && columns && onColumnVisibilityChange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Settings2 className="me-2 h-4 w-4" />
                  {t("toolbar.columns")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>
                  {t("toolbar.toggleColumns")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns
                  .filter((col) => col.getCanHide())
                  .map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={columnVisibility[col.id] !== false}
                      onCheckedChange={(checked) =>
                        onColumnVisibilityChange({
                          ...columnVisibility,
                          [col.id]: checked,
                        })
                      }
                    >
                      {getColumnLabel(col)}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {enableExport && onExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Download className="me-2 h-4 w-4" />
                  {t("toolbar.export")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t("toolbar.exportAs")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <button
                  className="w-full px-2 py-1.5 text-sm text-start hover:bg-muted rounded"
                  onClick={() => onExport("csv")}
                >
                  {t("export.csv")}
                </button>
                <button
                  className="w-full px-2 py-1.5 text-sm text-start hover:bg-muted rounded"
                  onClick={() => onExport("json")}
                >
                  {t("export.json")}
                </button>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {hasActiveFilters && filters && (
        <DataTableActiveFilters
          activeFilters={activeFilters}
          filterConfigs={filters}
          onRemoveFilter={(key) => onFilterChange?.(key, undefined)}
          onClearAll={onClearFilters ?? (() => {})}
        />
      )}

      {selectedCount > 0 && bulkActions && bulkActions.length > 0 && (
        <div className="flex items-center gap-2 rounded-soft border border-primary/10 bg-primary/5 px-3 py-2.5">
          <span className="text-sm font-medium">
            {t("toolbar.selected", { count: formatNumber(selectedCount) })}
          </span>
          <div className="ms-auto flex items-center gap-2">
            {bulkActions.map((action) => (
              <Button
                key={action.label}
                variant={
                  action.variant === "destructive" ? "destructive" : "outline"
                }
                size="sm"
                className="h-8"
                onClick={() => handleBulkAction(action)}
                disabled={bulkLoading !== null}
              >
                {action.icon && <action.icon className="me-2 h-4 w-4" />}
                {bulkLoading === action.label
                  ? t("toolbar.processing")
                  : action.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
