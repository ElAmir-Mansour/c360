'use client';

import { useMemo, useState } from 'react';
import { CalendarCheck2, CalendarClock, CalendarDays, List } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { useDataTable } from '@/hooks/use-data-table';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { enterpriseApi } from '@/lib/enterprise';
import { actaMonthString } from '@/lib/enterprise';
import { meetingColumns } from './_components/meeting-columns';
import { MeetingFilters } from './_components/meeting-filters';
import { ScheduleMeetingDialog } from './_components/schedule-meeting-dialog';
import { MeetingCalendar } from './_components/meeting-calendar';
import type { ActaMeeting } from '@/types/suites';
import { useActaListLabels } from '../_lib/acta-i18n';

export default function ActaMeetingsPage() {
  const t = useActaListLabels().meetings;
  const [view, setView] = useState<'table' | 'calendar'>('table');
  const [month, setMonth] = useState(actaMonthString(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const { tableProps } = useDataTable<ActaMeeting>({
    queryKey: 'acta-meetings',
    fetchFn: (params) => enterpriseApi.acta.listMeetings(params),
    defaultPageSize: 25,
    defaultSort: { column: 'scheduled_at', direction: 'desc' },
  });
  const committeesQuery = useQuery({
    queryKey: ['acta-meeting-committees'],
    queryFn: () => enterpriseApi.acta.listCommittees({ page: 1, per_page: 100, order: 'asc' }),
  });
  const calendarQuery = useQuery({
    queryKey: ['acta-meeting-calendar', month],
    queryFn: () => enterpriseApi.acta.getCalendar(month),
  });

  // Tonal summary tiles from already-loaded rows. `total` uses the server-side
  // count; scheduled/completed are derived from the loaded page (no new query).
  const meetingStats = useMemo(() => {
    const meetings = tableProps.data;
    let scheduled = 0;
    let completed = 0;
    for (const meeting of meetings) {
      if (meeting.status === 'scheduled') scheduled += 1;
      if (meeting.status === 'completed') completed += 1;
    }
    return { total: tableProps.totalRows, scheduled, completed };
  }, [tableProps.data, tableProps.totalRows]);

  return (
    <PermissionRedirect permission="acta:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            <>
              <div className="flex rounded-lg border p-1">
                <Button variant={view === 'table' ? 'default' : 'ghost'} size="sm" onClick={() => setView('table')}>
                  <List className="me-1.5 h-4 w-4" />
                  {t.viewTable}
                </Button>
                <Button variant={view === 'calendar' ? 'default' : 'ghost'} size="sm" onClick={() => setView('calendar')}>
                  <CalendarDays className="me-1.5 h-4 w-4" />
                  {t.viewCalendar}
                </Button>
              </div>
              <Button onClick={() => setDialogOpen(true)}>{t.schedule}</Button>
            </>
          }
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard
            title={t.kpiTotal}
            value={meetingStats.total}
            tone="sky"
            icon={CalendarDays}
            loading={tableProps.isLoading && tableProps.data.length === 0}
          />
          <KpiCard
            title={t.kpiScheduled}
            value={meetingStats.scheduled}
            tone="gold"
            icon={CalendarClock}
            loading={tableProps.isLoading && tableProps.data.length === 0}
          />
          <KpiCard
            title={t.kpiCompleted}
            value={meetingStats.completed}
            tone="emerald"
            icon={CalendarCheck2}
            loading={tableProps.isLoading && tableProps.data.length === 0}
          />
        </div>

        <MeetingFilters
          search={tableProps.searchValue ?? ''}
          onSearchChange={(value) => tableProps.onSearchChange?.(value)}
          committeeId={
            typeof tableProps.activeFilters?.committee_id === 'string'
              ? tableProps.activeFilters.committee_id
              : undefined
          }
          onCommitteeChange={(value) => tableProps.onFilterChange?.('committee_id', value)}
          status={
            typeof tableProps.activeFilters?.status === 'string'
              ? tableProps.activeFilters.status
              : undefined
          }
          onStatusChange={(value) => tableProps.onFilterChange?.('status', value)}
          committees={committeesQuery.data?.data ?? []}
          loading={tableProps.isLoading}
        />

        {view === 'table' ? (
          <DataTable
            {...tableProps}
            columns={meetingColumns()}
            searchSlot={null}
            emptyState={{
              icon: CalendarDays,
              title: t.emptyTitle,
              description: t.emptyDescription,
            }}
          />
        ) : (
          <MeetingCalendar
            month={month}
            days={calendarQuery.data ?? []}
            onMonthChange={setMonth}
          />
        )}

        <ScheduleMeetingDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          committees={committeesQuery.data?.data ?? []}
        />
      </div>
    </PermissionRedirect>
  );
}
