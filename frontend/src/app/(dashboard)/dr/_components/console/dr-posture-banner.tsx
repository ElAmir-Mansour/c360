'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Gauge,
  Layers,
  ShieldAlert,
  ShieldPlus,
  Timer,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MetricTile } from '@/components/shared/metric-tile';
import { StatusChip } from '@/components/shared/status-chip';
import type {
  DRFailoverRunSummary,
  DRPosture,
  DRRansomwareSignal,
  DRReplicationSummary,
  DRStreamSummary,
} from '@/types/clario-dr';
import {
  useDRPosture,
  useDRRansomwareSignals,
  useDRReplicationSummary,
} from '../../_hooks/use-dr-queries';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';

/**
 * Always-on readiness banner for the Recovery Operations Console.
 *
 * Renders a posture readiness score plus the five KPI tiles called for by the
 * console design: overall health, worst live RPO, protected groups, last drill
 * verdict, and the live ransomware-signal status. Every value is read from the
 * real `useDRPosture()` / `useDRReplicationSummary()` / `useDRRansomwareSignals()`
 * query hooks — no fabricated telemetry. The readiness score is derived only
 * from posture-available inputs (recovery-point coverage, open attention items,
 * RPO breaches, stream health) so it never depends on data the banner does not
 * own.
 */

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type MetricTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

/** Full posture-banner copy (one identically-shaped copy per locale). */
interface PostureBannerLabels {
  /** Accessible name for the banner card landmark. */
  cardAriaLabel: string;
  /** Health/status token -> display label (lower-case token keys). */
  healthLabels: Record<string, string>;
  /** "not available" placeholder. */
  na: string;
  /** Readiness eyebrow. */
  recoveryReadiness: string;
  /** Readiness score band labels. */
  score: {
    noData: string;
    ready: string;
    needsAttention: string;
    atRisk: string;
  };
  /** Prefix for the posture-health chip: `${posturePrefix} ${health}`. */
  posturePrefix: string;
  /** Attention chip: count + singular/plural noun. */
  attention: { one: (n: number) => string; other: (n: number) => string };
  /** KPI tile labels. */
  tiles: {
    overallHealth: string;
    worstRpo: string;
    protectedGroups: string;
    lastDrillVerdict: string;
    ransomwareSignals: string;
  };
  /** Drill-verdict copy. */
  verdict: {
    noDrills: string;
    rtoMissed: string;
    passed: string;
    failed: string;
    cancelled: string;
  };
  /** Worst-live-RPO tile detail copy. */
  rpo: {
    noStream: string;
    /** `${target} · ${objectivePrefix} ${objective}`. */
    objectivePrefix: string;
    streamFallback: string;
  };
  /** Ransomware footer + tile detail. */
  ransomware: { noAnomalies: string };
  /** Footer count lines (Western digits preserved). */
  footer: {
    protectedSites: (n: number) => string;
    recoveryPoints: (n: number) => string;
  };
  /** Persistent no-protection-groups on-ramp banner. */
  noGroups: {
    message: string;
    cta: string;
    dismiss: string;
  };
}

/**
 * Bilingual posture-banner copy. The `en` side is byte-identical to the prior
 * English (keeping every test assertion green under the `en` default); the `ar`
 * side is professional MSA with identical shape and preserved interpolation.
 */
