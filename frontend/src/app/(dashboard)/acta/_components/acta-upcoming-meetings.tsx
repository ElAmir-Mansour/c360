'use client';

import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/status-badge';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { Calendar } from 'lucide-react';
import type { ActaMeetingSummary } from '@/types/suites';
import {
  useActaCommonLabels,
  useActaDashboardLabels,
  useActaMeetingStatusLabels,
} from '../_lib/acta-i18n';

interface ActaUpcomingMeetingsProps {
  meetings: ActaMeetingSummary[];
}

export function ActaUpcomingMeetings({ meetings }: ActaUpcomingMeetingsProps) {
  const common = useActaCommonLabels();
  const t = useActaDashboardLabels();
  const statusLabels = useActaMeetingStatusLabels();
  return (
    <SectionCard
      title={t.upcomingTitle}
      description={t.upcomingDescription}
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link href="/acta/meetings">
            {common.allMeetings}
            <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
          </Link>
        </Button>
      }
    >
      {meetings.length === 0 ? (
        <EmptyState
          icon={Calendar}
          size="compact"
          title={t.upcomingEmptyTitle}
          description={t.upcomingEmptyDescription}
        />
      ) : (
        <div className="space-y-3">
          {meetings.slice(0, 5).map((meeting) => (
            <Link
              key={meeting.id}
              href={`/acta/meetings/${meeting.id}`}
              className="block rounded-xl border px-4 py-3 transition hover:border-primary"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{meeting.title}</p>
                    <StatusBadge
                      status={meeting.status}
                      label={statusLabels[meeting.status] ?? meeting.status.replace(/_/g, ' ')}
                      size="sm"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {meeting.committee_name}
                  </p>
                </div>
                <div className="text-end text-xs text-muted-foreground">
                  <div>{format(parseISO(meeting.scheduled_at), 'MMM d, yyyy')}</div>
                  <div>{format(parseISO(meeting.scheduled_at), 'p')}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>{meeting.location ?? common.locationTbd}</span>
                <span>
                  {meeting.duration_minutes} {common.minutesUnit}
                </span>
                <span>
                  {meeting.quorum_met === null || meeting.quorum_met === undefined
                    ? common.quorumPending
                    : meeting.quorum_met
                      ? common.quorumMet
                      : common.quorumNotMet}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
