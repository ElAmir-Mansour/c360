'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { DetailPanel } from '@/components/shared/detail-panel';
import { LineChart } from '@/components/shared/charts/line-chart';
import { useT, useLocale } from '@/components/providers/locale-provider';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import type { FleetService } from '@/types/platform';

// The lightweight SimpleTable constrains its row type to `Record<string, unknown>`.
// FleetService is an object type that structurally satisfies that index
// constraint, so we widen it for the table generic at the call site.
type FleetRow = FleetService & Record<string, unknown>;
import {
  fleetStatusConfig,
  circuitStatusConfig,
  checkDotColor,
  checkStatusLabel,
} from './overview-status';

type Translate = (key: MessageKey) => string;

/** Per-dependency readiness dots (postgres/redis/kafka/...) from `checks`. */
function ReadinessDots({
  service,
  t,
}: {
  service: FleetService;
  t: Translate;
}) {
  const checks = service.checks;
  if (!checks || Object.keys(checks).length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {Object.entries(checks).map(([dep, check]) => {
        const color = checkDotColor(check.status);
        const dot =
          color === 'green'
            ? 'bg-primary'
            : color === 'orange'
              ? 'bg-warning-500'
              : color === 'red'
                ? 'bg-error-500'
                : 'bg-muted-foreground/40';
        const label = checkStatusLabel(t, check.status);
        return (
          <span
            key={dep}
            className="inline-flex items-center"
            title={`${dep}: ${label}${
              check.latency_ms != null ? ` (${check.latency_ms}ms)` : ''
            }`}
          >
            <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />
            <span className="sr-only">
              {dep}: {label}
            </span>
          </span>
        );
      })}
    </span>
  );
}

interface ServiceHealthTableProps {
  services: FleetService[];
}

