'use client';

// Service & Infra Ops — Health / metrics grid (§E.5 #7, G1 fuller detail).
//
// Shares the fleet endpoint with the Overview screen but renders the *full*
// per-service detail: liveness/readiness, dependency checks, circuit-breaker
// state, endpoints, and the full latency/throughput metric block. Per the §H
// resilience contract every field degrades to "—" rather than 0, and a
// per-service `scrape_error` is rendered inline (not as a page-level ErrorState).

import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Server,
} from 'lucide-react';
import { useT } from '@/components/providers/locale-provider';
import { useFleetHealth } from '@/hooks/use-platform';
import type { FleetService } from '@/types/platform';
import { SimpleTable } from '@/components/shared/simple-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { DetailPanel } from '@/components/shared/detail-panel';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import type { StatusConfig } from '@/lib/status-configs';

// The lightweight SimpleTable constrains its row type to Record<string, unknown>;
// FleetService is an interface (no implicit index signature), so widen it for the
// table generic only. (Matches the platform/_components/service-health-table.tsx
// pattern.)
type FleetRow = FleetService & Record<string, unknown>;

/** Render a value or an em-dash when null/undefined (never "0" for absent). */
function dash(value: number | string | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || value === '') return '—';
  return `${typeof value === 'number' ? value.toLocaleString() : value}${suffix}`;
}

