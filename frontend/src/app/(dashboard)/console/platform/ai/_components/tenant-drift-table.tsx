'use client';

import { cn } from '@/lib/utils';
import { SimpleTable } from '@/components/shared/simple-table';
import { useT } from '@/components/providers/locale-provider';
import type { FleetAiTenantRow } from '@/types/platform';

interface TenantDriftTableProps {
  rows: FleetAiTenantRow[];
  loading?: boolean;
}

type DriftHealth = FleetAiTenantRow['drift_health'];

const HEALTH_CLASS: Record<DriftHealth, string> = {
  healthy: 'bg-primary/15 text-primary',
  warning: 'bg-warning-100 text-warning-700 dark:bg-warning-700/20 dark:text-warning-300',
  critical: 'bg-destructive/10 text-destructive',
};

function DriftHealthBadge({ value, label }: { value: DriftHealth; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        HEALTH_CLASS[value] ?? HEALTH_CLASS.healthy,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Per-tenant drift health table (§E.5 #8). Worst-case `drift_health` drives the
 * row badge tone; drift-alert counts are emphasized in rose when non-zero. Sorted
 * server-side already, but we surface the cross-tenant rollup as-is. Empty/loading
 * are handled by the lightweight SimpleTable.
 */
export function TenantDriftTable({ rows, loading }: TenantDriftTableProps) {
  const t = useT();

  const columns = [
    {
      key: 'tenant_name',
      header: t('platformConsole.ai.tenant'),
      render: (r: FleetAiTenantRow) => (
        <span className="font-medium text-foreground">{r.tenant_name}</span>
      ),
    },
    {
      key: 'total_models',
      header: t('platformConsole.ai.totalModels'),
      align: 'right' as const,
      render: (r: FleetAiTenantRow) => (
        <span className="tabular-nums">{r.total_models}</span>
      ),
    },
    {
      key: 'in_production',
      header: t('platformConsole.ai.inProduction'),
      align: 'right' as const,
      render: (r: FleetAiTenantRow) => (
        <span className="tabular-nums">{r.in_production}</span>
      ),
    },
    {
      key: 'shadow',
      header: t('platformConsole.ai.shadow'),
      align: 'right' as const,
      render: (r: FleetAiTenantRow) => (
        <span className="tabular-nums text-muted-foreground">{r.shadow}</span>
      ),
    },
    {
      key: 'drift_alerts',
      header: t('platformConsole.ai.driftAlerts'),
      align: 'right' as const,
      render: (r: FleetAiTenantRow) => (
        <span
          className={cn(
            'tabular-nums',
            r.drift_alerts > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground',
          )}
        >
          {r.drift_alerts}
        </span>
      ),
    },
    {
      key: 'drift_health',
      header: t('platformConsole.ai.driftHealth'),
      align: 'right' as const,
      render: (r: FleetAiTenantRow) => (
        <DriftHealthBadge
          value={r.drift_health}
          label={t(`platformConsole.ai.health.${r.drift_health}` as const)}
        />
      ),
    },
  ];

  return (
    // SimpleTable's generic requires Record<string, unknown>; the typed row
    // interface satisfies it structurally, so we widen at the boundary only.
    <SimpleTable<FleetAiTenantRow & Record<string, unknown>>
      columns={columns}
      data={rows as Array<FleetAiTenantRow & Record<string, unknown>>}
      loading={loading}
      ariaLabel={t('platformConsole.ai.driftHealthTitle')}
      emptyMessage={t('platformConsole.ai.noTenants')}
      getRowKey={(r) => r.tenant_id}
    />
  );
}
