'use client';

import { Activity, AlarmClock, GaugeCircle, ShieldAlert, Target, Timer } from 'lucide-react';
import { MetricTile } from '@/components/shared/metric-tile';
import { formatRecoveryDuration } from '@/components/product';
import { formatPercent, type OpsInsights } from '../_lib/insights-aggregation';
import { useInsightsLabels } from './insights-labels';

/**
 * Dense, scannable strip of the headline ops-insights metrics. Every value is
 * derived from real history by {@link OpsInsights} — no value is fabricated.
 * `MetricTile` carries its own tokenized styling; tone selects an accent.
 *
 * RTL-safe: the grid flows with logical writing direction and each tile is
 * self-contained, so mirroring is automatic. Each tile pairs its number with a
 * text caption so the meaning is available to assistive tech without color.
 */
export function InsightsMetricStrip({ insights }: { insights: OpsInsights }) {
  const labels = useInsightsLabels();
  const { runPerformance, drillOutcomes, rpoBreaches } = insights;

  const attainmentTone =
    runPerformance.attainmentRate === null
      ? 'muted'
      : runPerformance.attainmentRate >= 0.9
        ? 'success'
        : runPerformance.attainmentRate >= 0.7
          ? 'warning'
          : 'danger';

  const drillTone =
    drillOutcomes.passRate === null
      ? 'muted'
      : drillOutcomes.passRate >= 0.9
        ? 'success'
        : drillOutcomes.passRate >= 0.7
          ? 'warning'
          : 'danger';

  const rpoTone = rpoBreaches.breachingStreams > 0 ? 'danger' : 'success';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <MetricTile
        icon={Target}
        tone={attainmentTone}
        label={labels.attainmentLabel}
        value={formatPercent(runPerformance.attainmentRate, labels.naLabel)}
        aria-label={`${labels.attainmentLabel}: ${formatPercent(
          runPerformance.attainmentRate,
          labels.naLabel,
        )} — ${labels.attainmentCaption(runPerformance.metRtoRuns, runPerformance.measuredRuns)}`}
      />
      <MetricTile
        icon={Timer}
        tone="info"
        label={labels.medianDurationLabel}
        value={formatRecoveryDuration(runPerformance.medianDurationSeconds, labels.naLabel)}
      />
      <MetricTile
        icon={AlarmClock}
        tone="info"
        label={labels.p90DurationLabel}
        value={formatRecoveryDuration(runPerformance.p90DurationSeconds, labels.naLabel)}
      />
      <MetricTile
        icon={GaugeCircle}
        tone={drillTone}
        label={labels.drillPassRateLabel}
        value={formatPercent(drillOutcomes.passRate, labels.naLabel)}
        aria-label={`${labels.drillPassRateLabel}: ${formatPercent(
          drillOutcomes.passRate,
          labels.naLabel,
        )} — ${labels.drillPassCaption(drillOutcomes.passedDrills, drillOutcomes.totalDrills)}`}
      />
      <MetricTile
        icon={ShieldAlert}
        tone={rpoTone}
        label={labels.rpoBreachLabel}
        value={rpoBreaches.breachingStreams}
        aria-label={`${labels.rpoBreachLabel}: ${labels.rpoBreachCaption(
          rpoBreaches.breachingStreams,
          rpoBreaches.totalStreams,
        )}`}
      />
      <MetricTile
        icon={Activity}
        tone={runPerformance.activeRuns > 0 ? 'primary' : 'muted'}
        label={labels.activeRunsLabel}
        value={runPerformance.activeRuns}
      />
    </div>
  );
}
