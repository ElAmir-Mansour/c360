'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Clock, Settings2, TimerReset } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { lexAdminApi } from '@/lib/lex/admin';
import type { RequestPriority } from '@/lib/lex/requests';
import { cn } from '@/lib/utils';
import { pickSlaTarget, projectSla } from '../_lib/sla-preview';
import { slaPreviewLabels } from '../_lib/sla-preview-i18n';

export interface SlaPromisePreviewProps {
  /** The selected service's `code` (matches `SLATarget.service_code`). */
  serviceCode?: string;
  /** The drafted request priority — drives which SLA tier is previewed. */
  priority: RequestPriority;
  /** Optional wrapper class for layout composition by the parent. */
  className?: string;
}

/**
 * Mockup copy that is NEW to this card (the "SLA Target Delivery" headline). Kept
 * local to the file per the wizard's step-local i18n rule (shared `labels.ts` and
 * `sla-preview-i18n.ts` are not edited here to avoid cross-agent collisions).
 * Resolved with the canonical locale ternary — English is the effective default,
 * Arabic is Modern Standard Arabic (flag for the localization/termbase gate).
 */
const SLA_DELIVERY_COPY = {
  en: {
    cardTitle: 'SLA Target Delivery',
    basedOn: (priority: string) =>
      `Based on your selected ${priority} priority, the legal department will deliver resolution or feedback by:`,
    slaTarget: (window: string, single: boolean) =>
      `SLA Target: ${window} business ${single ? 'day' : 'days'}`,
  },
  ar: {
    cardTitle: 'موعد التسليم المستهدف',
    basedOn: (priority: string) =>
      `بناءً على الأولوية ${priority} المختارة، ستقدّم الإدارة القانونية الحل أو الرد بحلول:`,
    slaTarget: (window: string, single: boolean) =>
      `المستهدف: ${window} ${single ? 'يوم عمل' : 'أيام عمل'}`,
  },
} as const;

/**
 * SlaPromisePreview — the live SLA promise card (improvement #4), restyled to the
 * step-4 mockup's "SLA Target Delivery" tinted card.
 *
 * Self-contained: it fetches the tenant SLA targets, picks the active one matching
 * the chosen service + priority, and leads with the computed calendar delivery
 * date (weekday + full date, locale-aware Arabic-Indic numerals). The
 * acknowledgement window and the L1/L2/L3 escalation ladder are preserved below a
 * divider so the card stays informative at both of its mount points (under the
 * Priority control on step 2, and at the top of the step-4 Review). Normal draws
 * an emerald accent; urgent/emergency an amber one. When no service is selected —
 * or the service has no SLA target — it shows a subtle informational note rather
 * than an error, and never blocks the wizard.
 */
