'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Loader2, Moon, Plus, Star, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import { useLexFormat, isKsaHoliday, isKsaWeekend } from '@/lib/lex/ksa';
import { showApiError, showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  CALENDAR_HOLIDAY_KINDS,
  lexAdminApi,
  type CalendarHoliday,
  type CalendarHolidayKind,
} from '@/lib/lex/admin';
import { downloadText, parseImportFile } from '../../_lib/admin-feature-utils';
import { useAdminCommonLabels, useCalendarLabels } from '../../_lib/admin-labels';
import {
  addMonths,
  dateKey,
  daysInMonth,
  holidayImportPayload,
  holidayTemplateCsv,
  monthStart,
  parseHolidayImportRows,
  type HolidayImportRow,
} from './calendar-admin-utils';

interface Props {
  calendarId: string;
  calendarName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CalendarHolidaysDialog({ calendarId, calendarName, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { locale, direction } = useLocaleOrDefault();
  const isRtl = direction === 'rtl';
  // Mirror the directional month-paging chevrons in RTL, matching legal-calendar.
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  const f = useLexFormat();
  const t = useCalendarLabels();
  const common = useAdminCommonLabels();
  const fileRef = useRef<HTMLInputElement>(null);

  const [date, setDate] = useState('');
  const [kind, setKind] = useState<CalendarHolidayKind>('official');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [month, setMonth] = useState(() => dateKey(new Date()).slice(0, 7));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<HolidayImportRow[]>([]);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);

  const q = useQuery({
    queryKey: ['lex-admin-working-calendar', calendarId, 'holidays'],
    queryFn: () => lexAdminApi.getWorkingCalendar(calendarId),
    enabled: Boolean(calendarId) && open,
  });
  const holidays = useMemo(
    () => [...(q.data?.holidays ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [q.data?.holidays],
  );

  const visibleMonth = useMemo(() => monthStart(`${month}-01`), [month]);
  const monthDays = useMemo(() => daysInMonth(visibleMonth), [visibleMonth]);
  const monthHolidays = useMemo(() => {
    const grouped = new Map<string, CalendarHoliday[]>();
    for (const holiday of holidays) {
      const key = dateKey(holiday.date);
      if (!key.startsWith(month)) continue;
      const existing = grouped.get(key) ?? [];
      existing.push(holiday);
      grouped.set(key, existing);
    }
    return grouped;
  }, [holidays, month]);

  // Detect whether the date being added is an official KSA national/religious day,
  // so the admin gets a one-click hint + suggested bilingual name.
  const pickedKsaHoliday = useMemo(
    () => (date ? isKsaHoliday(`${date}T00:00:00`) : null),
    [date],
  );

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['lex-admin-working-calendar', calendarId, 'holidays'] });
    await qc.invalidateQueries({ queryKey: ['lex-admin-working-calendars'] });
  };

  const resetForm = () => {
    setDate('');
    setNameEn('');
    setNameAr('');
    setKind('official');
  };

  const add = useMutation({
    mutationFn: () =>
      lexAdminApi.addCalendarHoliday(calendarId, {
        date: new Date(`${date}T00:00:00`).toISOString(),
        kind,
        name: { ar: nameAr, en: nameEn },
      }),
    onSuccess: async () => {
      showSuccess(t.holidays.toastAdded);
      if (date) setMonth(date.slice(0, 7));
      resetForm();
      await invalidate();
    },
    onError: showApiError,
  });

  const remove = useMutation({
    mutationFn: (holidayId: string) => lexAdminApi.deleteCalendarHoliday(calendarId, holidayId),
    onSuccess: async () => {
      showSuccess(t.holidays.toastRemoved);
      await invalidate();
    },
    onError: showApiError,
  });

