'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useFieldArray, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Loader2, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  buildRecordTimeline,
  COMMON_LEGAL_TIMEZONES,
  findOverlappingSegments,
  minutesToTime,
  readSnapshots,
  timeToMinutes,
  writeSnapshot,
} from '../../_lib/admin-feature-utils';
import {
  CALENDAR_PROFILES,
  lexAdminApi,
  type CalendarProfile,
  type WorkingCalendar,
  type WorkingHoursInput,
} from '@/lib/lex/admin';
import { useAdminCommonLabels, useCalendarLabels, type CalendarLabels } from '../../_lib/admin-labels';
import {
  buildTimezonePreview,
  simulateSlaDueDate,
  toDateTimeInputValue,
} from './calendar-admin-utils';

function buildSchema(errors: CalendarLabels['form']['errors']) {
  return z.object({
    name: z.string().trim().min(1, errors.nameRequired),
    description: z.string().trim(),
    timezone: z.string().trim().min(1, errors.timezoneRequired),
    is_default: z.boolean(),
    ramadan_start: z.string().trim(),
    ramadan_end: z.string().trim(),
    working_hours: z
      .array(
        z
          .object({
            profile: z.enum(CALENDAR_PROFILES as unknown as [CalendarProfile, ...CalendarProfile[]]),
            day_of_week: z.coerce.number().int().min(0).max(6),
            start: z.string(),
            end: z.string(),
          })
          .refine((seg) => timeToMinutes(seg.end) > timeToMinutes(seg.start), {
            message: errors.timeOrder,
            path: ['end'],
          }),
      )
      .superRefine((segments, ctx) => {
        const overlaps = findOverlappingSegments(
          segments.map((seg) => ({
            profile: seg.profile,
            day_of_week: seg.day_of_week,
            start_minute: timeToMinutes(seg.start),
            end_minute: timeToMinutes(seg.end),
          })),
        );
        if (overlaps.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: overlaps.join(' '),
          });
        }
      }),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  calendar?: WorkingCalendar | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (calendar: WorkingCalendar) => void;
}

const DEFAULT_SEGMENTS: FormValues['working_hours'] = [0, 1, 2, 3, 4].map((day) => ({
  profile: 'standard',
  day_of_week: day,
  start: '08:00',
  end: '16:00',
}));

function defaults(calendar?: WorkingCalendar | null): FormValues {
  return {
    name: calendar?.name ?? '',
    description: calendar?.description ?? '',
    timezone: calendar?.timezone ?? 'Asia/Riyadh',
    is_default: calendar?.is_default ?? false,
    ramadan_start: calendar?.ramadan_start ? calendar.ramadan_start.slice(0, 10) : '',
    ramadan_end: calendar?.ramadan_end ? calendar.ramadan_end.slice(0, 10) : '',
    working_hours:
      calendar?.working_hours && calendar.working_hours.length > 0
        ? calendar.working_hours.map((wh) => ({
            profile: wh.profile,
            day_of_week: wh.day_of_week,
            start: minutesToTime(wh.start_minute),
            end: minutesToTime(wh.end_minute),
          }))
        : DEFAULT_SEGMENTS,
  };
}

function toWorkingHoursInput(values: FormValues['working_hours']): WorkingHoursInput[] {
  return values.map((seg, index) => ({
    profile: seg.profile,
    day_of_week: seg.day_of_week,
    segment_index: index,
    start_minute: timeToMinutes(seg.start),
    end_minute: timeToMinutes(seg.end),
  }));
}

