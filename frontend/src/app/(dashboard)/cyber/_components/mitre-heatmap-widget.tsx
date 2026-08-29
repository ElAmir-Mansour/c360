'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { severityVar, type SeverityLevel } from '@/lib/design-tokens';
import { formatNumber } from '@/lib/format-number';
import type { MITREHeatmapCell, MITREHeatmapData } from '@/types/cyber';
import { useCyberDashboardLabels, type CyberDashboardLabels } from '../_lib/cyber-i18n';

interface MitreHeatmapWidgetProps {
  data?: MITREHeatmapData;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

/** How many techniques to show per tactic column before collapsing into "+N more". */
const MAX_PER_TACTIC = 5;

/**
 * Intensity ramp → severity hue. A heatmap should read hot→cold, and the design
 * system already ships a severity ramp (critical → high → medium → low → info)
 * that re-themes in light/dark. We bucket each cell's `alert_count / max_count`
 * ratio onto that ramp and color the cell via `severityVar()` so there is NO
 * hardcoded `bg-red-*` / hex anywhere. The level is also used for the legend.
 */
function intensityLevel(count: number, max: number): SeverityLevel | null {
  if (count <= 0) return null; // empty cell — rendered as a neutral track
  const ratio = count / Math.max(max, 1);
  if (ratio > 0.66) return 'critical';
  if (ratio > 0.4) return 'high';
  if (ratio > 0.2) return 'medium';
  if (ratio > 0.05) return 'low';
  return 'info';
}

/** Build the legend from the resolved bilingual labels. */
function buildLegend(t: CyberDashboardLabels): ReadonlyArray<{ level: SeverityLevel; label: string }> {
  return [
    { level: 'info', label: t.mitreLegendSparse },
    { level: 'low', label: t.mitreLegendLow },
    { level: 'medium', label: t.mitreLegendModerate },
    { level: 'high', label: t.mitreLegendHigh },
    { level: 'critical', label: t.mitreLegendHot },
  ];
}

/** A single technique cell. Token-colored, with a hover tooltip. */
function HeatCell({
  cell,
  level,
  onSelect,
  t,
}: {
  cell: MITREHeatmapCell;
  level: SeverityLevel | null;
  onSelect: (cell: MITREHeatmapCell) => void;
  t: CyberDashboardLabels;
}) {
  // Empty cells stay on a neutral track; active cells fill with their severity
  // hue. Inline style is required because the hue is data-driven (var() resolves
  // fine in inline style and re-themes in dark mode automatically).
  const filled = level !== null;
  const style = filled
    ? { backgroundColor: severityVar(level), color: 'hsl(var(--primary-foreground))' }
    : undefined;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onSelect(cell)}
            style={style}
            className={cn(
              'flex h-7 w-full items-center justify-between gap-1.5 rounded-input px-2',
              'duration-fast ease-standard transition-[box-shadow]',
              'hover:shadow-elevation-2',
              'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              !filled && 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
            aria-label={`${cell.technique_id} ${cell.technique_name}: ${cell.alert_count} alerts`}
          >
            <span className="truncate font-mono text-caption font-medium">{cell.technique_id}</span>
            <span className="shrink-0 text-caption font-semibold tabular-nums">
              {formatNumber(cell.alert_count, { abbr: true })}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs shadow-elevation-3">
          <p className="font-medium">{cell.technique_name}</p>
          <p className="text-caption text-muted-foreground">
            {cell.technique_id} · {cell.tactic_name}
          </p>
          <p className="text-caption text-muted-foreground">
            {t.mitreAlertsCountTooltip(formatNumber(cell.alert_count), cell.alert_count === 1)}
            {cell.critical_count > 0 ? t.mitreCriticalSuffix(formatNumber(cell.critical_count)) : ''}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function MitreHeatmapWidget({ data, loading, error, onRetry }: MitreHeatmapWidgetProps) {
  const router = useRouter();
  const t = useCyberDashboardLabels();
  const legend = buildLegend(t);

  const tactics = useMemo(() => {
    if (!data?.cells) return [];

    const byTactic = new Map<
      string,
      { id: string; name: string; cells: MITREHeatmapCell[] }
    >();

    for (const cell of data.cells) {
      let entry = byTactic.get(cell.tactic_id);
      if (!entry) {
        entry = { id: cell.tactic_id, name: cell.tactic_name, cells: [] };
        byTactic.set(cell.tactic_id, entry);
      }
      entry.cells.push(cell);
    }

    // Sort techniques within a tactic hottest-first so the visible top-N is the
    // most meaningful slice.
    for (const entry of byTactic.values()) {
      entry.cells.sort((a, b) => b.alert_count - a.alert_count);
    }

    return Array.from(byTactic.values());
  }, [data]);

  if (loading) return <LoadingSkeleton variant="table-row" count={5} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!data?.cells || data.cells.length === 0) {
    return (
      <EmptyState
        icon={Shield}
        size="compact"
        title={t.mitreEmptyTitle}
        description={t.mitreEmptyDescription}
      />
    );
  }

  const handleSelect = (cell: MITREHeatmapCell) =>
    router.push(`/cyber/alerts?mitre_technique_id=${cell.technique_id}`);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max gap-3">
          {tactics.map((tactic) => {
            const visible = tactic.cells.slice(0, MAX_PER_TACTIC);
            const overflow = tactic.cells.length - visible.length;
            return (
              <div key={tactic.id} className="flex w-32 shrink-0 flex-col gap-1.5">
                <p
                  className="truncate text-overline text-muted-foreground"
                  title={tactic.name}
                >
                  {tactic.name}
                </p>
                <div className="flex flex-col gap-1">
                  {visible.map((cell) => (
                    <HeatCell
                      key={cell.technique_id}
                      cell={cell}
                      level={intensityLevel(cell.alert_count, data.max_count)}
                      onSelect={handleSelect}
                      t={t}
                    />
                  ))}
                  {overflow > 0 && (
                    <span className="px-2 text-caption text-muted-foreground">
                      {t.mitreOverflowMore(formatNumber(overflow))}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">{t.mitreLess}</span>
          <div className="flex items-center gap-1">
            {legend.map(({ level, label }) => (
              <span
                key={level}
                title={label}
                className="h-3 w-5 rounded-sm"
                style={{ backgroundColor: severityVar(level) }}
              />
            ))}
          </div>
          <span className="text-caption text-muted-foreground">{t.mitreMore}</span>
        </div>
        <p className="text-caption text-muted-foreground">
          {t.mitreFooter(MAX_PER_TACTIC, formatNumber(data.cells.length))}
        </p>
      </div>
    </div>
  );
}
