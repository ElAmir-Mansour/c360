"use client";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
// Side-effect import: registers the shared 'table' i18n namespace.
import "@/lib/i18n/table-messages";
import type { FilterConfig } from "@/types/table";

interface DataTableActiveFiltersProps {
  activeFilters: Record<string, string | string[]>;
  filterConfigs: FilterConfig[];
  onRemoveFilter: (key: string) => void;
  onClearAll: () => void;
}

export function DataTableActiveFilters({
  activeFilters,
  filterConfigs,
  onRemoveFilter,
  onClearAll,
}: DataTableActiveFiltersProps) {
  const t = useT("table");
  const entries = Object.entries(activeFilters).filter(
    ([, v]) =>
      v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)
  );

  if (entries.length === 0) return null;

  const getLabel = (key: string, value: string | string[]): string => {
    const config = filterConfigs.find((f) => f.key === key);
    const displayValue = Array.isArray(value) ? value.join(", ") : value;
    if (!config) return `${key}: ${displayValue}`;
    if (config.options) {
      const labels = (Array.isArray(value) ? value : [value])
        .map((v) => config.options?.find((o) => o.value === v)?.label ?? v)
        .join(", ");
      return `${config.label}: ${labels}`;
    }
    return `${config.label}: ${displayValue}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 py-1">
      <span className="text-xs font-medium text-muted-foreground">
        {t("toolbar.activeFilters")}
      </span>
      {entries.map(([key, value]) => (
        <Badge
          key={key}
          variant="outline"
          className="gap-1 pr-1 normal-case tracking-normal"
        >
          {getLabel(key, value)}
          <button
            onClick={() => onRemoveFilter(key)}
            className="ml-1 rounded-full p-0.5 hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={t("toolbar.removeFilter", {
              label: filterConfigs.find((f) => f.key === key)?.label ?? key,
            })}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={onClearAll}
      >
        {t("toolbar.clearAll")}
      </Button>
    </div>
  );
}
