'use client';

/**
 * Premium presentational row for a single {@link MatterTimelineSummary} in the
 * cross-matter triage dashboard (feature #15). Renders the matter number + title,
 * a unified status chip, an external-hold badge (+ category), open-delay days
 * (emphasized when high), and the estimated-completion / due date in KSA format
 * (Hijri + Arabic-Indic in Arabic mode), with a holiday marker when that date
 * lands on a recognized Saudi holiday. A "View timeline" action deep-links into
 * the single-matter workspace (`?matterId=…`, feature #17).
 *
 * Polish layered on the original:
 *   - color-coded elevated row via {@link rowAccentClass} (status / overdue tint
 *     + motion-safe hover lift),
 *   - {@link LexStatusChip} instead of a raw status badge,
 *   - {@link useLexFormat} for all dates (Hijri + Arabic-Indic),
 *   - {@link isKsaHoliday} marker on the completion date,
 *   - spring-pop CTA via the shared `.btn-*` / `.card-interactive` language.
 *
 * Pure presentation: it owns no data and no queries. RTL-safe via logical
 * spacing utilities; bilingual copy is supplied by the caller through the
 * resolved settlement labels + the local timeline-extension bundle.
 */

import { resolveLocalized } from '@/lib/i18n/localized';
import Link from 'next/link';
import { ArrowUpRight, CalendarClock, Hand, PartyPopper } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { LexStatusChip } from '@/components/lex/status-chip';
import { rowAccentClass } from '@/components/lex/row-accents';
import { cn } from '@/lib/utils';
import { useLexFormat, isKsaHoliday } from '@/lib/lex/ksa';
import {
  delayCategoryLabel,
  type SettlementLabels,
} from '../../settlements/_components/labels';
import { useMatterLabels } from '../../matters/_components/labels';
import type { TimelineExtraLabels } from './labels';
import type { MatterTimelineSummary } from '@/lib/lex/settlements';

/** Open-delay threshold (days) above which the figure is rendered with emphasis. */
const HIGH_DELAY_THRESHOLD = 14;

export interface MatterSummaryRowProps {
  matter: MatterTimelineSummary;
  labels: SettlementLabels;
  /** Local timeline-extension labels (holiday markers, etc.). */
  extra: TimelineExtraLabels;
  /** Staggered fade-up index for a cascading list entrance. */
  index?: number;
}

export function MatterSummaryRow({ matter, labels, extra, index = 0 }: MatterSummaryRowProps) {
  const f = useLexFormat();
  const matterLabels = useMatterLabels();
  const tl = labels.timeline;
  const hasOpenDelay = matter.open_delay_days > 0;
  const highDelay = matter.open_delay_days >= HIGH_DELAY_THRESHOLD;
  const completion = matter.estimated_completion_date ?? matter.due_date ?? null;

  // An open-hold matter reads as "warning"; a high open delay as "overdue"
  // (danger). Otherwise tint by status so the rail color matches the chip.
  const accentValue = matter.external_hold
    ? 'on_hold'
    : highDelay
      ? 'overdue'
      : matter.status;
  const accent = rowAccentClass('status', accentValue);

  // Holiday marker on the completion date (#29 KSA).
  const holiday = completion ? isKsaHoliday(completion) : null;
  const holidayName = holiday ? resolveLocalized(holiday.name, f.locale) : null;

  return (
    <TooltipProvider>
      <div
        className={cn(
          'group flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/70 p-4',
          'motion-safe:animate-fade-up',
          accent,
          'sm:flex-row sm:items-center sm:justify-between',
        )}
        style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
      >
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {matter.matter_number ? (
              <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {matter.matter_number}
              </span>
            ) : null}
            <span className="truncate font-semibold text-foreground" dir="auto">
              {matter.title}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Matter statuses are MATTER-domain tokens (intake/open/in_review/
                waiting_on_business/on_hold/closed/cancelled); resolve their tone +
                bilingual label via the matter domain and the matter status bundle. */}
            <LexStatusChip
              value={matter.status}
              domain="matter"
              labels={matterLabels.filters.statusOptions}
              size="sm"
            />
            {matter.external_hold ? (
              <span className="badge-base badge-warning inline-flex items-center gap-1">
                <Hand className="h-3 w-3" aria-hidden />
                {matter.external_hold_category
                  ? `${tl.externalHold} · ${delayCategoryLabel(labels, matter.external_hold_category)}`
                  : tl.externalHold}
              </span>
            ) : null}
            {hasOpenDelay ? (
              <span
                className={cn(
                  'badge-base inline-flex items-center gap-1',
                  highDelay ? 'badge-danger font-bold' : 'badge-neutral',
                )}
              >
                {tl.openDelayDays}: {f.formatNumber(matter.open_delay_days)}
              </span>
            ) : null}
            {completion ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                <span>
                  {tl.estimatedCompletion}: {f.formatDual(completion)}
                </span>
                {holidayName ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="badge-base badge-info inline-flex items-center gap-1 px-1.5 py-0"
                        aria-label={`${extra.holiday.onHoliday}: ${holidayName}`}
                      >
                        <PartyPopper className="h-3 w-3" aria-hidden />
                        {holidayName}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        {extra.holiday.onHoliday}
                        {holiday?.approximate ? ` · ${extra.holiday.approximate}` : ''}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>

        <div className="shrink-0">
          <Button
            asChild
            variant="secondary"
            className={cn(
              'gap-1.5',
              'transition-transform duration-fast ease-emphasized',
              'motion-safe:group-hover:translate-x-0.5 rtl:motion-safe:group-hover:-translate-x-0.5',
            )}
          >
            <Link href={`/lex/case-timeline?matterId=${encodeURIComponent(matter.matter_id)}`}>
              {tl.dashboard.viewTimeline}
              <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
