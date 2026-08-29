"use client";

/**
 * Workload heatmap (feature #21) — a pure CSS-grid matrix of OPEN matters by
 * handling officer (rows) × practice area (columns).
 *
 * Built as a hand-rolled CSS grid (NOT recharts) in the spirit of the cyber
 * MITRE heatmap (`components/cyber/mitre-mini-heatmap.tsx`): each cell is tinted
 * along a brand→hot ramp keyed to the design-system semantic tokens so it
 * re-themes in dark mode. Officer / area axes are sorted busiest-first, the
 * header + leading officer column stick while scrolling, and per-row and
 * per-column totals frame the grid.
 *
 * Bilingual + RTL safe:
 *   - all counts pass through `useLexFormat().formatNumber` (Arabic-Indic in ar),
 *   - the grid uses logical scrolling and inherits `dir` from an ancestor, so
 *     the leading officer column flips to the right edge in Arabic mode.
 */

import { useMemo } from "react";
import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useLexFormat } from "@/lib/lex/ksa";
import { LexEmptyState } from "@/components/lex/empty-state";
import type { WorkloadMatrix } from "./use-legal-ops-analytics";
import type { AnalyticsLabels } from "./analytics-labels";

interface WorkloadHeatmapProps {
  matrix: WorkloadMatrix;
  labels: AnalyticsLabels["heatmap"];
  /** Cap the visible officers / areas so the grid stays legible. */
  maxOfficers?: number;
  maxAreas?: number;
}

const ACTIVE_CASE_STATUSES = [
  "intake",
  "phase1",
  "phase2",
  "open",
  "under_procedure",
  "on_hold",
] as const;

function workloadHref(
  options: { officerId?: string; areaKey?: string } = {},
): string {
  const params = new URLSearchParams({ view: "table" });
  ACTIVE_CASE_STATUSES.forEach((status) => params.append("status", status));
  if (options.officerId === "__unassigned__") {
    params.set("handling_officer_unassigned", "true");
  } else if (options.officerId) {
    params.set("handling_officer_id", options.officerId);
  }
  if (options.areaKey === "__unassigned__") {
    params.set("case_type_unassigned", "true");
  } else if (options.areaKey) {
    params.set("case_type", options.areaKey);
  }
  return `/lex/cases?${params.toString()}`;
}

/**
 * Heat ramp: 0 reads as an inert muted tile; load climbs brand → amber → hot.
 * Tints come straight from the shared semantic tokens (same family the badges /
 * row-accents use) so the whole grid re-themes with the design system.
 */
function heatStyle(
  count: number,
  max: number,
): { backgroundColor: string; color: string } {
  if (count === 0 || max === 0) {
    return {
      backgroundColor: "hsl(var(--muted)/0.5)",
      color: "hsl(var(--muted-foreground))",
    };
  }
  const t = Math.min(count / max, 1);
  // Brand-primary (low) → warning (mid) → error (high), interpolated by opacity
  // bands so a heavier cell reads hotter and more saturated.
  let token: string;
  let alpha: number;
  if (t < 0.34) {
    token = "--ds-brand-primary";
    alpha = 0.25 + t * 0.9; // 0.25 → ~0.55
  } else if (t < 0.67) {
    token = "--ds-warning-500";
    alpha = 0.45 + (t - 0.34) * 1.1; // ~0.45 → ~0.81
  } else {
    token = "--ds-error-500";
    alpha = 0.6 + (t - 0.67) * 1.2; // ~0.6 → ~1.0
  }
  return {
    backgroundColor: `hsl(var(${token})/${alpha.toFixed(2)})`,
    color: t < 0.34 ? "hsl(var(--foreground))" : "hsl(0 0% 100%)",
  };
}

