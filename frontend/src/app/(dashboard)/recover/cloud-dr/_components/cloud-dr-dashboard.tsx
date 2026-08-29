'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CloudCog,
  FileCode2,
  GitBranch,
  HardDriveUpload,
  Layers,
  PlayCircle,
  RotateCcw,
  Server,
  Timer,
} from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCloudDROverview } from '@/lib/recover/use-cloud-dr-overview';
import { RegionFailoverView } from './region-failover-view';
import { useRecoverT } from '../../_lib/recover-i18n';
import type { CloudDROverview, FailoverTestSummary } from '@/types/recover-cloud-dr';

/** Composed Cloud DR capability surfaces (the existing dr/* engines). */
const WORKSPACE_LINKS = [
  { href: '/dr/protect', labelKey: 'clouddr.links.vmCapture', descKey: 'clouddr.links.vmCaptureDesc', icon: HardDriveUpload },
  { href: '/dr/protect', labelKey: 'clouddr.links.iacDr', descKey: 'clouddr.links.iacDrDesc', icon: FileCode2 },
  { href: '/dr/topology', labelKey: 'clouddr.links.topology', descKey: 'clouddr.links.topologyDesc', icon: GitBranch },
  { href: '/recover/cloud-dr/rehearse', labelKey: 'clouddr.links.rehearseFailover', descKey: 'clouddr.links.rehearseFailoverDesc', icon: PlayCircle },
  { href: '/recover/it-dr/recover', labelKey: 'clouddr.links.failoverFailback', descKey: 'clouddr.links.failoverFailbackDesc', icon: RotateCcw },
] as const;

/** Formats an ISO timestamp as a short, locale-stable date-time. */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Formats a duration in seconds as a compact h/m/s string. */
function formatSeconds(secs: number | null | undefined): string {
  if (secs == null || secs < 0) return '—';
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Maps a failover-run status to a design-system badge class. */
function failoverStatusClass(status: string): string {
  const s = status.toUpperCase();
  if (s === 'COMPLETED' || s === 'ATTESTED') return 'badge-success';
  if (s === 'FAILED' || s === 'ROLLED_BACK' || s === 'CANCELLED') return 'badge-error';
  return 'badge-warning';
}

/** RTO-vs-RTA comparison for the last failover test, computed from real records. */
function FailoverTestCard({ test }: { test: FailoverTestSummary }) {
  const t = useRecoverT();
  const objective = test.rto_objective_seconds;
  const actual = test.rto_actual_seconds ?? null;
  const met = actual != null && objective > 0 ? actual <= objective : null;
  return (
    <section className="card p-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{t('clouddr.lastFailoverTest')}</h2>
        <span className={failoverStatusClass(test.status)}>{test.status}</span>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border/60 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('clouddr.mode')}</p>
          <p className="mt-1 text-lg font-semibold capitalize text-foreground">{test.mode}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(test.initiated_at)}</p>
        </div>
        <div className="rounded-lg border border-border/60 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('clouddr.rtoObjective')}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {formatSeconds(objective)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('clouddr.definedTarget')}</p>
        </div>
        <div className="rounded-lg border border-border/60 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('clouddr.rtoActual')}</p>
          <p
            className={
              'mt-1 text-lg font-semibold tabular-nums ' +
              (met == null ? 'text-foreground' : met ? 'text-success-600' : 'text-error-500')
            }
          >
            {formatSeconds(actual)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {met == null ? t('clouddr.inFlight') : met ? t('clouddr.withinObjective') : t('clouddr.exceededObjective')}
          </p>
        </div>
      </div>
    </section>
  );
}

function CloudDRSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

/** Inline error state with a retry; never silently hides a failure. */
function CloudDRError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useRecoverT();
  return (
    <div className="card flex flex-col items-start gap-3 border-destructive/40 p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-5 w-5" />
        <h2 className="text-base font-semibold">{t('clouddr.errorTitle')}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
      <button type="button" onClick={onRetry} className="btn-secondary inline-flex items-center gap-2">
        {t('common.retry')}
      </button>
    </div>
  );
}

