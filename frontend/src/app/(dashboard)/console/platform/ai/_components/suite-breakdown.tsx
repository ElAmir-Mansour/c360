'use client';

import { useMemo } from 'react';
import { Layers } from 'lucide-react';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { EmptyState } from '@/components/common/empty-state';
import { useT } from '@/components/providers/locale-provider';
import type { FleetAiModelSlug } from '@/types/platform';

interface SuiteBreakdownProps {
  models?: FleetAiModelSlug[];
  loading?: boolean;
}

interface SuiteAgg {
  suite: string;
  /** Localized label used as the chart axis tick. */
  suiteLabel: string;
  models: number;
  in_production: number;
  shadow: number;
  drift_alerts: number;
}

/**
 * By-suite breakdown derived client-side from the per-model-slug rollup
 * (`FleetAiModels.models`). The fleet endpoint returns models, not a pre-bucketed
 * suite table, so we fold them here into one row per suite and render a stacked
 * in-production / shadow bar chart. Colors are bound to design tokens.
 */
export function SuiteBreakdown({ models, loading }: SuiteBreakdownProps) {
  const t = useT();
  const data = useMemo<SuiteAgg[]>(() => {
    if (!models) return [];
    const bySuite = new Map<string, SuiteAgg>();
    for (const m of models) {
      const suite = m.suite || 'unassigned';
      const suiteLabel = m.suite || t('platformConsole.ai.unassigned');
      const row =
        bySuite.get(suite) ??
        { suite, suiteLabel, models: 0, in_production: 0, shadow: 0, drift_alerts: 0 };
      row.models += 1;
      row.in_production += m.in_production ?? 0;
      row.shadow += m.shadow ?? 0;
      row.drift_alerts += m.drift_alerts ?? 0;
      bySuite.set(suite, row);
    }
    return Array.from(bySuite.values()).sort(
      (a, b) => b.in_production + b.shadow - (a.in_production + a.shadow),
    );
  }, [models, t]);

  if (!loading && data.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-caps-wide text-muted-foreground">
          {t('platformConsole.ai.bySuite')}
        </h2>
        <EmptyState
          icon={Layers}
          title={t('platformConsole.ai.noSuiteTitle')}
          description={t('platformConsole.ai.noSuiteDescription')}
          size="compact"
        />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-caps-wide text-muted-foreground">
        {t('platformConsole.ai.bySuite')}
      </h2>
      <BarChart
        data={data as unknown as Array<Record<string, unknown>>}
        xKey="suiteLabel"
        layout="horizontal"
        stacked
        loading={loading}
        height={Math.max(220, data.length * 48)}
        yKeys={[
          {
            key: 'in_production',
            label: t('platformConsole.ai.inProduction'),
            color: 'hsl(var(--primary))',
          },
          {
            key: 'shadow',
            label: t('platformConsole.ai.shadow'),
            color: 'hsl(var(--chart-3))',
          },
        ]}
      />
    </div>
  );
}
