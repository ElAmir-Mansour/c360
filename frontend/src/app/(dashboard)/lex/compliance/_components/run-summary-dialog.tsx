/**
 * FEATURE 10 — Run-check summary + last-run timestamp (Watheeq / Lex compliance).
 *
 * After a manual compliance check, the page's `runMutation` returns a
 * {@link LexComplianceRunResult}. Today the page only surfaces a toast; this
 * module lets the integrator open a richer summary dialog that reports the
 * resulting score (with an optional delta vs. the previous score), the number
 * of alerts created, and a compact preview of the newly created alerts, plus
 * when the check was calculated.
 *
 * It also exports a tiny presentational {@link LastRunBadge} for placement near
 * the page header ("Last checked: <relative time>"), derived from
 * `dashboard.calculated_at`.
 *
 * Self-contained: this file owns its OWN bilingual label bundle following the
 * canonical lex contract (see `../../_lib/lex-i18n.ts` and the worked example in
 * `../_lib/compliance-labels.ts`). It edits no pre-existing file.
 */

'use client';

import { useMemo } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatDualRaw, formatRelativeAt, shapeDigits, useLexFormat } from '@/lib/lex/ksa';
import type { AppLocale } from '@/lib/i18n';
import type {
  LexComplianceAlert,
  LexComplianceRunResult,
  LexComplianceSeverity,
} from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

// ---------------------------------------------------------------------------
// Self-contained bilingual labels (English + MSA).
// ---------------------------------------------------------------------------

interface RunSummaryLabels {
  title: string;
  description: string;
  scoreLabel: string;
  /** Signed delta vs. the previous score, e.g. "+3 vs previous" / "no change". */
  delta: (delta: number) => string;
  deltaNeutral: string;
  alertsCreatedLabel: string;
  /** Pluralized count of newly created alerts. */
  alertsCreated: (count: number) => string;
  newAlertsTitle: string;
  /** "Showing X of Y new alerts" when the preview is truncated. */
  alertsTruncated: (shown: number, total: number) => string;
  noNewAlerts: string;
  calculatedLabel: string;
  close: string;
  /** Status enum map keyed by raw backend token. */
  statuses: Record<string, string>;
  /** "Last checked: <relative time slot>" for the LastRunBadge. */
  lastChecked: string;
  lastCheckedNever: string;
}

const runSummaryLabels: LexBilingual<RunSummaryLabels> = {
  en: {
    title: 'Compliance Check Complete',
    description: 'Summary of the compliance run across the contract portfolio.',
    scoreLabel: 'Compliance Score',
    delta: (delta) => `${delta > 0 ? '+' : ''}${delta} vs previous`,
    deltaNeutral: 'No change vs previous',
    alertsCreatedLabel: 'New Alerts',
    alertsCreated: (count) => `${count} new alert${count === 1 ? '' : 's'} created`,
    newAlertsTitle: 'Newly created alerts',
    alertsTruncated: (shown, total) => `Showing ${shown} of ${total} new alerts`,
    noNewAlerts: 'No new alerts were created by this run.',
    calculatedLabel: 'Calculated',
    close: 'Close',
    statuses: {
      open: 'open',
      acknowledged: 'acknowledged',
      investigating: 'investigating',
      resolved: 'resolved',
      dismissed: 'dismissed',
    },
    lastChecked: 'Last checked',
    lastCheckedNever: 'Not checked yet',
  },
  ar: {
    title: 'اكتمل فحص الامتثال',
    description: 'ملخّص تشغيل فحص الامتثال عبر محفظة العقود.',
    scoreLabel: 'درجة الامتثال',
    delta: (delta) => `${delta > 0 ? '+' : ''}${delta} مقارنةً بالسابقة`,
    deltaNeutral: 'لا تغيّر مقارنةً بالسابقة',
    alertsCreatedLabel: 'التنبيهات الجديدة',
    alertsCreated: (count) => `تم إنشاء ${count} تنبيه جديد`,
    newAlertsTitle: 'التنبيهات المنشأة حديثًا',
    alertsTruncated: (shown, total) => `عرض ${shown} من ${total} تنبيهًا جديدًا`,
    noNewAlerts: 'لم يُنشئ هذا التشغيل أي تنبيهات جديدة.',
    calculatedLabel: 'وقت الحساب',
    close: 'إغلاق',
    statuses: {
      open: 'مفتوح',
      acknowledged: 'مُقَر به',
      investigating: 'قيد التحقيق',
      resolved: 'محلول',
      dismissed: 'مرفوض',
    },
    lastChecked: 'آخر فحص',
    lastCheckedNever: 'لم يُفحص بعد',
  },
};

function useRunSummaryLabels(): RunSummaryLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(runSummaryLabels, locale), [locale]);
}

/** Pure resolver for non-React callers / tests. Defaults to English. */
export function resolveRunSummaryLabels(locale: AppLocale = 'en'): RunSummaryLabels {
  return resolveLexBilingual(runSummaryLabels, locale === 'ar' ? 'ar' : 'en');
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Maximum number of alerts shown in the preview before truncation. */
const ALERT_PREVIEW_LIMIT = 6;

/** Map a backend compliance severity to the SeverityIndicator's Severity union. */
function toIndicatorSeverity(value: LexComplianceSeverity | string): Severity {
  switch (value) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return 'info';
  }
}

