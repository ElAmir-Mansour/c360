'use client';

import { ShieldCheck, Activity, Radar, Target } from 'lucide-react';

import { KpiCard } from '@/components/shared/kpi-card';
import type { DetectionRuleStats } from '@/types/cyber';

import { useRulesLabels } from '../_lib/rules-i18n';

interface RuleStatsProps {
  stats?: DetectionRuleStats;
  loading?: boolean;
}

function countFor(items: DetectionRuleStats['by_type'] | undefined, name: string): number {
  return items?.find((item) => item.name === name)?.count ?? 0;
}

export function RuleStats({ stats, loading = false }: RuleStatsProps) {
  const t = useRulesLabels();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title={t.stats.totalRules}
        value={stats?.total ?? 0}
        icon={ShieldCheck}
        tone="sky"
        description={t.stats.totalDescription}
        loading={loading}
      />
      <KpiCard
        title={t.stats.activeRules}
        value={stats?.active ?? 0}
        icon={Activity}
        tone="emerald"
        change={stats ? (stats.total > 0 ? (stats.active / stats.total) * 100 : 0) : 0}
        changeLabel={t.stats.enabledChange}
        loading={loading}
      />
      <KpiCard
        title={t.stats.typeMix}
        value={
          stats
            ? `${countFor(stats.by_type, 'sigma')}/${countFor(stats.by_type, 'threshold')}/${countFor(stats.by_type, 'correlation')}/${countFor(stats.by_type, 'anomaly')}`
            : '0/0/0/0'
        }
        icon={Radar}
        tone="slate"
        description={t.stats.typeMixDescription}
        loading={loading}
      />
      <KpiCard
        title={t.stats.truePositiveRate}
        value={`${((stats?.true_positive_rate ?? 0) * 100).toFixed(1)}%`}
        icon={Target}
        tone="emerald"
        description={t.stats.truePositiveDescription(stats?.alerts_last_30_days ?? 0)}
        loading={loading}
      />
    </div>
  );
}