const postureBannerLabels: DRBilingual<PostureBannerLabels> = {
  en: {
    cardAriaLabel: 'Disaster-recovery posture',
    healthLabels: {
      healthy: 'Healthy',
      warning: 'Watch',
      critical: 'Critical',
      paused: 'Paused',
      seeding: 'Seeding',
      empty: 'Empty',
      streaming: 'Streaming',
      degraded: 'Degraded',
      error: 'Error',
      completed: 'Completed',
      passed: 'Passed',
      failed: 'Failed',
    },
    na: 'n/a',
    recoveryReadiness: 'Recovery readiness',
    score: {
      noData: 'No posture data',
      ready: 'Recovery-ready',
      needsAttention: 'Needs attention',
      atRisk: 'At risk',
    },
    posturePrefix: 'Posture',
    attention: {
      one: (n: number) => `${n} attention item`,
      other: (n: number) => `${n} attention items`,
    },
    tiles: {
      overallHealth: 'Overall health',
      worstRpo: 'Worst live RPO',
      protectedGroups: 'Protected groups',
      lastDrillVerdict: 'Last drill verdict',
      ransomwareSignals: 'Ransomware signals',
    },
    verdict: {
      noDrills: 'No drills yet',
      rtoMissed: 'RTO missed',
      passed: 'Passed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    rpo: {
      noStream: 'No live replication stream',
      objectivePrefix: 'objective',
      streamFallback: 'stream',
    },
    ransomware: { noAnomalies: 'No active anomalies' },
    footer: {
      protectedSites: (n: number) => `${n} protected sites`,
      recoveryPoints: (n: number) => `${n} recovery points`,
    },
    noGroups: {
      message: 'No protection groups yet — start in Protect.',
      cta: 'Set up protection',
      dismiss: 'Dismiss',
    },
  },
  ar: {
    cardAriaLabel: 'وضع التعافي من الكوارث',
    healthLabels: {
      healthy: 'سليم',
      warning: 'تحت المراقبة',
      critical: 'حرج',
      paused: 'متوقف مؤقتًا',
      seeding: 'قيد التهيئة',
      empty: 'فارغ',
      streaming: 'قيد البث',
      degraded: 'متدهور',
      error: 'خطأ',
      completed: 'مكتمل',
      passed: 'ناجح',
      failed: 'فشل',
    },
    na: 'غير متاح',
    recoveryReadiness: 'جاهزية الاسترداد',
    score: {
      noData: 'لا توجد بيانات وضع',
      ready: 'جاهز للاسترداد',
      needsAttention: 'يتطلّب انتباهًا',
      atRisk: 'في خطر',
    },
    posturePrefix: 'الوضع',
    attention: {
      one: (n: number) => `${n} بند يتطلّب انتباهًا`,
      other: (n: number) => `${n} بنود تتطلّب انتباهًا`,
    },
    tiles: {
      overallHealth: 'الصحة العامة',
      worstRpo: 'أسوأ نقطة استرداد (RPO) مباشرة',
      protectedGroups: 'المجموعات المحمية',
      lastDrillVerdict: 'نتيجة آخر تمرين',
      ransomwareSignals: 'إشارات برمجيات الفدية',
    },
    verdict: {
      noDrills: 'لا توجد تمارين بعد',
      rtoMissed: 'لم يتحقق هدف RTO',
      passed: 'ناجح',
      failed: 'فشل',
      cancelled: 'ملغى',
    },
    rpo: {
      noStream: 'لا يوجد تدفق نسخ متماثل مباشر',
      objectivePrefix: 'الهدف',
      streamFallback: 'تدفق',
    },
    ransomware: { noAnomalies: 'لا توجد حالات شاذة نشطة' },
    footer: {
      protectedSites: (n: number) => `${n} موقع محمي`,
      recoveryPoints: (n: number) => `${n} نقطة استرداد`,
    },
    noGroups: {
      message: 'لا توجد مجموعات حماية بعد — ابدأ من مرحلة الحماية.',
      cta: 'إعداد الحماية',
      dismiss: 'إغلاق',
    },
  },
};

/** Resolve the posture-banner copy for the active locale (en default in tests). */
function usePostureBannerLabels(): PostureBannerLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(postureBannerLabels, locale), [locale]);
}