/** Tone classes for the score chip, by rough banding (high/mid/low). */
function scoreToneClass(score: number): string {
  if (score >= 80) return 'text-success-600 dark:text-success-300';
  if (score >= 50) return 'text-warning-700 dark:text-warning-300';
  return 'text-destructive';
}

// ---------------------------------------------------------------------------
// LastRunBadge — "Last checked: <relative time>" near the page header.
// ---------------------------------------------------------------------------

export interface LastRunBadgeProps {
  /** Typically `dashboard.calculated_at`. When absent, renders a "not yet" hint. */
  calculatedAt?: string;
  className?: string;
}

/**
 * LastRunBadge is a compact, presentational pill that reports when compliance
 * was last calculated. Bilingual and RTL-correct (logical spacing). Place it
 * near the page header / KPI row.
 */
export function LastRunBadge({ calculatedAt, className }: LastRunBadgeProps) {
  const labels = useRunSummaryLabels();
  const { locale } = useLocaleOrDefault();

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground',
        className,
      )}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {calculatedAt ? (
        <>
          <span className="font-medium text-foreground/80">{labels.lastChecked}:</span>
          {/* KSA: localized relative time + Hijri-aware tooltip. */}
          <time
            dateTime={calculatedAt}
            className="text-xs tabular-nums text-muted-foreground"
            title={formatDualRaw(calculatedAt, locale)}
          >
            {formatRelativeAt(calculatedAt, locale, new Date())}
          </time>
        </>
      ) : (
        <span>{labels.lastCheckedNever}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RunSummaryDialog — post-run summary.
// ---------------------------------------------------------------------------

export interface RunSummaryDialogProps {
  open: boolean;
  /** The result returned by `enterpriseApi.lex.runCompliance({})`, or null. */
  result: LexComplianceRunResult | null;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional previous compliance score (e.g. the dashboard score captured
   * BEFORE the run). When provided, a signed delta is shown next to the score.
   */
  previousScore?: number;
}

/**
 * RunSummaryDialog summarizes a finished compliance run: rounded score (with an
 * optional delta vs. `previousScore`), the count of created alerts, a compact
 * preview list of the new alerts (title + SeverityIndicator + status), and the
 * `calculated_at` timestamp via RelativeTime.
 *
 * Controlled via `open` / `onOpenChange`. Renders nothing meaningful until a
 * `result` is supplied; the integrator should open it onSuccess of the run.
 */
export function RunSummaryDialog({
  open,
  result,
  onOpenChange,
  previousScore,
}: RunSummaryDialogProps) {
  const labels = useRunSummaryLabels();
  const f = useLexFormat();

  const score = result ? Math.round(result.score) : 0;
  const delta =
    result && typeof previousScore === 'number'
      ? score - Math.round(previousScore)
      : undefined;

  const alerts: LexComplianceAlert[] = result?.alerts ?? [];
  const visibleAlerts = alerts.slice(0, ALERT_PREVIEW_LIMIT);
  const alertsCreated = result?.alerts_created ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success-600 dark:text-success-300" aria-hidden />
            {labels.title}
          </DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Score + alerts-created summary cards. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border px-4 py-3">
              <p className="text-xs text-muted-foreground">{labels.scoreLabel}</p>
              {/* KSA: Arabic-Indic digits in ar mode; identical en output. */}
              <p className={cn('mt-1 text-2xl font-semibold tabular-nums', scoreToneClass(score))}>
                {f.formatNumber(score)}%
              </p>
              {delta !== undefined ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {delta === 0 ? (
                    labels.deltaNeutral
                  ) : (
                    <span
                      className={cn(
                        'font-medium tabular-nums',
                        delta > 0
                          ? 'text-success-600 dark:text-success-300'
                          : 'text-destructive',
                      )}
                    >
                      {shapeDigits(labels.delta(delta), f.locale)}
                    </span>
                  )}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border px-4 py-3">
              <p className="text-xs text-muted-foreground">{labels.alertsCreatedLabel}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{f.formatNumber(alertsCreated)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {shapeDigits(labels.alertsCreated(alertsCreated), f.locale)}
              </p>
            </div>
          </div>

          {/* Newly created alerts preview. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{labels.newAlertsTitle}</p>
              {alerts.length > visibleAlerts.length ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {shapeDigits(labels.alertsTruncated(visibleAlerts.length, alerts.length), f.locale)}
                </span>
              ) : null}
            </div>

            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{labels.noNewAlerts}</p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto pe-1">
                {visibleAlerts.map((alert) => (
                  <li
                    key={alert.id}
                    className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
                  >
                    <p className="min-w-0 flex-1 text-sm font-medium">{alert.title}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <SeverityIndicator
                        severity={toIndicatorSeverity(alert.severity)}
                        size="sm"
                      />
                      <Badge variant="outline" className="text-xs">
                        {labels.statuses[alert.status] ?? alert.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Calculated-at footer. */}
          {result ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{labels.calculatedLabel}:</span>
              {/* KSA: localized relative time + Hijri-aware tooltip. */}
              <time
                dateTime={result.calculated_at}
                className="tabular-nums"
                title={f.formatDual(result.calculated_at)}
              >
                {f.formatRelative(result.calculated_at)}
              </time>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{labels.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
