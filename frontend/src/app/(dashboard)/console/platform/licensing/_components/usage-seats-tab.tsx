'use client';

import { useState } from 'react';
import { Users, Gauge, TrendingUp, Layers } from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useT } from '@/components/providers/locale-provider';
import { useSeatRollup, useTenantEntitlements } from '@/hooks/use-platform';
import type { SeatRollupTenant, TenantEntitlement } from '@/types/platform';
import { formatLimit, formatSeats, isOverSeats } from '../_lib/license-state';
import { TenantPicker } from './tenant-picker';

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type SeatRow = SeatRollupTenant & Record<string, unknown>;
type EntitlementRow = TenantEntitlement & Record<string, unknown>;

function EntitlementsBreakdown({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useTenantEntitlements(
    tenantId,
    tenantId !== '',
  );

  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        message={t('platformConsole.licensing.entitlementsError')}
      />
    );
  }

  const entitlements = data ?? [];

  const columns: Column<TenantEntitlement>[] = [
    {
      key: 'key',
      header: t('platformConsole.licensing.colEntitlement'),
      render: (e) => (
        <div className="min-w-0">
          <div className="text-sm">{e.label ?? e.key}</div>
          <div className="font-mono text-xs text-muted-foreground">{e.key}</div>
        </div>
      ),
    },
    {
      key: 'used',
      header: t('platformConsole.licensing.colUsedLimit'),
      align: 'right',
      render: (e) => (
        <span
          className={
            isOverSeats(e.used, e.limit)
              ? 'tabular-nums font-medium text-destructive'
              : 'tabular-nums'
          }
        >
          {e.used !== undefined ? formatSeats(e.used, e.limit) : formatLimit(e.limit, t)}
        </span>
      ),
    },
    {
      key: 'source',
      header: t('platformConsole.licensing.colSource'),
      render: (e) => (
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {e.source}
        </span>
      ),
    },
    {
      key: 'enabled',
      header: t('platformConsole.licensing.colStatus'),
      render: (e) =>
        e.enabled ? (
          <span className="text-sm text-primary">{t('platformConsole.licensing.enabled')}</span>
        ) : (
          <span className="text-sm text-destructive">{t('platformConsole.licensing.disabled')}</span>
        ),
    },
  ];

  if (!isLoading && entitlements.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title={t('platformConsole.licensing.entitlementsEmptyTitle')}
        description={t('platformConsole.licensing.entitlementsEmptyDesc')}
        size="compact"
      />
    );
  }

  return (
    <SimpleTable<EntitlementRow>
      columns={columns as Column<EntitlementRow>[]}
      data={entitlements as EntitlementRow[]}
      loading={isLoading}
      getRowKey={(e) => e.key}
      ariaLabel={t('platformConsole.licensing.entitlementsTableAria')}
      emptyMessage={t('platformConsole.licensing.entitlementsEmptyTitle')}
    />
  );
}

export function UsageSeatsTab() {
  const t = useT();
  const { data: rollup, isLoading, isError, error, refetch } = useSeatRollup('seats.users');
  const [tenantId, setTenantId] = useState('');

  const rollupColumns: Column<SeatRollupTenant>[] = [
    {
      key: 'tenant',
      header: t('platformConsole.licensing.colTenant'),
      render: (row) => (
        <span className="font-medium text-foreground">
          {row.tenant_name || row.tenant_id}
        </span>
      ),
    },
    {
      key: 'used',
      header: t('platformConsole.licensing.colSeatsUsedLimit'),
      align: 'right',
      render: (row) => (
        <span
          className={
            isOverSeats(row.used, row.limit)
              ? 'tabular-nums font-medium text-destructive'
              : 'tabular-nums'
          }
        >
          {formatSeats(row.used, row.limit)}
        </span>
      ),
    },
    {
      key: 'utilization',
      header: t('platformConsole.licensing.colUtilization'),
      align: 'right',
      render: (row) => {
        if (!row.limit || row.limit <= 0) return <span className="text-muted-foreground">—</span>;
        const pct = Math.round(((row.used ?? 0) / row.limit) * 100);
        return (
          <span className={pct >= 100 ? 'tabular-nums font-medium text-destructive' : 'tabular-nums'}>
            {pct}%
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t('platformConsole.licensing.fleetSeatsTitle')}
        </h3>

        {isError ? (
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            message={t('platformConsole.licensing.rollupError')}
          />
        ) : isLoading ? (
          <LoadingSkeleton variant="card" count={3} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <KpiCard
                title={t('platformConsole.licensing.seatsUsed')}
                value={(rollup?.total_used ?? 0).toLocaleString()}
                icon={Users}
                tone="emerald"
              />
              <KpiCard
                title={t('platformConsole.licensing.totalSeatLimit')}
                value={(rollup?.total_limit ?? 0).toLocaleString()}
                icon={Gauge}
                tone="sky"
              />
              <KpiCard
                title={t('platformConsole.licensing.utilization')}
                value={
                  rollup && rollup.total_limit > 0
                    ? `${Math.round((rollup.total_used / rollup.total_limit) * 100)}%`
                    : '—'
                }
                icon={TrendingUp}
                tone="gold"
              />
            </div>

            {(rollup?.per_tenant?.length ?? 0) === 0 ? (
              <EmptyState
                icon={Users}
                title={t('platformConsole.licensing.noSeatUsageTitle')}
                description={t('platformConsole.licensing.noSeatUsageDesc')}
                size="compact"
              />
            ) : (
              <SimpleTable<SeatRow>
                columns={rollupColumns as Column<SeatRow>[]}
                data={(rollup?.per_tenant ?? []) as SeatRow[]}
                getRowKey={(row) => row.tenant_id}
                ariaLabel={t('platformConsole.licensing.seatRollupTableAria')}
                emptyMessage={t('platformConsole.licensing.noSeatUsageTitle')}
              />
            )}
          </>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            {t('platformConsole.licensing.tenantEntitlementsTitle')}
          </h3>
          <TenantPicker
            value={tenantId}
            onChange={(id) => setTenantId(id)}
            className="w-64"
          />
        </div>
        {tenantId === '' ? (
          <EmptyState
            icon={Layers}
            title={t('platformConsole.licensing.selectTenantTitle')}
            description={t('platformConsole.licensing.selectTenantEntitlementsDesc')}
            size="compact"
          />
        ) : (
          <EntitlementsBreakdown tenantId={tenantId} />
        )}
      </section>
    </div>
  );
}
