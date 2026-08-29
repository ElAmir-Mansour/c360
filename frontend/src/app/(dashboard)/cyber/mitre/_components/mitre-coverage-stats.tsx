'use client';

import { Activity, MoonStar, ShieldCheck, TriangleAlert } from 'lucide-react';

import { GaugeChart } from '@/components/shared/charts/gauge-chart';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { KpiCard } from '@/components/shared/kpi-card';
import type { MITRECoverage } from '@/types/cyber';

import { useMitreLabels } from '../_lib/mitre-i18n';

export function MitreCoverageStats({ coverage }: { coverage: MITRECoverage }) {
  const t = useMitreLabels();
  const tacticData = coverage.tactics.map((tactic) => ({
    tactic: tactic.short_name ?? tactic.name,
    covered: tactic.covered_count,
    total: tactic.technique_count,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title={t.stats.coverage} value={`${coverage.covered_techniques}/${coverage.total_techniques}`} icon={ShieldCheck} tone="emerald" description={t.stats.coverageDescription(coverage.coverage_percent.toFixed(1))} />
        <KpiCard title={t.stats.activeTechniques} value={coverage.active_techniques} icon={Activity} tone="sky" description={t.stats.activeDescription} />
        <KpiCard title={t.stats.passiveTechniques} value={coverage.passive_techniques} icon={MoonStar} tone="slate" description={t.stats.passiveDescription} />
        <KpiCard title={t.stats.criticalGaps} value={coverage.critical_gap_count} icon={TriangleAlert} tone="rose" description={t.stats.criticalGapsDescription} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_1fr]">
        <div className="rounded-softer surface-card p-5">
          <p className="text-sm font-medium text-foreground">{t.stats.overallCoverage}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.stats.overallDescription}</p>
          <div className="mt-4">
            <GaugeChart value={coverage.coverage_percent} label={t.stats.coverageLabel} max={100} />
          </div>
        </div>
        <BarChart
          data={tacticData}
          xKey="tactic"
          yKeys={[
            { key: 'covered', label: t.stats.coveredSeries, color: 'hsl(var(--chart-6))' },
            { key: 'total', label: t.stats.totalSeries, color: 'hsl(var(--muted-foreground) / 0.35)' },
          ]}
          title={t.stats.coverageByTactic}
          height={280}
        />
      </div>
    </div>
  );
}
