'use client';

/**
 * Header KPI strip for the integrations console: total connectors plus a count
 * per health grade (healthy / degraded / down / not-configured). Counts are
 * derived from the registry rows folded with any fresh health probes.
 */
import { Activity, AlertTriangle, CheckCircle2, CircleSlash, Plug } from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import type { GradeCounts } from '../_lib/health-presentation';
import type { IntegrationsListLabels } from '../_lib/integrations-i18n';

interface HealthKpiStripProps {
  counts: GradeCounts;
  labels: IntegrationsListLabels;
  loading?: boolean;
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function HealthKpiStrip({ counts, labels: t, loading = false }: HealthKpiStripProps) {
  const healthyShare = percent(counts.healthy, counts.total);
  const degradedShare = percent(counts.degraded, counts.total);
  const downShare = percent(counts.down, counts.total);
  const unconfiguredShare = percent(counts.unconfigured, counts.total);

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
      data-testid="health-kpi-strip"
    >
      <div className="contents" data-testid="health-kpi-total">
        <KpiCard
          appearance="operational"
          title={t.kpiTotal}
          value={counts.total}
          tone="teal"
          icon={Plug}
          loading={loading}
          href="#integration-registry"
        />
      </div>
      <div className="contents" data-testid="health-kpi-healthy">
        <KpiCard
          appearance="operational"
          title={t.kpiHealthy}
          value={counts.healthy}
          tone="emerald"
          icon={CheckCircle2}
          loading={loading}
          progress={healthyShare}
          progressLabel={t.kpiTotal}
          detail={t.kpiTotal}
          detailValue={`${healthyShare}%`}
          href="#integration-registry"
        />
      </div>
      <div className="contents" data-testid="health-kpi-degraded">
        <KpiCard
          appearance="operational"
          title={t.kpiDegraded}
          value={counts.degraded}
          tone="gold"
          icon={Activity}
          loading={loading}
          progress={degradedShare}
          progressLabel={t.kpiTotal}
          detail={t.kpiTotal}
          detailValue={`${degradedShare}%`}
          href="#integration-registry"
        />
      </div>
      <div className="contents" data-testid="health-kpi-down">
        <KpiCard
          appearance="operational"
          title={t.kpiDown}
          value={counts.down}
          tone="rose"
          icon={AlertTriangle}
          loading={loading}
          progress={downShare}
          progressLabel={t.kpiTotal}
          detail={t.kpiTotal}
          detailValue={`${downShare}%`}
          href="#integration-registry"
        />
      </div>
      <div className="contents" data-testid="health-kpi-unconfigured">
        <KpiCard
          appearance="operational"
          title={t.kpiUnconfigured}
          value={counts.unconfigured}
          tone="slate"
          icon={CircleSlash}
          loading={loading}
          progress={unconfiguredShare}
          progressLabel={t.kpiTotal}
          detail={t.kpiTotal}
          detailValue={`${unconfiguredShare}%`}
          href="#integration-registry"
        />
      </div>
    </div>
  );
}

export default HealthKpiStrip;
