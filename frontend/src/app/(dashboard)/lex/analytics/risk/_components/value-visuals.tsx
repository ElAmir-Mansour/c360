"use client";

/**
 * Contract VALUE visualizations (feature #19).
 *
 *   1. VALUE-AT-RISK split — active value carried by high-risk contracts vs. the
 *      rest of the active book, on the shared donut (`PieChart`), centered on the
 *      total active value. Surfaces concentration of value in risky paper.
 *   2. RENEWAL CLIFF — active contract value expiring per month over the next 12
 *      months, on the shared `AreaChart` (value) with a paired count line. The
 *      peak-exposure month is called out above the chart.
 *
 * All money flows through `useLexFormat.formatCurrency` / `formatCurrencyCompact`
 * so Arabic mode renders SAR with Arabic-Indic digits. RTL-aware: the cliff
 * timeline is reversed in Arabic so the months read right-to-left; the donut and
 * currency are direction-agnostic.
 */

import { useMemo } from "react";
import { ShieldAlert, TrendingDown } from "lucide-react";
import { useLexFormat } from "@/lib/lex/ksa";
import { PieChart } from "@/components/shared/charts/pie-chart";
import { AreaChart } from "@/components/shared/charts/area-chart";
import type {
  PortfolioRisk,
  RenewalCliffPoint,
} from "../_lib/use-portfolio-risk";
import type { RiskLabels } from "../_lib/risk-labels";
import { ChartPanel } from "./chart-panel";

const COLOR_AT_RISK = "hsl(var(--ds-error-500))";
const COLOR_SAFE = "hsl(var(--ds-success-500))";
const COLOR_VALUE = "hsl(var(--ds-brand-primary))";

interface ValueVisualsProps {
  data: PortfolioRisk;
  labels: RiskLabels;
  onOpenContracts: (title: string, description: string, ids: string[]) => void;
}

export function ValueVisualsSection({
  data,
  labels,
  onOpenContracts,
}: ValueVisualsProps) {
  const f = useLexFormat();
  const rtl = f.direction === "rtl";
  const { kpis, cliff, peakCliffIndex } = data;
  const valueAtRiskIds = new Set(kpis.valueAtRiskContractIds);
  const safeContractIds = kpis.activeContractIds.filter((id) => !valueAtRiskIds.has(id));

  // --- Value-at-risk donut: at-risk vs. safe active value -----------------
  const safeValue = Math.max(0, kpis.activeValue - kpis.valueAtRisk);
  const valueSplit = useMemo(
    () =>
      [
        {
          name: labels.kpi.valueAtRisk,
          value: Math.round(kpis.valueAtRisk),
          color: COLOR_AT_RISK,
          contractIds: kpis.valueAtRiskContractIds,
        },
        {
          name: labels.risk.scored,
          value: Math.round(safeValue),
          color: COLOR_SAFE,
          contractIds: safeContractIds,
        },
      ].filter((slice) => slice.value > 0),
    [
      kpis.valueAtRisk,
      kpis.valueAtRiskContractIds,
      safeValue,
      safeContractIds,
      labels.kpi.valueAtRisk,
      labels.risk.scored,
    ],
  );

  // --- Renewal cliff: value expiring per month over the next 12 months ----
  const cliffData = useMemo(() => {
    const rows = cliff.map((p: RenewalCliffPoint) => ({
      month: f.formatDate(p.monthDate, { month: "short", year: "2-digit" }),
      value: Math.round(p.value),
      contractIds: p.contractIds,
    }));
    return rtl ? [...rows].reverse() : rows;
  }, [cliff, f, rtl]);

  const peak = peakCliffIndex >= 0 ? cliff[peakCliffIndex] : undefined;

  // Compact SAR on the axis; the shared AreaChart reuses this formatter in its
  // tooltip, so it stays readable at both scales.
  const currencyAxisFmt = (v: number) => f.formatCurrencyCompact(v);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Value-at-risk donut. */}
      <ChartPanel
        icon={ShieldAlert}
        title={labels.kpi.valueAtRisk}
        description={`${f.formatPercent(kpis.valueAtRiskShare, { maximumFractionDigits: 0 })} ${labels.kpi.ofPortfolio}`}
        href="/lex/contracts?sort=risk_score&order=desc"
        className="xl:col-span-1"
      >
        <PieChart
          data={valueSplit}
          innerRadius={64}
          outerRadius={104}
          height={260}
          centerValue={f.formatCurrencyCompact(kpis.activeValue)}
          centerLabel={labels.kpi.activeValue}
          onItemSelect={(name) => {
            const slice = valueSplit.find((item) => item.name === name);
            onOpenContracts(name, labels.kpiDetails.activeValue, slice?.contractIds ?? []);
          }}
          emptyMessage={labels.cliff.empty}
        />
      </ChartPanel>

      {/* Renewal cliff timeline. */}
      <ChartPanel
        icon={TrendingDown}
        title={labels.cliff.title}
        description={labels.cliff.description}
        href="/lex/contracts?expiring_in_days=365"
        className="xl:col-span-2"
        aside={
          peak ? (
            <div className="rounded-xl border border-warning-500/30 bg-warning-500/10 px-3 py-1.5 text-end">
              <div className="text-overline uppercase text-warning-700 dark:text-warning-300">
                {labels.cliff.peakMonth}
              </div>
              <div className="text-sm font-semibold tabular-nums text-foreground">
                {f.formatDate(peak.monthDate, {
                  month: "short",
                  year: "2-digit",
                })}{" "}
                · {f.formatCurrencyCompact(peak.value)}
              </div>
            </div>
          ) : undefined
        }
      >
        <AreaChart
          data={cliffData}
          xKey="month"
          yKeys={[
            { key: "value", label: labels.cliff.valueAxis, color: COLOR_VALUE },
          ]}
          showLegend={false}
          yFormatter={currencyAxisFmt}
          onItemSelect={(datum) =>
            onOpenContracts(
              String(datum.month ?? labels.cliff.title),
              labels.cliff.description,
              (datum.contractIds as string[]) ?? [],
            )
          }
          height={260}
          emptyMessage={labels.cliff.emptyHint}
        />
      </ChartPanel>
    </div>
  );
}
