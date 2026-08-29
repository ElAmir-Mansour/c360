'use client';

import { Boxes } from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { SimpleTable } from '@/components/shared/simple-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useFleetAiModelSlug } from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';
import type { FleetAiTenantRow } from '@/types/platform';

interface ModelDrilldownPanelProps {
  /** The slug to drill into; null closes the panel. */
  slug: string | null;
  displayName?: string;
  onClose: () => void;
}

/**
 * G23 per-model-slug drill-down (`/fleet/models/{slug}`). The same 20 default
 * models are seeded into every tenant, so this view answers "across the fleet,
 * who runs <model>, and where is it drifting?" — summary tiles plus the
 * per-tenant adoption/drift table scoped to the slug. Loads on open only.
 */
export function ModelDrilldownPanel({ slug, displayName, onClose }: ModelDrilldownPanelProps) {
  const t = useT();
  const { data, isLoading, error, refetch } = useFleetAiModelSlug(slug ?? '', Boolean(slug));

  const summary = data?.summary;
  const tenantRows: FleetAiTenantRow[] = data?.tenants ?? [];

  const columns = [
    {
      key: 'tenant_name',
      header: t('platformConsole.ai.tenant'),
      render: (r: FleetAiTenantRow) => (
        <span className="font-medium text-foreground">{r.tenant_name}</span>
      ),
    },
    {
      key: 'in_production',
      header: t('platformConsole.ai.inProduction'),
      align: 'right' as const,
      render: (r: FleetAiTenantRow) => <span className="tabular-nums">{r.in_production}</span>,
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
          className={
            r.drift_alerts > 0
              ? 'font-semibold tabular-nums text-destructive'
              : 'tabular-nums text-muted-foreground'
          }
        >
          {r.drift_alerts}
        </span>
      ),
    },
  ];

  return (
    <DetailPanel
      open={Boolean(slug)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={displayName || slug || t('platformConsole.ai.model')}
      description={slug ? `${t('platformConsole.ai.fleetAdoption')} · ${slug}` : undefined}
      width="xl"
    >
      {isLoading ? (
        <LoadingSkeleton variant="card" count={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <DetailStatCard
              label={t('platformConsole.ai.tenantsUsing')}
              value={summary?.total_tenants ?? 0}
              tone="sky"
              icon={Boxes}
            />
            <DetailStatCard
              label={t('platformConsole.ai.inProduction')}
              value={summary?.in_production ?? 0}
              tone="emerald"
            />
            <DetailStatCard
              label={t('platformConsole.ai.shadow')}
              value={summary?.shadow ?? 0}
              tone="gold"
            />
            <DetailStatCard
              label={t('platformConsole.ai.driftAlerts')}
              value={summary?.drift_alerts ?? 0}
              tone={(summary?.drift_alerts ?? 0) > 0 ? 'rose' : 'slate'}
            />
          </div>

          {tenantRows.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title={t('platformConsole.ai.noAdoptionTitle')}
              description={t('platformConsole.ai.noAdoptionDescription')}
              size="compact"
            />
          ) : (
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-caps-wide text-muted-foreground">
                {t('platformConsole.ai.perTenantAdoption')}
              </h3>
              <SimpleTable<FleetAiTenantRow & Record<string, unknown>>
                columns={columns}
                data={tenantRows as Array<FleetAiTenantRow & Record<string, unknown>>}
                ariaLabel={t('platformConsole.ai.perTenantAdoption')}
                getRowKey={(r) => r.tenant_id}
              />
            </div>
          )}
        </div>
      )}
    </DetailPanel>
  );
}
