"use client";
import { useFormat } from "@/lib/format/index";
import { cn } from "@/lib/utils";

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
  }>;
  label?: string | number;
  labelFormatter?: (label: string | number) => string;
  valueFormatter?: (value: number, name: string) => string;
  className?: string;
}

/**
 * Shared recharts tooltip body. Locale-aware by default: when no
 * `valueFormatter` is supplied, values render through the platform
 * `useFormat()` bundle (Arabic-Indic digits + ar-SA grouping in Arabic mode).
 * Both formatter props accept the members of `useChartLocaleFormatters()`
 * (see chart-container) so axes and tooltip stay consistent per locale.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  className,
}: ChartTooltipProps) {
  // Hook order: unconditionally before the early return.
  const format = useFormat();
  if (!active || !payload || payload.length === 0) return null;
  const displayLabel = label !== undefined && labelFormatter ? labelFormatter(label) : label;

  return (
    <div
      className={cn(
        // Popover-tier surface: tokenized radius, border, card surface, and the
        // elevation-3 shadow reserved for floating overlays (popovers/menus).
        // `text-start` keeps the label/value rows logically aligned — the
        // tooltip is plain HTML, so it inherits the document dir and mirrors
        // correctly under RTL without recharts' help.
        "min-w-[120px] rounded-card border border-border bg-card p-3 text-start text-body-sm shadow-elevation-3",
        className,
      )}
    >
      {displayLabel !== undefined && (
        <p className="mb-2 font-medium text-foreground">{String(displayLabel)}</p>
      )}
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-pill"
                style={{ backgroundColor: entry.color }}
                aria-hidden
              />
              <span className="text-muted-foreground">{entry.name}</span>
            </div>
            <span className="font-medium tabular-nums text-foreground">
              {valueFormatter
                ? valueFormatter(entry.value, entry.name)
                : format.formatNumber(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
