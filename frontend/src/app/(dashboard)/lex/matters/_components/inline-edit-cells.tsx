/**
 * Inline triage edit cells for the Matters list table and board cards.
 *
 * These are small, fully controlled cell components the integrator drops into
 * the matters table columns and board cards to enable in-place editing of a
 * matter's priority, owner, and due date without opening the full edit dialog.
 *
 * Each cell:
 *   - renders a read-only display when `canWrite` is false;
 *   - opens a compact popover (priority / owner) or calendar (due date) on click
 *     or keyboard activation when `canWrite` is true;
 *   - patches the matter via `enterpriseApi.lex.updateMatter(id, patch)` with an
 *     OPTIMISTIC update across every mounted `['lex-matters']` cache variant
 *     (filter / sort / page) and ROLLS BACK on error;
 *   - invalidates / settles `['lex-matters']` + `['lex-overview']` so the list,
 *     board, hero stats, and the lex overview console all reconcile.
 *
 * Bilingual contract: this file owns its labels as a `LexBilingual<...>` bundle
 * (English `en` + professional MSA `ar`) resolved through `useInlineEditLabels`,
 * mirroring the canonical lex i18n pattern (`../../_lib/lex-i18n.ts`). Legal
 * glossary: قضية (matter) / مهمة قانونية / التزام (obligation) / مهلة (due) /
 * تذكير (reminder) / مستند (document).
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, ChevronDown } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOptimisticMutation } from '@/hooks/use-optimistic-mutation';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { formatDate } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { AppLocale } from '@/lib/i18n';
import type { PaginatedResponse } from '@/types/api';
import type { LexMatter, LexUpdateMatterPayload, UserDirectoryEntry } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import { type MatterSlaTier, matterSlaTier } from '../_lib/matter-sla';
import { MATTER_PRIORITY_OPTIONS, formatMatterToken } from './labels';

/* ------------------------------------------------------------------------- *
 * Feature-local bilingual labels (own them here per the lex i18n contract).
 * ------------------------------------------------------------------------- */

interface InlineEditLabels {
  priorityOptions: Record<string, string>;
  priorityAria: (title: string) => string;
  ownerAria: (title: string) => string;
  dueDateAria: (title: string) => string;
  owner: string;
  ownerPlaceholder: string;
  ownerUnassigned: string;
  ownerSearchPlaceholder: string;
  ownerEmpty: string;
  ownerError: string;
  dueDate: string;
  noDueDate: string;
  clearDueDate: string;
  quickSet: {
    today: string;
    plusOneDay: string;
    plusSevenDays: string;
    clear: string;
  };
  saving: string;
  toast: {
    priorityUpdated: string;
    ownerUpdated: string;
    dueDateUpdated: string;
  };
}

const inlineEditLabelsBundle: LexBilingual<InlineEditLabels> = {
  en: {
    priorityOptions: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
    priorityAria: (title) => `Change priority for ${title}`,
    ownerAria: (title) => `Reassign owner for ${title}`,
    dueDateAria: (title) => `Change due date for ${title}`,
    owner: 'Owner',
    ownerPlaceholder: 'Select owner',
    ownerUnassigned: 'Unassigned',
    ownerSearchPlaceholder: 'Search owners...',
    ownerEmpty: 'No owners found.',
    ownerError: 'Unable to load the user directory.',
    dueDate: 'Due date',
    noDueDate: 'No due date',
    clearDueDate: 'Clear due date',
    quickSet: {
      today: 'Today',
      plusOneDay: '+1 day',
      plusSevenDays: '+7 days',
      clear: 'Clear',
    },
    saving: 'Saving...',
    toast: {
      priorityUpdated: 'Matter priority updated.',
      ownerUpdated: 'Matter owner reassigned.',
      dueDateUpdated: 'Matter due date updated.',
    },
  },
  ar: {
    priorityOptions: {
      critical: 'حرجة',
      high: 'مرتفعة',
      medium: 'متوسطة',
      low: 'منخفضة',
    },
    priorityAria: (title) => `تغيير أولوية القضية "${title}"`,
    ownerAria: (title) => `إعادة إسناد مسؤول القضية "${title}"`,
    dueDateAria: (title) => `تغيير تاريخ استحقاق القضية "${title}"`,
    owner: 'المسؤول',
    ownerPlaceholder: 'اختر المسؤول',
    ownerUnassigned: 'غير مُسند',
    ownerSearchPlaceholder: 'البحث عن مسؤول...',
    ownerEmpty: 'لا يوجد مسؤولون.',
    ownerError: 'تعذّر تحميل دليل المستخدمين.',
    dueDate: 'تاريخ الاستحقاق',
    noDueDate: 'بلا تاريخ استحقاق',
    clearDueDate: 'مسح تاريخ الاستحقاق',
    quickSet: {
      today: 'اليوم',
      plusOneDay: '+1 يوم',
      plusSevenDays: '+7 أيام',
      clear: 'مسح',
    },
    saving: 'جارٍ الحفظ...',
    toast: {
      priorityUpdated: 'تم تحديث أولوية القضية.',
      ownerUpdated: 'تمت إعادة إسناد مسؤول القضية.',
      dueDateUpdated: 'تم تحديث تاريخ استحقاق القضية.',
    },
  },
};

