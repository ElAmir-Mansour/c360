"use client";

/**
 * Matter urgency + obligation maturity (feature #18).
 *
 * Two side-by-side views on the shared chart primitives:
 *   1. MATTER URGENCY — open matters by priority (stacked BAR), with the overdue
 *      slice drawn in danger red on top of the on-track slice so the at-risk load
 *      reads instantly.
 *   2. OBLIGATION MATURITY — open obligations bucketed by due horizon
 *      (overdue / 30d / 90d / later) as a per-bucket-tinted BAR, so the wave of
 *      upcoming deadlines is visible.
 *
 * RTL-aware (priority + horizon order is reversed in Arabic so it reads with the
 * text direction) and KSA-formatted (Arabic-Indic counts in ar mode).
 */

import { useMemo } from "react";
import { ListChecks, CalendarClock } from "lucide-react";
import { useLexFormat } from "@/lib/lex/ksa";
import { BarChart } from "@/components/shared/charts/bar-chart";
import type {
  MatterUrgencyPoint,
  ObligationMaturityPoint,
} from "../_lib/use-portfolio-risk";
import type { RiskLabels } from "../_lib/risk-labels";
import { ChartPanel } from "./chart-panel";

const COLOR_OPEN = "hsl(var(--ds-info-500))";
const COLOR_OVERDUE = "hsl(var(--ds-error-500))";

/* Maturity horizons get a cool→hot ramp so "overdue" pops. */
const MATURITY_COLOR: Record<ObligationMaturityPoint["key"], string> = {
  overdue: "hsl(var(--ds-error-500))",
  next30: "hsl(var(--ds-warning-500))",
  next90: "hsl(var(--ds-info-500))",
  later: "hsl(var(--ds-success-500))",
};

interface UrgencyMaturityProps {
  urgency: MatterUrgencyPoint[];
  maturity: ObligationMaturityPoint[];
  labels: RiskLabels;
  onOpenMatters: (title: string, description: string, ids: string[]) => void;
  onOpenObligations: (title: string, description: string, ids: string[]) => void;
}

export function UrgencyMaturitySection({
  urgency,
  maturity,
  labels,
  onOpenMatters,
  onOpenObligations,
}: UrgencyMaturityProps) {
  const f = useLexFormat();
  const rtl = f.direction === "rtl";
  const numberFmt = (v: number) => f.formatNumber(v);

  // --- Matter urgency: on-track vs overdue, stacked by priority -----------
  const urgencyData = useMemo(() => {
    const rows = urgency
      .filter((u) => u.open > 0)
      .map((u) => ({
        priority: labels.priority[u.priority],
        onTrack: Math.max(0, u.open - u.overdue),
        overdue: u.overdue,
        onTrackMatterIds: u.onTrackMatterIds,
        overdueMatterIds: u.overdueMatterIds,
      }));
    return rtl ? [...rows].reverse() : rows;
  }, [urgency, labels.priority, rtl]);

  // --- Obligation maturity buckets ----------------------------------------
  const maturityData = useMemo(() => {
    const rows = maturity
      .filter((m) => m.count > 0)
      .map((m) => ({
        bucket: labels.maturity[m.key],
        count: m.count,
        key: m.key,
        obligationIds: m.obligationIds,
      }));
    return rtl ? [...rows].reverse() : rows;
  }, [maturity, labels.maturity, rtl]);

  const maturityColors = useMemo(
    () => maturityData.map((m) => MATURITY_COLOR[m.key]),
    [maturityData],
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartPanel
        icon={ListChecks}
        title={labels.urgency.title}
        description={labels.urgency.description}
        href="/lex/matters"
      >
        <BarChart
          data={urgencyData}
          xKey="priority"
          yKeys={[
            { key: "onTrack", label: labels.urgency.open, color: COLOR_OPEN },
            {
              key: "overdue",
              label: labels.urgency.overdue,
              color: COLOR_OVERDUE,
            },
          ]}
          stacked
          layout="vertical"
          yFormatter={numberFmt}
          onItemSelect={(datum, seriesKey) =>
            onOpenMatters(
              String(datum.priority ?? labels.urgency.title),
              labels.urgency.description,
              (seriesKey === "overdue"
                ? datum.overdueMatterIds
                : datum.onTrackMatterIds) as string[],
            )
          }
          height={260}
          emptyMessage={labels.urgency.empty}
        />
      </ChartPanel>

      <ChartPanel
        icon={CalendarClock}
        title={labels.maturity.title}
        description={labels.maturity.description}
        href="/lex/obligations"
      >
        <BarChart
          data={maturityData}
          xKey="bucket"
          yKeys={[
            {
              key: "count",
              label: labels.maturity.obligations,
              color: MATURITY_COLOR.next90,
            },
          ]}
          cellColors={maturityColors}
          layout="vertical"
          showLegend={false}
          yFormatter={numberFmt}
          onItemSelect={(datum) =>
            onOpenObligations(
              String(datum.bucket ?? labels.maturity.title),
              labels.maturity.description,
              (datum.obligationIds as string[]) ?? [],
            )
          }
          height={260}
          emptyMessage={labels.maturity.empty}
        />
      </ChartPanel>
    </div>
  );
}
