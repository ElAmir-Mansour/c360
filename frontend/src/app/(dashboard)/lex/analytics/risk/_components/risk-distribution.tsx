"use client";

/**
 * Contract risk distribution (feature #18).
 *
 * Three coordinated views over the derived `RiskDistribution`:
 *   1. A value-weighted PORTFOLIO RISK GAUGE — a hand-rolled semicircle (like the
 *      cyber MITRE heatmap, since the shared GaugeChart colors "fuller = safer"
 *      which is inverted for risk) whose arc + readout tint red→amber→emerald as
 *      risk rises. Paired with the shared `GaugeChart` showing analysis COVERAGE
 *      (scored ÷ total), where fuller genuinely is better.
 *   2. A high/medium/low DONUT on the shared `PieChart` (innerRadius > 0).
 *   3. A score-band HISTOGRAM (0–100) on the shared `BarChart`, per-bar tinted by
 *      band so the shape of the risk curve reads at a glance.
 *
 * RTL-aware: the gauge readout uses logical layout; the histogram series is
 * reversed in Arabic mode so the 0→100 axis still reads with the text direction.
 * Every number is KSA-formatted via `useLexFormat` (Arabic-Indic in ar).
 */

import { useMemo } from "react";
import { Gauge, PieChart as PieIcon, BarChart3 } from "lucide-react";
import { useLexFormat } from "@/lib/lex/ksa";
import { PieChart } from "@/components/shared/charts/pie-chart";
import { BarChart } from "@/components/shared/charts/bar-chart";
import { GaugeChart } from "@/components/shared/charts/gauge-chart";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  RiskDistribution,
  ScoreBucketPoint,
} from "../_lib/use-portfolio-risk";
import type { RiskBand, RiskLabels } from "../_lib/risk-labels";
import { ChartPanel } from "./chart-panel";

/* Band → design-system semantic color (also used for the donut + bars). */
const BAND_COLOR: Record<RiskBand, string> = {
  high: "hsl(var(--ds-error-500))",
  medium: "hsl(var(--ds-warning-500))",
  low: "hsl(var(--ds-success-500))",
};

interface RiskDistributionProps {
  distribution: RiskDistribution;
  labels: RiskLabels;
  onOpenContracts: (title: string, description: string, ids: string[]) => void;
}