  const bulkImport = useMutation({
    mutationFn: async (rows: HolidayImportRow[]) => {
      for (const row of rows) {
        await lexAdminApi.addCalendarHoliday(calendarId, holidayImportPayload(row));
      }
    },
    onSuccess: async () => {
      showSuccess(t.holidays.toastImported);
      setPreviewOpen(false);
      setPreviewRows([]);
      setPreviewErrors([]);
      await invalidate();
    },
    onError: showApiError,
  });

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await parseImportFile(file);
      const preview = parseHolidayImportRows(parsed.rows);
      setPreviewRows(preview.rows);
      setPreviewErrors([...parsed.errors, ...preview.errors]);
      setPreviewOpen(true);
    } catch (error) {
      showError(error instanceof Error ? error.message : t.holidays.parseError);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t.holidays.sectionTitle} · {calendarName}
          </DialogTitle>
          <DialogDescription>{t.holidays.sectionDescription}</DialogDescription>
        </DialogHeader>

        <LexCreationGuidance workflow="calendar" />

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">{t.holidays.addTitle}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadText('calendar-holidays-template.csv', holidayTemplateCsv(), 'text/csv;charset=utf-8')}
              >
                <Download className="me-1.5 h-3.5 w-3.5" />
                {t.holidays.template}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.json,application/json,text/csv"
                className="hidden"
                onChange={(event) => void handleImportFile(event.target.files?.[0])}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="me-1.5 h-3.5 w-3.5" />
                {t.holidays.import}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="holiday-date">{t.holidays.date}</Label>
              <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              {date ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Moon className="h-3 w-3" aria-hidden />
                  {f.formatHijri(`${date}T00:00:00`)}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-kind">{t.holidays.kind}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as CalendarHolidayKind)}>
                <SelectTrigger id="holiday-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALENDAR_HOLIDAY_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t.holidayKinds[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-name-en">{common.nameEn}</Label>
              <Input id="holiday-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-name-ar">{common.nameAr}</Label>
              <Input id="holiday-name-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
          </div>
          {pickedKsaHoliday ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success-500/40 bg-success-500/10 px-3 py-2 text-xs text-success-700 dark:text-success-300">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Star className="h-3.5 w-3.5" aria-hidden />
                {t.holidays.ksaMatch} · {resolveLocalized(pickedKsaHoliday.name, locale)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => {
                  setNameEn(pickedKsaHoliday.name.en);
                  setNameAr(pickedKsaHoliday.name.ar);
                }}
              >
                {t.holidays.ksaSuggested}
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!date || (!nameEn && !nameAr) || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="me-1.5 h-3.5 w-3.5" />}
            {t.holidays.add}
          </Button>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {f.formatDate(visibleMonth, { month: 'long', year: 'numeric' })}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Moon className="h-3 w-3" aria-hidden />
                <span>{f.formatHijri(visibleMonth, { month: 'long', year: 'numeric' })}</span>
                <span aria-hidden>·</span>
                <span>{t.holidays.records(holidays.length)}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t.holidays.prevMonth}
                onClick={() => setMonth(dateKey(addMonths(visibleMonth, -1)).slice(0, 7))}
              >
                <PrevIcon className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t.holidays.nextMonth}
                onClick={() => setMonth(dateKey(addMonths(visibleMonth, 1)).slice(0, 7))}
              >
                <NextIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {q.isLoading ? (
            <LoadingSkeleton variant="list-item" count={3} />
          ) : holidays.length === 0 ? (
            <EmptyState icon={CalendarDays} title={t.holidays.empty} description={t.holidays.sectionDescription} />
          ) : (
            <>
              <HolidayMonthGrid
                holidaysByDate={monthHolidays}
                monthDays={monthDays}
                firstDayOffset={visibleMonth.getDay()}
                weekdays={t.weekdaysShort}
                holidayKinds={t.holidayKinds}
                locale={locale}
                formatHijriDay={(d) => f.formatHijri(d, { day: 'numeric' })}
              />
              <div className="grid gap-2 md:grid-cols-2">
                {holidays.map((h) => {
                  const ksa = isKsaHoliday(h.date);
                  return (
                    <div
                      key={h.id}
                      className="group relative flex items-center justify-between gap-2 overflow-hidden rounded-lg border px-4 py-3 ps-5 transition-[box-shadow] duration-fast ease-standard hover:shadow-elevation-2"
                    >
                      <span className="absolute inset-y-0 start-0 w-1 bg-error-500/70" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {resolveLocalized(h.name, locale) || f.formatDate(h.date)}
                        </p>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{f.formatDate(h.date)}</span>
                          <Moon className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{f.formatHijri(h.date)}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {ksa ? (
                          <span className="badge-base badge-success inline-flex items-center gap-1" title={t.holidays.ksaMatch}>
                            <Star className="h-3 w-3" aria-hidden />
                            {t.holidays.ksaSuggested}
                          </span>
                        ) : null}
                        <Badge variant="secondary">{t.holidayKinds[h.kind] ?? h.kind}</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={common.remove}
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(h.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t.holidays.previewTitle}</DialogTitle>
              <DialogDescription>{t.holidays.previewDescription}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={previewErrors.length ? 'destructive' : 'secondary'}>
                  {previewErrors.length ? t.holidays.errorsBadge(previewErrors.length) : t.holidays.noErrors}
                </Badge>
                <Badge variant="outline">{t.holidays.rowsBadge(previewRows.length)}</Badge>
              </div>
              {previewErrors.length ? (
                <div className="max-h-40 overflow-auto rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {previewErrors.map((error) => (
                    <p key={error}>{error}</p>
                  ))}
                </div>
              ) : (
                <div className="max-h-72 overflow-auto rounded-md border">
                  <table className="w-full text-start text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        <th className="px-3 py-2">{t.holidays.colDate}</th>
                        <th className="px-3 py-2">{t.holidays.colKind}</th>
                        <th className="px-3 py-2">{t.holidays.colNameEn}</th>
                        <th className="px-3 py-2">{t.holidays.colNameAr}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 10).map((row, index) => (
                        <tr key={`${row.date}-${index}`} className="border-t">
                          <td className="px-3 py-2">{row.date}</td>
                          <td className="px-3 py-2">{row.kind}</td>
                          <td className="px-3 py-2">{row.name_en || '-'}</td>
                          <td className="px-3 py-2">{row.name_ar || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>
                {common.cancel}
              </Button>
              <Button
                type="button"
                disabled={previewErrors.length > 0 || previewRows.length === 0 || bulkImport.isPending}
                onClick={() => bulkImport.mutate(previewRows)}
              >
                {bulkImport.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="me-1.5 h-3.5 w-3.5" />}
                {t.holidays.apply}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

interface HolidayMonthGridProps {
  holidaysByDate: Map<string, CalendarHoliday[]>;
  monthDays: Date[];
  firstDayOffset: number;
  weekdays: string[];
  holidayKinds: Record<string, string>;
  locale: AppLocale;
  formatHijriDay: (date: Date) => string;
}

function HolidayMonthGrid({
  holidaysByDate,
  monthDays,
  firstDayOffset,
  weekdays,
  holidayKinds,
  locale,
  formatHijriDay,
}: HolidayMonthGridProps) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 bg-muted/60 text-center text-xs font-medium text-muted-foreground">
        {weekdays.map((day) => (
          <div key={day} className="px-2 py-2">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: firstDayOffset }).map((_, index) => (
          <div key={`blank-${index}`} className="min-h-24 border-t border-e bg-muted/20" />
        ))}
        {monthDays.map((day) => {
          const key = dateKey(day);
          const holidays = holidaysByDate.get(key) ?? [];
          const ksa = isKsaHoliday(day);
          const weekend = isKsaWeekend(day);
          return (
            <div
              key={key}
              className={cn(
                'min-h-24 space-y-1 border-t border-e p-2',
                (ksa || weekend) && 'bg-muted/30',
              )}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-medium">{day.getDate()}</span>
                  <span className="text-caption text-muted-foreground">{formatHijriDay(day)}</span>
                </div>
                {holidays.length > 0 ? (
                  <Badge variant="outline">{holidays.length}</Badge>
                ) : ksa ? (
                  <Star className="h-3 w-3 text-success-500" aria-hidden />
                ) : null}
              </div>
              {ksa && holidays.length === 0 ? (
                <div className="rounded bg-success-50 px-2 py-1 text-caption text-success-700 dark:bg-success-700/15 dark:text-success-300">
                  <p className="truncate font-medium">{resolveLocalized(ksa.name, locale)}</p>
                </div>
              ) : null}
              {holidays.map((holiday) => (
                <div key={holiday.id} className="rounded bg-error-50 px-2 py-1 text-caption text-error-700 dark:bg-error-700/15 dark:text-error-300">
                  <p className="truncate font-medium">{resolveLocalized(holiday.name, locale)}</p>
                  <p className="truncate text-error-700 dark:text-error-300/80">{holidayKinds[holiday.kind] ?? holiday.kind}</p>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