export default function SlaPromisePreview({
  serviceCode,
  priority,
  className,
}: SlaPromisePreviewProps) {
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const t = locale === 'ar' ? slaPreviewLabels.ar : slaPreviewLabels.en;
  const d = locale === 'ar' ? SLA_DELIVERY_COPY.ar : SLA_DELIVERY_COPY.en;
  // Emergency + urgent share the elevated ("fast") accent; the label resolves per tier.
  const isFast = priority === 'urgent' || priority === 'emergency';
  const priorityLabel =
    priority === 'emergency' ? t.priorityEmergency : priority === 'urgent' ? t.priorityUrgent : t.priorityNormal;

  const targetsQuery = useQuery({
    queryKey: ['lex-sla-targets', 'wizard'],
    queryFn: () => lexAdminApi.listSLATargets({ page: 1, per_page: 200 }),
  });

  const target = useMemo(
    () => pickSlaTarget(targetsQuery.data?.data ?? [], serviceCode, priority),
    [targetsQuery.data, serviceCode, priority],
  );

  // `from` is computed at render time (not module scope) and feeds the calendar
  // due date; projectSla stays pure and is passed the date.
  const projection = useMemo(
    () => (target ? projectSla(target, new Date()) : null),
    [target],
  );

  // Loading — compact skeleton matching the panel footprint.
  if (targetsQuery.isLoading) {
    return (
      <div className={cn('rounded-xl border bg-muted/20 p-4 sm:p-5', className)}>
        <Skeleton variant="text" role="status" aria-label={d.cardTitle} />
      </div>
    );
  }

  // Empty / informational states — subtle, never an error surface.
  if (!serviceCode || !target || !projection) {
    const title = !serviceCode
      ? t.selectServiceTitle
      : targetsQuery.isError
        ? t.previewUnavailableTitle
        : t.noTargetTitle;
    const body = !serviceCode
      ? t.selectServiceBody
      : targetsQuery.isError
        ? t.previewUnavailableBody
        : t.noTargetBody(priorityLabel);

    return (
      <div
        className={cn(
          'rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-sm',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-foreground">{title}</p>
              <p className="mt-1 text-muted-foreground">{body}</p>
              {serviceCode && !targetsQuery.isError ? (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Settings2 className="h-3.5 w-3.5" aria-hidden />
                  {t.noTargetOwner}
                </p>
              ) : null}
            </div>
          </div>
          {serviceCode ? (
            <Badge variant={isFast ? 'warning' : 'neutral'} className="shrink-0">
              {priorityLabel}
            </Badge>
          ) : null}
        </div>
      </div>
    );
  }

  const ackWindowText =
    target.ack_window_unit === 'working_hours'
      ? t.unitWorkingHours(target.ack_window_value)
      : t.unitWorkingDays(target.ack_window_value);

  // Big, human delivery date (weekday + full date) — locale-aware, Arabic-Indic
  // numerals applied automatically in `ar`.
  const deliveryDate = f.formatDate(projection.turnaroundDueApprox, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const isSingleDay =
    projection.turnaroundFromDays === projection.turnaroundToDays &&
    projection.turnaroundToDays === 1;
  const windowText =
    projection.turnaroundFromDays === projection.turnaroundToDays
      ? f.formatNumber(projection.turnaroundToDays)
      : `${f.formatNumber(projection.turnaroundFromDays)}–${f.formatNumber(projection.turnaroundToDays)}`;

  const escalationTiers: { level: 1 | 2 | 3; day: number }[] = [
    { level: 1, day: projection.escalation.l1 },
    { level: 2, day: projection.escalation.l2 },
    { level: 3, day: projection.escalation.l3 },
  ];

  return (
    <div
      className={cn(
        'rounded-xl border p-4 sm:p-5',
        isFast
          ? 'border-warning-300 bg-warning-50/60 dark:border-warning-800/40 dark:bg-warning-800/10'
          : 'border-success-300/70 bg-success-50/50 dark:border-success-700/40 dark:bg-success-700/10',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Clock
            className={cn(
              'h-4 w-4 shrink-0',
              isFast ? 'text-warning-700 dark:text-warning-300' : 'text-success-700 dark:text-success-300',
            )}
            aria-hidden
          />
          {d.cardTitle}
        </h3>
        <Badge variant={isFast ? 'warning' : 'success'} className="shrink-0">
          {priorityLabel}
        </Badge>
      </div>

      {/* Headline delivery promise */}
      <p className="mt-3 text-sm text-muted-foreground">{d.basedOn(priorityLabel)}</p>
      <p className="mt-1.5 text-lg font-semibold leading-snug text-foreground" dir="auto">
        {deliveryDate}
      </p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">
        ({d.slaTarget(windowText, isSingleDay)})
      </p>

      {/* Secondary: acknowledgement window + escalation ladder (preserved). */}
      <div className="mt-3.5 space-y-2.5 border-t border-border/50 pt-3.5 text-sm">
        <div className="flex items-start gap-2">
          <TimerReset className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-foreground">{t.acknowledgedWithin(ackWindowText)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t.escalationLabel}:</span>
          {escalationTiers.map((tier) => (
            <Badge key={tier.level} variant="outline" className="font-normal normal-case tracking-normal">
              {t.escalationTier(tier.level, tier.day)}
            </Badge>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{t.approximateNote}</p>
    </div>
  );
}
