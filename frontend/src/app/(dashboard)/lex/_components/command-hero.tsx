'use client';

/**
 * Command hero band for the Watheeq Legal-Affairs command center (`/lex`).
 *
 * A premium full-width brand band that anchors the landing page:
 *   - LEFT: eyebrow + greeting title + subtitle + at-a-glance tag chips
 *     (SLA breaches, overdue obligations, pending approvals roll-ups).
 *   - RIGHT: a floating "posture" aside (live compliance gauge + recorded-score
 *     trend + resource stats), with the primary quick actions kept in the hero.
 *
 * The compliance-score trend is read from the shared tenant-scoped store
 * (`../_lib/compliance-score-history`), which the compliance page writes to as
 * well — one localStorage series, SSR-safe and resilient to malformed / legacy
 * values.
 *
 * Data is read from the shared command-center hooks so no extra network
 * round-trips are issued: `useLexCommandKpis()` (KPI strip values, including
 * compliance score + active contracts from the shared dashboard fetch) and
 * `useLexOverviewDashboard()` (the single `getDashboard()` cache entry, reused
 * for the gauge score). Both dedupe via the shared `['lex-overview','dashboard']`
 * react-query key.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Download,
  FilePlus2,
  ListChecks,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendSparkline } from '@/components/shared/trend-sparkline';
import { useLocale } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useLexFormat } from '@/lib/lex/ksa';
import { canAccessWith } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { type ComplianceScorePoint, recordComplianceScore } from '../_lib/compliance-score-history';
import { COMPLIANCE_SCORE_THRESHOLDS } from '../_lib/compliance-score';
import { type LexGreetingPeriod, useLexLabels } from '../_lib/lex-i18n';
import { useLexCommandKpis, useLexOverviewDashboard } from '../_lib/use-lex-command-center';
import { CommandCard, ScoreGauge } from './command-ui';

/* ------------------------------------------------------------------------- *
 * Hero
 * ------------------------------------------------------------------------- */

export interface CommandHeroProps {
  /** Invoked by the hero's "Export" quick action. */
  onExport?: () => void;
}