function resolveInlineEditLabels(locale: AppLocale = 'en'): InlineEditLabels {
  return resolveLexBilingual(inlineEditLabelsBundle, locale);
}

function useInlineEditLabels(): InlineEditLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveInlineEditLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Shared optimistic-update plumbing.
 *
 * Every cell patches a single matter in-place across all mounted `lex-matters`
 * list caches (each filter / sort / page is a distinct query key). On success
 * we surface a toast; on error the hook rolls each snapshot back. We always
 * settle `['lex-matters']` + `['lex-overview']` so the table, board, hero
 * stats, and the lex overview console reconcile against the server.
 */

type MatterPatch = LexUpdateMatterPayload;

interface InlineMutationVars {
  matterId: string;
  patch: MatterPatch;
}

function applyPatchToCache(
  prev: PaginatedResponse<LexMatter> | undefined,
  vars: InlineMutationVars,
): PaginatedResponse<LexMatter> | undefined {
  if (!prev?.data) {
    return prev;
  }
  return {
    ...prev,
    data: prev.data.map((matter) =>
      // The patch fields are a subset of LexMatter (optional on the payload);
      // merging never removes required keys, so the cast back to LexMatter is
      // sound. We only ever pass defined values from the cells.
      matter.id === vars.matterId ? ({ ...matter, ...vars.patch } as LexMatter) : matter,
    ),
  };
}

/**
 * useInlineMatterPatch wires an optimistic `updateMatter` mutation that targets
 * every currently-mounted `lex-matters` list cache and settles the matters +
 * overview keys. The `successMessage` is shown once the server confirms.
 */
function useInlineMatterPatch(successMessage: string) {
  const queryClient = useQueryClient();

  const matterListKeys = useCallback(
    () =>
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ['lex-matters'] })
        .map((query) => query.queryKey as unknown[]),
    [queryClient],
  );

  return useOptimisticMutation<InlineMutationVars, LexMatter>({
    mutationFn: ({ matterId, patch }) => enterpriseApi.lex.updateMatter(matterId, patch),
    queryKeys: matterListKeys(),
    applyOptimistic: applyPatchToCache,
    onSuccess: () => showSuccess(successMessage),
    onError: showApiError,
    invalidateKeys: [['lex-matters'], ['lex-overview']],
  });
}

/** Badge tone for a priority token, matching the list/board PriorityBadge. */
function priorityVariant(priority: string): 'destructive' | 'warning' | 'secondary' {
  if (priority === 'critical' || priority === 'high') {
    return 'destructive';
  }
  if (priority === 'medium') {
    return 'warning';
  }
  return 'secondary';
}

/* ------------------------------------------------------------------------- *
 * PriorityEditCell
 * ------------------------------------------------------------------------- */

export interface PriorityEditCellProps {
  matter: LexMatter;
  canWrite: boolean;
}

