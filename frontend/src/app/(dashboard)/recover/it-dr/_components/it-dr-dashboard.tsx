'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  DatabaseZap,
  GitBranch,
  PlayCircle,
  ShieldCheck,
} from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import { SimpleTable } from '@/components/shared/simple-table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useITDROverview } from '@/lib/recover/use-it-dr-overview';
import { useRecoverT } from '../../_lib/recover-i18n';
import type {
  ITDROverview,
  ITDRReadinessComponent,
  ITDRRunbookSummary,
} from '@/types/recover-it-dr';

/** Composed IT DR capability surfaces (the dynamic-runbook spine stays live). */
const WORKSPACE_LINKS = [
  { href: '/recover/it-dr/runbooks', labelKey: 'itdr.links.runbookStudio', descKey: 'itdr.links.runbookStudioDesc', icon: BookOpen },
  { href: '/recover/it-dr/rehearse', labelKey: 'itdr.links.rehearsals', descKey: 'itdr.links.rehearsalsDesc', icon: CalendarClock },
  { href: '/recover/it-dr/recover', labelKey: 'itdr.links.liveRecovery', descKey: 'itdr.links.liveRecoveryDesc', icon: PlayCircle },
  { href: '/dr/topology', labelKey: 'itdr.links.topology', descKey: 'itdr.links.topologyDesc', icon: GitBranch },
  { href: '/recover/it-dr/prove', labelKey: 'itdr.links.evidence', descKey: 'itdr.links.evidenceDesc', icon: ShieldCheck },
  { href: '/recover/it-dr/metastore', labelKey: 'itdr.links.metastore', descKey: 'itdr.links.metastoreDesc', icon: DatabaseZap },
] as const;

/** Formats an ISO timestamp as a short, locale-stable date-time. */
function formatDateTime(iso: string | undefined): string {
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

/** Maps a runbook authoring status to a design-system badge class. */
function statusBadgeClass(status: string): string {
  switch (status) {
    case 'published':
      return 'badge-success';
    case 'archived':
      return 'badge-neutral';
    default:
      return 'badge-warning';
  }
}

/** Maps a readiness score to a tone for the gauge ring + label. */
function readinessTone(score: number): { ring: string; text: string; labelKey: string } {
  if (score >= 80) return { ring: 'text-success-500', text: 'text-success-600', labelKey: 'itdr.toneStrong' };
  if (score >= 50) return { ring: 'text-warning-500', text: 'text-warning-700 dark:text-warning-300', labelKey: 'itdr.toneFair' };
  return { ring: 'text-error-500', text: 'text-error-500', labelKey: 'itdr.toneAtRisk' };
}

/** A compact circular readiness gauge driven by the real, computed score. */
function ReadinessGauge({ score }: { score: number }) {
  const t = useRecoverT();
  const tone = readinessTone(score);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className="relative flex h-36 w-36 items-center justify-center" role="img" aria-label={t('itdr.readinessAria', { score: clamped })}>
      <svg className="h-36 w-36 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} className="stroke-border/40" strokeWidth="10" fill="none" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          className={cn('transition-all duration-700', tone.ring)}
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('text-3xl font-semibold tabular-nums', tone.text)}>{clamped}</span>
        <span className="text-xs font-medium text-muted-foreground">{t(tone.labelKey)}</span>
      </div>
    </div>
  );
}

/** One weighted readiness component row with its real basis text. */
function ReadinessComponentRow({ component }: { component: ITDRReadinessComponent }) {
  const t = useRecoverT();
  const pct = Math.round(component.value * 100);
  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{component.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {t('itdr.componentWeight', { pct, weight: Math.round(component.weight * 100) })}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{component.detail}</p>
    </li>
  );
}

// SimpleTable<T> requires T extends Record<string, unknown>; the row alias
// satisfies the constraint so the generic narrows cleanly over the domain type.
type RunbookRow = ITDRRunbookSummary & Record<string, unknown>;

