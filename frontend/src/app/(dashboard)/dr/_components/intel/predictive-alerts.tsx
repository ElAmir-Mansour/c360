'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Gauge,
  ShieldCheck,
  TimerReset,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';
import { formatCountdown } from '../../_lib/rto';
import {
  deriveAlerts,
  type PredictiveAlert,
  type PredictiveAlertSeverity,
} from './predictive-alerts-derivations';
import type { DRPrediction } from '@/types/clario-dr';

/**
 * Predictive RPO / breach-alert surface for the ClarioDR Recovery Operations
 * Console.
 *
 * Renders a ranked list of forward-looking alerts derived from REAL
 * `fetchDRPredictions()` data (`DRPrediction[]`): for each at-risk stream it
 * states "<stream> projected to breach RPO in ~<eta>" (or a throughput-collapse
 * warning), pairs an ICON + TEXT with a `state-*` colour token (never colour
 * alone, per WCAG 2.1 AA), and offers a single RECOMMENDED ACTION that
 * deep-links to where the operator resolves it (`/dr/protect?stream=…` to tune
 * replication, or `/dr/recover` to make a recovery decision).
 *
 * This is a thin renderer: all severity/ETA/ranking logic lives in the pure
 * `predictive-alerts-derivations` module so it is unit-tested in isolation.
 *
 * It is reusable: the Overview embeds it inside the attention queue (so forecast
 * alerts sit alongside the backend `DRAttentionItem` entries without
 * duplication), but it stands alone wherever a predictive surface is wanted.
 */

/**
 * Feature-local copy. Bilingual bundle (English + professional MSA) following the
 * console's foundation contract — NOT added to the shared `_lib/dr-i18n.ts`. The
 * component resolves the active locale via {@link usePredictiveAlertsLabels}; the
 * exported `predictiveAlertsLabels` is the English-resolved default for any
 * non-React/pure caller.
 */
export interface PredictiveAlertsLabels {
  /** Card heading + supporting line (used when rendered as a standalone card). */
  title: string;
  description: string;
  /** Badge counter suffix. */
  countSuffix: string;
  /** Empty-state line when no stream is forecast at risk. */
  emptyState: string;
  /** Severity badge labels. */
  severityLabel: Record<PredictiveAlertSeverity, string>;
  /** Per-kind alert headline builders. */
  breachHeadline: (stream: string) => string;
  collapseHeadline: (stream: string) => string;
  /** ETA phrasing. */
  etaPrefix: string;
  etaUnknown: string;
  /** Objective / lag context line. */
  objectivePrefix: string;
  lagPrefix: string;
  /** Recommended-action call to action per target route. */
  actionLabel: Record<'protect' | 'recover', string>;
  /** Accessible name prefix for the recommended-action link. */
  actionAriaPrefix: string;
  /** Accessible "for stream <id>" suffix on the recommended-action link. */
  actionAriaForStream: (stream: string) => string;
}

export const predictiveAlertsLabelsBundle: DRBilingual<PredictiveAlertsLabels> = {
  en: {
    title: 'Predictive alerts',
    description:
      'Forward-looking RPO-breach and throughput-collapse forecasts from live replication trend analysis.',
    countSuffix: 'forecast',
    emptyState: 'No streams forecast at risk.',
    severityLabel: {
      critical: 'Breach imminent',
      warning: 'At risk',
      info: 'Watch',
    },
    breachHeadline: (stream: string) => `Stream ${stream} projected to breach RPO`,
    collapseHeadline: (stream: string) => `Stream ${stream} replication throughput is collapsing`,
    etaPrefix: 'Projected breach in',
    etaUnknown: 'no finite breach horizon yet',
    objectivePrefix: 'RPO objective',
    lagPrefix: 'live lag',
    actionLabel: {
      protect: 'Tune replication',
      recover: 'Review recovery options',
    },
    actionAriaPrefix: 'Recommended action:',
    actionAriaForStream: (stream: string) => `for stream ${stream}`,
  },
  ar: {
    title: 'التنبيهات التنبؤية',
    description:
      'توقّعات استشرافية لتجاوز هدف نقطة الاسترداد (RPO) ولانهيار الإنتاجية، مستمدة من تحليل اتجاه النسخ المتماثل الحي.',
    countSuffix: 'توقّع',
    emptyState: 'لا توجد تدفقات مُتوقَّع تعرّضها للخطر.',
    severityLabel: {
      critical: 'التجاوز وشيك',
      warning: 'معرّض للخطر',
      info: 'تحت المراقبة',
    },
    breachHeadline: (stream: string) =>
      `يُتوقَّع أن يتجاوز التدفق ${stream} هدف نقطة الاسترداد (RPO)`,
    collapseHeadline: (stream: string) => `إنتاجية النسخ المتماثل للتدفق ${stream} في انهيار`,
    etaPrefix: 'التجاوز المتوقَّع خلال',
    etaUnknown: 'لا يوجد أفق تجاوز محدد بعد',
    objectivePrefix: 'هدف نقطة الاسترداد (RPO)',
    lagPrefix: 'التأخّر الحي',
    actionLabel: {
      protect: 'ضبط النسخ المتماثل',
      recover: 'مراجعة خيارات الاسترداد',
    },
    actionAriaPrefix: 'الإجراء الموصى به:',
    actionAriaForStream: (stream: string) => `للتدفق ${stream}`,
  },
};

/** English-resolved default labels for any non-React / pure caller. */
export const predictiveAlertsLabels: PredictiveAlertsLabels = predictiveAlertsLabelsBundle.en;

