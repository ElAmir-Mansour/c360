"use client";

/**
 * Velocity & cycle-time charts (feature #22).
 *
 * Three views over the derived analytics, built on the shared chart primitives
 * (`@/components/shared/charts`) — bar / line / area — never recharts directly:
 *
 *   1. Matters opened vs. closed per week (grouped BAR, weekly throughput).
 *   2. Average days-in-phase per case status (horizontal BAR).
 *   3. Settlement cycle time per executed settlement (AREA, value-weighted).
 *
 * RTL-aware: in Arabic mode the week series is REVERSED so time still reads
 * right-to-left, and every axis tick / tooltip value is KSA-formatted via
 * `useLexFormat` (Arabic-Indic digits + Hijri-aware week labels). Each chart
 * sits in a `.card` panel with a titled header; empty data degrades to the
 * chart primitives' own empty state.
 */

import { useMemo } from "react";
import { ArrowUpRight, BarChart3, CalendarClock, GitGraph } from "lucide-react";
import Link from "next/link";
import { useLexFormat } from "@/lib/lex/ksa";
import { BarChart } from "@/components/shared/charts/bar-chart";
import { AreaChart } from "@/components/shared/charts/area-chart";
import { cn } from "@/lib/utils";
import type {
  LegalOpsAnalytics,
  PhaseDwellPoint,
  WeekPoint,
} from "./use-legal-ops-analytics";
import type { AnalyticsLabels } from "./analytics-labels";

interface VelocityChartsProps {
  analytics: LegalOpsAnalytics;
  labels: AnalyticsLabels;
  onOpenCases: (title: string, description: string, ids: string[]) => void;
  onOpenSettlements: (title: string, description: string, ids: string[]) => void;
}

/* Series colours pulled from the design-system brand/semantic tokens. */
const COLOR_OPENED = "hsl(var(--ds-brand-primary))";
const COLOR_CLOSED = "hsl(var(--ds-success-500))";
const COLOR_DWELL = "hsl(var(--ds-warning-500))";
const COLOR_CYCLE = "hsl(var(--ds-info-500))";
const ACTIVE_CASES_HREF =
  "/lex/cases?status=intake&status=phase1&status=phase2&status=open&status=under_procedure&status=on_hold&view=table";
const CLOSED_CASES_HREF =
  "/lex/cases?status=closed&status=cancelled&sort=updated_at&order=desc&view=table";

export function VelocityCharts({
  analytics,
  labels,
  onOpenCases,
  onOpenSettlements,
}: VelocityChartsProps) {
  const f = useLexFormat();
  const rtl = f.direction === "rtl";
  const L = labels.velocity;

  // --- Weekly throughput: opened vs closed --------------------------------
  const weeklyData = useMemo(() => {
    const rows = analytics.weekly.map((w: WeekPoint) => ({
      week: f.formatDate(w.weekDate, { day: "numeric", month: "short" }),
      opened: w.opened,
      closed: w.closed,
      openedCaseIds: w.openedCaseIds,
      closedCaseIds: w.closedCaseIds,
    }));
    // Mirror time-axis order in RTL so the latest week sits at the start edge.
    return rtl ? [...rows].reverse() : rows;
  }, [analytics.weekly, f, rtl]);

  // --- Average days-in-phase ----------------------------------------------
  const dwellData = useMemo(
    () =>
      analytics.phaseDwell.map((p: PhaseDwellPoint) => ({
        phase: labels.status[p.status] ?? p.status,
        days: p.avgDays,
        caseIds: p.caseIds,
      })),
    [analytics.phaseDwell, labels.status],
  );

  // --- Settlement cycle time ----------------------------------------------
  const cycleData = useMemo(() => {
    const rows = analytics.settlementCycle.map((s) => ({
      reference: s.reference,
      cycle: s.cycleDays,
      settlementId: s.id,
    }));
    return rtl ? [...rows].reverse() : rows;
  }, [analytics.settlementCycle, rtl]);

  const numberFmt = (v: number) => f.formatNumber(v);
  const daysFmt = (v: number) => `${f.formatNumber(v)} ${L.daysAxis}`;
  // `xFormatter` is typed for a category-or-number axis; coerce defensively so
  // it satisfies the shared chart contract while still localizing numbers.
  const axisNumberFmt = (v: string | number) =>
    typeof v === "number" ? f.formatNumber(v) : v;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {/* 1) Opened vs closed per week — spans full width on xl. */}
      <ChartPanel
        className="xl:col-span-2"
        icon={BarChart3}
        title={L.closedPerWeek}
        description={L.description}
        href={CLOSED_CASES_HREF}
      >
        <BarChart
          data={weeklyData}
          xKey="week"
          yKeys={[
            { key: "opened", label: L.opened, color: COLOR_OPENED },
            { key: "closed", label: L.closed, color: COLOR_CLOSED },
          ]}
          layout="vertical"
          yFormatter={numberFmt}
          onItemSelect={(datum, seriesKey) =>
            onOpenCases(
              seriesKey === "opened" ? L.opened : L.closed,
              L.description,
              (seriesKey === "opened" ? datum.openedCaseIds : datum.closedCaseIds) as string[],
            )
          }
          height={260}
          emptyMessage={L.empty}
        />
      </ChartPanel>

      {/* 2) Average days in phase — horizontal bar. */}
      <ChartPanel
        icon={CalendarClock}
        title={L.avgDaysInPhase}
        description={L.avgDaysInPhaseDesc}
        href={ACTIVE_CASES_HREF}
      >
        <BarChart
          data={dwellData}
          xKey="phase"
          yKeys={[{ key: "days", label: L.daysAxis, color: COLOR_DWELL }]}
          layout="horizontal"
          showLegend={false}
          xFormatter={axisNumberFmt}
          yFormatter={numberFmt}
          onItemSelect={(datum) =>
            onOpenCases(
              String(datum.phase ?? L.avgDaysInPhase),
              L.avgDaysInPhaseDesc,
              (datum.caseIds as string[]) ?? [],
            )
          }
          height={260}
          emptyMessage={L.empty}
        />
      </ChartPanel>

      {/* 3) Settlement cycle time — area. */}
      <ChartPanel
        icon={GitGraph}
        title={L.settlementCycle}
        description={L.settlementCycleDesc}
        href="/lex/settlements?status=executed&sort=updated_at&order=desc"
      >
        <AreaChart
          data={cycleData}
          xKey="reference"
          yKeys={[{ key: "cycle", label: L.cycleDays, color: COLOR_CYCLE }]}
          showLegend={false}
          yFormatter={daysFmt}
          onItemSelect={(datum) =>
            onOpenSettlements(
              String(datum.reference ?? L.settlementCycle),
              L.settlementCycleDesc,
              datum.settlementId ? [String(datum.settlementId)] : [],
            )
          }
          height={260}
          emptyMessage={L.empty}
        />
      </ChartPanel>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * ChartPanel — titled `.card` shell around a chart, matching the suite's
 * premium panel look (header with icon chip + title, divider, body).
 * ------------------------------------------------------------------------- */

function ChartPanel({
  icon: Icon,
  title,
  description,
  href,
  className,
  children,
}: {
  icon: typeof BarChart3;
  title: string;
  description?: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("card p-5 motion-safe:animate-fade-up", className)}>
      <header className="mb-4 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[image:var(--ds-gradient-primary)] text-primary-foreground shadow-elevation-1 ring-1 ring-inset ring-white/15">
          <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            <Link
              href={href}
              className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </h3>
          {description ? (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}