export function ServiceHealthTable({ services }: ServiceHealthTableProps) {
  const t = useT();
  const { locale } = useLocale();
  const [selected, setSelected] = useState<FleetService | null>(null);

  const fleetCfg = fleetStatusConfig(t);
  const circuitCfg = circuitStatusConfig(t);

  const columns: Column<FleetRow>[] = [
    {
      key: 'name',
      header: t('platformConsole.overview.colService'),
      render: (s) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{s.name}</span>
          {s.suite ? (
            <span className="text-xs text-muted-foreground">{s.suite}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'role',
      header: t('platformConsole.overview.colRole'),
      render: (s) => (
        <span className="text-sm text-muted-foreground">{s.role || '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('platformConsole.overview.colHealth'),
      render: (s) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={s.status} config={fleetCfg} />
          {s.scrape_error ? (
            <span
              className="inline-flex items-center text-warning-600 dark:text-warning-300"
              title={s.scrape_error}
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">
                {t('platformConsole.overview.scrapeError')}: {s.scrape_error}
              </span>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'readiness',
      header: t('platformConsole.overview.colReadiness'),
      render: (s) => <ReadinessDots service={s} t={t} />,
    },
    {
      key: 'circuit_breaker',
      header: t('platformConsole.overview.colBreaker'),
      render: (s) =>
        s.circuit_breaker ? (
          <StatusBadge
            status={s.circuit_breaker}
            config={circuitCfg}
            variant="dot"
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'error_rate_pct',
      header: t('platformConsole.overview.colErrors'),
      align: 'right',
      render: (s) =>
        s.metrics ? (
          <span
            className={cn(
              'tabular-nums',
              s.metrics.error_rate_pct > 0 && 'text-error-600 dark:text-error-300',
            )}
          >
            {s.metrics.error_rate_pct.toFixed(1)}%
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'p95',
      header: t('platformConsole.overview.colP95'),
      align: 'right',
      render: (s) =>
        s.metrics ? (
          <span className="tabular-nums">
            {s.metrics.p95.toFixed(0)} {t('platformConsole.overview.unitMs')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'version',
      header: t('platformConsole.overview.colVersion'),
      render: (s) => (
        <span className="font-mono text-xs text-muted-foreground">
          {s.version || '—'}
        </span>
      ),
    },
  ];

  return (
    <>
      <SimpleTable<FleetRow>
        columns={columns}
        data={services as FleetRow[]}
        getRowKey={(s) => s.name}
        onRowClick={(s) => setSelected(s)}
        ariaLabel={t('platformConsole.overview.fleetHealth')}
      />

      <DetailPanel
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected?.name ?? ''}
        description={
          selected
            ? [selected.suite, selected.role].filter(Boolean).join(' · ') ||
              undefined
            : undefined
        }
        width="xl"
      >
        {selected ? (
          <ServiceDetail service={selected} t={t} locale={locale} />
        ) : null}
      </DetailPanel>
    </>
  );
}

function ServiceDetail({
  service,
  t,
  locale,
}: {
  service: FleetService;
  t: Translate;
  locale: string;
}) {
  // Synthesize a latency-percentile sparkline from the snapshot metrics. The G1
  // contract is point-in-time (no history series), so this renders the p50/p95/p99
  // distribution as a small line; a future timeseries endpoint can replace `data`.
  const m = service.metrics;
  const ms = t('platformConsole.overview.unitMs');
  const latencyData = m
    ? [
        { point: 'p50', latency: m.p50 },
        { point: 'p95', latency: m.p95 },
        { point: 'p99', latency: m.p99 },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={service.status} config={fleetStatusConfig(t)} />
        {service.circuit_breaker ? (
          <StatusBadge
            status={service.circuit_breaker}
            config={circuitStatusConfig(t)}
            variant="outline"
          />
        ) : null}
        {service.version ? (
          <span className="rounded-full border border-border/60 bg-secondary/60 px-2.5 py-1 font-mono text-xs text-muted-foreground">
            {service.version}
          </span>
        ) : null}
      </div>

      {service.scrape_error ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 p-3 text-sm text-warning-700 dark:text-warning-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{service.scrape_error}</span>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <Field
          label={t('platformConsole.overview.liveness')}
          value={
            service.liveness
              ? t('platformConsole.overview.up')
              : t('platformConsole.overview.down')
          }
        />
        <Field
          label={t('platformConsole.overview.readiness')}
          value={service.readiness}
        />
        <Field
          label={t('platformConsole.overview.uptime')}
          value={service.uptime ?? '—'}
        />
        <Field
          label={t('platformConsole.overview.lastScraped')}
          value={
            service.last_scraped_at
              ? new Date(service.last_scraped_at).toLocaleString(locale)
              : '—'
          }
        />
        {service.endpoints?.http ? (
          <Field
            label={t('platformConsole.overview.httpEndpoint')}
            value={service.endpoints.http}
            mono
          />
        ) : null}
        {service.endpoints?.admin ? (
          <Field
            label={t('platformConsole.overview.adminEndpoint')}
            value={service.endpoints.admin}
            mono
          />
        ) : (
          <Field
            label={t('platformConsole.overview.adminEndpoint')}
            value={t('platformConsole.overview.noAdminPort')}
          />
        )}
      </dl>

      {m ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric
            label={t('platformConsole.overview.metricRps')}
            value={m.rps.toLocaleString(locale)}
          />
          <Metric
            label={t('platformConsole.overview.metricErrorRate')}
            value={`${m.error_rate_pct.toFixed(1)}%`}
          />
          <Metric
            label={t('platformConsole.overview.metricActive')}
            value={m.active.toLocaleString(locale)}
          />
          <Metric label={t('platformConsole.overview.metricP50')} value={`${m.p50.toFixed(0)} ${ms}`} />
          <Metric label={t('platformConsole.overview.metricP95')} value={`${m.p95.toFixed(0)} ${ms}`} />
          <Metric label={t('platformConsole.overview.metricP99')} value={`${m.p99.toFixed(0)} ${ms}`} />
          {m.db_pool_pct != null ? (
            <Metric
              label={t('platformConsole.overview.metricDbPool')}
              value={`${m.db_pool_pct.toFixed(0)}%`}
            />
          ) : null}
          {m.cpu_pct != null ? (
            <Metric
              label={t('platformConsole.overview.metricCpu')}
              value={`${m.cpu_pct.toFixed(0)}%`}
            />
          ) : null}
          {m.mem_mb != null ? (
            <Metric
              label={t('platformConsole.overview.metricMemory')}
              value={`${m.mem_mb.toFixed(0)} ${t('platformConsole.overview.unitMb')}`}
            />
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
          {t('platformConsole.overview.noMetricsDetail')}
        </p>
      )}

      {latencyData.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            {t('platformConsole.overview.latencyDistribution')}
          </h4>
          <LineChart
            data={latencyData}
            xKey="point"
            yKeys={[
              {
                key: 'latency',
                label: `${t('platformConsole.overview.latency')} (${ms})`,
                color: 'hsl(var(--primary))',
              },
            ]}
            yFormatter={(v) => `${v} ${ms}`}
            height={180}
            showLegend={false}
          />
        </div>
      ) : null}

      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">
          {t('platformConsole.overview.rawHealth')}
        </h4>
        <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
          {JSON.stringify(service, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-overline font-semibold uppercase tracking-caps text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 break-words text-foreground',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-overline font-semibold uppercase tracking-caps text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