export function WorkloadHeatmap({
  matrix,
  labels,
  maxOfficers = 12,
  maxAreas = 8,
}: WorkloadHeatmapProps) {
  const f = useLexFormat();

  const officers = useMemo(
    () => matrix.officers.slice(0, maxOfficers),
    [matrix.officers, maxOfficers],
  );
  const areas = useMemo(
    () => matrix.areas.slice(0, maxAreas),
    [matrix.areas, maxAreas],
  );

  if (officers.length === 0 || areas.length === 0) {
    return (
      <LexEmptyState
        icon={LayoutGrid}
        title={labels.empty}
        description={labels.emptyHint}
      />
    );
  }

  // CSS grid template: [officer label] [area columns…] [row total].
  const gridTemplateColumns = `minmax(9rem, 1.4fr) repeat(${areas.length}, minmax(3.5rem, 1fr)) minmax(3.5rem, auto)`;

  return (
    <div className="overflow-x-auto pb-1">
      <div
        role="grid"
        aria-label={labels.title}
        className="grid min-w-max gap-1 text-xs"
        style={{ gridTemplateColumns }}
      >
        {/* ---- Header row: corner + area labels + total ---- */}
        <div
          role="columnheader"
          className="sticky start-0 z-20 flex items-end bg-card pb-2 pe-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {labels.officer}
        </div>
        {areas.map((area) => (
          <div
            key={area.key}
            role="columnheader"
            title={area.label}
            className="flex items-end justify-center pb-2 text-center"
          >
            <span className="line-clamp-2 text-[11px] font-medium leading-tight text-muted-foreground">
              {area.label}
            </span>
          </div>
        ))}
        <div
          role="columnheader"
          className="flex items-end justify-center pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {labels.total}
        </div>

        {/* ---- Officer rows ---- */}
        {officers.map((officer, rowIdx) => {
          const row = matrix.cells.get(officer.id);
          return (
            <div key={officer.id} role="row" className="contents">
              {/* Sticky officer label (flips to the trailing edge in RTL). */}
              <div
                role="rowheader"
                title={officer.label}
                className={cn(
                  "sticky start-0 z-10 flex items-center bg-card pe-3 text-start",
                  "motion-safe:animate-fade-up",
                )}
                style={{ animationDelay: `${Math.min(rowIdx * 30, 240)}ms` }}
              >
                <span className="truncate font-medium text-foreground">
                  {officer.label}
                </span>
              </div>

              {/* Cells */}
              {areas.map((area) => {
                const cell = row?.get(area.key);
                const count = cell?.count ?? 0;
                const style = heatStyle(count, matrix.max);
                return (
                  <Link
                    key={area.key}
                    role="gridcell"
                    href={workloadHref({
                      officerId: officer.id,
                      areaKey: area.key,
                    })}
                    title={labels.cellTooltip(officer.label, area.label, count)}
                    aria-label={labels.cellTooltip(
                      officer.label,
                      area.label,
                      count,
                    )}
                    className={cn(
                      "flex h-11 items-center justify-center rounded-md font-semibold tabular-nums",
                      "ring-1 ring-inset ring-border/40 duration-fast ease-standard",
                      "outline-none hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    style={style}
                  >
                    {count > 0 ? f.formatNumber(count) : ""}
                  </Link>
                );
              })}

              {/* Row total */}
              <Link
                role="gridcell"
                href={workloadHref({ officerId: officer.id })}
                aria-label={labels.cellTooltip(
                  officer.label,
                  labels.total,
                  officer.total,
                )}
                className="flex h-11 items-center justify-center rounded-md bg-muted/40 font-semibold tabular-nums text-foreground ring-1 ring-inset ring-border/50 outline-none hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {f.formatNumber(officer.total)}
              </Link>
            </div>
          );
        })}

        {/* ---- Footer: column totals ---- */}
        <div
          role="rowheader"
          className="sticky start-0 z-10 flex items-center bg-card pe-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {labels.total}
        </div>
        {areas.map((area) => (
          <Link
            key={area.key}
            role="gridcell"
            href={workloadHref({ areaKey: area.key })}
            aria-label={labels.cellTooltip(
              labels.total,
              area.label,
              area.total,
            )}
            className="flex h-9 items-center justify-center rounded-md bg-muted/40 font-semibold tabular-nums text-foreground ring-1 ring-inset ring-border/50 outline-none hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {f.formatNumber(area.total)}
          </Link>
        ))}
        <Link
          role="gridcell"
          href={workloadHref()}
          aria-label={labels.cellTooltip(
            labels.total,
            labels.total,
            matrix.officers.reduce((sum, officer) => sum + officer.total, 0),
          )}
          className="flex h-9 items-center justify-center rounded-md bg-muted/60 font-bold tabular-nums text-foreground ring-1 ring-inset ring-border/60 outline-none hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {f.formatNumber(
            matrix.officers.reduce((sum, officer) => sum + officer.total, 0),
          )}
        </Link>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-3 ps-1">
        <span className="text-[11px] text-muted-foreground">
          {labels.legendLight}
        </span>
        <div className="flex h-2.5 w-40 overflow-hidden rounded-full ring-1 ring-inset ring-border/50">
          {[0.15, 0.4, 0.55, 0.7, 0.85, 1].map((t, i) => (
            <span
              key={i}
              className="h-full flex-1"
              style={{
                backgroundColor: heatStyle(
                  Math.round(t * matrix.max) || 1,
                  matrix.max,
                ).backgroundColor,
              }}
            />
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {labels.legendHeavy}
        </span>
      </div>
    </div>
  );
}
