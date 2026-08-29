'use client';

/**
 * Key facts & deadlines card — the right-rail "what's time-critical" surface for
 * a Litigation Case detail page. Distills the deadline risk (from the parent's
 * already-derived `deadlineItems`) into a compact rail card: an overall risk
 * badge + overdue counter, the single next deadline, the case strength, the
 * last-updated stamp, the top few upcoming items, and a deep link to the full
 * timeline tab.
 *
 * Pure presentation over data the parent already holds — no query. Mirrors the
 * intent of the service-desk `SlaHeroRibbon` (the case domain has no SLA clock,
 * so court/procedural deadlines are the equivalent time-critical fact).
 * Bilingual + RTL via logical utilities.
 */

import type { ReactNode } from 'react';
import { AlarmClock, CalendarClock, GaugeCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { LegalCase } from '@/lib/lex/cases';
import {
  summarizeDeadlineRisk,
  type DeadlineItem,
  type DeadlineItemType,
  type DeadlineRiskLevel,
} from '../../_components/detail-workspace/workflow-metrics';
import { useCaseDetailExtraLabels, type CaseDetailExtraLabels } from './case-detail-labels';
import { useRiskRatingLabel, useStrengthLabel } from './case-enums-i18n';

export interface CaseKeyFactsCardProps {
  legalCase: LegalCase;
  deadlineItems: DeadlineItem[];
  onViewTimeline: () => void;
  className?: string;
}

const RISK_VARIANT: Record<DeadlineRiskLevel, NonNullable<BadgeProps['variant']>> = {
  critical: 'destructive',
  high: 'warning',
  medium: 'outline',
  low: 'secondary',
};

function riskLabel(level: DeadlineRiskLevel, t: CaseDetailExtraLabels['keyFacts']): string {
  if (level === 'critical') return t.riskCritical;
  if (level === 'high') return t.riskHigh;
  if (level === 'medium') return t.riskMedium;
  return t.riskLow;
}

function typeLabel(type: DeadlineItemType, t: CaseDetailExtraLabels['keyFacts']): string {
  if (type === 'task') return t.typeTask;
  if (type === 'hearing') return t.typeHearing;
  if (type === 'expert') return t.typeExpert;
  return t.typeJudgment;
}

function KeyFactRow({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof GaugeCircle;
  label: string;
  value: ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </span>
      <span
        className={cn(
          'truncate text-sm font-medium',
          tone === 'warning' && 'text-warning-700 dark:text-warning-300',
          tone === 'danger' && 'text-destructive',
          tone === 'default' && 'text-foreground',
        )}
        dir="auto"
      >
        {value}
      </span>
    </div>
  );
}

export function CaseKeyFactsCard({
  legalCase,
  deadlineItems,
  onViewTimeline,
  className,
}: CaseKeyFactsCardProps) {
  const t = useCaseDetailExtraLabels().keyFacts;
  const f = useLexFormat();
  const strengthLabel = useStrengthLabel();
  const riskRatingLabel = useRiskRatingLabel();

  const summary = summarizeDeadlineRisk(deadlineItems);
  const next = summary.nextItem;
  const topItems = deadlineItems.slice(0, 3);

  const dueBadge = (daysUntil: number): { text: string; variant: NonNullable<BadgeProps['variant']> } => {
    if (daysUntil < 0) return { text: t.overdueBadge, variant: 'destructive' };
    if (daysUntil === 0) return { text: t.dueToday, variant: 'warning' };
    return { text: t.dueIn(f.formatNumber(daysUntil)), variant: daysUntil <= 7 ? 'warning' : 'outline' };
  };

  const missingStrength = !legalCase.strength;
  const weakCase = legalCase.strength === 'weak';

  const riskRating = legalCase.risk_rating ?? null;
  const exposureText =
    legalCase.risk_exposure_value != null
      ? f.formatCurrencyCompact(
          legalCase.risk_exposure_value,
          legalCase.risk_exposure_currency ? { currency: legalCase.risk_exposure_currency } : undefined,
        )
      : null;

  return (
    <SectionCard
      title={t.title}
      className={className}
      actions={
        summary.activeCount > 0 ? (
          <div className="flex items-center gap-1.5">
            <Badge variant={RISK_VARIANT[summary.level]} size="sm">
              {riskLabel(summary.level, t)}
            </Badge>
            {summary.overdueCount > 0 ? (
              <Badge variant="destructive" size="sm" className="tabular-nums">
                {t.overdue(f.formatNumber(summary.overdueCount))}
              </Badge>
            ) : null}
          </div>
        ) : null
      }
      contentClassName="space-y-3"
    >
      {/* Next deadline */}
      {next ? (
        <div className="rounded-lg border border-border/60 bg-card/50 px-3 py-2.5 shadow-elevation-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t.nextDeadline}</p>
          <div className="mt-1 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground" dir="auto" title={next.title}>
                {next.title}
              </p>
              <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
                {f.formatDual(next.date)} · {f.formatRelative(next.date)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge variant="outline" size="sm">
                {typeLabel(next.type, t)}
              </Badge>
              <Badge variant={dueBadge(next.daysUntil).variant} size="sm" className="tabular-nums">
                {dueBadge(next.daysUntil).text}
              </Badge>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t.noDeadlines}</p>
      )}

      {/* Facts */}
      <div className="space-y-2 border-t border-border/60 pt-3">
        <KeyFactRow
          icon={GaugeCircle}
          label={t.strength}
          value={legalCase.strength ? strengthLabel(legalCase.strength) : t.notSet}
          tone={weakCase ? 'danger' : missingStrength ? 'warning' : 'default'}
        />
        <KeyFactRow
          icon={ShieldAlert}
          label={t.riskRating}
          value={
            riskRating ? (
              <span className="inline-flex items-center gap-1.5">
                <Badge
                  variant={RISK_VARIANT[riskRating]}
                  size="sm"
                  title={exposureText ? t.exposure(exposureText) : undefined}
                >
                  {riskRatingLabel(riskRating)}
                </Badge>
                {exposureText ? (
                  <span className="text-xs tabular-nums text-muted-foreground">{exposureText}</span>
                ) : null}
              </span>
            ) : (
              t.notSet
            )
          }
          tone={riskRating ? 'default' : 'warning'}
        />
        <KeyFactRow
          icon={RefreshCw}
          label={t.lastUpdated}
          value={f.formatRelative(legalCase.updated_at)}
        />
      </div>

      {/* Top upcoming items (beyond the headline next) */}
      {topItems.length > 1 ? (
        <ul className="space-y-1.5 border-t border-border/60 pt-3">
          {topItems.slice(1).map((item) => {
            const due = dueBadge(item.daysUntil);
            return (
              <li key={item.id} className="flex items-center gap-2">
                <AlarmClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs text-foreground" dir="auto" title={item.title}>
                  {item.title}
                </span>
                <Badge variant={due.variant} size="sm" className="tabular-nums">
                  {due.text}
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-center text-xs"
        onClick={onViewTimeline}
      >
        <CalendarClock className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {t.viewTimeline}
      </Button>
    </SectionCard>
  );
}
