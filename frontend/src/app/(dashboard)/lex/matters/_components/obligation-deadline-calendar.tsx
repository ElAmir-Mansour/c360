'use client';

/**
 * Feature 3 — Deadline calendar + reminders / escalations (matter detail).
 *
 * <MatterDeadlineCalendar> renders, for a single matter, a month/agenda calendar
 * of every deadline event (the matter's own `due_date` plus each obligation's
 * `due_date`) coloured by overdue / due-soon / upcoming severity, alongside a
 * reminder-plan panel. The panel fetches the tenant-wide obligation reminder
 * plan (`getObligationReminderPlan`) for a configurable horizon, filters it down
 * to THIS matter's obligations, and surfaces the upcoming reminders /
 * escalations. When the viewer can write, it offers a one-click
 * `enqueueObligationReminders` action to schedule the visible reminders.
 *
 * It is fully self-contained: it owns its bilingual labels (EN + professional
 * MSA, legal glossary: قضية / التزام / مهلة / تذكير / تصعيد / مستند) following the
 * canonical lex bilingual contract (`../../_lib/lex-i18n.ts`), accepts the
 * already-loaded `obligations` as a prop to avoid duplicate fetching, and only
 * fetches the reminder plan itself.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { AlarmClockOff, BellRing, CalendarClock, Send, TriangleAlert } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { EventCalendar, type CalendarEvent } from '@/components/shared/event-calendar';
import { RelativeTime } from '@/components/shared/relative-time';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import { formatDateTime } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  LexMatter,
  LexObligation,
  LexObligationNotificationEvent,
} from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained — EN + professional MSA).
 * ------------------------------------------------------------------------- */

