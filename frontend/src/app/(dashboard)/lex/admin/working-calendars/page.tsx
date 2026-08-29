'use client';

import { useCallback, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, CalendarRange, Copy, PencilLine, Plus, Star, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { StatTile } from '@/components/shared/stat-tile';
import { DataTable } from '@/components/shared/data-table/data-table';
import { selectColumn } from '@/components/shared/data-table/columns/common-columns';
import { SearchInput } from '@/components/shared/forms/search-input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { showApiError, showError, showSuccess } from '@/lib/toast';
import type { BulkAction, FilterConfig, RowAction } from '@/types/table';
import {
  CALENDAR_HOLIDAY_KINDS,
  CALENDAR_PROFILES,
  lexAdminApi,
  LEX_ADMIN_ENDPOINTS,
  type CalendarProfile,
  type CreateWorkingCalendarPayload,
  type WorkingCalendar,
  type WorkingHoursInput,
} from '@/lib/lex/admin';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { AdminDatasetActions } from '../_components/admin-dataset-actions';
import { timeToMinutes } from '../_lib/admin-feature-utils';
import { useAdminCommonLabels, useCalendarLabels } from '../_lib/admin-labels';
import { CalendarFormDialog } from './_components/calendar-form-dialog';
import { CalendarHolidaysDialog } from './_components/calendar-holidays-dialog';
import {
  calendarClonePayload,
  holidayPayload,
  workingHoursInputFromCalendar,
} from './_components/calendar-admin-utils';

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function WorkingCalendarsPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const t = useCalendarLabels();
  const common = useAdminCommonLabels();
  const qc = useQueryClient();
  const canWrite = hasPermission('lex:catalog:manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WorkingCalendar | null>(null);
  const [deleting, setDeleting] = useState<WorkingCalendar | null>(null);
  const [holidaysFor, setHolidaysFor] = useState<WorkingCalendar | null>(null);

  const { tableProps, totalRows, searchValue, setSearch } = useDataTable<WorkingCalendar>({
    queryKey: 'lex-admin-working-calendars',
    fetchFn: (params) => fetchSuitePaginated<WorkingCalendar>(LEX_ADMIN_ENDPOINTS.WORKING_CALENDARS, params),
    defaultPageSize: 25,
    defaultSort: { column: 'name', direction: 'asc' },
    wsTopics: ['lex.working-calendars'],
  });

  const rows = tableProps.data;
  const invalidateCalendars = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['lex-admin-working-calendars'] });
  }, [qc]);

  const stats = useMemo(() => {
    let defaults = 0;
    let holidays = 0;
    for (const r of rows) {
      if (r.is_default) defaults += 1;
      holidays += r.holidays?.length ?? 0;
    }
    return { total: totalRows, defaults, holidays };
  }, [rows, totalRows]);
  const defaultShare = percent(stats.defaults, stats.total);
  const kpiCopy =
    locale === 'ar'
      ? {
          total: 'تقويمات العمل المتاحة لحساب مواعيد واتفاقيات الخدمة.',
          defaultCal: 'التقويم الافتراضي المستخدم عندما لا يحدد الطلب تقويما.',
          holidays: 'استثناءات العطلات المسجلة في التقويمات المعروضة.',
          currentRegistry: 'السجل الحالي',
          defaultShare: 'نسبة التقويمات الافتراضية',
          calendars: 'تقويمات',
          holidaySlots: 'استثناءات',
        }
      : {
          total: 'Working calendars available for due-date and SLA calculations.',
          defaultCal: 'Fallback calendar used when a request has no explicit calendar.',
          holidays: 'Holiday exceptions registered across the visible calendars.',
          currentRegistry: 'Current registry',
          defaultShare: 'Default-calendar share',
          calendars: 'Calendars',
          holidaySlots: 'Exceptions',
        };

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'is_default',
        label: t.columns.default,
        type: 'select',
        options: [
          { label: t.defaultBadge, value: 'true' },
          { label: t.nonDefault, value: 'false' },
        ],
      },
      {
        key: 'timezone',
        label: t.columns.timezone,
        type: 'text',
        placeholder: 'Asia/Riyadh',
      },
      {
        key: 'profile',
        label: t.form.profile,
        type: 'multi-select',
        options: CALENDAR_PROFILES.map((profile) => ({
          label: t.profiles[profile],
          value: profile,
        })),
      },
      {
        key: 'holiday_kind',
        label: t.holidays.kind,
        type: 'multi-select',
        options: CALENDAR_HOLIDAY_KINDS.map((kind) => ({
          label: t.holidayKinds[kind],
          value: kind,
        })),
      },
    ],
    [t],
  );

  const datasetFilters = useMemo(
    () => ({
      ...(tableProps.activeFilters ?? {}),
      ...(searchValue ? { search: searchValue } : {}),
    }),
    [searchValue, tableProps.activeFilters],
  );

  const exportRows = useMemo(
    () =>
      rows.map((calendar) => ({
        id: calendar.id,
        name: calendar.name,
        description: calendar.description,
        timezone: calendar.timezone,
        is_default: calendar.is_default,
        ramadan_start: calendar.ramadan_start?.slice(0, 10) ?? '',
        ramadan_end: calendar.ramadan_end?.slice(0, 10) ?? '',
        working_hours: encodeWorkingHours(workingHoursInputFromCalendar(calendar)),
        holiday_count: calendar.holidays?.length ?? 0,
        created_at: calendar.created_at,
        updated_at: calendar.updated_at,
      })),
    [rows],
  );

  const del = useMutation({
    mutationFn: (id: string) => lexAdminApi.deleteWorkingCalendar(id),
    onSuccess: async () => {
      showSuccess(common.toast.deleted);
      await invalidateCalendars();
      setDeleting(null);
    },
    onError: showApiError,
  });

  const makeCalendarDefault = async (id: string): Promise<WorkingCalendar> => {
    const calendar = await lexAdminApi.getWorkingCalendar(id);
    return lexAdminApi.updateWorkingCalendar(id, {
      name: calendar.name,
      description: calendar.description,
      timezone: calendar.timezone,
      is_default: true,
      ramadan_start: calendar.ramadan_start ?? null,
      ramadan_end: calendar.ramadan_end ?? null,
      working_hours: workingHoursInputFromCalendar(calendar),
    });
  };

  const setDefault = useMutation({
    mutationFn: (id: string) => makeCalendarDefault(id),
    onSuccess: async () => {
      showSuccess(t.toast.defaultUpdated);
      await invalidateCalendars();
    },
    onError: showApiError,
  });

  const clone = useMutation({
    mutationFn: async (id: string) => {
      const source = await lexAdminApi.getWorkingCalendar(id);
      const created = await lexAdminApi.createWorkingCalendar(calendarClonePayload(source));
      for (const holiday of source.holidays ?? []) {
        await lexAdminApi.addCalendarHoliday(created.id, holidayPayload(holiday));
      }
      return created;
    },
    onSuccess: async () => {
      showSuccess(t.toast.duplicated);
      await invalidateCalendars();
    },
    onError: showApiError,
  });

  const importCalendars = async (rawRows: Record<string, unknown>[]) => {
    const payloads = rawRows.map(parseCalendarImportRow);
    const defaultCount = payloads.filter((payload) => payload.is_default).length;
    if (defaultCount > 1) {
      throw new Error(t.importMultipleDefaultError);
    }
    for (const payload of payloads) {
      await lexAdminApi.createWorkingCalendar(payload);
    }
    await invalidateCalendars();
  };

  const bulkActions = useMemo<BulkAction[]>(
    () => [
      {
        label: t.bulk.makeDefault,
        icon: Star,
        onClick: async (ids) => {
          if (ids.length !== 1) {
            showError(t.selectOneError);
            return;
          }
          try {
            await makeCalendarDefault(ids[0]);
            showSuccess(t.toast.defaultUpdated);
            await invalidateCalendars();
          } catch (error) {
            showApiError(error);
          }
        },
      },
      {
        label: t.bulk.deleteSelected,
        icon: Trash2,
        variant: 'destructive',
        onClick: async (ids) => {
          if (ids.length === 0) return;
          const ok = window.confirm(t.confirmBulkDelete(ids.length));
          if (!ok) return;
          try {
            for (const id of ids) {
              await lexAdminApi.deleteWorkingCalendar(id);
            }
            showSuccess(t.toast.deleted(ids.length));
            await invalidateCalendars();
          } catch (error) {
            showApiError(error);
          }
        },
      },
    ],
    [invalidateCalendars, t],
  );

  const ramadanWindow = (cal: WorkingCalendar): string => {
    if (!cal.ramadan_start || !cal.ramadan_end) return t.noRamadan;
    return `${f.formatDate(cal.ramadan_start, { dateStyle: 'medium' })} → ${f.formatDate(cal.ramadan_end, { dateStyle: 'medium' })}`;
  };

  const columns: ColumnDef<WorkingCalendar>[] = [
    ...(canWrite ? [selectColumn<WorkingCalendar>()] : []),
    {
      id: 'name',
      accessorKey: 'name',
      header: t.columns.name,
      enableSorting: true,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          {row.original.description ? (
            <p className="text-xs text-muted-foreground">{row.original.description}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'timezone',
      accessorKey: 'timezone',
      header: t.columns.timezone,
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.timezone}</span>,
    },
    {
      id: 'ramadan',
      header: t.columns.ramadan,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{ramadanWindow(row.original)}</span>,
    },
    {
      id: 'default',
      accessorKey: 'is_default',
      header: t.columns.default,
      cell: ({ row }) =>
        row.original.is_default ? (
          <Badge variant="default">{t.defaultBadge}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'updated_at',
      accessorKey: 'updated_at',
      header: t.columns.updated,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.updated_at ? f.formatDate(row.original.updated_at, { dateStyle: 'medium' }) : '—'}
        </span>
      ),
    },
  ];

  const rowActions: RowAction<WorkingCalendar>[] = [
    { label: t.holidays.sectionTitle, icon: CalendarDays, onClick: (row) => setHolidaysFor(row) },
    {
      label: t.rowDuplicate,
      icon: Copy,
      disabled: () => clone.isPending,
      onClick: (row) => clone.mutate(row.id),
    },
    {
      label: t.rowMakeDefault,
      icon: Star,
      hidden: (row) => row.is_default,
      disabled: () => setDefault.isPending,
      onClick: (row) => setDefault.mutate(row.id),
    },
    { label: common.edit, icon: PencilLine, onClick: (row) => setEditing(row) },
    { label: common.delete, icon: Trash2, variant: 'destructive', onClick: (row) => setDeleting(row) },
  ];

  const defaultWarning =
    !tableProps.isLoading && stats.defaults !== 1
      ? stats.defaults === 0
        ? t.noDefaultWarning
        : t.multipleDefaultWarning(stats.defaults)
      : null;

  return (
    <LexAccessGuard routeKey="/lex/admin/working-calendars" resourceName={t.pageTitle}>
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          title={t.pageTitle}
          description={t.pageDescription}
          actions={
            canWrite ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="me-1.5 h-4 w-4" />
                {t.create}
              </Button>
            ) : undefined
          }
        />

        <div className="working-calendar-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile
            label={t.stats.total}
            value={stats.total}
            themeClass="kpi-theme-primary"
            icon={CalendarRange}
            loading={tableProps.isLoading}
            detail={kpiCopy.currentRegistry}
            detailValue={kpiCopy.calendars}
            size="md"
            appearance="operational"
            className="working-calendar-kpi-card"
            href="/lex/admin/working-calendars"
          />
          <StatTile
            label={t.stats.defaultCal}
            value={stats.defaults}
            themeClass="kpi-theme-amber"
            icon={Star}
            loading={tableProps.isLoading}
            progress={defaultShare}
            progressLabel={kpiCopy.defaultShare}
            detail={kpiCopy.currentRegistry}
            detailValue={`${defaultShare}%`}
            size="md"
            appearance="operational"
            className="working-calendar-kpi-card"
            href="/lex/admin/working-calendars?is_default=true"
          />
          <StatTile
            label={t.stats.holidays}
            value={stats.holidays}
            themeClass="kpi-theme-red"
            icon={CalendarDays}
            loading={tableProps.isLoading}
            detail={kpiCopy.currentRegistry}
            detailValue={kpiCopy.holidaySlots}
            size="md"
            appearance="operational"
            className="working-calendar-kpi-card"
            href="/lex/admin/working-calendars"
          />
        </div>

        {defaultWarning ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{defaultWarning}</AlertDescription>
          </Alert>
        ) : null}

        <AdminDatasetActions
          namespace="lex.working-calendars"
          filename="lex-working-calendars"
          rows={exportRows}
          activeFilters={datasetFilters}
          labels={{
            savedView: t.savedView,
            importTitle: t.importTitle,
            importDescription: t.importDescription,
          }}
          onImportRows={canWrite ? importCalendars : undefined}
        />

        <DataTable
          {...tableProps}
          columns={columns}
          filters={filters}
          getRowId={(row) => row.id}
          enableSelection={canWrite}
          bulkActions={canWrite ? bulkActions : undefined}
          rowActions={canWrite ? rowActions : undefined}
          searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={common.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
          emptyState={{ icon: CalendarRange, title: t.emptyTitle, description: t.emptyDescription }}
        />

        {canWrite ? (
          <>
            <CalendarFormDialog open={createOpen} onOpenChange={setCreateOpen} />
            <CalendarFormDialog
              calendar={editing}
              open={editing !== null}
              onOpenChange={(o) => !o && setEditing(null)}
            />
            <ConfirmDialog
              open={deleting !== null}
              onOpenChange={(o) => !o && setDeleting(null)}
              title={common.confirm.deleteTitle}
              description={common.confirm.deleteDescription(deleting?.name ?? '')}
              confirmLabel={common.delete}
              variant="destructive"
              loading={del.isPending}
              onConfirm={async () => {
                if (deleting) await del.mutateAsync(deleting.id);
              }}
            />
          </>
        ) : null}

        {holidaysFor ? (
          <CalendarHolidaysDialog
            calendarId={holidaysFor.id}
            calendarName={holidaysFor.name}
            open={holidaysFor !== null}
            onOpenChange={(o) => !o && setHolidaysFor(null)}
          />
        ) : null}
      </div>
    </LexAccessGuard>
  );
}

