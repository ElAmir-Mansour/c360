'use client';

import { useState } from 'react';
import { ChevronDown, Boxes, Activity, KeyRound, FileBadge, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import type { StatusConfig } from '@/lib/status-configs';
import { MetricTile } from '@/components/shared/metric-tile';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useT } from '@/components/providers/locale-provider';
import type {
  AdminTenantSummary,
  FleetService,
  FleetServiceStatus,
} from '@/types/platform';
import type { SuiteDescriptor } from './suite-catalog';
import { SuiteTenantRow } from './suite-tenant-row';

interface SuiteCardProps {
  suite: SuiteDescriptor;
  contract?: string;
  /** Matched fleet service for this suite's backing binary (G1). */
  fleet?: FleetService;
  /** All tenants (G2). Used for the expand → per-tenant toggle list. */
  tenants: AdminTenantSummary[];
  tenantsLoading: boolean;
}

const HEALTH_COLOR: Record<FleetServiceStatus, string> = {
  healthy: 'green',
  degraded: 'orange',
  unhealthy: 'red',
  unknown: 'gray',
};

export function SuiteCard({
  suite,
  contract,
  fleet,
  tenants,
  tenantsLoading,
}: SuiteCardProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const status: FleetServiceStatus = fleet?.status ?? 'unknown';
  const STATUS_LABEL: Record<FleetServiceStatus, string> = {
    healthy: t('platformConsole.status.healthy'),
    degraded: t('platformConsole.status.degraded'),
    unhealthy: t('platformConsole.status.unhealthy'),
    unknown: t('platformConsole.status.unknown'),
  };
  const healthConfig: StatusConfig = {
    healthy: { label: STATUS_LABEL.healthy, color: HEALTH_COLOR.healthy, icon: Activity },
    degraded: { label: STATUS_LABEL.degraded, color: HEALTH_COLOR.degraded, icon: Activity },
    unhealthy: { label: STATUS_LABEL.unhealthy, color: HEALTH_COLOR.unhealthy, icon: Activity },
    unknown: { label: STATUS_LABEL.unknown, color: HEALTH_COLOR.unknown, icon: Activity },
  };

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="kpi-icon-badge shrink-0">
            <Boxes className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-foreground">
                {suite.name}
              </h3>
              <StatusBadge status={status} config={healthConfig} size="sm" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <KeyRound className="h-3 w-3" aria-hidden />
                <code className="font-mono">{suite.entitlement}</code>
              </span>
              {contract && (
                <span className="inline-flex items-center gap-1">
                  <FileBadge className="h-3 w-3" aria-hidden />
                  {contract}
                </span>
              )}
              <span className="font-mono opacity-70">{suite.service}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suite.prefixes.map((p) => (
                <code
                  key={p}
                  className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-overline text-muted-foreground"
                >
                  {p}
                </code>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-controls={`suite-tenants-${suite.id}`}
          aria-label={`${suite.name} · ${tenants.length} ${t('platformConsole.suites.tenantsEnabled')}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary/60 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Building2 className="h-4 w-4" aria-hidden />
          {tenants.length}
          <span className="text-muted-foreground">
            {t('platformConsole.suites.tenantsEnabled')}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </div>

      {/* Per-suite metric strip */}
      <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3">
        <MetricTile
          label={t('platformConsole.suites.tenantsEnabled')}
          value={tenants.length}
          icon={Building2}
          tone="primary"
        />
        <MetricTile
          label={t('platformConsole.overview.fleetHealth')}
          value={STATUS_LABEL[status]}
          icon={Activity}
          tone={
            status === 'healthy'
              ? 'success'
              : status === 'unhealthy'
                ? 'danger'
                : status === 'degraded'
                  ? 'warning'
                  : 'muted'
          }
        />
        <MetricTile
          label={t('platformConsole.suites.routePrefixes')}
          value={suite.prefixes.length}
          icon={KeyRound}
          tone="info"
        />
      </div>

      {/* Expanded per-tenant toggle table */}
      {expanded && (
        <div
          id={`suite-tenants-${suite.id}`}
          className="border-t border-border bg-secondary/20"
        >
          {tenantsLoading ? (
            <div className="p-5">
              <LoadingSkeleton variant="table" count={4} />
            </div>
          ) : tenants.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t('platformConsole.suites.noTenants')}
              description={t('platformConsole.suites.noTenantsDesc')}
              size="compact"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {t('platformConsole.suites.tenantTableCaption')}
                </caption>
                <thead>
                  <tr className="text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('platformConsole.tenants.title')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                      {t('platformConsole.suites.enabled')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-end font-semibold">
                      {t('platformConsole.suites.toggle')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tenant) => (
                    <SuiteTenantRow
                      key={tenant.id}
                      suite={suite}
                      tenant={tenant}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
