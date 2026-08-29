/**
 * <ContractsExpiryCliffChart> — the forward-looking 24-month expiry cliff for
 * the contracts ANALYTICS view.
 *
 * Consumes the dense `expiry_cliff` series ({month, count, value}, zero-filled
 * by the backend) from the upgraded `GET /reports/contracts-analytics` payload
 * and renders a single-hue column chart through the shared `<BarChart>`
 * wrapper (tooltips, RTL mirroring, loading/empty/error surfaces, code-split
 * recharts).
 *
 * Count and value are two measures on DIFFERENT scales, so this chart never
 * dual-axes them: a segmented count|value toggle switches the plotted metric
 * (one axis at a time), and a headline line above the plot always shows the
 * "next 12 months" count + value together via `summarizeExpiryCliff`.
 *
 * Month ticks resolve through `useLexFormat().formatDate` (localized short
 * month + 2-digit year — Arabic month names and Arabic-Indic digits in `ar`);
 * values are raw cross-currency sums, formatted as plain compact numbers.
 */

'use client';

import { memo, useMemo, useState } from 'react';
import { BarChart } from '@/components/shared/charts/bar-chart';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexExpiryCliffPoint } from '@/lib/lex/reports';
import { cn } from '@/lib/utils';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import { parseCliffMonth, summarizeExpiryCliff } from '../_lib/contracts-analytics';
import { EXPIRY_CLIFF_COLOR } from './contracts-analytics-palette';

/* ---------------------------- Bilingual labels ---------------------------- */

interface ExpiryCliffLabels {
  title: string;
  description: string;
  metricToggle: string;
  countMetric: string;
  valueMetric: string;
  emptyMessage: string;
  /** Headline over the plot. Receives PRE-FORMATTED count + value strings. */
  next12Months: (count: string, value: string) => string;
  crossCurrencyNote: string;
}

const expiryCliffLabels: LexBilingual<ExpiryCliffLabels> = {
  en: {
    title: 'Expiry cliff (24 months)',
    description: 'Live contracts expiring per month across the coming 24 months.',
    metricToggle: 'Cliff metric',
    countMetric: 'Count',
    valueMetric: 'Value',
    emptyMessage: 'No live contracts expire in the next 24 months.',
    next12Months: (count, value) => `Next 12 months: ${count} contracts · ${value} total value`,
    crossCurrencyNote: 'Values are raw sums across currencies (no FX conversion).',
  },
  ar: {
    title: 'منحدر الانتهاء (٢٤ شهرًا)',
    description: 'العقود السارية المنتهية شهريًا خلال الأشهر الأربعة والعشرين القادمة.',
    metricToggle: 'مقياس المنحدر',
    countMetric: 'العدد',
    valueMetric: 'القيمة',
    emptyMessage: 'لا توجد عقود سارية تنتهي خلال ٢٤ شهرًا القادمة.',
    next12Months: (count, value) =>
      `خلال ١٢ شهرًا القادمة: ${count} عقدًا · ${value} قيمة إجمالية`,
    crossCurrencyNote: 'القيم مجاميع خام عبر العملات (دون تحويل صرف).',
  },
};

const CHART_HEIGHT = 280;
/** Headline horizon (leading months summed into the "next N months" line). */
const HEADLINE_MONTHS = 12;

type CliffMetric = 'count' | 'value';

export interface ContractsExpiryCliffChartProps {
  /** Dense `expiry_cliff` series from the analytics report. */
  points: LexExpiryCliffPoint[] | null | undefined;
  loading?: boolean;
  /** Localized error line; renders the shared chart error state. */
  error?: string;
  onRetry?: () => void;
  onMonthSelect?: (month: string) => void;
  className?: string;
}

function ContractsExpiryCliffChartImpl({
  points,
  loading = false,
  error,
  onRetry,
  onMonthSelect,
  className,
}: ContractsExpiryCliffChartProps) {
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const labels = useMemo(() => resolveLexBilingual(expiryCliffLabels, locale), [locale]);
  const [metric, setMetric] = useState<CliffMetric>('count');

  /* Rows + headline in one pass, keyed on the series + formatter locale. */
  const view = useMemo(() => {
    const series = points ?? [];
    const rows = series.map((point) => {
      const date = parseCliffMonth(point.month);
      return {
        key: point.month,
        month: date ? f.formatDate(date, { month: 'short', year: '2-digit' }) : point.month,
        count: point.count,
        value: point.value,
      };
    });
    const headline = summarizeExpiryCliff(series, HEADLINE_MONTHS);
    return {
      rows,
      headline,
      hasAny: rows.some((row) => row.count > 0 || row.value > 0),
    };
  }, [points, f]);

  const yKeys = useMemo(
    () => [
      {
        key: metric,
        label: metric === 'count' ? labels.countMetric : labels.valueMetric,
        color: EXPIRY_CLIFF_COLOR,
      },
    ],
    [metric, labels.countMetric, labels.valueMetric],
  );

  // Vertical layout: `yFormatter` formats the numeric axis AND tooltip values.
  const yFormatter = (value: number) =>
    metric === 'count' ? f.formatNumber(value) : f.formatCompact(value);

  const isEmpty = !view.hasAny;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="text-base">{labels.title}</CardTitle>
          <CardDescription>{labels.description}</CardDescription>
        </div>
        <div
          className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5"
          role="group"
          aria-label={labels.metricToggle}
        >
          {(['count', 'value'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMetric(option)}
              aria-pressed={metric === option}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                metric === option
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'count' ? labels.countMetric : labels.valueMetric}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loading && !error && !isEmpty ? (
          <p className="text-sm text-muted-foreground" role="status">
            {labels.next12Months(
              f.formatNumber(view.headline.count),
              f.formatCompact(view.headline.value),
            )}
          </p>
        ) : null}
        <BarChart
          data={view.rows}
          xKey="month"
          yKeys={yKeys}
          layout="vertical"
          height={CHART_HEIGHT}
          loading={loading}
          error={error}
          onRetry={onRetry}
          empty={!loading && !error && isEmpty}
          emptyMessage={labels.emptyMessage}
          yFormatter={yFormatter}
          showGrid
          showLegend={false}
          onItemSelect={
            onMonthSelect
              ? (datum) => onMonthSelect(String(datum.key ?? ''))
              : undefined
          }
        />
        {!loading && !error && !isEmpty && metric === 'value' ? (
          <p className="text-xs text-muted-foreground/80">{labels.crossCurrencyNote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** PERF: memo — only the metric toggle (local state) re-renders the plot. */
export const ContractsExpiryCliffChart = memo(ContractsExpiryCliffChartImpl);
