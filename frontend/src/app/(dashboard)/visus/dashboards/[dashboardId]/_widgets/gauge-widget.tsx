'use client';

import type { WidgetBodyProps } from './widget-body-props';
import type { VisusGaugeWidgetData, VisusKPIStatus } from '@/types/suites';
import { GaugeChart } from '@/components/shared/charts';
import { statusVar, type StatusTone } from '@/lib/design-tokens';
import { Button } from '@/components/ui/button';
import { pickEnumLabel, useVisusEnumLabels, useVisusWidgetChromeLabels } from '../../../_lib/visus-i18n';

/** KPI status → reserved status tone (drives the caption color). */
const STATUS_TONE: Record<VisusKPIStatus, StatusTone> = {
  normal: 'success',
  warning: 'warning',
  critical: 'error',
  unknown: 'neutral',
};

/**
 * Map the backend gauge payload to {@link GaugeChart}'s percent breakpoints.
 * The chart colors by `value/max` percent: `≥good` → success, `≥warning` →
 * warning, else error. We express the backend value thresholds as percentages
 * of `max` (good = warning threshold, warning = critical threshold). Both must
 * be present to form a valid `{good, warning}` pair — otherwise we omit it and
 * let the chart use its defaults.
 */
function toChartThresholds(
  data: VisusGaugeWidgetData,
): { good: number; warning: number } | undefined {
  const { warning, critical } = data.thresholds;
  if (warning == null || critical == null || data.max <= 0) return undefined;
  const pct = (n: number) => Math.min(Math.max((n / data.max) * 100, 0), 100);
  return { good: pct(warning), warning: pct(critical) };
}

export function GaugeWidget({ data, isLoading, isError, onRetry }: WidgetBodyProps<VisusGaugeWidgetData>) {
  const t = useVisusWidgetChromeLabels();
  const enums = useVisusEnumLabels();
  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <GaugeChart value={0} max={100} size={180} loading />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="text-xs text-muted-foreground">{t.couldntLoadGauge}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t.retry}
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <p className="text-xs text-muted-foreground">{t.noDataAvailable}</p>
      </div>
    );
  }

  const tone = STATUS_TONE[data.status] ?? 'neutral';
  const label = pickEnumLabel(enums.kpiStatus, data.status);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
      <GaugeChart
        value={data.value}
        max={data.max}
        thresholds={toChartThresholds(data)}
        size={180}
        format="number"
      />
      <div className="mt-1 flex items-center gap-1.5 text-caption">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: statusVar(tone) }}
          aria-hidden
        />
        <span className="text-muted-foreground">{t.statusPrefix}</span>
        <span className="font-medium" style={{ color: statusVar(tone) }}>
          {label}
        </span>
      </div>
    </div>
  );
}
