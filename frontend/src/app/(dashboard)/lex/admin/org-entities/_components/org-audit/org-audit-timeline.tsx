'use client';

/**
 * OrgAuditTimeline — change-history / audit timeline for org entities.
 *
 * Modes:
 *   - entity-scoped: pass `entityId`; events are limited to that entity.
 *   - org-wide:      omit `entityId`; events span all entities and each row
 *                    surfaces its entity_code.
 *
 * The component is fully self-contained: it owns its data fetch (react-query),
 * loading skeleton, empty state, and error handling. Because the data layer
 * (`fetchOrgAuditResult`) gracefully falls back to local snapshots when the
 * backend audit request fails, this shows a degraded-source notice instead of a
 * hard failure. A genuine query rejection (which the api lib avoids) is still
 * handled defensively.
 *
 * Events are grouped into day buckets (Today / Yesterday / formatted date),
 * newest day first, newest event first within a day.
 */
import { useMemo, type ReactNode } from 'react';
import { History, Info } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { AuditEventRow } from './audit-event-row';
import { auditLabels, tt, type Lang } from '../../_lib/org-audit-i18n';
import { fetchOrgAuditResult, type OrgAuditEvent } from '../../_lib/org-audit-api';

export interface OrgAuditTimelineProps {
  /** Entity-scoped when provided; org-wide otherwise. */
  entityId?: string;
}

interface DayGroup {
  key: string;
  label: string;
  events: OrgAuditEvent[];
}

function dayKey(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  return format(parsed, 'yyyy-MM-dd');
}

function groupByDay(events: OrgAuditEvent[], lang: Lang): DayGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, OrgAuditEvent[]>();

  for (const event of events) {
    const key = dayKey(event.at);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(event);
  }

  return order.map((key) => {
    const dayEvents = buckets.get(key) ?? [];
    const first = dayEvents[0];
    const parsed = first ? new Date(first.at) : new Date(NaN);
    let label: string;
    if (key === 'unknown' || Number.isNaN(parsed.getTime())) {
      label = key;
    } else if (isToday(parsed)) {
      label = tt(auditLabels.today, lang);
    } else if (isYesterday(parsed)) {
      label = tt(auditLabels.yesterday, lang);
    } else {
      label = format(parsed, 'PPP');
    }
    return { key, label, events: dayEvents };
  });
}

export function OrgAuditTimeline({ entityId }: OrgAuditTimelineProps) {
  const { locale } = useLocaleOrDefault();
  const lang: Lang = locale === 'ar' ? 'ar' : 'en';
  const orgWide = !entityId;

  const query = useQuery({
    queryKey: ['org-audit', entityId ?? 'org-wide'],
    queryFn: () => fetchOrgAuditResult(entityId),
    staleTime: 30_000,
  });

  const events = useMemo(() => query.data?.events ?? [], [query.data]);
  const degraded = query.data?.degraded ?? false;
  const groups = useMemo(() => groupByDay(events, lang), [events, lang]);

  const description = tt(orgWide ? auditLabels.description : auditLabels.descriptionEntity, lang);

  let body: ReactNode;
  if (query.isLoading) {
    body = <LoadingSkeleton variant="list" count={4} label={tt(auditLabels.loading, lang)} />;
  } else if (events.length === 0) {
    body = (
      <EmptyState
        icon={History}
        size="compact"
        title={tt(auditLabels.emptyTitle, lang)}
        description={tt(auditLabels.emptyDescription, lang)}
      />
    );
  } else {
    body = (
      <div className="space-y-5">
        {degraded ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:text-warning-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{tt(auditLabels.localOnlyNotice, lang)}</span>
          </div>
        ) : null}
        {groups.map((group) => (
          <section key={group.key}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h4>
            <ol className="relative space-y-3 border-s border-border/70 ps-0">
              {group.events.map((event) => (
                <AuditEventRow key={event.id} event={event} showEntityCode={orgWide} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    );
  }

  return (
    <SectionCard title={tt(auditLabels.title, lang)} description={description}>
      {body}
    </SectionCard>
  );
}

export default OrgAuditTimeline;