function normalizeStatus(status?: string | null): string {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(labels: PostureBannerLabels, status?: string | null): string {
  const normalized = normalizeStatus(status);
  return labels.healthLabels[normalized] ?? normalized.replace(/_/g, ' ');
}

function healthTone(status?: string | null): StatusTone {
  const normalized = normalizeStatus(status);
  if (normalized === 'critical' || normalized === 'error' || normalized === 'failed') return 'danger';
  if (normalized === 'warning' || normalized === 'degraded' || normalized === 'paused') return 'warning';
  if (normalized === 'healthy' || normalized === 'completed' || normalized === 'passed') return 'success';
  if (normalized === 'seeding' || normalized === 'streaming') return 'info';
  return 'neutral';
}

function formatSeconds(seconds: number | null | undefined, naLabel: string): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return naLabel;
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${hours}h ${minRem}m` : `${hours}h`;
}

function clampPercent(value?: number | null): number | null {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function highestSeveritySignal(signals: DRRansomwareSignal[]): DRRansomwareSignal | null {
  if (signals.length === 0) return null;
  return signals.reduce((worst, signal) => {
    const worstRank = SEVERITY_RANK[normalizeStatus(worst.severity)] ?? 0;
    const rank = SEVERITY_RANK[normalizeStatus(signal.severity)] ?? 0;
    return rank > worstRank ? signal : worst;
  }, signals[0]);
}

function ransomwareTone(severity?: string | null): StatusTone {
  const normalized = normalizeStatus(severity);
  if (normalized === 'critical' || normalized === 'high') return 'danger';
  if (normalized === 'medium') return 'warning';
  if (normalized === 'low' || normalized === 'info') return 'info';
  return 'neutral';
}

/** Latest drill-mode run from the posture rollup (mirrors monolith run selection). */
function latestDrillRun(runs: DRFailoverRunSummary[]): DRFailoverRunSummary | null {
  const drills = runs.filter((run) => normalizeStatus(run.mode) === 'drill');
  if (drills.length === 0) return null;
  return [...drills].sort(
    (left, right) => new Date(right.initiated_at).getTime() - new Date(left.initiated_at).getTime(),
  )[0];
}

function drillVerdict(
  labels: PostureBannerLabels,
  run: DRFailoverRunSummary | null,
): { label: string; tone: StatusTone } {
  if (!run) return { label: labels.verdict.noDrills, tone: 'neutral' };
  const normalized = normalizeStatus(run.status);
  if (normalized === 'completed' || normalized === 'attested') {
    return run.met_rto === false
      ? { label: labels.verdict.rtoMissed, tone: 'warning' }
      : { label: labels.verdict.passed, tone: 'success' };
  }
  if (normalized === 'failed' || normalized === 'rolled_back') {
    return { label: labels.verdict.failed, tone: 'danger' };
  }
  if (normalized === 'cancelled') return { label: labels.verdict.cancelled, tone: 'warning' };
  return { label: labelFor(labels, run.status), tone: healthTone(run.status) };
}

/**
 * Posture-only readiness score. Starts from a baseline and adjusts by the
 * posture facts the banner already loads, so it is internally consistent and
 * does not depend on BCM/BYOK/evidence data this component never fetches.
 */
function deriveReadinessScore(
  posture: DRPosture | undefined,
  replication: DRReplicationSummary | undefined,
): number | null {
  if (!posture && !replication) return null;
  const recoveryPoints = posture?.recovery_point_count ?? 0;
  const groups = posture?.group_count ?? 0;
  const openAttention = posture?.attention?.length ?? 0;
  const breaches = (posture?.rpo_breaches?.length ?? 0) + (replication?.rpo_breaches?.length ?? 0);
  const unhealthy = normalizeStatus(posture?.overall_health ?? replication?.overall_health);

  let score = 72;
  if (recoveryPoints > 0) score += 8;
  if (groups > 0) score += 6;
  if (openAttention === 0) score += 8;
  else score -= Math.min(16, openAttention * 4);
  if (breaches === 0) score += 6;
  else score -= Math.min(18, breaches * 6);
  if (unhealthy === 'healthy') score += 4;
  else if (unhealthy === 'critical' || unhealthy === 'error') score -= 14;
  else if (unhealthy === 'warning' || unhealthy === 'degraded') score -= 8;

  return clampPercent(score);
}

const SCORE_TONE_THRESHOLD = 85;

function scoreLabel(labels: PostureBannerLabels, score: number | null): string {
  if (score === null) return labels.score.noData;
  if (score >= SCORE_TONE_THRESHOLD) return labels.score.ready;
  if (score >= 60) return labels.score.needsAttention;
  return labels.score.atRisk;
}

function scoreChipTone(score: number | null): StatusTone {
  if (score === null) return 'neutral';
  if (score >= SCORE_TONE_THRESHOLD) return 'success';
  if (score >= 60) return 'warning';
  return 'danger';
}

function rpoTile(
  labels: PostureBannerLabels,
  worst: DRStreamSummary | null | undefined,
): { value: string; detail: string; tone: MetricTone } {
  if (!worst) return { value: labels.na, detail: labels.rpo.noStream, tone: 'muted' };
  const objective = formatSeconds(worst.rpo_objective_seconds, labels.na);
  const target = worst.site_name ?? worst.stream_id ?? labels.rpo.streamFallback;
  return {
    value: formatSeconds(worst.rpo_seconds, labels.na),
    detail: `${target} · ${labels.rpo.objectivePrefix} ${objective}`,
    tone: worst.breaches_rpo ? 'warning' : 'success',
  };
}

const STATUS_TO_METRIC_TONE: Record<StatusTone, MetricTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'muted',
};

/** Session key so the on-ramp banner stays dismissed for the rest of the tab session. */
const NO_GROUPS_BANNER_DISMISS_KEY = 'clario-dr:no-groups-banner-dismissed';

/**
 * Thin, persistent on-ramp shown across every `/dr` route while the tenant has
 * zero protection groups. It points operators at `/dr/protect` (where the
 * create-group flow lives) so deep-links never strand them on a wall of disabled
 * actions. Dismissible for the rest of the browser session; complements — does
 * not duplicate — the per-page empty states.
 */
function DRNoGroupsBanner({ labels }: { labels: PostureBannerLabels }) {
  const [dismissed, setDismissed] = useState(true);

  // Read the per-session dismissal on mount (client-only; avoids SSR hydration
  // mismatch by defaulting to dismissed until the effect runs).
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(NO_GROUPS_BANNER_DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(NO_GROUPS_BANNER_DISMISS_KEY, '1');
    } catch {
      /* sessionStorage unavailable — fall back to in-memory dismissal */
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm"
    >
      <ShieldPlus className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 text-foreground">{labels.noGroups.message}</p>
      <Button asChild size="sm" className="shrink-0 gap-1.5">
        <Link href="/dr/protect">
          {labels.noGroups.cta}
          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        </Link>
      </Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={labels.noGroups.dismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function DRPostureBanner() {
  const labels = usePostureBannerLabels();
  const postureQuery = useDRPosture();
  const replicationQuery = useDRReplicationSummary();
  const ransomwareQuery = useDRRansomwareSignals();

  const posture = postureQuery.data;
  const replication = replicationQuery.data;
  const signals = useMemo(() => ransomwareQuery.data ?? [], [ransomwareQuery.data]);

  const readinessScore = useMemo(
    () => deriveReadinessScore(posture, replication),
    [posture, replication],
  );

  const overallHealth = posture?.overall_health ?? replication?.overall_health ?? 'empty';
  const worstRpo = posture?.worst_live_rpo ?? replication?.worst_live_rpo ?? null;
  const rpo = rpoTile(labels, worstRpo);
  const groupCount = posture?.group_count ?? 0;
  const siteCount = posture?.site_count ?? 0;
  const recoveryPointCount = posture?.recovery_point_count ?? 0;

  const lastDrill = useMemo(() => latestDrillRun(posture?.recent_runs ?? []), [posture?.recent_runs]);
  const verdict = drillVerdict(labels, lastDrill);

  const worstSignal = useMemo(() => highestSeveritySignal(signals), [signals]);
  const signalTone = worstSignal ? ransomwareTone(worstSignal.severity) : 'success';
  const signalValue = worstSignal ? `${signals.length}` : '0';
  const signalDetail = worstSignal
    ? `${labelFor(labels, worstSignal.severity)} · ${worstSignal.kind}`
    : labels.ransomware.noAnomalies;

  const attentionCount = posture?.attention?.length ?? 0;
  const healthTo = healthTone(overallHealth);
  const isLoading =
    postureQuery.isLoading && replicationQuery.isLoading && ransomwareQuery.isLoading;

  // Only surface the on-ramp once posture has actually resolved with zero groups
  // (never while still loading, and never on a posture fetch error — the page-level
  // error states own that case).
  const hasNoGroups =
    postureQuery.isSuccess && (posture?.groups?.length ?? posture?.group_count ?? 0) === 0;

  return (
    <div className="space-y-3">
      {hasNoGroups ? <DRNoGroupsBanner labels={labels} /> : null}
      <Card aria-label={labels.cardAriaLabel} aria-busy={isLoading || undefined}>
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border border-border bg-muted">
              <span className="text-2xl font-bold leading-none tracking-tight text-foreground">
                {readinessScore === null ? labels.na : readinessScore}
              </span>
              {readinessScore !== null && (
                <span className="text-xs font-medium text-muted-foreground">/ 100</span>
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {labels.recoveryReadiness}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip
                  tone={scoreChipTone(readinessScore)}
                  size="lg"
                  icon={Gauge}
                  label={scoreLabel(labels, readinessScore)}
                />
                <StatusChip
                  tone={healthTo === 'success' ? 'success' : healthTo === 'neutral' ? 'neutral' : healthTo}
                  size="lg"
                  icon={Activity}
                  label={`${labels.posturePrefix} ${labelFor(labels, overallHealth)}`}
                />
              </div>
            </div>
          </div>
          {attentionCount > 0 && (
            <StatusChip
              tone="warning"
              size="lg"
              icon={AlertTriangle}
              label={
                attentionCount === 1
                  ? labels.attention.one(attentionCount)
                  : labels.attention.other(attentionCount)
              }
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricTile
            label={labels.tiles.overallHealth}
            value={labelFor(labels, overallHealth)}
            icon={Activity}
            tone={STATUS_TO_METRIC_TONE[healthTo]}
          />
          <MetricTile label={labels.tiles.worstRpo} value={rpo.value} icon={Timer} tone={rpo.tone} />
          <MetricTile
            label={labels.tiles.protectedGroups}
            value={groupCount}
            icon={Layers}
            tone={groupCount > 0 ? 'primary' : 'muted'}
          />
          <MetricTile
            label={labels.tiles.lastDrillVerdict}
            value={verdict.label}
            icon={Gauge}
            tone={STATUS_TO_METRIC_TONE[verdict.tone]}
          />
          <MetricTile
            label={labels.tiles.ransomwareSignals}
            value={signalValue}
            icon={ShieldAlert}
            tone={STATUS_TO_METRIC_TONE[signalTone]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{labels.footer.protectedSites(siteCount)}</span>
          <span aria-hidden>·</span>
          <span>{labels.footer.recoveryPoints(recoveryPointCount)}</span>
          <span aria-hidden>·</span>
          <span>{rpo.detail}</span>
          <span aria-hidden>·</span>
          <span>{signalDetail}</span>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