export function HealthGrid() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useFleetHealth();
  const [selected, setSelected] = useState<FleetService | null>(null);

  const statusConfig: StatusConfig = {
    healthy: { label: t('platformConsole.status.healthy'), color: 'green', icon: CheckCircle2 },
    degraded: { label: t('platformConsole.status.degraded'), color: 'yellow', icon: AlertTriangle },
    unhealthy: { label: t('platformConsole.status.unhealthy'), color: 'red', icon: AlertTriangle },
    unknown: { label: t('platformConsole.status.unknown'), color: 'gray', icon: Server },
  };

  const circuitConfig: StatusConfig = {
    closed: { label: t('platformConsole.services.circuitClosed'), color: 'green', icon: CheckCircle2 },
    open: { label: t('platformConsole.services.circuitOpen'), color: 'red', icon: AlertTriangle },
    'half-open': { label: t('platformConsole.services.circuitHalfOpen'), color: 'orange', icon: Activity },
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton variant="kpi" count={5} />
        <LoadingSkeleton variant="table" count={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        error={error}
        variant={detectVariant(error)}
        onRetry={() => refetch()}
        message={t('platformConsole.services.fleetError')}
      />
    );
  }

  const services = data?.services ?? [];
  const summary = data?.summary;

  const columns = [
    {
      key: 'name',
      header: t('platformConsole.services.colService'),
      render: (s: FleetService) => (
        <div className="min-w-0">
          <div className="font-medium text-foreground">{s.name}</div>
          <div className="text-xs text-muted-foreground">
            {s.role}
            {s.suite ? ` · ${s.suite}` : ''}
            {s.version ? ` · v${s.version}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('platformConsole.services.colStatus'),
      render: (s: FleetService) => (
        <StatusBadge status={s.status} config={statusConfig} />
      ),
    },
    {
      key: 'readiness',
      header: t('platformConsole.services.colReadiness'),
      render: (s: FleetService) => (
        <StatusBadge status={s.readiness} config={statusConfig} variant="dot" />
      ),
    },
    {
      key: 'circuit_breaker',
      header: t('platformConsole.services.circuitBreakers'),
      render: (s: FleetService) =>
        s.circuit_breaker ? (
          <StatusBadge status={s.circuit_breaker} config={circuitConfig} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'rps',
      header: t('platformConsole.services.colRps'),
      align: 'right' as const,
      render: (s: FleetService) => (
        <span className="tabular-nums">{dash(s.metrics?.rps)}</span>
      ),
    },
    {
      key: 'error_rate_pct',
      header: t('platformConsole.services.colErrPct'),
      align: 'right' as const,
      render: (s: FleetService) => (
        <span className="tabular-nums">{dash(s.metrics?.error_rate_pct, '%')}</span>
      ),
    },
    {
      key: 'p95',
      header: t('platformConsole.services.colP95'),
      align: 'right' as const,
      render: (s: FleetService) => (
        <span className="tabular-nums">{dash(s.metrics?.p95, 'ms')}</span>
      ),
    },
    {
      key: 'p99',
      header: t('platformConsole.services.colP99'),
      align: 'right' as const,
      render: (s: FleetService) => (
        <span className="tabular-nums">{dash(s.metrics?.p99, 'ms')}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {summary && (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
          aria-live="polite"
        >
          <KpiCard
            title={t('platformConsole.status.healthy')}
            value={summary.healthy}
            icon={CheckCircle2}
            tone="emerald"
          />
          <KpiCard
            title={t('platformConsole.status.degraded')}
            value={summary.degraded}
            icon={AlertTriangle}
            tone="gold"
          />
          <KpiCard
            title={t('platformConsole.status.unhealthy')}
            value={summary.unhealthy}
            icon={AlertTriangle}
            tone="rose"
          />
          <KpiCard
            title={t('platformConsole.status.unknown')}
            value={summary.unknown}
            icon={Server}
            tone="slate"
          />
          <KpiCard
            title={t('platformConsole.services.total')}
            value={summary.total}
            icon={Server}
            tone="sky"
          />
        </div>
      )}

      {services.length === 0 ? (
        <EmptyState
          icon={Server}
          title={t('platformConsole.overview.noServices')}
          description={t('platformConsole.services.noServicesDesc')}
        />
      ) : (
        <SimpleTable<FleetRow>
          columns={columns}
          data={services as FleetRow[]}
          getRowKey={(s) => s.name}
          onRowClick={(s) => setSelected(s)}
          onSortChange={() => undefined}
          ariaLabel={t('platformConsole.services.title')}
        />
      )}

      <DetailPanel
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected?.name ?? ''}
        description={
          selected
            ? `${selected.role}${selected.suite ? ` · ${selected.suite}` : ''}${selected.version ? ` · v${selected.version}` : ''}`
            : undefined
        }
        width="lg"
      >
        {selected && <ServiceDetail service={selected} statusConfig={statusConfig} circuitConfig={circuitConfig} />}
      </DetailPanel>
    </div>
  );
}

function ServiceDetail({
  service,
  statusConfig,
  circuitConfig,
}: {
  service: FleetService;
  statusConfig: StatusConfig;
  circuitConfig: StatusConfig;
}) {
  const t = useT();
  const m = service.metrics;
  const checks = service.checks ? Object.entries(service.checks) : [];
  const statusTone =
    service.status === 'healthy'
      ? 'emerald'
      : service.status === 'unhealthy'
        ? 'rose'
        : service.status === 'degraded'
          ? 'gold'
          : 'slate';

  return (
    <div className="space-y-5">
      {service.scrape_error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-warning-300 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-700/40 dark:bg-warning-700/15 dark:text-warning-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">{t('platformConsole.services.scrapeError')}</p>
            <p className="mt-0.5 text-xs">{service.scrape_error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <DetailStatCard
          label={t('platformConsole.services.colStatus')}
          tone={statusTone}
          value={<StatusBadge status={service.status} config={statusConfig} />}
        />
        <DetailStatCard
          label={t('platformConsole.services.colReadiness')}
          value={<StatusBadge status={service.readiness} config={statusConfig} variant="dot" />}
        />
        <DetailStatCard
          label={t('platformConsole.services.liveness')}
          value={service.liveness ? t('platformConsole.services.up') : t('platformConsole.services.down')}
        />
        <DetailStatCard
          label={t('platformConsole.services.circuitBreaker')}
          value={
            service.circuit_breaker ? (
              <StatusBadge status={service.circuit_breaker} config={circuitConfig} />
            ) : (
              '—'
            )
          }
        />
        <DetailStatCard label={t('platformConsole.services.uptime')} value={dash(service.uptime)} />
        <DetailStatCard label={t('platformConsole.services.lastScraped')} value={dash(service.last_scraped_at)} />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          {t('platformConsole.services.dependencyChecks')}
        </h3>
        {checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('platformConsole.services.noChecks')}
          </p>
        ) : (
          <div className="space-y-2">
            {checks.map(([name, c]) => (
              <div
                key={name}
                className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-3 py-2 text-sm"
              >
                <span className="capitalize text-foreground">{name}</span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground tabular-nums">
                    {dash(c.latency_ms, 'ms')}
                  </span>
                  <StatusBadge
                    status={c.status}
                    config={statusConfig}
                    variant="outline"
                    size="sm"
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          {t('platformConsole.services.metrics')}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <DetailStatCard label={t('platformConsole.services.colRps')} icon={Activity} value={dash(m?.rps)} />
          <DetailStatCard label={t('platformConsole.services.errorRate')} value={dash(m?.error_rate_pct, '%')} />
          <DetailStatCard label={t('platformConsole.services.active')} value={dash(m?.active)} />
          <DetailStatCard label={t('platformConsole.services.colP50')} value={dash(m?.p50, 'ms')} />
          <DetailStatCard label={t('platformConsole.services.colP95')} value={dash(m?.p95, 'ms')} />
          <DetailStatCard label={t('platformConsole.services.colP99')} value={dash(m?.p99, 'ms')} />
          <DetailStatCard label={t('platformConsole.services.dbPool')} icon={Database} value={dash(m?.db_pool_pct, '%')} />
          <DetailStatCard label={t('platformConsole.services.cpu')} icon={Cpu} value={dash(m?.cpu_pct, '%')} />
          <DetailStatCard label={t('platformConsole.services.memory')} icon={HardDrive} value={dash(m?.mem_mb, ' MB')} />
        </div>
      </section>

      {service.endpoints && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {t('platformConsole.services.endpoints')}
          </h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('platformConsole.services.http')}</dt>
              <dd className="truncate font-mono text-xs">{dash(service.endpoints.http)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('platformConsole.services.admin')}</dt>
              <dd className="truncate font-mono text-xs">{dash(service.endpoints.admin)}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
