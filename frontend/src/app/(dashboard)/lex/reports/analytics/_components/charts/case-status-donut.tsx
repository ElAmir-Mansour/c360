/**
 * [3] Caseload by Status — DONUT chart.
 *
 * Renders the `caseStatusDonut` slice (status buckets + closed/open headline)
 * as a donut: the shared `<PieChart>` wrapper with a non-zero `innerRadius`, the
 * total caseload count stamped in the center, and each slice colored by its
 * legal STATUS tone (so "closed" is the same green here as everywhere else in
 * the suite).
 *
 * PERF CONTRACT:
 *   - Pure + `React.memo`: only re-renders when its `donut`/`loading`/`locale`
 *     inputs change.
 *   - It does NOT re-walk the raw dashboard — it consumes the precomputed
 *     `CaseStatusDonut` slice from `deriveAnalyticsSeries()`.
 *   - The slice→`{name,value,color}` projection runs in a single `useMemo` keyed
 *     on `donut.slices` + `locale` (the only inputs that change its output).
 *   - The shared `<PieChart>` is a `dynamic()` import of its recharts impl, so
 *     recharts stays out of the initial bundle and is code-split per chart.
 */

'use client';

import { memo, useMemo } from 'react';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { CaseStatusDonut } from './_lib/analytics-series';
import { toneFor } from './_lib/palette';
import { AnalyticsChartCard } from './analytics-chart-card';

/* ------------------------------------------------------------------ *
 * In-file bilingual labels (kept local to avoid touching the shared
 * analytics-labels.ts — avoids cross-agent merge conflicts).
 * ------------------------------------------------------------------ */
const COPY = {
  en: {
    title: 'Caseload by Status',
    description: 'Distribution of all legal cases across their current status.',
    centerLabel: 'Total Cases',
    empty: 'No case-status data for this window.',
    /** Human labels for known normalized status keys; unknowns fall back to the raw API label. */
    status: {
      open: 'Open',
      closed: 'Closed',
      under_procedure: 'Under Procedure',
      under_review: 'Under Review',
      pending: 'Pending',
      on_hold: 'On Hold',
      in_progress: 'In Progress',
      resolved: 'Resolved',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
      new: 'New',
      submitted: 'Submitted',
    } as Record<string, string>,
  },
  ar: {
    title: 'القضايا حسب الحالة',
    description: 'توزيع جميع القضايا القانونية وفق حالتها الحالية.',
    centerLabel: 'إجمالي القضايا',
    empty: 'لا توجد بيانات حالة قضايا لهذه الفترة.',
    status: {
      open: 'مفتوحة',
      closed: 'مغلقة',
      under_procedure: 'تحت الإجراء',
      under_review: 'قيد المراجعة',
      pending: 'معلّقة',
      on_hold: 'مُعلّقة مؤقتاً',
      in_progress: 'قيد التنفيذ',
      resolved: 'محسومة',
      rejected: 'مرفوضة',
      cancelled: 'ملغاة',
      new: 'جديدة',
      submitted: 'مُقدَّمة',
    } as Record<string, string>,
  },
} as const;

/** Donut geometry hoisted out of render so no new object is created per render. */
const INNER_RADIUS = 64;
const OUTER_RADIUS = 100;
const CHART_HEIGHT = 240;

export interface CaseStatusDonutChartProps {
  /** Precomputed donut slice from `deriveAnalyticsSeries()`. */
  donut: CaseStatusDonut;
  /** Render the card body as a shimmer. */
  loading?: boolean;
}

function CaseStatusDonutChartImpl({ donut, loading = false }: CaseStatusDonutChartProps) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;

  // Project the derived slices into the wrapper's {name,value,color} shape.
  // Keyed on the slices identity + locale (the only inputs that change output).
  const data = useMemo(
    () =>
      donut.slices.map((slice) => ({
        name: copy.status[slice.key] ?? slice.label,
        value: slice.value,
        color: toneFor(slice.key),
      })),
    [donut.slices, copy.status],
  );

  const isEmpty = donut.total <= 0 || data.length === 0;
  const centerValue = f.formatNumber(donut.total);

  return (
    <AnalyticsChartCard
      title={copy.title}
      description={copy.description}
      loading={loading}
      empty={!loading && isEmpty}
      emptyMessage={copy.empty}
      minBodyHeight={CHART_HEIGHT}
    >
      <PieChart
        data={data}
        innerRadius={INNER_RADIUS}
        outerRadius={OUTER_RADIUS}
        height={CHART_HEIGHT}
        showLegend
        centerValue={centerValue}
        centerLabel={copy.centerLabel}
        empty={isEmpty}
        emptyMessage={copy.empty}
      />
    </AnalyticsChartCard>
  );
}

export const CaseStatusDonutChart = memo(CaseStatusDonutChartImpl);