function OverviewContent({ data }: { data: CloudDROverview }) {
  const t = useRecoverT();
  const wl = data.workloads;
  const bg = data.boot_graph;
  const test = data.last_failover_test;

  return (
    <div className="space-y-6">
      {/* KPI strip — every value derives from real persisted state. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t('clouddr.kpiVmCaptures')}
          value={wl.vm_sources}
          icon={HardDriveUpload}
          tone="sky"
          detail={t('clouddr.kpiVmCapturesDetail')}
        />
        <KpiCard
          title={t('clouddr.kpiIacSnapshots')}
          value={wl.iac_snapshots}
          icon={FileCode2}
          tone="emerald"
          detail={t('clouddr.kpiIacSnapshotsDetail')}
        />
        <KpiCard
          title={t('clouddr.kpiRecoveryScopes')}
          value={bg.total_scopes}
          icon={Boxes}
          tone="gold"
          detail={t('clouddr.kpiRecoveryScopesDetail', { count: bg.scopes_with_plan })}
        />
        <KpiCard
          title={t('clouddr.kpiSequencedServices')}
          value={bg.total_services}
          icon={Layers}
          tone="slate"
          detail={t('clouddr.kpiSequencedServicesDetail')}
        />
      </div>

      {/* Region / AZ failover view: real bootgraph sequence, visualised before execution. */}
      <RegionFailoverView regions={bg.scopes} />

      {/* RTO-vs-RTA from the last real failover/drill test. */}
      {test ? (
        <FailoverTestCard test={test} />
      ) : (
        <section className="card p-6">
          <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-foreground">
            <Timer className="h-4 w-4 text-muted-foreground" /> {t('clouddr.lastFailoverTest')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('clouddr.noFailoverYet')}</p>
        </section>
      )}

      {/* Workload inventory. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <HardDriveUpload className="h-4 w-4 text-muted-foreground" /> {t('clouddr.kpiVmCaptures')}
            </h2>
            <span className="text-xs text-muted-foreground">{t('clouddr.vmSourcesCount', { count: wl.vm_sources })}</span>
          </header>
          {wl.vm_sources_list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('clouddr.noVmSources')}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {wl.vm_sources_list.slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2.5">
                  <span className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground">{s.name}</span>
                    <span className="text-xs text-muted-foreground">· {s.source_kind}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={s.enabled ? 'badge-success' : 'badge-neutral'}>
                      {s.enabled ? t('clouddr.enabled') : t('clouddr.disabled')}
                    </span>
                    {t('clouddr.epochCount', { count: s.epoch_count })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <FileCode2 className="h-4 w-4 text-muted-foreground" /> {t('clouddr.kpiIacSnapshots')}
            </h2>
            <span className="text-xs text-muted-foreground">{t('clouddr.iacSnapshotCount', { count: wl.iac_snapshots })}</span>
          </header>
          {wl.iac_snapshots_list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('clouddr.noIacSnapshots')}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {wl.iac_snapshots_list.slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2.5">
                  <span className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground">{s.name}</span>
                    <span className="text-xs text-muted-foreground">· v{s.version}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('clouddr.resourceCount', { count: s.resource_count, kind: s.source_kind })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Composed workspaces. */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
          <CloudCog className="h-4 w-4 text-muted-foreground" /> {t('clouddr.workspaces')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {WORKSPACE_LINKS.map((w) => {
            const Icon = w.icon;
            return (
              <Link
                key={w.labelKey}
                href={w.href}
                className="card group flex flex-col gap-2 p-5 transition-colors hover:border-primary/50"
              >
                <div className="flex items-center gap-2 text-primary">
                  <Icon className="h-5 w-5" />
                  <span className="font-semibold text-foreground">{t(w.labelKey)}</span>
                </div>
                <p className="text-sm text-muted-foreground">{t(w.descKey)}</p>
                <span className="mt-1 inline-flex items-center gap-1 text-sm text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {t('common.open')} <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/**
 * Cloud Disaster Recovery sub-solution dashboard.
 *
 * Binds the real `GET /api/recover/cloud-dr/overview` aggregation — protected
 * workloads (VM captures + IaC snapshots), the last failover test with its
 * RTO-vs-RTA, and the boot-graph status across recovery scopes — with real
 * loading and error states. The region/AZ failover view drills into the REAL
 * bootgraph boot sequence before execution, and links into the shared rehearsal
 * flow and the existing failover/failback execution surfaces.
 */
export function CloudDRDashboard() {
  const t = useRecoverT();
  const { data, isLoading, isError, error, refetch } = useCloudDROverview();

  if (isLoading) return <CloudDRSkeleton />;
  if (isError || !data) {
    return (
      <CloudDRError
        message={error?.message ?? t('clouddr.errorFallback')}
        onRetry={() => void refetch()}
      />
    );
  }
  return <OverviewContent data={data} />;
}
