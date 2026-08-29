/**
 * <ContractsSpendChart> — single-hue horizontal bar chart for one contract
 * spend rollup (`spend_by_type` / `spend_by_department`) inside the contracts
 * ANALYTICS view.
 *
 * Consumes the upgraded `GET /reports/contracts-analytics` `LexValueBucket[]`
 * slices through the pure `deriveSpendRows` helper (value-descending, long
 * tail folded into a localized "Other" row), and renders through the shared
 * `<BarChart>` wrapper, which owns tooltips, RTL axis mirroring, the empty /
 * loading / error surfaces, and code-splits recharts.
 *
 * Chart hygiene:
 *   - one hue per chart (magnitude job) — identity lives on the category axis
 *     labels, never on color alone;
 *   - values are RAW sums across currencies (the backend applies no FX), so
 *     the axis/tooltip render plain compact numbers and the caption states the
 *     cross-currency scope instead of faking a single currency;
 *   - numbers go through `useLexFormat` (Arabic-Indic digits in `ar` mode).
 *
 * Read-only — nothing to RBAC-gate beyond the page's own view gate.
 */

'use client';

import { memo, useMemo } from 'react';
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
import type { LexValueBucket } from '@/lib/lex/reports';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import { SPEND_OTHER_KEY, deriveSpendRows } from '../_lib/contracts-analytics';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical lex token-record contract, in-file so this
 * component stays a self-contained new file).
 * ------------------------------------------------------------------------- */

interface SpendChartLabels {
  /** Series name shown in the tooltip rows. */
  valueSeries: string;
  /** Folded long-tail row. */
  other: string;
  /** Rollup rows with an empty key (no type / no department recorded). */
  unattributed: string;
  emptyMessage: string;
  /** Caption scope note. Receives PRE-FORMATTED category + contract counts. */
  caption: (categories: string, contracts: string) => string;
  crossCurrencyNote: string;
}

const spendChartLabels: LexBilingual<SpendChartLabels> = {
  en: {
    valueSeries: 'Total value',
    other: 'Other',
    unattributed: 'Unattributed',
    emptyMessage: 'No contract value recorded for the current filters.',
    caption: (categories, contracts) =>
      `${categories} categories · ${contracts} contracts in scope`,
    crossCurrencyNote: 'Values are raw sums across currencies (no FX conversion).',
  },
  ar: {
    valueSeries: 'القيمة الإجمالية',
    other: 'أخرى',
    unattributed: 'غير مصنّف',
    emptyMessage: 'لا توجد قيمة عقود مسجّلة للمرشّحات الحالية.',
    caption: (categories, contracts) => `${categories} فئات · ${contracts} عقدًا ضمن النطاق`,
    crossCurrencyNote: 'القيم مجاميع خام عبر العملات (دون تحويل صرف).',
  },
};

const CHART_HEIGHT = 260;
/** Long-tail fold threshold — max bars before the tail folds into "Other". */
const MAX_ROWS = 8;

export interface ContractsSpendChartProps {
  /** Card heading (already localized by the caller). */
  title: string;
  /** Optional supporting line under the title (already localized). */
  description?: string;
  /** `spend_by_type` / `spend_by_department` slice from the analytics report. */
  buckets: LexValueBucket[] | null | undefined;
  /** Resolve a raw bucket key to its display label (e.g. contract-type map). */
  resolveKeyLabel?: (key: string) => string;
  /** Single series hue from `contracts-analytics-palette`. */
  color: string;
  loading?: boolean;
  /** Localized error line; renders the shared chart error state. */
  error?: string;
  onRetry?: () => void;
  onBucketSelect?: (key: string) => void;
  className?: string;
}

function ContractsSpendChartImpl({
  title,
  description,
  buckets,
  resolveKeyLabel,
  color,
  loading = false,
  error,
  onRetry,
  onBucketSelect,
  className,
}: ContractsSpendChartProps) {
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const labels = useMemo(() => resolveLexBilingual(spendChartLabels, locale), [locale]);

  /* Single transform pass: derived rows -> recharts rows + scope caption. */
  const view = useMemo(() => {
    const derived = deriveSpendRows(buckets, MAX_ROWS);
    const rows = derived.map((row) => ({
      key: row.key,
      category:
        row.key === SPEND_OTHER_KEY
          ? labels.other
          : row.key === ''
            ? labels.unattributed
            : (resolveKeyLabel?.(row.key) ?? row.key),
      value: row.value,
      count: row.count,
    }));
    return {
      rows,
      categories: buckets?.length ?? 0,
      contracts: rows.reduce((sum, row) => sum + row.count, 0),
      hasValue: rows.some((row) => row.value > 0),
    };
  }, [buckets, labels.other, labels.unattributed, resolveKeyLabel]);

  const yKeys = useMemo(
    () => [{ key: 'value', label: labels.valueSeries, color }],
    [labels.valueSeries, color],
  );

  // In horizontal layout the shared wrapper routes `yFormatter` to BOTH the
  // category axis ticks and the tooltip values, so format defensively: finite
  // numbers get compact locale digits, category strings pass through.
  const compactValue = (value: number | string) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && String(value).trim() !== ''
      ? f.formatCompact(numeric)
      : String(value);
  };

  const isEmpty = !view.hasValue;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <BarChart
          data={view.rows}
          xKey="category"
          yKeys={yKeys}
          layout="horizontal"
          height={CHART_HEIGHT}
          loading={loading}
          error={error}
          onRetry={onRetry}
          empty={!loading && !error && isEmpty}
          emptyMessage={labels.emptyMessage}
          xFormatter={compactValue}
          yFormatter={compactValue}
          showGrid
          showLegend={false}
          onItemSelect={
            onBucketSelect
              ? (datum) => onBucketSelect(String(datum.key ?? ''))
              : undefined
          }
        />
        {!loading && !error && !isEmpty ? (
          <p className="text-xs text-muted-foreground">
            {labels.caption(f.formatNumber(view.categories), f.formatNumber(view.contracts))}
            <span className="ms-2 text-muted-foreground/80">{labels.crossCurrencyNote}</span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** PERF: pure projection of its props — memo keeps steady-state renders free. */
export const ContractsSpendChart = memo(ContractsSpendChartImpl);