export function CalendarFormDialog({ calendar, open, onOpenChange, onSaved }: Props) {
  const isEdit = Boolean(calendar);
  const qc = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const t = useCalendarLabels();
  const common = useAdminCommonLabels();
  const schema = useMemo(() => buildSchema(t.form.errors), [t.form.errors]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(calendar) });
  const hours = useFieldArray({ control: form.control, name: 'working_hours' });
  const [simStart, setSimStart] = useState(() => toDateTimeInputValue(new Date()));
  const [simDays, setSimDays] = useState(2);
  const [simHours, setSimHours] = useState(0);

  useEffect(() => {
    if (open) {
      form.reset(defaults(calendar));
      setSimStart(toDateTimeInputValue(new Date()));
      setSimDays(2);
      setSimHours(0);
    }
  }, [calendar, form, open]);

  const watchedHours = form.watch('working_hours');
  const watchedTimezone = form.watch('timezone');
  const watchedRamadanStart = form.watch('ramadan_start');
  const watchedRamadanEnd = form.watch('ramadan_end');
  const watchedIsDefault = form.watch('is_default');

  const workingHourInputs = useMemo(() => toWorkingHoursInput(watchedHours ?? []), [watchedHours]);
  const overlapWarnings = useMemo(() => findOverlappingSegments(workingHourInputs), [workingHourInputs]);
  const timezonePreview = useMemo(() => buildTimezonePreview(watchedTimezone), [watchedTimezone]);
  const timeline = useMemo(
    () => (calendar ? buildRecordTimeline(calendar, common.timeline) : []),
    [calendar, common.timeline],
  );
  const snapshots = useMemo(
    () => (calendar ? readSnapshots<WorkingCalendar>('working-calendars', calendar.id) : []),
    [calendar],
  );
  const slaResult = useMemo(
    () =>
      simulateSlaDueDate({
        start: simStart,
        workingDays: Number.isFinite(simDays) ? simDays : 0,
        workingHours: Number.isFinite(simHours) ? simHours : 0,
        timezone: watchedTimezone,
        ramadanStart: watchedRamadanStart,
        ramadanEnd: watchedRamadanEnd,
        workingHoursRows: workingHourInputs,
        holidays: calendar?.holidays,
      }),
    [calendar?.holidays, simDays, simHours, simStart, watchedRamadanEnd, watchedRamadanStart, watchedTimezone, workingHourInputs],
  );

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const payload = {
        name: v.name,
        description: v.description,
        timezone: v.timezone,
        is_default: v.is_default,
        ramadan_start: v.ramadan_start ? new Date(v.ramadan_start).toISOString() : null,
        ramadan_end: v.ramadan_end ? new Date(v.ramadan_end).toISOString() : null,
        working_hours: toWorkingHoursInput(v.working_hours),
      };
      if (isEdit && calendar) {
        writeSnapshot('working-calendars', calendar.id, calendar);
        return lexAdminApi.updateWorkingCalendar(calendar.id, payload);
      }
      return lexAdminApi.createWorkingCalendar(payload);
    },
    onSuccess: async (saved) => {
      showSuccess(isEdit ? common.toast.updated : common.toast.created);
      await qc.invalidateQueries({ queryKey: ['lex-admin-working-calendars'] });
      await qc.invalidateQueries({ queryKey: ['lex-admin-working-calendar', saved.id, 'holidays'] });
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.form.editTitle : t.form.createTitle}</DialogTitle>
          <DialogDescription>{t.pageDescription}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            {!isEdit ? <LexCreationGuidance workflow="calendar" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="name" label={t.form.name} required>
                <Input id="name" {...form.register('name')} placeholder={t.form.namePlaceholder} />
              </FormField>
              <FormField name="timezone" label={t.form.timezone} required>
                <Input id="timezone" {...form.register('timezone')} placeholder={t.form.timezonePlaceholder} />
              </FormField>
              <div className="md:col-span-2">
                <div className="flex flex-wrap gap-2">
                  {COMMON_LEGAL_TIMEZONES.map((timezone) => (
                    <Button
                      key={timezone}
                      type="button"
                      variant={watchedTimezone === timezone ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => form.setValue('timezone', timezone, { shouldValidate: true })}
                    >
                      {timezone}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <Alert
                  className={cn(
                    'py-3',
                    timezonePreview.valid
                      ? 'border-primary/20 bg-primary/5 text-primary'
                      : 'border-destructive/30 bg-destructive/10 text-destructive',
                  )}
                >
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {timezonePreview.valid
                      ? `${t.form.tzPreview(
                          timezonePreview.currentLabel ?? t.form.tzUnknown,
                          timezonePreview.winterOffset ?? t.form.tzUnknown,
                          timezonePreview.summerOffset ?? t.form.tzUnknown,
                        )} ${timezonePreview.observesDst ? t.form.tzDstYes : t.form.tzDstNo}`
                      : t.form.tzInvalid}
                  </AlertDescription>
                </Alert>
              </div>
              <FormField name="description" label={t.form.description} className="md:col-span-2">
                <Input id="description" {...form.register('description')} />
              </FormField>
              <FormField name="ramadan_start" label={t.form.ramadanStart}>
                <Input id="ramadan_start" type="date" {...form.register('ramadan_start')} />
              </FormField>
              <FormField name="ramadan_end" label={t.form.ramadanEnd}>
                <Input id="ramadan_end" type="date" {...form.register('ramadan_end')} />
              </FormField>
            </div>

            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Switch
                id="is_default"
                checked={watchedIsDefault}
                onCheckedChange={(c) => form.setValue('is_default', c, { shouldValidate: true })}
              />
              <div className="space-y-1">
                <Label htmlFor="is_default">{t.form.isDefault}</Label>
                {watchedIsDefault ? (
                  <p className="text-xs text-muted-foreground">
                    {t.form.defaultHint}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t.form.workingHoursTitle}</p>
                  <p className="text-xs text-muted-foreground">{t.form.workingHoursHint}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    hours.append({ profile: 'standard', day_of_week: 0, start: '08:00', end: '16:00' })
                  }
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t.form.addSegment}
                </Button>
              </div>
              {overlapWarnings.length > 0 ? (
                <Alert variant="destructive" className="py-3">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{overlapWarnings.join(' ')}</AlertDescription>
                </Alert>
              ) : null}
              {hours.fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end"
                >
                  <FormField name={`working_hours.${index}.profile`} label={t.form.profile}>
                    <Select
                      value={form.watch(`working_hours.${index}.profile`)}
                      onValueChange={(v) =>
                        form.setValue(`working_hours.${index}.profile`, v as CalendarProfile, {
                          shouldValidate: true,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CALENDAR_PROFILES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {t.profiles[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField name={`working_hours.${index}.day_of_week`} label={t.form.day}>
                    <Select
                      value={String(form.watch(`working_hours.${index}.day_of_week`))}
                      onValueChange={(v) =>
                        form.setValue(`working_hours.${index}.day_of_week`, Number.parseInt(v, 10), {
                          shouldValidate: true,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {t.weekdays.map((day, dow) => (
                          <SelectItem key={dow} value={String(dow)}>
                            {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField name={`working_hours.${index}.start`} label={t.form.startTime}>
                    <Input type="time" {...form.register(`working_hours.${index}.start`)} />
                  </FormField>
                  <FormField name={`working_hours.${index}.end`} label={t.form.endTime}>
                    <Input type="time" {...form.register(`working_hours.${index}.end`)} />
                  </FormField>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={common.remove}
                    onClick={() => hours.remove(index)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <WorkingHoursGridPreview
                segments={workingHourInputs}
                weekdays={t.weekdaysShort}
                profiles={t.profiles}
                previewLabel={t.form.weeklyGridPreview}
              />
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">{t.form.slaSimTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.form.slaSimHint}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sla-start">{t.form.slaSimStart}</Label>
                  <Input id="sla-start" type="datetime-local" value={simStart} onChange={(e) => setSimStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sla-days">{t.form.slaSimDays}</Label>
                  <Input
                    id="sla-days"
                    type="number"
                    min={0}
                    step={0.5}
                    value={simDays}
                    onChange={(e) => setSimDays(Number.parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sla-hours">{t.form.slaSimHours}</Label>
                  <Input
                    id="sla-hours"
                    type="number"
                    min={0}
                    step={0.25}
                    value={simHours}
                    onChange={(e) => setSimHours(Number.parseFloat(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className="rounded-md bg-muted/40 p-3 text-sm">
                {slaResult.warning ? (
                  <p className="text-destructive">{slaResult.warning}</p>
                ) : (
                  <p>
                    {t.form.slaEstimatedDue} <span className="font-medium">{slaResult.dueAt}</span>
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.form.slaAverages(
                    slaResult.averageDailyHours.toFixed(2),
                    (slaResult.requestedWorkingMinutes / 60).toFixed(2),
                    watchedTimezone,
                  )}
                </p>
              </div>
            </div>

            {calendar ? (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">{t.form.recordTimeline}</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {timeline.length > 0 ? (
                    timeline.map((event) => (
                      <div key={event.id} className="rounded-md bg-muted/40 p-3">
                        <p className="text-sm font-medium">{event.label}</p>
                        <p className="text-xs text-muted-foreground">{new Date(event.at).toLocaleString(locale)}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">{t.form.noTimeline}</p>
                  )}
                  <div className="rounded-md bg-muted/40 p-3">
                    <p className="text-sm font-medium">{t.form.localSnapshots}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.form.snapshotCount(snapshots.length)}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {common.cancel}
              </Button>
              <Button type="submit" disabled={save.isPending || overlapWarnings.length > 0 || !timezonePreview.valid}>
                {save.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {isEdit ? common.save : common.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

interface WorkingHoursGridPreviewProps {
  segments: WorkingHoursInput[];
  weekdays: string[];
  profiles: Record<string, string>;
  previewLabel: string;
}

function WorkingHoursGridPreview({ segments, weekdays, profiles, previewLabel }: WorkingHoursGridPreviewProps) {
  return (
    <div className="space-y-3 rounded-md bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase text-muted-foreground">{previewLabel}</p>
        <div className="flex items-center gap-3 text-caption text-muted-foreground">
          <span>00:00</span>
          <span>12:00</span>
          <span>24:00</span>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {CALENDAR_PROFILES.map((profile) => (
          <div key={profile} className="space-y-2">
            <Badge variant={profile === 'ramadan' ? 'outline' : 'secondary'}>{profiles[profile]}</Badge>
            <div className="space-y-1.5">
              {weekdays.map((day, dayIndex) => {
                const daySegments = segments
                  .filter((seg) => seg.profile === profile && seg.day_of_week === dayIndex)
                  .sort((a, b) => a.start_minute - b.start_minute);
                return (
                  <div key={`${profile}-${day}`} className="grid grid-cols-[3rem_1fr] items-center gap-2">
                    <span className="text-xs text-muted-foreground">{day}</span>
                    <div className="relative h-7 overflow-hidden rounded bg-background">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden />
                      {daySegments.length === 0 ? (
                        <span className="absolute inset-0 flex items-center justify-center text-caption text-muted-foreground">
                          Closed
                        </span>
                      ) : (
                        daySegments.map((seg, index) => {
                          const left = (seg.start_minute / 1440) * 100;
                          const width = ((seg.end_minute - seg.start_minute) / 1440) * 100;
                          return (
                            <span
                              key={`${seg.start_minute}-${seg.end_minute}-${index}`}
                              className={cn(
                                'absolute top-1 h-5 rounded-sm px-1 text-caption leading-5 text-primary-foreground',
                                profile === 'ramadan' ? 'bg-violet-600' : 'bg-primary',
                              )}
                              style={{ left: `${left}%`, width: `${Math.max(width, 3)}%` }}
                              title={`${minutesToTime(seg.start_minute)}-${minutesToTime(seg.end_minute)}`}
                            >
                              <span className="block truncate">
                                {minutesToTime(seg.start_minute)}-{minutesToTime(seg.end_minute)}
                              </span>
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
