'use client';

import { cn } from '@/lib/utils';
import { SimpleTable } from '@/components/shared/simple-table';
import { useT } from '@/components/providers/locale-provider';
import type { FleetAiModelSlug } from '@/types/platform';

const RISK_TIER_CLASS: Record<string, string> = {
  low: 'bg-primary/15 text-primary',
  medium: 'bg-warning-100 text-warning-700 dark:bg-warning-700/20 dark:text-warning-300',
  high: 'bg-error-100 text-error-700 dark:bg-error-700/20 dark:text-error-300',
  critical: 'bg-destructive/10 text-destructive',
};

interface FleetModelsTableProps {
  models: FleetAiModelSlug[];
  loading?: boolean;
  onSelect: (model: FleetAiModelSlug) => void;
}

/**
 * Fleet-wide model catalog (one row per slug) — the entry point for the
 * per-model-slug drill-down. The same default models are seeded into every
 * tenant, so this is effectively the canonical model list with cross-tenant
 * adoption counts. Clicking a row opens the slug drill-down panel.
 */
export function FleetModelsTable({ models, loading, onSelect }: FleetModelsTableProps) {
  const t = useT();

  const columns = [
    {
      key: 'display_name',
      header: t('platformConsole.ai.model'),
      render: (m: FleetAiModelSlug) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{m.display_name}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{m.slug}</div>
        </div>
      ),
    },
    {
      key: 'suite',
      header: t('platformConsole.ai.suite'),
      render: (m: FleetAiModelSlug) => (
        <span className="text-muted-foreground">
          {m.suite || t('platformConsole.ai.unassigned')}
        </span>
      ),
    },
    {
      key: 'risk_tier',
      header: t('platformConsole.ai.riskTier'),
      render: (m: FleetAiModelSlug) =>
        m.risk_tier ? (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
              RISK_TIER_CLASS[m.risk_tier] ?? 'bg-muted text-muted-foreground',
            )}
          >
            {m.risk_tier in RISK_TIER_CLASS
              ? t(`platformConsole.ai.risk.${m.risk_tier}` as never)
              : m.risk_tier}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'tenants_using',
      header: t('platformConsole.ai.tenants'),
      align: 'right' as const,
      render: (m: FleetAiModelSlug) => <span className="tabular-nums">{m.tenants_using}</span>,
    },
    {
      key: 'in_production',
      header: t('platformConsole.ai.inProduction'),
      align: 'right' as const,
      render: (m: FleetAiModelSlug) => <span className="tabular-nums">{m.in_production}</span>,
    },
    {
      key: 'shadow',
      header: t('platformConsole.ai.shadow'),
      align: 'right' as const,
      render: (m: FleetAiModelSlug) => (
        <span className="tabular-nums text-muted-foreground">{m.shadow}</span>
      ),
    },
    {
      key: 'drift_alerts',
      header: t('platformConsole.ai.driftAlerts'),
      align: 'right' as const,
      render: (m: FleetAiModelSlug) => (
        <span
          className={
            m.drift_alerts > 0
              ? 'font-semibold tabular-nums text-destructive'
              : 'tabular-nums text-muted-foreground'
          }
        >
          {m.drift_alerts}
        </span>
      ),
    },
  ];

  return (
    // Widen to satisfy SimpleTable's Record<string, unknown> generic constraint.
    <SimpleTable<FleetAiModelSlug & Record<string, unknown>>
      columns={columns}
      data={models as Array<FleetAiModelSlug & Record<string, unknown>>}
      loading={loading}
      ariaLabel={t('platformConsole.ai.modelsTitle')}
      emptyMessage={t('platformConsole.ai.noModels')}
      getRowKey={(m) => m.slug}
      onRowClick={onSelect}
    />
  );
}
