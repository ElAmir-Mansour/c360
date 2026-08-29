'use client';

/**
 * SLACompliancePanel is the FLAGSHIP legal-affairs KPI surface (CAP-151): the
 * front-and-center quarterly SLA-compliance gauge against the 90% target, an
 * overall-rate headline, a per-quarter compliance trend (bar chart) and a
 * `.table-premium` quarter table.
 *
 * Consumes the shared chart primitives (GaugeChart / BarChart) — never reinvents
 * a chart. Fully bilingual + RTL-safe (logical spacing, the table inherits the
 * design-system `text-align:start`).
 */
import Link from 'next/link';
import { GaugeChart } from '@/components/shared/charts/gauge-chart';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { LexEmptyState } from '@/components/lex/empty-state';
import { rowAccentClass } from '@/components/lex/row-accents';
import { useLexFormat, type LexFormatter } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { FileBarChart } from 'lucide-react';
import type { LexSLAComplianceReport } from '@/lib/lex/reports';
import type { AnalyticsLabels } from '../_lib/analytics-labels';

interface SLACompliancePanelProps {
  report: LexSLAComplianceReport;
  labels: AnalyticsLabels;
}

function formatSignedPct(value: number, f: LexFormatter): string {
  const formatted = `${f.formatNumber(Number(Math.abs(value).toFixed(1)))}%`;
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return '0%';
}

function serviceDeskExceptionHref(kind: 'breached' | 'pending'): string {
  const params = new URLSearchParams();
  params.set('page', '1');
  if (kind === 'breached') {
    params.set('status', 'in_execution');
  } else {
    params.set('status', 'submitted');
  }
  return `/lex/service-desk?${params.toString()}`;
}

