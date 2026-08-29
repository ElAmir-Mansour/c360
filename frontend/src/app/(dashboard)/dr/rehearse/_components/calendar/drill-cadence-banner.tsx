'use client';

import { AlarmClockOff, CalendarClock, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useDrillCalendarLabels } from './drill-calendar-labels';
import type { DrillCadenceSummary } from './drill-cadence';

/**
 * Console-attention banner for drill cadence.
 *
 * Surfaces, at the top of the rehearse calendar, whether any enabled schedule is
 * overdue or due-soon — the "drill due/overdue" signal that feeds the console's
 * attention concept. It is purely a read surface (no write actions), so it is not
 * gated by `dr:write`. RTL-safe via logical spacing; the icon is decorative and
 * the status counts are conveyed in text for assistive tech.
 */
export function DrillCadenceBanner({
  summary,
  totalEnabled,
}: {
  summary: DrillCadenceSummary;
  totalEnabled: number;
}) {
  const labels = useDrillCalendarLabels();

  if (!summary.needsAttention) {
    return (
      <Alert variant="success">
        <CircleCheck className="h-4 w-4" aria-hidden />
        <AlertTitle>{labels.attentionAllClearTitle}</AlertTitle>
        <AlertDescription>{labels.attentionAllClearDescription}</AlertDescription>
      </Alert>
    );
  }

  const overdue = summary.overdue > 0;
  const variant = overdue ? 'destructive' : 'warning';
  const Icon = overdue ? AlarmClockOff : CalendarClock;
  const title = overdue ? labels.attentionTitleOverdue : labels.attentionTitleDueSoon;

  return (
    <Alert variant={variant}>
      <Icon className="h-4 w-4" aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <div className="flex flex-wrap items-center gap-2">
          <span>{labels.attentionSummary(summary.overdue, summary.dueSoon, totalEnabled)}</span>
          {summary.overdue > 0 ? (
            <Badge variant="destructive">
              {summary.overdue} {labels.status.overdue}
            </Badge>
          ) : null}
          {summary.dueSoon > 0 ? (
            <Badge variant="warning">
              {summary.dueSoon} {labels.status.due_soon}
            </Badge>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
