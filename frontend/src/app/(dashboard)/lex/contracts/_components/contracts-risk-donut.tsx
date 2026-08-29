/**
 * <ContractsRiskDonut> — risk-level distribution donut for the contracts
 * ANALYTICS view.
 *
 * Fed by the `by_risk_level` map of `GET /contracts/stats` (the same
 * server-accurate rollup behind the page's KPI tiles — TanStack dedupes the
 * two consumers onto one request via the shared query key). Slices are ordered
 * most→least severe by the pure `deriveRiskSlices` helper and colored from the
 * RESERVED severity palette (never the categorical ramp), with the "none"
 * bucket in muted ink.
 *
 * NOTE the stats endpoint is portfolio-wide (it takes no filters), so the card
 * description says so instead of implying the donut follows the table filters.
 *
 * Rendering rides the shared `<PieChart>` wrapper: hover tooltips with slice
 * percentages, a toggleable legend (identity never color-alone), center total,
 * loading/empty surfaces, and code-split recharts.
 */

'use client';

import { memo, useMemo } from 'react';
import { PieChart } from '@/components/shared/charts/pie-chart';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import { contractRiskLabels } from '../_lib/contracts-labels';
import { deriveRiskSlices } from '../_lib/contracts-analytics';
import { riskSliceColor } from './contracts-analytics-palette';

/* ---------------------------- Bilingual labels ---------------------------- */

interface RiskDonutLabels {
  title: string;
  description: string;
  centerLabel: string;
  emptyMessage: string;
}

const riskDonutLabels: LexBilingual<RiskDonutLabels> = {
  en: {
    title: 'Risk distribution',
    description: 'Portfolio-wide contract count per assessed risk level.',
    centerLabel: 'Contracts',
    emptyMessage: 'No risk assessments recorded yet.',
  },
  ar: {
    title: 'توزيع المخاطر',
    description: 'عدد العقود لكل مستوى مخاطر مُقيَّم على مستوى المحفظة.',
    centerLabel: 'العقود',
    emptyMessage: 'لا توجد تقييمات مخاطر مسجّلة بعد.',
  },
};

/** Donut geometry hoisted out of render (no per-render object churn). */
const INNER_RADIUS = 56;
const OUTER_RADIUS = 88;
const CHART_HEIGHT = 240;

export interface ContractsRiskDonutProps {
  /** `by_risk_level` from `GET /contracts/stats`. */
  byRiskLevel: Record<string, number> | null | undefined;
  loading?: boolean;
  /** Localized error line; renders the shared chart error state. */
  error?: string;
  onRetry?: () => void;
  onRiskSelect?: (risk: string) => void;
  className?: string;
}

function ContractsRiskDonutImpl({
  byRiskLevel,
  loading = false,
  error,
  onRetry,
  onRiskSelect,
  className,
}: ContractsRiskDonutProps) {
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const labels = useMemo(() => resolveLexBilingual(riskDonutLabels, locale), [locale]);
  const riskLabels = useMemo(() => resolveLexBilingual(contractRiskLabels, locale), [locale]);

  const view = useMemo(() => {
    const slices = deriveRiskSlices(byRiskLevel);
    return {
      data: slices.map((slice) => ({
        key: slice.key,
        name: riskLabels[slice.key] ?? slice.key,
        value: slice.count,
        color: riskSliceColor(slice.key),
      })),
      total: slices.reduce((sum, slice) => sum + slice.count, 0),
    };
  }, [byRiskLevel, riskLabels]);

  const isEmpty = view.total <= 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <PieChart
          data={view.data}
          innerRadius={INNER_RADIUS}
          outerRadius={OUTER_RADIUS}
          height={CHART_HEIGHT}
          loading={loading}
          error={error}
          onRetry={onRetry}
          empty={!loading && !error && isEmpty}
          emptyMessage={labels.emptyMessage}
          showLegend
          centerValue={f.formatNumber(view.total)}
          centerLabel={labels.centerLabel}
          onItemSelect={
            onRiskSelect
              ? (name) => {
                  const selected = view.data.find((item) => item.name === name);
                  if (selected) onRiskSelect(selected.key);
                }
              : undefined
          }
        />
      </CardContent>
    </Card>
  );
}

/** PERF: pure projection of its props — memo keeps steady-state renders free. */
export const ContractsRiskDonut = memo(ContractsRiskDonutImpl);