/**
 * React hook returning the active-locale-resolved predictive-alerts labels.
 * Reads the active locale via `useLocaleOrDefault` (defaults to English under the
 * test `en` LocaleProvider and outside any provider) and memoizes by locale.
 */
export function usePredictiveAlertsLabels(): PredictiveAlertsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(predictiveAlertsLabelsBundle, locale), [locale]);
}

interface SeverityTone {
  icon: LucideIcon;
  badgeVariant: 'destructive' | 'warning' | 'outline';
  accent: string;
  surface: string;
}

function toneForSeverity(severity: PredictiveAlertSeverity, kind: PredictiveAlert['kind']): SeverityTone {
  if (severity === 'critical') {
    return {
      icon: kind === 'throughput_collapse' ? TrendingDown : TimerReset,
      badgeVariant: 'destructive',
      accent: 'text-state-error',
      surface: 'border-state-error/40 bg-state-error/5',
    };
  }
  if (severity === 'warning') {
    return {
      icon: kind === 'throughput_collapse' ? TrendingDown : Gauge,
      badgeVariant: 'warning',
      accent: 'text-state-warning',
      surface: 'border-state-warning/40 bg-state-warning/5',
    };
  }
  return {
    icon: Gauge,
    badgeVariant: 'outline',
    accent: 'text-state-info',
    surface: 'border-state-info/40 bg-state-info/5',
  };
}

/** Format an ETA seconds value as a countdown, or the unknown-horizon phrase. */
function etaText(etaSeconds: number | null, labels: PredictiveAlertsLabels): string {
  if (etaSeconds === null) return labels.etaUnknown;
  return `${labels.etaPrefix} ~${formatCountdown(etaSeconds)}`;
}

function alertHeadline(alert: PredictiveAlert, labels: PredictiveAlertsLabels): string {
  return alert.kind === 'throughput_collapse'
    ? labels.collapseHeadline(alert.streamId)
    : labels.breachHeadline(alert.streamId);
}

/**
 * A single predictive-alert row: severity badge (icon + text + token),
 * headline, ETA + context, and the recommended-action deep link.
 *
 * Exported so the Overview can render forecast rows inline within the existing
 * attention queue (a single rendering path — no duplicated markup).
 */
export function PredictiveAlertRow({ alert }: { alert: PredictiveAlert }) {
  const labels = usePredictiveAlertsLabels();
  const tone = toneForSeverity(alert.severity, alert.kind);
  const Icon = tone.icon;
  const actionLabel = labels.actionLabel[alert.actionTarget];

  return (
    <div className={cn('rounded-card border px-3 py-3', tone.surface)}>
      <div className="flex items-center justify-between gap-2">
        <Badge variant={tone.badgeVariant} className="gap-1">
          <Icon className="h-3 w-3" aria-hidden />
          {labels.severityLabel[alert.severity]}
        </Badge>
        <span className="truncate font-mono text-caption text-content-muted">{alert.groupLabel}</span>
      </div>

      <p className={cn('mt-2 text-body-sm font-medium', tone.accent)}>{alertHeadline(alert, labels)}</p>
      <p className="text-caption text-content-muted">
        {etaText(alert.etaSeconds, labels)} · {labels.objectivePrefix}{' '}
        {formatCountdown(alert.rpoObjectiveSeconds)} · {labels.lagPrefix}{' '}
        {formatCountdown(alert.lagSeconds)}
      </p>

      <Link
        href={alert.actionHref}
        aria-label={`${labels.actionAriaPrefix} ${actionLabel} ${labels.actionAriaForStream(alert.streamId)}`}
        className={cn(
          'mt-2 inline-flex items-center gap-1.5 rounded-button text-body-sm font-medium',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          tone.accent,
        )}
      >
        {actionLabel}
        <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      </Link>
    </div>
  );
}

export interface PredictiveAlertsProps {
  predictions: DRPrediction[];
  /**
   * When true, render the bare ranked list (no Card chrome) so a host surface —
   * e.g. the Overview attention queue — can place the rows inside its own card.
   * Defaults to the standalone Card presentation.
   */
  embedded?: boolean;
  className?: string;
}

/**
 * The reusable predictive-alerts surface. Pass the raw `DRPrediction[]` from
 * `useDRPredictions()`; ranking, severity, ETA, and routing are all derived
 * here via the pure module. Renders an empty state when no stream is at risk.
 */
export function PredictiveAlerts({ predictions, embedded = false, className }: PredictiveAlertsProps) {
  const labels = usePredictiveAlertsLabels();
  const alerts = deriveAlerts(predictions);

  if (embedded) {
    return <PredictiveAlertList alerts={alerts} className={className} />;
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{labels.title}</CardTitle>
          <CardDescription>{labels.description}</CardDescription>
        </div>
        <Badge variant={alerts.length > 0 ? 'warning' : 'outline'}>
          {alerts.length} {labels.countSuffix}
        </Badge>
      </CardHeader>
      <CardContent>
        <PredictiveAlertList alerts={alerts} />
      </CardContent>
    </Card>
  );
}

function PredictiveAlertList({ alerts, className }: { alerts: PredictiveAlert[]; className?: string }) {
  const labels = usePredictiveAlertsLabels();
  if (alerts.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-card border border-dashed px-3 py-6 text-body-sm text-content-muted',
          className,
        )}
      >
        <ShieldCheck className="h-4 w-4 text-state-success" aria-hidden />
        <span>{labels.emptyState}</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {alerts.map((alert) => (
        <PredictiveAlertRow key={alert.id} alert={alert} />
      ))}
    </div>
  );
}
