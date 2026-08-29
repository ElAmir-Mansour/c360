'use client';

import { Zap, Bell, CheckCircle2, XCircle } from 'lucide-react';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { LineChart } from '@/components/shared/charts/line-chart';
import { PieChart } from '@/components/shared/charts/pie-chart';
import { KpiCard } from '@/components/shared/kpi-card';
import type { DetectionRule, DetectionRulePerformance } from '@/types/cyber';

import { useRulesLabels } from '../../_lib/rules-i18n';

interface RulePerformanceProps {
  rule: DetectionRule;
  performance?: DetectionRulePerformance;
  loading?: boolean;
}

export function RulePerformance({ rule, performance, loading = false }: RulePerformanceProps) {
  const t = useRulesLabels();
  const alertTrend = (performance?.alert_trend ?? []).map((point) => ({
    date: new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    alerts: point.count,
  }));

  const severityData = (performance?.severity_distribution ?? []).map((item) => ({
    name: item.name,
    value: item.count,
    color:
      item.name === 'critical'
        ? 'hsl(var(--severity-critical))'
        : item.name === 'high'
        ? 'hsl(var(--severity-high))'
        : item.name === 'medium'
        ? 'hsl(var(--severity-medium))'
        : 'hsl(var(--severity-info))',
  }));

  const topAssets = (performance?.top_assets ?? []).map((item) => ({
    asset: item.asset_name,
    alerts: item.alert_count,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t.performance.triggers}
          value={rule.trigger_count.toLocaleString()}
          icon={Zap}
          tone="sky"
          loading={loading}
          className=""
        />
        <KpiCard
          title={t.performance.alerts30d}
          value={performance?.alerts_last_30_days ?? 0}
          icon={Bell}
          tone="sky"
          loading={loading}
          className=""
        />
        <KpiCard
          title={t.performance.truePositiveRate}
          value={`${((performance?.true_positive_rate ?? 0) * 100).toFixed(1)}%`}
          icon={CheckCircle2}
          tone="emerald"
          loading={loading}
          className=""
        />
        <KpiCard
          title={t.performance.falsePositiveRate}
          value={`${((performance?.false_positive_rate ?? 0) * 100).toFixed(1)}%`}
          icon={XCircle}
          tone="rose"
          loading={loading}
          className=""
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <LineChart
          data={alertTrend}
          xKey="date"
          yKeys={[{ key: 'alerts', label: t.performance.alertsSeries, color: 'hsl(var(--chart-6))' }]}
          title={t.performance.alertTrendTitle}
          loading={loading}
          height={320}
        />
        <PieChart
          data={severityData}
          title={t.performance.severityDistribution}
          loading={loading}
          centerLabel={t.performance.alertsCenter}
          centerValue={String(performance?.alerts_last_90_days ?? 0)}
          height={320}
        />
      </div>

      <BarChart
        data={topAssets}
        xKey="asset"
        yKeys={[{ key: 'alerts', label: t.performance.alertsSeries, color: 'hsl(var(--chart-2))' }]}
        layout="horizontal"
        title={t.performance.topTriggeredAssets}
        loading={loading}
        height={320}
      />
    </div>
  );
}