interface DeadlineCalendarLabels {
  title: string;
  description: string;
  matterDueKind: string;
  obligationDueKind: string;
  legend: {
    overdue: string;
    dueSoon: string;
    upcoming: string;
  };
  reminders: {
    title: string;
    description: string;
    horizonLabel: string;
    horizonOption: (days: number) => string;
    includeEscalations: string;
    reminderKind: string;
    escalationKind: string;
    plannedFor: (when: string) => string;
    leadDays: (days: number) => string;
    escalationTo: (target: string) => string;
    summary: (reminders: number, escalations: number) => string;
    enqueue: string;
    enqueuing: string;
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  toast: {
    enqueuedTitle: string;
    enqueuedDescription: (queued: number, skipped: number) => string;
    noneTitle: string;
    noneDescription: string;
  };
  loading: string;
}

const deadlineCalendarLabels: LexBilingual<DeadlineCalendarLabels> = {
  en: {
    title: 'Deadline Calendar',
    description: 'Matter due date and obligation deadlines, coloured by urgency.',
    matterDueKind: 'Matter',
    obligationDueKind: 'Obligation',
    legend: {
      overdue: 'Overdue',
      dueSoon: 'Due soon',
      upcoming: 'Upcoming',
    },
    reminders: {
      title: 'Reminders & Escalations',
      description: 'Upcoming reminder and escalation events for this matter’s obligations.',
      horizonLabel: 'Horizon',
      horizonOption: (days) => `Next ${days} days`,
      includeEscalations: 'Include escalations',
      reminderKind: 'Reminder',
      escalationKind: 'Escalation',
      plannedFor: (when) => `Planned ${when}`,
      leadDays: (days) => `${days}-day lead`,
      escalationTo: (target) => `Escalates to ${target}`,
      summary: (reminders, escalations) =>
        `${reminders} reminder${reminders === 1 ? '' : 's'}, ${escalations} escalation${escalations === 1 ? '' : 's'}`,
      enqueue: 'Schedule reminders',
      enqueuing: 'Scheduling…',
      loadError: 'Failed to load the reminder plan.',
      emptyTitle: 'No upcoming reminders',
      emptyDescription:
        'No reminders or escalations are planned for this matter’s obligations in the selected horizon.',
    },
    toast: {
      enqueuedTitle: 'Reminders scheduled',
      enqueuedDescription: (queued, skipped) =>
        `${queued} queued${skipped > 0 ? `, ${skipped} already scheduled` : ''}.`,
      noneTitle: 'Nothing to schedule',
      noneDescription: 'No reminders were due to be queued for the selected horizon.',
    },
    loading: 'Loading deadlines…',
  },
  ar: {
    title: 'تقويم المُهَل',
    description: 'تاريخ استحقاق القضية ومُهَل الالتزامات، مُلوَّنة حسب الأولوية.',
    matterDueKind: 'قضية',
    obligationDueKind: 'التزام',
    legend: {
      overdue: 'متأخّر',
      dueSoon: 'يقترب الاستحقاق',
      upcoming: 'قادم',
    },
    reminders: {
      title: 'التذكيرات والتصعيدات',
      description: 'أحداث التذكير والتصعيد القادمة لالتزامات هذه القضية.',
      horizonLabel: 'النطاق الزمني',
      horizonOption: (days) => `الـ ${days} يومًا القادمة`,
      includeEscalations: 'تضمين التصعيدات',
      reminderKind: 'تذكير',
      escalationKind: 'تصعيد',
      plannedFor: (when) => `مُجدوَل ${when}`,
      leadDays: (days) => `مهلة ${days} يومًا`,
      escalationTo: (target) => `يُصعَّد إلى ${target}`,
      summary: (reminders, escalations) =>
        `${reminders} تذكير، ${escalations} تصعيد`,
      enqueue: 'جدولة التذكيرات',
      enqueuing: 'جارٍ الجدولة…',
      loadError: 'تعذّر تحميل خطة التذكيرات.',
      emptyTitle: 'لا توجد تذكيرات قادمة',
      emptyDescription:
        'لا توجد تذكيرات أو تصعيدات مُجدوَلة لالتزامات هذه القضية ضمن النطاق الزمني المُحدَّد.',
    },
    toast: {
      enqueuedTitle: 'تمت جدولة التذكيرات',
      enqueuedDescription: (queued, skipped) =>
        `تمت إضافة ${queued} إلى الطابور${skipped > 0 ? `، و${skipped} مُجدوَل مسبقًا` : ''}.`,
      noneTitle: 'لا شيء للجدولة',
      noneDescription: 'لا توجد تذكيرات مستحقة للإضافة ضمن النطاق الزمني المُحدَّد.',
    },
    loading: 'جارٍ تحميل المُهَل…',
  },
};

function useDeadlineCalendarLabels(): DeadlineCalendarLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(deadlineCalendarLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Severity helpers — overdue / due-soon / upcoming for a deadline.
 * ------------------------------------------------------------------------- */

type DeadlineSeverity = NonNullable<CalendarEvent['severity']>;

const HORIZON_OPTIONS = [30, 60, 90] as const;
const DUE_SOON_DAYS = 7;

/** Calendar-day delta to `due` (negative = past). Returns null for invalid dates. */
function daysUntil(due: string | null | undefined): number | null {
  if (!due) return null;
  const parsed = parseISO(due);
  if (Number.isNaN(parsed.getTime())) return null;
  return differenceInCalendarDays(parsed, new Date());
}

/** Map a day-delta to the shared calendar severity palette. */
function deadlineSeverity(delta: number | null): DeadlineSeverity {
  if (delta === null) return 'info';
  if (delta < 0) return 'critical';
  if (delta <= DUE_SOON_DAYS) return 'high';
  return 'low';
}

/** Escalation events are always rendered as critical; reminders inherit due-severity. */
function reminderSeverity(event: LexObligationNotificationEvent): DeadlineSeverity {
  if (event.type === 'escalation') return 'critical';
  return deadlineSeverity(daysUntil(event.due_date));
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface MatterDeadlineCalendarProps {
  matterId: string;
  matter: LexMatter;
  /** Obligations already loaded by the detail page — passed in to avoid a duplicate fetch. */
  obligations: LexObligation[];
}

export function MatterDeadlineCalendar({
  matterId,
  matter,
  obligations,
}: MatterDeadlineCalendarProps): JSX.Element {
  const { locale, direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const labels = useDeadlineCalendarLabels();
  const queryClient = useQueryClient();
  // §9 — matter deadline edits are case mutations.
  const canWrite = hasPermission('lex:case:edit');

  const [horizonDays, setHorizonDays] = useState<number>(60);
  const [includeEscalations, setIncludeEscalations] = useState(true);

  const calendarLocale = locale === 'ar' ? 'ar' : 'en';

  /* Calendar events: the matter's own due date + each obligation deadline. */
  const events = useMemo<CalendarEvent[]>(() => {
    const collected: CalendarEvent[] = [];

    if (matter.due_date) {
      const delta = daysUntil(matter.due_date);
      collected.push({
        id: `matter:${matter.id}`,
        date: matter.due_date,
        title: matter.title,
        kind: labels.matterDueKind,
        severity: deadlineSeverity(delta),
        meta: matter.matter_number || undefined,
      });
    }

    for (const obligation of obligations) {
      if (!obligation.due_date) continue;
      const delta = daysUntil(obligation.due_date);
      collected.push({
        id: `obligation:${obligation.id}`,
        date: obligation.due_date,
        title: obligation.title,
        kind: labels.obligationDueKind,
        severity: deadlineSeverity(delta),
        meta: obligation.owner_name || undefined,
      });
    }

    return collected;
  }, [matter, obligations, labels.matterDueKind, labels.obligationDueKind]);

  /* The set of obligation ids belonging to this matter — used to scope the
   * tenant-wide reminder plan down to events relevant here. */
  const matterObligationIds = useMemo(
    () => new Set(obligations.map((o) => o.id)),
    [obligations],
  );

  const planQuery = useQuery({
    queryKey: ['lex-matter-reminder-plan', matterId, horizonDays, includeEscalations],
    queryFn: () =>
      enterpriseApi.lex.getObligationReminderPlan({
        horizon_days: horizonDays,
        include_escalations: includeEscalations,
      }),
    enabled: Boolean(matterId),
  });

  /* Scope plan events to this matter: prefer matter_id, fall back to obligation id. */
  const matterEvents = useMemo<LexObligationNotificationEvent[]>(() => {
    const all = planQuery.data?.events ?? [];
    return all
      .filter(
        (event) =>
          event.matter_id === matterId || matterObligationIds.has(event.obligation_id),
      )
      .slice()
      .sort((a, b) => {
        const aTime = parseISO(a.planned_for).getTime();
        const bTime = parseISO(b.planned_for).getTime();
        return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
      });
  }, [planQuery.data, matterId, matterObligationIds]);

  const reminderCount = matterEvents.filter((e) => e.type !== 'escalation').length;
  const escalationCount = matterEvents.filter((e) => e.type === 'escalation').length;

  const enqueueMutation = useMutation({
    mutationFn: () =>
      enterpriseApi.lex.enqueueObligationReminders({
        horizon_days: horizonDays,
        include_escalations: includeEscalations,
      }),
    onSuccess: async (result) => {
      if (result.queued_count > 0) {
        showSuccess(
          labels.toast.enqueuedTitle,
          labels.toast.enqueuedDescription(result.queued_count, result.skipped_duplicate_count),
        );
      } else {
        showSuccess(labels.toast.noneTitle, labels.toast.noneDescription);
      }
      await Promise.all([
        planQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['lex-matter-obligations', matterId] }),
      ]);
    },
    onError: showApiError,
  });

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]" dir={direction}>
      <SectionCard title={labels.title} description={labels.description}>
        <div className="space-y-3">
          <SeverityLegend labels={labels} />
          <EventCalendar
            events={events}
            dir={direction}
            locale={calendarLocale}
            initialView={events.length > 6 ? 'agenda' : 'month'}
          />
        </div>
      </SectionCard>

      <SectionCard
        title={labels.reminders.title}
        description={labels.reminders.description}
        actions={
          canWrite ? (
            <Button
              size="sm"
              onClick={() => enqueueMutation.mutate()}
              disabled={enqueueMutation.isPending}
            >
              <Send className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {enqueueMutation.isPending ? labels.reminders.enqueuing : labels.reminders.enqueue}
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="lex-reminder-horizon" className="text-xs text-muted-foreground">
                {labels.reminders.horizonLabel}
              </Label>
              <Select
                value={String(horizonDays)}
                onValueChange={(value) => setHorizonDays(Number(value))}
              >
                <SelectTrigger id="lex-reminder-horizon" className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HORIZON_OPTIONS.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {labels.reminders.horizonOption(days)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-1.5">
              <Switch
                id="lex-reminder-escalations"
                checked={includeEscalations}
                onCheckedChange={setIncludeEscalations}
                aria-label={labels.reminders.includeEscalations}
              />
              <Label htmlFor="lex-reminder-escalations" className="text-sm">
                {labels.reminders.includeEscalations}
              </Label>
            </div>
          </div>

          {planQuery.isLoading ? (
            <LoadingSkeleton variant="list-item" count={3} />
          ) : planQuery.isError ? (
            <ErrorState
              message={labels.reminders.loadError}
              onRetry={() => void planQuery.refetch()}
            />
          ) : matterEvents.length === 0 ? (
            <EmptyState
              icon={AlarmClockOff}
              title={labels.reminders.emptyTitle}
              description={labels.reminders.emptyDescription}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {labels.reminders.summary(reminderCount, escalationCount)}
              </p>
              <div className="space-y-2">
                {matterEvents.map((event) => (
                  <ReminderRow key={event.event_id} event={event} labels={labels} />
                ))}
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Sub-components.
 * ------------------------------------------------------------------------- */

function SeverityLegend({ labels }: { labels: DeadlineCalendarLabels }): JSX.Element {
  const items: Array<{ key: string; dot: string; label: string }> = [
    { key: 'overdue', dot: 'bg-error-500 dark:bg-error-300', label: labels.legend.overdue },
    { key: 'dueSoon', dot: 'bg-warning-500 dark:bg-warning-300', label: labels.legend.dueSoon },
    { key: 'upcoming', dot: 'bg-blue-500 dark:bg-blue-400', label: labels.legend.upcoming },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <span key={item.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dot}`} aria-hidden />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function ReminderRow({
  event,
  labels,
}: {
  event: LexObligationNotificationEvent;
  labels: DeadlineCalendarLabels;
}): JSX.Element {
  const isEscalation = event.type === 'escalation';
  const severity = reminderSeverity(event);
  const accent =
    severity === 'critical'
      ? 'bg-destructive/60'
      : severity === 'high'
        ? 'bg-warning-300/70'
        : 'bg-blue-400/70';

  return (
    <div className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
      <span className={`absolute inset-y-0 start-0 w-1 ${accent}`} aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isEscalation ? (
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
            ) : (
              <BellRing className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate text-sm font-medium">{event.obligation_title}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
            {labels.reminders.plannedFor('')}
            <RelativeTime date={event.planned_for} className="text-xs text-muted-foreground" />
            <span aria-hidden>•</span>
            <span>{labels.reminders.leadDays(event.lead_days)}</span>
            <span aria-hidden>•</span>
            <span>{formatDateTime(event.due_date, 'MMM d, yyyy')}</span>
          </p>
          {isEscalation && event.escalation_target ? (
            <p className="mt-1 text-xs text-destructive">
              {labels.reminders.escalationTo(event.escalation_target)}
            </p>
          ) : null}
        </div>
        <Badge variant={isEscalation ? 'destructive' : 'secondary'}>
          {isEscalation ? labels.reminders.escalationKind : labels.reminders.reminderKind}
        </Badge>
      </div>
    </div>
  );
}