export function SLACompliancePanel({ report, labels }: SLACompliancePanelProps) {
  const f = useLexFormat();
  const t = labels.sla;
  const target = report.target_pct || 90;
  const quarters = report.quarters ?? [];
  // The most recent quarter drives the headline gauge; quarters are returned
  // oldest-first, so the current quarter is the last element.
  const current = quarters.length > 0 ? quarters[quarters.length - 1] : undefined;
  const previous = quarters.length > 1 ? quarters[quarters.length - 2] : undefined;
  const gaugeValue = current?.rate_pct ?? report.overall_rate_pct ?? 0;
  const qoqDelta = current && previous ? current.rate_pct - previous.rate_pct : undefined;
  const targetGap = current ? current.rate_pct - target : undefined;
  const revealQuarterBreakdown = () => {
    document.getElementById('sla-quarter-breakdown')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  // Trend bars are colored by whether each quarter met the target (success) or
  // not (warning) — the design-system status tokens, not ad-hoc hex.
  const trendData = quarters.map((q) => ({
    quarter: q.quarter,
    rate: Number(q.rate_pct.toFixed(1)),
  }));
  const cellColors = quarters.map((q) =>
    q.meets_target ? 'hsl(var(--status-success))' : 'hsl(var(--status-warning))',
  );
  const exceptionRows = [...quarters]
    .reverse()
    .flatMap((q) => [
      ...(q.breached > 0
        ? [{ quarter: q.quarter, kind: 'breached' as const, count: q.breached }]
        : []),
      ...(q.pending > 0
        ? [{ quarter: q.quarter, kind: 'pending' as const, count: q.pending }]
        : []),
    ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title={t.headline} description={t.headlineDescription}>
          <button
            type="button"
            onClick={revealQuarterBreakdown}
            className="flex w-full flex-col items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GaugeChart
              value={gaugeValue}
              max={100}
              thresholds={{ good: target, warning: target - 15 }}
              label={t.gaugeLabel}
              format="percentage"
              size={220}
            />
            <Badge variant={gaugeValue >= target ? 'success' : 'warning'}>
              {t.target(Math.round(target))}
            </Badge>
          </button>
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-2">
          <DetailStatCard
            label={t.overall}
            value={`${f.formatNumber(Number(report.overall_rate_pct.toFixed(1)))}%`}
            tone={report.overall_meets_target ? 'emerald' : 'rose'}
            helper={report.overall_meets_target ? t.overallMeets : t.overallMisses}
            onAction={revealQuarterBreakdown}
          />
          {current ? (
            <>
              <DetailStatCard
                label={t.currentQuarter}
                value={`${f.formatNumber(Number(current.rate_pct.toFixed(1)))}%`}
                tone={current.meets_target ? 'emerald' : 'gold'}
                helper={current.quarter}
                onAction={revealQuarterBreakdown}
              />
              <DetailStatCard
                label={t.onTime}
                value={f.formatNumber(current.on_time)}
                tone="emerald"
                onAction={revealQuarterBreakdown}
              />
              <DetailStatCard
                label={t.breached}
                value={f.formatNumber(current.breached)}
                tone="rose"
                onAction={revealQuarterBreakdown}
              />
              <DetailStatCard
                label={t.qoqChange}
                value={qoqDelta === undefined ? '—' : formatSignedPct(qoqDelta, f)}
                tone={qoqDelta === undefined ? 'slate' : qoqDelta >= 0 ? 'emerald' : 'rose'}
                helper={previous ? `${t.previousQuarter}: ${previous.quarter}` : t.noPreviousQuarter}
                onAction={revealQuarterBreakdown}
              />
              <DetailStatCard
                label={t.targetGap}
                value={targetGap === undefined ? '—' : formatSignedPct(targetGap, f)}
                tone={targetGap === undefined ? 'slate' : targetGap >= 0 ? 'emerald' : 'rose'}
                helper={t.target(Math.round(target))}
                onAction={revealQuarterBreakdown}
              />
            </>
          ) : null}
        </div>
      </div>

      <SectionCard title={t.trendTitle} description={t.trendDescription}>
        {trendData.length === 0 ? (
          <LexEmptyState icon={FileBarChart} title={t.noQuarters} description={t.headlineDescription} />
        ) : (
          <BarChart
            data={trendData}
            xKey="quarter"
            yKeys={[{ key: 'rate', label: t.rate, color: 'hsl(var(--primary))' }]}
            cellColors={cellColors}
            yFormatter={(value) => `${value}%`}
            showLegend={false}
            height={280}
            onItemSelect={revealQuarterBreakdown}
          />
        )}
      </SectionCard>

      <div id="sla-quarter-breakdown" className="scroll-mt-24">
        <SectionCard
          title={t.headline}
          description={labels.comparison.generatedContext(f.formatDate(report.generated_at, { dateStyle: 'medium', timeStyle: 'short' }))}
        >
        {quarters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noQuarters}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-premium w-full">
              <thead>
                <tr>
                  <th>{t.quarterColumn}</th>
                  <th>{t.received}</th>
                  <th>{t.onTime}</th>
                  <th>{t.breached}</th>
                  <th>{t.pending}</th>
                  <th>{t.rate}</th>
                  <th>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {[...quarters].reverse().map((q) => (
                  <tr
                    key={q.quarter}
                    className={cn(rowAccentClass('status', q.meets_target ? 'compliant' : 'breached'))}
                  >
                    <td className="font-medium">{q.quarter}</td>
                    <td className="tabular-nums">{f.formatNumber(q.received)}</td>
                    <td className="tabular-nums">{f.formatNumber(q.on_time)}</td>
                    <td className="tabular-nums">{f.formatNumber(q.breached)}</td>
                    <td className="tabular-nums">{f.formatNumber(q.pending)}</td>
                    <td className="tabular-nums font-medium">
                      {f.formatNumber(Number(q.rate_pct.toFixed(1)))}%
                    </td>
                    <td>
                      <Badge variant={q.meets_target ? 'success' : 'warning'}>
                        {q.meets_target ? t.meets : t.misses}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </SectionCard>
      </div>

      <SectionCard title={t.exceptionTitle} description={t.exceptionDescription}>
        {exceptionRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noExceptions}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-premium w-full">
              <thead>
                <tr>
                  <th>{t.exceptionQuarter}</th>
                  <th>{t.exceptionType}</th>
                  <th>{t.exceptionCount}</th>
                  <th>{t.exceptionAction}</th>
                </tr>
              </thead>
              <tbody>
                {exceptionRows.map((row) => (
                  <tr
                    key={`${row.quarter}-${row.kind}`}
                    className={cn(rowAccentClass('status', row.kind === 'breached' ? 'breached' : 'pending'))}
                  >
                    <td className="font-medium">{row.quarter}</td>
                    <td>
                      <Badge variant={row.kind === 'breached' ? 'destructive' : 'warning'}>
                        {row.kind === 'breached' ? t.exceptionBreached : t.exceptionPending}
                      </Badge>
                    </td>
                    <td className="tabular-nums">{f.formatNumber(row.count)}</td>
                    <td>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={serviceDeskExceptionHref(row.kind)}>
                          {row.kind === 'breached' ? t.reviewBreached : t.reviewPending}
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