/** Resolve a browser-local hour into the welcome shown in the hero. */
export function resolveGreetingPeriod(hour: number): LexGreetingPeriod {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function CommandHero({ onExport }: CommandHeroProps) {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const { overview: t, commonActions } = useLexLabels();
  const { hasPermission, user } = useAuth();
  const canViewCompliance = hasPermission('lex:audit:read');

  const kpis = useLexCommandKpis();
  const dashboard = useLexOverviewDashboard();

  const [scoreHistory, setScoreHistory] = useState<ComplianceScorePoint[]>([]);
  // Start with a hydration-safe generic "Welcome" and specialize immediately
  // after mount using the user's browser-local time. Refresh once per minute so
  // a long-lived dashboard naturally crosses morning/afternoon/evening bands.
  const [greetingPeriod, setGreetingPeriod] = useState<LexGreetingPeriod>('neutral');

  useEffect(() => {
    const updateGreeting = () => {
      setGreetingPeriod(resolveGreetingPeriod(new Date().getHours()));
    };
    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // The gauge score comes from the shared dashboard fetch. Keep it unknown
  // while loading or unavailable instead of presenting a false 0% score.
  const liveComplianceScore = kpis.complianceScore.isAvailable ? kpis.complianceScore.value : undefined;
  const complianceScore = Math.round(liveComplianceScore ?? 0);
  const postureLoading = kpis.complianceScore.isLoading;
  const postureUnavailable = !postureLoading && !kpis.complianceScore.isAvailable;

  const tenantId = user?.tenant_id ?? 'default';

  useEffect(() => {
    if (liveComplianceScore == null) {
      return;
    }
    setScoreHistory(recordComplianceScore(tenantId, Math.round(liveComplianceScore)));
  }, [tenantId, liveComplianceScore]);

  const scoreTrendData = useMemo(
    () =>
      scoreHistory.map((point) => ({
        // KSA-formatted axis label: Arabic mode renders the Umm al-Qura Hijri
        // date with Arabic-Indic digits, Gregorian short date otherwise.
        label: f.formatDate(point.at, { month: 'short', day: 'numeric' }),
        value: point.score,
      })),
    [scoreHistory, f],
  );

  const fmt = (value: number) => f.formatNumber(value);

  // Surface only meaningful, loaded signals. Zero-value warnings previously
  // made a healthy queue look noisy and weakened the first impression.
  const signals: Array<{
    key: string;
    icon: typeof AlertTriangle;
    label: string;
    value: number;
    isLoading: boolean;
    tone: 'danger' | 'warning' | 'info';
    href: string;
  }> = [
    {
      key: 'sla',
      icon: AlertTriangle,
      label: t.commandKpis.slaBreaches,
      value: kpis.slaBreaches.value,
      isLoading: kpis.slaBreaches.isLoading,
      tone: 'danger',
      href: '/lex/service-desk/sla-board?breached=true',
    },
    {
      key: 'obligations',
      icon: CalendarClock,
      label: t.commandKpis.overdueObligations,
      value: kpis.overdueObligations.value,
      isLoading: kpis.overdueObligations.isLoading,
      tone: 'warning',
      href: '/lex/obligations#overdue',
    },
    {
      key: 'approvals',
      icon: ShieldCheck,
      label: t.commandKpis.pendingApprovals,
      value: kpis.pendingApprovals.value,
      isLoading: kpis.pendingApprovals.isLoading,
      tone: 'info',
      href: '/lex/inbox',
    },
    // NOTE: openAlerts is intentionally NOT a left-column chip — it already
    // headlines the compliance posture panel on the right, so surfacing it here
    // too was pure duplication. Keep it out to keep the hero compact.
  ];

  const visibleSignals = signals.filter((signal) => !signal.isLoading && signal.value > 0).slice(0, 4);
  const signalsLoading = signals.some((signal) => signal.isLoading);
  const attentionCount = signals.reduce(
    (total, signal) => total + (signal.key === 'approvals' || signal.isLoading ? 0 : signal.value),
    0,
  );

  const posture =
    liveComplianceScore == null
      ? null
      : complianceScore >= COMPLIANCE_SCORE_THRESHOLDS.good
        ? { label: t.hero.posture.healthy, tone: 'success' as const }
        : complianceScore >= COMPLIANCE_SCORE_THRESHOLDS.warning
          ? { label: t.hero.posture.watch, tone: 'warning' as const }
          : { label: t.hero.posture.actionRequired, tone: 'error' as const };

  const canCreateRequest = hasPermission('lex:request:add');
  const canReviewApprovals = canAccessWith(hasPermission, {
    anyOf: [
      'lex:request:approve',
      'lex:case:approve',
      'lex:case:edit',
      'lex:contract:approve',
      'lex:contract:edit',
      'lex:investigation:approve',
      'lex:settlement:approve',
      'lex:consultation:approve',
    ],
  });
  // The policy analytics count is tenant-wide rather than assigned-to-me.
  // Keep this primary action permission-driven instead of implying that a
  // non-zero tenant total is personally actionable.
  const showReviewApprovals = canReviewApprovals;
  const canDraft = canAccessWith(hasPermission, {
    anyOf: [
      'lex:document:add',
      'lex:document:edit',
      'lex:contract:add',
      'lex:contract:edit',
      'lex:consultation:add',
      'lex:consultation:edit',
    ],
  });
  return (
    <CommandCard
      as="section"
      accent="primary"
      dir={direction}
      lang={locale}
      className="border-primary/30 bg-brand-primary-600 p-0 shadow-elevation-4"
    >
      <Scale
        aria-hidden
        strokeWidth={0.55}
        className="pointer-events-none absolute -bottom-14 end-8 h-72 w-72 text-white/[0.045]"
      />

      <div
        className={cn(
          'relative grid grid-cols-1 gap-6 p-5 sm:p-6 lg:gap-7 lg:p-6',
          canViewCompliance && 'lg:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.8fr)]',
        )}
      >
        {/* LEFT — identity + greeting + chips + quick actions */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="space-y-3">
            <p className="text-overline font-semibold uppercase tracking-caps text-brand-accent-300 rtl:normal-case rtl:tracking-normal">
              {t.hero.eyebrow}
            </p>
            <h1 className="max-w-3xl font-display text-h2 font-semibold leading-tight tracking-[-0.04em] text-white rtl:tracking-normal sm:text-h1">
              {t.hero.greeting(greetingPeriod, user?.first_name?.trim() || user?.full_name?.trim() || undefined)}
            </h1>
            <p className="max-w-2xl text-body text-white/80 sm:text-body-lg">
              {signalsLoading
                ? t.hero.subtitle
                : attentionCount > 0
                  ? t.hero.attentionSummary(fmt(attentionCount))
                  : t.hero.allClear}
            </p>
          </div>

          {visibleSignals.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {visibleSignals.map((signal) => (
                <li key={signal.key}>
                  <Link
                    href={signal.href}
                    className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/10 py-1 pe-3 ps-1.5 text-caption shadow-sm outline-none transition-colors hover:border-white/30 hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    <span
                      className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10',
                        signal.tone === 'danger' && 'text-error-300',
                        signal.tone === 'warning' && 'text-warning-300',
                        signal.tone === 'info' && 'text-info-300',
                      )}
                    >
                      <signal.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    </span>
                    <span className="font-semibold tabular-nums text-white">{fmt(signal.value)}</span>
                    <span className="text-white/75">{signal.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {showReviewApprovals ? (
              <Button
                size="sm"
                asChild
                className="bg-brand-accent text-content-on-accent shadow-elevation-2 hover:bg-brand-accent/90 motion-safe:duration-fast motion-safe:ease-emphasized"
              >
                <Link href="/lex/inbox">
                  <ListChecks className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {t.hero.quickActions.reviewApprovals}
                </Link>
              </Button>
            ) : null}
            {canCreateRequest ? (
              <Button
                variant={showReviewApprovals ? 'outline' : 'default'}
                size="sm"
                asChild
                className={cn(
                  'motion-safe:duration-fast motion-safe:ease-emphasized',
                  showReviewApprovals
                    ? 'border-white/20 bg-white/[0.08] text-white shadow-none hover:border-white/30 hover:bg-white/[0.14] hover:text-white'
                    : 'bg-brand-accent text-content-on-accent shadow-elevation-2 hover:bg-brand-accent/90',
                )}
              >
                <Link href="/lex/service-desk/new">
                  <FilePlus2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {t.hero.quickActions.newRequest}
                </Link>
              </Button>
            ) : null}
            {canDraft ? (
              <Button
                variant="outline"
                size="sm"
                asChild
                className="border-white/20 bg-white/[0.08] text-white shadow-none hover:border-white/30 hover:bg-white/[0.14] hover:text-white"
              >
                <Link href="/lex/drafting">
                  <Sparkles className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {t.hero.quickActions.aiDrafting}
                </Link>
              </Button>
            ) : null}
            {canViewCompliance ? (
              <Button
                variant="outline"
                size="sm"
                asChild
                className="border-white/20 bg-white/[0.08] text-white shadow-none hover:border-white/30 hover:bg-white/[0.14] hover:text-white"
              >
                <Link href="/lex/compliance">
                  <ShieldCheck className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {t.hero.quickActions.compliance}
                </Link>
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={!onExport || !dashboard.data}
              className="border-white/20 bg-white/[0.08] text-white shadow-none hover:border-white/30 hover:bg-white/[0.14] hover:text-white disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-white/35"
            >
              <Download className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {commonActions.export}
            </Button>
          </div>
        </div>

        {/* RIGHT — posture panel */}
        {canViewCompliance ? (
          <CommandCard as="div" accent="neutral" className="flex flex-col gap-4 p-4 shadow-elevation-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-overline uppercase tracking-caps text-muted-foreground">
                  {t.hero.posture.complianceScore}
                </p>
                <p className="text-body-sm text-muted-foreground">{t.compliancePosture.description}</p>
              </div>
              {!postureLoading && posture ? (
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 text-caption font-semibold',
                    posture.tone === 'success' && 'border-status-success/25 bg-status-success/10 text-status-success',
                    posture.tone === 'warning' && 'border-status-warning/25 bg-status-warning/10 text-status-warning',
                    posture.tone === 'error' && 'border-status-error/25 bg-status-error/10 text-status-error',
                  )}
                >
                  {posture.label}
                </span>
              ) : null}
            </div>

            {dashboard.isFetching || dashboard.dataUpdatedAt > 0 ? (
              <p aria-live="polite" className="flex items-center gap-1.5 text-caption text-muted-foreground">
                <RefreshCw
                  className={cn('h-3.5 w-3.5 shrink-0', dashboard.isFetching && 'motion-safe:animate-spin')}
                  aria-hidden
                />
                {dashboard.isFetching ? (
                  t.hero.freshness.refreshing
                ) : (
                  <time
                    dateTime={new Date(dashboard.dataUpdatedAt).toISOString()}
                    title={f.formatDual(dashboard.dataUpdatedAt)}
                  >
                    {t.hero.freshness.updated(f.formatRelative(dashboard.dataUpdatedAt))}
                  </time>
                )}
              </p>
            ) : null}

            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
              {postureUnavailable ? (
                <div
                  role="status"
                  className="col-span-2 flex min-h-28 items-center gap-3 rounded-soft border border-dashed border-border bg-muted/30 p-4 text-body-sm text-muted-foreground"
                >
                  <AlertTriangle className="h-5 w-5 shrink-0 text-status-warning" aria-hidden />
                  {t.loadError}
                </div>
              ) : postureLoading ? (
                <Skeleton className="h-28 w-28 shrink-0 rounded-full" />
              ) : (
                <Link
                  href="/lex/compliance"
                  className="shrink-0 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ScoreGauge
                    value={complianceScore}
                    max={100}
                    unit="%"
                    label={t.hero.posture.complianceScore}
                    thresholds={COMPLIANCE_SCORE_THRESHOLDS}
                    size={112}
                    formatValue={fmt}
                  />
                </Link>
              )}
              {!postureUnavailable ? (
                <div className="min-w-0 space-y-2">
                  {kpis.openAlerts.isLoading ? (
                    <Skeleton className="h-5 w-28" />
                  ) : (
                    <Link
                      href="/lex/compliance?status=open"
                      className="block rounded-sm text-body-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="me-1 font-semibold tabular-nums">{fmt(kpis.openAlerts.value)}</span>
                      {t.hero.posture.openAlerts}
                    </Link>
                  )}
                  {scoreTrendData.length > 1 ? (
                    <div className="space-y-1">
                      <span className="text-caption text-muted-foreground">{t.compliancePosture.trendLabel}</span>
                      <TrendSparkline data={scoreTrendData} height={40} />
                    </div>
                  ) : (
                    <p className="text-caption leading-5 text-muted-foreground">{t.compliancePosture.trendEmpty}</p>
                  )}
                  {canViewCompliance ? (
                    <Link
                      href="/lex/compliance"
                      className="inline-flex items-center gap-1.5 text-caption font-semibold text-primary hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t.compliancePosture.viewCompliance}
                      <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CommandCard>
        ) : null}
      </div>
    </CommandCard>
  );
}

export default CommandHero;