/**
 * PriorityEditCell shows the matter priority as a badge. When `canWrite`, the
 * badge becomes a popover trigger exposing the four priority options; selecting
 * one optimistically patches `{ priority }`. Read-only otherwise.
 */
export function PriorityEditCell({ matter, canWrite }: PriorityEditCellProps) {
  const labels = useInlineEditLabels();
  const [open, setOpen] = useState(false);
  const mutation = useInlineMatterPatch(labels.toast.priorityUpdated);

  const priority = matter.priority;
  const display = labels.priorityOptions[priority] ?? formatMatterToken(priority);

  if (!canWrite) {
    return <Badge variant={priorityVariant(priority)}>{display}</Badge>;
  }

  const choose = (next: string) => {
    setOpen(false);
    if (next === priority) {
      return;
    }
    mutation.mutate({ matterId: matter.id, patch: { priority: next } });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={labels.priorityAria(matter.title)}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
        >
          <Badge variant={priorityVariant(priority)} className="gap-1">
            {display}
            <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        <div role="listbox" aria-label={labels.priorityAria(matter.title)} className="space-y-0.5">
          {MATTER_PRIORITY_OPTIONS.map((option) => {
            const active = option === priority;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => choose(option)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors hover:bg-accent/70 focus-visible:bg-accent/70',
                  active && 'font-medium',
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <Badge variant={priorityVariant(option)}>
                    {labels.priorityOptions[option] ?? formatMatterToken(option)}
                  </Badge>
                </span>
                {active ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------------- *
 * OwnerEditCell
 * ------------------------------------------------------------------------- */

export interface OwnerEditCellProps {
  matter: LexMatter;
  canWrite: boolean;
}

/**
 * OwnerEditCell shows the current owner name. When `canWrite`, clicking opens a
 * popover with a searchable owner select sourced from the user directory;
 * choosing an owner optimistically patches `{ owner_user_id, owner_name }`.
 */
export function OwnerEditCell({ matter, canWrite }: OwnerEditCellProps) {
  const labels = useInlineEditLabels();
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState('');
  const mutation = useInlineMatterPatch(labels.toast.ownerUpdated);

  const ownerName = matter.owner_name?.trim() ? matter.owner_name : labels.ownerUnassigned;

  const usersQuery = useQuery({
    queryKey: ['lex-inline-owner-users'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open && canWrite,
    staleTime: 60_000,
  });

  const users: UserDirectoryEntry[] = usersQuery.data?.data ?? [];

  // Reset the staged selection whenever the popover opens against this matter.
  useEffect(() => {
    if (open) {
      setPendingId(matter.owner_user_id ?? '');
    }
  }, [open, matter.owner_user_id]);

  if (!canWrite) {
    return <span className="text-sm text-muted-foreground">{ownerName}</span>;
  }

  const commit = (userId: string) => {
    setPendingId(userId);
    const selected = users.find((entry) => entry.id === userId);
    if (!selected || userId === matter.owner_user_id) {
      setOpen(false);
      return;
    }
    setOpen(false);
    mutation.mutate({
      matterId: matter.id,
      patch: { owner_user_id: selected.id, owner_name: userDisplayName(selected) },
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={labels.ownerAria(matter.title)}
          disabled={mutation.isPending}
          className="inline-flex max-w-[12rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-start text-sm text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
        >
          <span className="truncate">{mutation.isPending ? labels.saving : ownerName}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2 p-3">
        <Label className="text-xs font-medium text-muted-foreground">{labels.owner}</Label>
        {usersQuery.isError ? (
          <p className="text-sm text-destructive">{labels.ownerError}</p>
        ) : (
          <Select value={pendingId} onValueChange={commit} disabled={usersQuery.isLoading}>
            <SelectTrigger aria-label={labels.ownerAria(matter.title)} className="h-10">
              <SelectValue placeholder={labels.ownerPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {users.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">{labels.ownerEmpty}</div>
              ) : (
                users.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {userDisplayName(entry)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------------- *
 * DueDateEditCell
 * ------------------------------------------------------------------------- */

export interface DueDateEditCellProps {
  matter: LexMatter;
  canWrite: boolean;
}

/** Format an ISO date to the `yyyy-MM-dd` the matter due_date payload expects. */
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Text tone for the displayed due date, driven by the SLA tier from
 * {@link matterSlaTier} (the single source of truth for DUE_SOON_DAYS /
 * BREACH_DAYS). `due_soon` reads amber, `overdue`/`breached` escalate to
 * orange/rose; `on_track` (and no-due-date / terminal matters) stay neutral.
 * Mirrors the tier palette in `../_lib/matter-sla.tsx` as text-only tones.
 */
const DUE_DATE_TIER_TONE: Record<MatterSlaTier, string> = {
  on_track: '',
  due_soon: 'text-warning-700 dark:text-warning-300',
  overdue: 'text-warning-700 dark:text-warning-300',
  breached: 'text-rose-700 dark:text-rose-300',
};

/**
 * DueDateEditCell shows the matter due date (or a "no due date" hint). When
 * `canWrite`, clicking opens a calendar popover; picking a day patches
 * `{ due_date }`, and a clear action sets it to `null`.
 */
export function DueDateEditCell({ matter, canWrite }: DueDateEditCellProps) {
  const labels = useInlineEditLabels();
  const [open, setOpen] = useState(false);
  const mutation = useInlineMatterPatch(labels.toast.dueDateUpdated);

  const selected = useMemo(() => {
    if (!matter.due_date) {
      return undefined;
    }
    const parsed = new Date(matter.due_date);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }, [matter.due_date]);

  const display = matter.due_date ? formatDate(matter.due_date) : labels.noDueDate;

  // Conditional tone: amber when due soon, orange/rose when overdue/breached,
  // neutral otherwise. Tier comes from the shared SLA module so the thresholds
  // (DUE_SOON_DAYS / BREACH_DAYS) are never re-derived here.
  const slaTone = DUE_DATE_TIER_TONE[matterSlaTier(matter)];

  if (!canWrite) {
    return (
      <span
        className={cn(
          'text-sm font-medium',
          slaTone || (matter.due_date ? '' : 'text-muted-foreground'),
        )}
      >
        {display}
      </span>
    );
  }

  // Patch the due date to an absolute Date, short-circuiting when it already
  // matches the stored ISO day. Closes the popover and routes through the same
  // optimistic inline patch the calendar uses.
  const setDue = (date: Date) => {
    setOpen(false);
    const next = toIsoDate(date);
    if (next === (matter.due_date ? toIsoDate(selected ?? new Date(matter.due_date)) : null)) {
      return;
    }
    mutation.mutate({ matterId: matter.id, patch: { due_date: next } });
  };

  const choose = (date: Date | undefined) => {
    if (!date) {
      return;
    }
    setDue(date);
  };

  // Quick-set offsets relative to "today" (local midnight) in whole days.
  const quickSetByDays = (offsetDays: number) => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + offsetDays);
    setDue(base);
  };

  const clear = () => {
    setOpen(false);
    if (matter.due_date) {
      mutation.mutate({ matterId: matter.id, patch: { due_date: null } });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={labels.dueDateAria(matter.title)}
          disabled={mutation.isPending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-start text-sm font-medium outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60',
            slaTone || (matter.due_date ? '' : 'text-muted-foreground'),
          )}
        >
          <CalendarClock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="truncate">{mutation.isPending ? labels.saving : display}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-wrap items-center gap-1 border-b p-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => quickSetByDays(0)}
          >
            {labels.quickSet.today}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => quickSetByDays(1)}
          >
            {labels.quickSet.plusOneDay}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => quickSetByDays(7)}
          >
            {labels.quickSet.plusSevenDays}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={clear}
            disabled={!matter.due_date}
          >
            {labels.quickSet.clear}
          </Button>
        </div>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={choose}
          initialFocus
        />
        <div className="flex justify-end border-t px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={!matter.due_date}
          >
            {labels.clearDueDate}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
