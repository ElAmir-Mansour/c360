'use client';

import { Server, Building2, Boxes, ShieldAlert, RefreshCw } from 'lucide-react';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { KpiCard } from '@/components/shared/kpi-card';
import { Button } from '@/components/ui/button';
import {
  useFleetHealth,
  usePlatformTenantsSummary,
  useSeatRollup,
  usePlatformAuditLogs,
} from '@/hooks/use-platform';
import { useT, useLocale } from '@/components/providers/locale-provider';
import { ServiceHealthTable } from './_components/service-health-table';
import { LicenseExpiriesPanel } from './_components/license-expiries-panel';
import { CriticalAuditPanel } from './_components/critical-audit-panel';
import { ProvisioningTicker } from './_components/provisioning-ticker';

/**
 * Platform Overview (§E.1 / §J.3) — the reference console screen. Self-sufficient
 * <PermissionRedirect permission="admin:console"> wrapper (the platform/layout
 * also gates, but the doc requires this page to stand alone).
 */
export default function PlatformOverviewPage() {
  return (
    <PermissionRedirect permission="admin:console">
      <OverviewBody />
    </PermissionRedirect>
  );
}

function OverviewBody() {
  const t = useT();
  const { locale } = useLocale();
  const fleet = useFleetHealth();
  const tenants = usePlatformTenantsSummary();
  const seats = useSeatRollup('seats.users');

  // Critical-events tile (G14 all-tenants count). We only need the total, so ask
  // for a single row and read meta.total; if the endpoint is unbuilt the tile
  // gracefully renders "—" rather than failing the whole screen.
  const criticalAudit = usePlatformAuditLogs({
    severity: 'high,critical',
    per_page: 1,
    page: 1,
  });

  const data = fleet.data;
  const summary = data?.summary;

  // Prefer the dedicated rollups (G3/G11) for tenant + seat figures, falling back
  // to whatever the fleet aggregator merged into its summary block.
  const activeTenants =
    tenants.data?.active ?? summary?.tenants ?? undefined;
  const seatsUsed =
    seats.data?.total_used ?? summary?.seats_used ?? undefined;
  const seatsLimit = seats.data?.total_limit;
  const criticalCount =
    criticalAudit.data?.meta?.total ?? summary?.critical_audit_24h ?? undefined;

  const lastUpdated = data?.generated_at
    ? new Date(data.generated_at).toLocaleTimeString(locale)
    : null;

  const refreshAll = () => {
    void fleet.refetch();
    void tenants.refetch();
    void seats.refetch();
    void criticalAudit.refetch();
  };

  const headerStats = summary
    ? [
        {
          label: t('platformConsole.overview.activeTenants'),
          value: activeTenants != null ? activeTenants.toLocaleString(locale) : '—',
        },
        {
          label: t('platformConsole.overview.servicesHealthy'),
          value: `${summary.healthy.toLocaleString(locale)}/${summary.total.toLocaleString(locale)}`,
        },
        {
          label: t('platformConsole.overview.seatsUsed'),
          value: seatsUsed != null ? seatsUsed.toLocaleString(locale) : '—',
        },
      ]
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('platformConsole.overview.title')}
        eyebrow={t('platformConsole.eyebrow')}
        description={t('platformConsole.subtitle')}
        stats={headerStats}
        actions={
          <div className="flex items-center gap-3">
            {lastUpdated ? (
              <span className="text-xs text-muted-foreground">
                {t('platformConsole.lastUpdated')}: {lastUpdated}
              </span>
            ) : null}
            <span className="sr-only" role="status" aria-live="polite">
              {fleet.isFetching
                ? t('platformConsole.overview.refreshing')
                : lastUpdated
                  ? `${t('platformConsole.lastUpdated')}: ${lastUpdated}`
                  : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={fleet.isFetching}
              aria-label={t('platformConsole.refresh')}
            >
              <RefreshCw
                className={
                  fleet.isFetching ? 'me-1.5 h-3.5 w-3.5 animate-spin' : 'me-1.5 h-3.5 w-3.5'
                }
                aria-hidden
              />
              {t('platformConsole.refresh')}
            </Button>
          </div>
        }
      />

      {/* Fleet KPI row */}
      {fleet.isLoading ? (
        <LoadingSkeleton variant="kpi" count={4} />
      ) : fleet.error ? (
        // Whole-fleet endpoint unreachable — the only case warranting ErrorState
        // (per-service scrape_error renders inline within the table).
        <ErrorState
          variant={detectVariant(fleet.error)}
          error={fleet.error}
          onRetry={() => fleet.refetch()}
        />
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title={t('platformConsole.overview.servicesHealthy')}
              value={`${summary.healthy.toLocaleString(locale)}/${summary.total.toLocaleString(locale)}`}
              icon={Server}
              tone={summary.unhealthy > 0 ? 'rose' : 'emerald'}
              description={
                summary.degraded > 0
                  ? `${summary.degraded.toLocaleString(locale)} ${t('platformConsole.overview.degradedSuffix')}`
                  : undefined
              }
            />
            <KpiCard
              title={t('platformConsole.overview.activeTenants')}
              value={activeTenants != null ? activeTenants.toLocaleString(locale) : '—'}
              icon={Building2}
              tone="sky"
            />
            <KpiCard
              title={t('platformConsole.overview.seatsUsed')}
              value={
                seatsUsed != null
                  ? seatsLimit != null
                    ? `${seatsUsed.toLocaleString(locale)} / ${seatsLimit.toLocaleString(locale)}`
                    : seatsUsed.toLocaleString(locale)
                  : '—'
              }
              icon={Boxes}
              tone="gold"
            />
            <KpiCard
              title={t('platformConsole.overview.criticalEvents')}
              value={criticalCount != null ? criticalCount.toLocaleString(locale) : '—'}
              icon={ShieldAlert}
              tone={(criticalCount ?? 0) > 0 ? 'rose' : 'slate'}
            />
          </div>

          {/* Service health grid + side panels */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <h2 className="mb-3 text-h4 font-semibold text-foreground">
                {t('platformConsole.overview.fleetHealth')}
              </h2>
              {data.services.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title={t('platformConsole.overview.noServices')}
                  description={t('platformConsole.overview.noServicesDesc')}
                />
              ) : (
                <ServiceHealthTable services={data.services} />
              )}
            </div>

            <div className="space-y-6">
              <LicenseExpiriesPanel />
              <ProvisioningTicker />
              <CriticalAuditPanel />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