function RunbookInventoryTable({ items }: { items: ITDRRunbookSummary[] }) {
  const t = useRecoverT();
  return (
    <SimpleTable<RunbookRow>
      data={items as RunbookRow[]}
      ariaLabel={t('itdr.tableAria')}
      emptyMessage={t('itdr.tableEmpty')}
      columns={[
        {
          key: 'name',
          header: t('itdr.tableRunbook'),
          render: (rb) => (
            <Link
              href={`/recover/it-dr/runbooks?runbook=${encodeURIComponent(rb.id)}`}
              className="font-medium text-foreground hover:text-primary hover:underline"
            >
              {rb.name}
            </Link>
          ),
        },
        {
          key: 'status',
          header: t('itdr.tableStatus'),
          render: (rb) => <span className={statusBadgeClass(rb.status)}>{rb.status}</span>,
        },
        {
          key: 'task_count',
          header: t('itdr.tableTasks'),
          align: 'right',
          className: 'tabular-nums',
          render: (rb) => rb.task_count,
        },
        {
          key: 'active_runs',
          header: t('itdr.tableActiveRuns'),
          align: 'right',
          className: 'tabular-nums',
          render: (rb) =>
            rb.active_runs > 0 ? (
              <span className="badge-info inline-flex items-center gap-1">
                <PlayCircle className="h-3 w-3" /> {rb.active_runs}
              </span>
            ) : (
              <span className="text-muted-foreground">0</span>
            ),
        },
        {
          key: 'updated_at',
          header: t('itdr.tableUpdated'),
          align: 'right',
          className: 'text-muted-foreground',
          render: (rb) => formatDateTime(rb.updated_at),
        },
      ]}
    />
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

/** Inline error state with a retry; never silently hides a failure. */
function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useRecoverT();
  return (
    <div className="card flex flex-col items-start gap-3 border-destructive/40 p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-5 w-5" />
        <h2 className="text-base font-semibold">{t('itdr.errorTitle')}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
      <button type="button" onClick={onRetry} className="btn-secondary inline-flex items-center gap-2">
        {t('common.retry')}
      </button>
    </div>
  );
}

function OverviewContent({ data }: { data: ITDROverview }) {
  const t = useRecoverT();
  const inv = data.inventory;
  const published = inv.by_status.published ?? 0;
  const last = data.last_rehearsal;
  const upcoming = data.upcoming_rehearsal;
  const approvals = data.open_approvals;

  return (
    <div className="space-y-6">
      {/* KPI strip — every value derives from real persisted state. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t('itdr.kpiRunbooks')}
          value={inv.total}
          icon={BookOpen}
          tone="sky"
          detail={t('itdr.kpiRunbooksDetail', { count: published })}
        />
        <KpiCard
          title={t('itdr.kpiReadiness')}
          value={data.readiness.score}
          unit="/100"
          icon={ShieldCheck}
          tone={data.readiness.score >= 80 ? 'emerald' : data.readiness.score >= 50 ? 'gold' : 'rose'}
          detail={t('itdr.kpiReadinessDetail')}
        />
        <KpiCard
          title={t('itdr.kpiOpenApprovals')}
          value={approvals.total}
          icon={ClipboardCheck}
          tone={approvals.total > 0 ? 'gold' : 'emerald'}
          detail={approvals.total > 0 ? t('itdr.kpiAwaitingSignoff') : t('itdr.kpiNoGatesBlocking')}
        />
        <KpiCard
          title={t('itdr.kpiNextRehearsal')}
          value={upcoming ? formatDateTime(upcoming.next_run) : t('common.notScheduled')}
          icon={CalendarClock}
          tone="slate"
          detail={upcoming ? upcoming.name : t('itdr.kpiNoDrillScheduled')}
        />
      </div>

      {/* Readiness breakdown + rehearsal cadence. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="card p-6">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">{t('itdr.recoveryReadiness')}</h2>
            <span className="text-xs text-muted-foreground">{t('itdr.asOf', { when: formatDateTime(data.generated_at) })}</span>
          </header>
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            <ReadinessGauge score={data.readiness.score} />
            <ul className="flex-1 space-y-4">
              {data.readiness.components.map((c) => (
                <ReadinessComponentRow key={c.key} component={c} />
              ))}
            </ul>
          </div>
        </section>

        <section className="card flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold text-foreground">{t('itdr.rehearsalCadence')}</h2>
          <div className="rounded-lg border border-border/60 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarClock className="h-4 w-4" /> {t('itdr.upcoming')}
            </div>
            {upcoming ? (
              <div>
                <p className="font-medium text-foreground">{upcoming.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(upcoming.next_run)} · {upcoming.profile} profile
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('itdr.noDrillScheduledDot')}</p>
            )}
          </div>
          <div className="rounded-lg border border-border/60 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" /> {t('itdr.lastRehearsal')}
            </div>
            {last ? (
              <div>
                <p className="font-medium text-foreground">{last.runbook_name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(last.started_at)} ·{' '}
                  <span className={last.status === 'completed' ? 'text-success-600' : 'text-warning-700 dark:text-warning-300'}>
                    {last.status}
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('itdr.noRehearsalRecorded')}</p>
            )}
          </div>
        </section>
      </div>

      {/* Open approval gates blocking active runs. */}
      {approvals.total > 0 && (
        <section className="card p-6">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">{t('itdr.openApprovalGates')}</h2>
            <span className="badge-warning">{t('itdr.awaitingSignoffBadge', { count: approvals.total })}</span>
          </header>
          <ul className="divide-y divide-border/60">
            {approvals.items.map((a) => (
              <li key={`${a.run_id}:${a.task_id}`} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-foreground">{a.task_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('itdr.approvalMeta', { name: a.runbook_name, mode: a.run_mode, since: formatDateTime(a.awaiting_since) })}
                  </p>
                </div>
                <Link
                  href={`/recover/it-dr/recover?run=${encodeURIComponent(a.run_id)}`}
                  className="btn-secondary inline-flex items-center gap-1 text-sm"
                >
                  {t('common.review')} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Runbook inventory. */}
      <section className="card p-6">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{t('itdr.runbookInventory')}</h2>
          <Link href="/recover/it-dr/runbooks" className="btn-secondary inline-flex items-center gap-1 text-sm">
            {t('itdr.openStudio')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </header>
        <RunbookInventoryTable items={inv.items} />
        {inv.total > inv.items.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('itdr.showingCount', { shown: inv.items.length, total: inv.total })}{' '}
            <Link href="/recover/it-dr/runbooks" className="text-primary hover:underline">
              {t('common.viewAll')}
            </Link>
          </p>
        )}
      </section>

      {/* Composed workspaces. */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-foreground">{t('itdr.workspaces')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {WORKSPACE_LINKS.map((w) => {
            const Icon = w.icon;
            return (
              <Link
                key={w.href}
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
 * IT Disaster Recovery sub-solution dashboard.
 *
 * Binds the real `GET /api/recover/it-dr/overview` aggregation — runbook
 * inventory, readiness score computed from real state, last/upcoming rehearsal,
 * and the open approval-gate backlog — with real loading and error states. It
 * links into the composed dr/* workspaces (runbook studio, rehearsals, live
 * recovery, topology, evidence), where dynamic runbooks remain editable mid-event
 * without halting the run.
 */
export function ITDRDashboard() {
  const t = useRecoverT();
  const { data, isLoading, isError, error, refetch } = useITDROverview();

  if (isLoading) return <DashboardSkeleton />;
  if (isError || !data) {
    return (
      <DashboardError
        message={error?.message ?? t('itdr.errorFallback')}
        onRetry={() => void refetch()}
      />
    );
  }
  return <OverviewContent data={data} />;
}
