'use client';

import { AlertTriangle, Activity, CheckCircle2, Clock, ShieldAlert, TrendingUp } from 'lucide-react';
import { KpiCard } from '@/components/shared/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useRecoverAnalytics } from '@/lib/recover/use-analytics';
import { useRecoverT } from '../_lib/recover-i18n';
import type {
  RecoverAnalytics,
  RecoverApplicationAnalytics,
  RecoverBottleneck,
  RecoverReadinessTrendPoint,
} from '@/types/recover-analytics';

/** Formats a seconds count as a compact h/m/s label. */
function formatSeconds(s: number | undefined): string {
  if (s === undefined || s === null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Maps a readiness score to a tone. */
function readinessTone(score: number): 'emerald' | 'gold' | 'rose' {
  if (score >= 80) return 'emerald';
  if (score >= 50) return 'gold';
  return 'rose';
}

/** One row of the per-application RTO-vs-RTA comparison. */
function RTOComparisonRow({ app }: { app: RecoverApplicationAnalytics }) {
  const t = useRecoverT();
  const target = app.rto_target_seconds;
  const rta = app.latest_rta_seconds;
  // Bar widths are relative to the larger of target/RTA so a breach visibly
  // overshoots; a missing RTA renders only the target track.
  const ceiling = Math.max(target, rta ?? 0, 1);
  const targetPct = Math.round((target / ceiling) * 100);
  const rtaPct = rta !== undefined ? Math.round((rta / ceiling) * 100) : 0;

  return (
    <tr>
      <td>
        <span className="font-medium text-foreground">{app.name}</span>
        <span className="ms-2 text-xs text-muted-foreground">{app.recovery_tier.replace('_', ' ')}</span>
      </td>
      <td className="text-end tabular-nums text-muted-foreground">{formatSeconds(target)}</td>
      <td className="text-end tabular-nums">
        {rta === undefined ? (
          <span className="text-muted-foreground">{t('analytics.untested')}</span>
        ) : (
          <span className={app.rta_breach ? 'font-semibold text-error-500' : 'text-success-600'}>
            {formatSeconds(rta)}
          </span>
        )}
      </td>
      <td className="w-48">
        <div className="space-y-1" aria-hidden>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
            <div className="h-full rounded-full bg-primary" style={{ width: `${targetPct}%` }} />
          </div>
          {rta !== undefined && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
              <div
                className={cn('h-full rounded-full', app.rta_breach ? 'bg-error-500' : 'bg-success-500')}
                style={{ width: `${rtaPct}%` }}
              />
            </div>
          )}
        </div>
      </td>
      <td className="text-end">
        {app.rta_breach ? (
          <span className="badge-danger">+{formatSeconds(app.breach_seconds)}</span>
        ) : rta !== undefined ? (
          <span className="badge-success">{t('analytics.onTarget')}</span>
        ) : (
          <span className="badge-neutral">{t('analytics.noData')}</span>
        )}
      </td>
    </tr>
  );
}

/** The readiness trend sparkline, drawn from real historical snapshots. */
function ReadinessTrend({ points }: { points: RecoverReadinessTrendPoint[] }) {
  const t = useRecoverT();
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('analytics.noReadinessHistory')}</p>;
  }
  // Snapshots arrive newest-first; plot oldest→newest left to right.
  const ordered = [...points].reverse();
  const w = 320;
  const h = 64;
  const max = 100;
  const step = ordered.length > 1 ? w / (ordered.length - 1) : 0;
  const coords = ordered.map((p, i) => {
    const x = ordered.length > 1 ? i * step : w / 2;
    const y = h - (p.score / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const latest = ordered[ordered.length - 1];

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" role="img" aria-label={t('analytics.trendAria')}>
        <polyline
          points={coords.join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        />
      </svg>
      <p className="text-xs text-muted-foreground">
        {ordered.length === 1
          ? t('analytics.trendCaptionOne', { count: ordered.length, score: latest.score })
          : t('analytics.trendCaptionMany', { count: ordered.length, score: latest.score })}
      </p>
    </div>
  );
}

/** Maps a bottleneck kind to its badge tone. */
function bottleneckBadge(kind: string): string {
  switch (kind) {
    case 'rto_breach':
      return 'badge-danger';
    case 'failing_recovery':
      return 'badge-danger';
    default:
      return 'badge-warning';
  }
}

function BottleneckRow({ b }: { b: RecoverBottleneck }) {
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{b.label}</p>
        <p className="text-sm text-muted-foreground">{b.detail}</p>
      </div>
      <span className={cn('shrink-0', bottleneckBadge(b.kind))}>{b.kind.replace(/_/g, ' ')}</span>
    </li>
  );
}

function AnalyticsContent({ data }: { data: RecoverAnalytics }) {
  const t = useRecoverT();
  const p = data.progress;
  // Applications arrive worst-first (ascending readiness); surface that order.
  const apps = data.applications;

  return (
    <div className="space-y-6">
      {/* Portfolio KPI strip — every value computed from real records + Metastore RTO. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title={t('analytics.kpiPortfolioReadiness')}
          value={data.portfolio_readiness}
          unit="/100"
          icon={ShieldAlert}
          tone={readinessTone(data.portfolio_readiness)}
          detail={t('analytics.kpiPortfolioReadinessDetail')}
        />
        <KpiCard
          title={t('analytics.kpiRecovered')}
          value={p.recovered}
          icon={CheckCircle2}
          tone="emerald"
          detail={t('analytics.kpiRecoveredDetail', { pct: Math.round(p.completion_ratio * 100) })}
        />
        <KpiCard
          title={t('analytics.kpiAtRisk')}
          value={p.at_risk}
          icon={AlertTriangle}
          tone={p.at_risk > 0 ? 'rose' : 'emerald'}
          detail={t('analytics.kpiAtRiskDetail')}
        />
        <KpiCard
          title={t('analytics.kpiUntested')}
          value={p.untested}
          icon={Clock}
          tone={p.untested > 0 ? 'gold' : 'emerald'}
          detail={t('analytics.kpiUntestedDetail', { count: p.in_progress })}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* RTO-vs-RTA comparison. */}
        <section className="card p-6">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Activity className="h-4 w-4 text-primary" /> {t('analytics.rtoVsRta')}
            </h2>
            <span className="text-xs text-muted-foreground">{t('analytics.appsCount', { count: apps.length })}</span>
          </header>
          {apps.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('analytics.noAppsRegistered')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-start">{t('analytics.colApplication')}</th>
                    <th className="text-end">{t('analytics.colRtoTarget')}</th>
                    <th className="text-end">{t('analytics.colLatestRta')}</th>
                    <th className="text-start">{t('analytics.colObjectiveVsActual')}</th>
                    <th className="text-end">{t('analytics.colResult')}</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => (
                    <RTOComparisonRow key={a.application_id} app={a} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Readiness trend + top bottlenecks. */}
        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
              <TrendingUp className="h-4 w-4 text-primary" /> {t('analytics.readinessTrend')}
            </h2>
            <ReadinessTrend points={data.readiness_trend} />
          </section>

          <section className="card p-6">
            <header className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">{t('analytics.topBottlenecks')}</h2>
              {data.bottlenecks.length > 0 && (
                <span className="badge-warning">{data.bottlenecks.length}</span>
              )}
            </header>
            {data.bottlenecks.length === 0 ? (
              <p className="py-4 text-sm text-success-600">{t('analytics.noBottlenecks')}</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {data.bottlenecks.map((b, i) => (
                  <BottleneckRow key={`${b.kind}:${b.application_id ?? i}`} b={b} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

function AnalyticsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useRecoverT();
  return (
    <div className="card flex flex-col items-start gap-3 border-destructive/40 p-6">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-5 w-5" />
        <h2 className="text-base font-semibold">{t('analytics.errorTitle')}</h2>
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
      <button type="button" onClick={onRetry} className="btn-secondary inline-flex items-center gap-2">
        {t('common.retry')}
      </button>
    </div>
  );
}

/**
 * Cross-sub-solution RTO/RTA & recovery analytics dashboard (Prompt 8).
 *
 * Binds the REAL `GET /api/recover/analytics` endpoint — per-application
 * RTO-vs-RTA comparison, multi-application recovery progress, the readiness trend,
 * and the top flagged bottlenecks — with real loading and error states (never
 * hidden). Every metric is computed server-side from real persisted execution
 * records and the Metastore RTO seam. Consumed by the Recover landing page and
 * every sub-solution overview.
 */
export function RecoverAnalyticsDashboard() {
  const t = useRecoverT();
  const { data, isLoading, isError, error, refetch } = useRecoverAnalytics();

  if (isLoading) return <AnalyticsSkeleton />;
  if (isError || !data) {
    return (
      <AnalyticsError
        message={error?.message ?? t('analytics.errorFallback')}
        onRetry={() => void refetch()}
      />
    );
  }
  return <AnalyticsContent data={data} />;
}