export function RiskDistributionSection({
  distribution,
  labels,
  onOpenContracts,
}: RiskDistributionProps) {
  const f = useLexFormat();
  const rtl = f.direction === "rtl";
  const L = labels.risk;
  const total = distribution.scored + distribution.unscored;

  const donutData = useMemo(
    () =>
      distribution.bands
        .filter((b) => b.count > 0)
        .map((b) => ({
          name: labels.bands[b.band],
          value: b.count,
          color: BAND_COLOR[b.band],
          key: b.band,
          contractIds: distribution.bandContractIds[b.band],
        })),
    [distribution.bandContractIds, distribution.bands, labels.bands],
  );

  const histogramData = useMemo(() => {
    const rows = distribution.buckets.map((bucket: ScoreBucketPoint) => ({
      band: `${f.formatNumber(bucket.from)}–${f.formatNumber(bucket.to)}`,
      count: bucket.count,
      contractIds: bucket.contractIds,
    }));
    return rtl ? [...rows].reverse() : rows;
  }, [distribution.buckets, f, rtl]);

  const histogramColors = useMemo(() => {
    const colors = distribution.buckets.map((b) => BAND_COLOR[b.band]);
    return rtl ? [...colors].reverse() : colors;
  }, [distribution.buckets, rtl]);

  const coveragePct =
    total > 0 ? Math.round((distribution.scored / total) * 100) : 0;
  const numberFmt = (v: number) => f.formatNumber(v);

  return (
    <section className="space-y-4">
      <SectionHeader icon={Gauge} title={L.title} description={L.description} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* 1) Portfolio risk index gauge + coverage gauge. */}
        <ChartPanel
          icon={Gauge}
          title={L.gaugeTitle}
          href="/lex/contracts?sort=risk_score&order=desc"
          className="xl:col-span-1"
        >
          {distribution.scored === 0 ? null : (
            <div className="flex flex-col items-center gap-4">
              <Button
                type="button"
                variant="ghost"
                className="h-auto rounded-xl p-0 transition-opacity hover:bg-transparent hover:opacity-80"
                onClick={() =>
                  onOpenContracts(
                    L.gaugeTitle,
                    L.description,
                    distribution.scoredContractIds,
                  )
                }
              >
                <RiskGauge
                  value={distribution.weightedIndex}
                  label={L.gaugeLabel}
                  f={f}
                />
              </Button>
              <div className="grid w-full grid-cols-2 gap-3 pt-1">
                <Stat
                  label={L.scored}
                  value={f.formatNumber(distribution.scored)}
                  tone="emerald"
                  onAction={() =>
                    onOpenContracts(
                      L.scored,
                      L.description,
                      distribution.scoredContractIds,
                    )
                  }
                />
                <Stat
                  label={L.unscored}
                  value={f.formatNumber(distribution.unscored)}
                  tone="muted"
                  onAction={() =>
                    onOpenContracts(
                      L.unscored,
                      L.description,
                      distribution.unscoredContractIds,
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-full rounded-xl p-0 transition-opacity hover:bg-transparent hover:opacity-80"
                onClick={() =>
                  onOpenContracts(
                    L.scored,
                    L.description,
                    distribution.scoredContractIds,
                  )
                }
              >
                <GaugeChart
                  value={coveragePct}
                  max={100}
                  size={150}
                  format="percentage"
                  thresholds={{ good: 80, warning: 50 }}
                  label={`${L.scored} · ${L.contracts}`}
                />
              </Button>
            </div>
          )}
        </ChartPanel>

        {/* 2) Risk-band donut. */}
        <ChartPanel
          icon={PieIcon}
          title={L.donutTitle}
          description={L.donutDescription}
          href="/lex/contracts?sort=risk_score&order=desc"
        >
          <PieChart
            data={donutData}
            innerRadius={64}
            outerRadius={104}
            height={260}
            centerValue={f.formatNumber(distribution.scored)}
            centerLabel={L.donutCenter}
            onItemSelect={(name) => {
              const slice = donutData.find((item) => item.name === name);
              onOpenContracts(name, L.donutDescription, slice?.contractIds ?? []);
            }}
            emptyMessage={L.empty}
          />
        </ChartPanel>

        {/* 3) Score-band histogram. */}
        <ChartPanel
          icon={BarChart3}
          title={L.bandTrendTitle}
          description={L.bandTrendDescription}
          href="/lex/contracts?sort=risk_score&order=desc"
        >
          <BarChart
            data={histogramData}
            xKey="band"
            yKeys={[
              { key: "count", label: L.contracts, color: BAND_COLOR.medium },
            ]}
            cellColors={histogramColors}
            layout="vertical"
            showLegend={false}
            yFormatter={numberFmt}
            onItemSelect={(datum) =>
              onOpenContracts(
                String(datum.band ?? L.bandTrendTitle),
                L.bandTrendDescription,
                (datum.contractIds as string[]) ?? [],
              )
            }
            height={260}
            emptyMessage={L.empty}
          />
        </ChartPanel>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- *
 * RiskGauge — hand-rolled semicircle whose fill + readout tint with risk.
 * (The shared GaugeChart's "fuller = greener" semantics are inverted for risk.)
 * ------------------------------------------------------------------------- */

function riskColor(value: number): string {
  if (value >= 70) return BAND_COLOR.high;
  if (value >= 40) return BAND_COLOR.medium;
  return BAND_COLOR.low;
}

function RiskGauge({
  value,
  label,
  f,
}: {
  value: number;
  label: string;
  f: ReturnType<typeof useLexFormat>;
}) {
  const size = 188;
  const stroke = 14;
  const radius = (size - stroke * 2) / 2;
  const circumference = Math.PI * radius;
  const pct = Math.min(Math.max(value / 100, 0), 1);
  const offset = circumference * (1 - pct);
  const color = riskColor(value);
  const baseY = size / 2 + 6;

  return (
    <div
      className="relative flex flex-col items-center"
      role="img"
      aria-label={`${label}: ${value}`}
    >
      <svg
        width={size}
        height={size / 2 + 28}
        style={{ overflow: "visible" }}
        aria-hidden
      >
        <path
          d={`M ${stroke} ${baseY} A ${radius} ${radius} 0 0 1 ${size - stroke} ${baseY}`}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${stroke} ${baseY} A ${radius} ${radius} 0 0 1 ${size - stroke} ${baseY}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="motion-reduce:transition-none"
          style={{
            transition:
              "stroke-dashoffset var(--ds-duration-slow) var(--ds-ease-decelerate), stroke var(--ds-duration-slow) var(--ds-ease-decelerate)",
          }}
        />
      </svg>
      <div
        className="absolute bottom-1 flex flex-col items-center"
        style={{ insetInlineStart: 0, insetInlineEnd: 0 }}
      >
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>
          {f.formatNumber(value)}
        </span>
        <span className="mt-0.5 text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  tone,
  onAction,
}: {
  label: string;
  value: string;
  tone: "emerald" | "muted";
  onAction: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onAction}
      aria-label={`${label}: ${value}`}
      className="h-auto rounded-xl border-border/60 bg-card/40 px-3 py-2 text-center font-normal hover:border-primary/40 hover:bg-primary/5"
    >
      <div
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "emerald"
            ? "text-success-600 dark:text-success-300"
            : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[0.7rem] leading-4 text-muted-foreground">
        {label}
      </div>
    </Button>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Gauge;
  title: string;
  description: string;
}) {
  return (
    <header className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[image:var(--ds-gradient-primary)] text-primary-foreground shadow-elevation-1 ring-1 ring-inset ring-white/15">
        <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </header>
  );
}