function encodeWorkingHours(segments: WorkingHoursInput[]): string {
  return segments.map((seg) => `${seg.profile}:${seg.day_of_week}:${seg.start_minute}-${seg.end_minute}`).join('|');
}

function parseCalendarImportRow(row: Record<string, unknown>): CreateWorkingCalendarPayload {
  const name = readString(row, ['name', 'calendar', 'calendar_name']);
  const timezone = readString(row, ['timezone', 'time_zone']) || 'Asia/Riyadh';
  if (!name) throw new Error('Imported calendars require a name.');

  return {
    name,
    description: readString(row, ['description']),
    timezone,
    is_default: readBoolean(row, ['is_default', 'default']),
    ramadan_start: readOptionalDate(row, ['ramadan_start']),
    ramadan_end: readOptionalDate(row, ['ramadan_end']),
    working_hours: parseWorkingHours(row.working_hours),
  };
}

function readString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return String(value).trim();
  }
  return '';
}

function readBoolean(row: Record<string, unknown>, keys: string[]): boolean {
  const value = readString(row, keys).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'default'].includes(value);
}

function readOptionalDate(row: Record<string, unknown>, keys: string[]): string | null {
  const value = readString(row, keys);
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date value: ${value}`);
  return parsed.toISOString();
}

function parseWorkingHours(value: unknown): WorkingHoursInput[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(parseWorkingHourObject);
  const raw = String(value).trim();
  if (!raw) return [];

  if (raw.startsWith('[')) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('working_hours JSON must be an array.');
    return parsed.map(parseWorkingHourObject);
  }

  return raw
    .split('|')
    .filter(Boolean)
    .map((item, index) => {
      const match = item.match(/^([^:]+):(\d):(.+)-(.+)$/);
      if (!match) throw new Error(`Invalid working-hours segment: ${item}`);
      const [, profileRaw, dayRaw, startRaw, endRaw] = match;
      const profile = profileRaw as CalendarProfile;
      if (!CALENDAR_PROFILES.includes(profile)) throw new Error(`Invalid working-hours profile: ${profileRaw}`);
      const start = parseMinuteValue(startRaw);
      const end = parseMinuteValue(endRaw);
      if (end <= start) throw new Error(`Invalid working-hours range: ${item}`);
      return {
        profile,
        day_of_week: Number.parseInt(dayRaw, 10),
        segment_index: index,
        start_minute: start,
        end_minute: end,
      };
    });
}

function parseWorkingHourObject(value: unknown, index: number): WorkingHoursInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid working-hours row.');
  const row = value as Record<string, unknown>;
  const profile = String(row.profile ?? 'standard') as CalendarProfile;
  if (!CALENDAR_PROFILES.includes(profile)) throw new Error(`Invalid working-hours profile: ${profile}`);
  const start = numberCell(row.start_minute ?? row.start);
  const end = numberCell(row.end_minute ?? row.end);
  if (end <= start) throw new Error('Working-hours end must be after start.');
  return {
    profile,
    day_of_week: numberCell(row.day_of_week ?? row.day),
    segment_index: numberCell(row.segment_index ?? index),
    start_minute: start,
    end_minute: end,
  };
}

function numberCell(value: unknown): number {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').trim();
  if (raw.includes(':')) return timeToMinutes(raw);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value: ${raw}`);
  return parsed;
}

function parseMinuteValue(value: string | undefined): number {
  const raw = (value ?? '').trim();
  if (!raw) throw new Error('Missing working-hours minute value.');
  return raw.includes(':') ? timeToMinutes(raw) : numberCell(raw);
}
