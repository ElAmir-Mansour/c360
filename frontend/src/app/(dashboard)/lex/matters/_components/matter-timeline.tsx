'use client';

/**
 * MatterCaseTimeline — FEATURE 1 of the Matters detail surface.
 *
 * Renders the chronological lifecycle timeline of a legal matter (قضية) and the
 * current external-hold (حجز خارجي) state — classified by court / government /
 * department / expert delay — and, when the viewer has write access, a dialog to
 * set or clear that external hold.
 *
 * The backend returns the case-timeline projection (`delay_events`,
 * `external_hold`, `external_hold_category`, `external_hold_since`). This module
 * still reads through a narrow accessor so older environments without the
 * timeline methods render an empty-state instead of crashing.
 *
 * Follows the canonical lex bilingual contract (../../_lib/lex-i18n.ts): a
 * self-contained `LexBilingual<MatterTimelineLabels>` bundle (full EN + MSA) read
 * via the local {@link useMatterTimelineLabels} hook. RTL-correct logical Tailwind
 * props (ms-/me-/ps-/pe-/start-/end-). Legal glossary: قضية / حجز خارجي / مهلة /
 * مستند / طرف.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CircleDot,
  Flag,
  Gavel,
  History,
  PauseCircle,
  PlayCircle,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Timeline } from '@/components/shared/timeline';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { enterpriseApi } from '@/lib/enterprise';
import { DELAY_CATEGORY_VALUES, type DelayCategory } from '@/lib/lex/settlements';
import { formatDate, formatDateTime } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Defensive backend-shape mirrors.
 *
 * Every field is optional and read with optional chaining; `[key: string]:
 * unknown` keeps forward-compat with extra backend fields we don't yet render.
 * ------------------------------------------------------------------------- */

/** A single chronological matter lifecycle event/entry. */
export interface MatterTimelineEntry {
  id?: string;
  /** Stable event token (e.g. `status_change`, `hold_set`, `hold_cleared`). */
  type?: string;
  kind?: string;
  event?: string;
  category?: DelayCategory | string | null;
  reason?: string | null;
  opened_at?: string | null;
  resolved_at?: string | null;
  resolved?: boolean | null;
  /** Human-readable title; may be absent (fall back to the token). */
  title?: string | null;
  label?: string | null;
  /** Optional longer detail line. */
  description?: string | null;
  detail?: string | null;
  notes?: string | null;
  /** ISO timestamp of the event. */
  at?: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
  timestamp?: string | null;
  /** Actor that produced the entry. */
  actor_name?: string | null;
  /** Whether this entry is an external-hold marker. */
  is_hold?: boolean | null;
  hold?: boolean | null;
  [key: string]: unknown;
}

/** Current external-hold state for a matter. */
export interface MatterExternalHoldState {
  active?: boolean | null;
  on_hold?: boolean | null;
  category?: DelayCategory | string | null;
  reason?: string | null;
  /** Optional party or team the matter is waiting on. */
  holder?: string | null;
  party?: string | null;
  /** Expected resume date (ISO). */
  expected_resume_date?: string | null;
  resume_date?: string | null;
  /** When the hold was set, and by whom. */
  since?: string | null;
  set_at?: string | null;
  set_by_name?: string | null;
  [key: string]: unknown;
}

/** Aggregate payload returned by `getMatterTimeline`. */
export interface MatterTimelinePayload {
  delay_events?: MatterTimelineEntry[] | null;
  entries?: MatterTimelineEntry[] | null;
  events?: MatterTimelineEntry[] | null;
  items?: MatterTimelineEntry[] | null;
  external_hold?: MatterExternalHoldState | boolean | null;
  external_hold_category?: DelayCategory | string | null;
  external_hold_since?: string | null;
  hold?: MatterExternalHoldState | null;
  [key: string]: unknown;
}

/** Request body for setting / clearing the external hold. Mirrors the Go DTO. */
export interface SetMatterExternalHoldPayload {
  held: boolean;
  category?: DelayCategory | null;
  reason?: string;
  since?: string | null;
}

/**
 * Narrow accessor over the lex client. Declared with optional members so older
 * deployments without the timeline methods still degrade gracefully.
 */
interface LexTimelineMethods {
  getMatterTimeline?: (matterId: string) => Promise<MatterTimelinePayload>;
  updateMatterTimeline?: (matterId: string, payload: unknown) => Promise<MatterTimelinePayload>;
  setMatterExternalHold?: (
    matterId: string,
    payload: SetMatterExternalHoldPayload,
  ) => Promise<MatterTimelinePayload | MatterExternalHoldState | unknown>;
}

const lexTimelineApi = enterpriseApi.lex as unknown as LexTimelineMethods;

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained, full EN + MSA).
 * ------------------------------------------------------------------------- */

interface MatterTimelineLabels {
  title: string;
  description: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  unavailableTitle: string;
  unavailableDescription: string;
  setHold: string;
  clearHold: string;
  holdMarker: string;
  byActor: (actor: string) => string;
  categoryOptions: Record<DelayCategory, string>;
  delayEventTitle: (category: string, resolved: boolean) => string;
  /**
   * Bilingual labels for the raw lifecycle event token (`type`/`kind`/`event`)
   * of a timeline entry, used when the backend does not supply a human-readable
   * `title`/`label`. Prettify stays only as a last-resort for unmapped tokens.
   */
  eventTypes: Record<string, string>;
  hold: {
    onHoldTitle: string;
    activeTitle: string;
    notOnHold: string;
    notOnHoldDescription: string;
    reason: string;
    holder: string;
    expectedResume: string;
    setOn: (date: string) => string;
    noReason: string;
    category: string;
    noCategory: string;
    since: string;
    noHolder: string;
    noResumeDate: string;
  };
  dialog: {
    setTitle: string;
    clearTitle: string;
    setDescription: string;
    clearDescription: string;
    reason: string;
    reasonPlaceholder: string;
    category: string;
    since: string;
    cancel: string;
    setSubmit: string;
    clearSubmit: string;
  };
  toast: {
    holdSet: string;
    holdCleared: string;
  };
}

const matterTimelineLabelsBundle: LexBilingual<MatterTimelineLabels> = {
  en: {
    title: 'Case Timeline',
    description: 'Chronological lifecycle events for this matter and its external-hold state.',
    loadError: 'Failed to load the matter timeline.',
    emptyTitle: 'No timeline events',
    emptyDescription: 'Lifecycle events appear here as the matter progresses.',
    unavailableTitle: 'Timeline unavailable',
    unavailableDescription: 'The matter timeline service is not available in this environment.',
    setHold: 'Set external hold',
    clearHold: 'Clear hold',
    holdMarker: 'External hold',
    byActor: (actor) => `by ${actor}`,
    categoryOptions: {
      court: 'Court',
      government: 'Government',
      department: 'Department',
      expert: 'Expert',
    },
    delayEventTitle: (category, resolved) =>
      `${category} delay ${resolved ? 'resolved' : 'recorded'}`,
    eventTypes: {
      created: 'Matter opened',
      opened: 'Matter opened',
      intake: 'Matter intake',
      updated: 'Matter updated',
      triaged: 'Matter triaged',
      status_change: 'Status changed',
      status_changed: 'Status changed',
      hold_set: 'External hold placed',
      hold_placed: 'External hold placed',
      hold_cleared: 'External hold cleared',
      contract_linked: 'Contract linked',
      contract_unlinked: 'Contract unlinked',
      document_linked: 'Document linked',
      document_unlinked: 'Document unlinked',
      comment_added: 'Comment added',
      deadline: 'Deadline added',
      deadline_created: 'Deadline added',
      deadline_obligation_created: 'Deadline added',
      reminder: 'Reminder',
      due: 'Due date',
      delay_recorded: 'Delay recorded',
      delay_resolved: 'Delay resolved',
      delay_reopened: 'Delay reopened',
      delay_updated: 'Delay updated',
      timeline_updated: 'Timeline updated',
    },
    hold: {
      onHoldTitle: 'On hold — waiting on an external dependency',
      activeTitle: 'External hold active',
      notOnHold: 'Not on hold',
      notOnHoldDescription: 'This matter is progressing without an external hold.',
      reason: 'Reason',
      holder: 'Waiting on',
      expectedResume: 'Expected resume',
      setOn: (date) => `Placed on hold ${date}`,
      noReason: 'No reason recorded',
      category: 'Category',
      noCategory: 'Category not recorded',
      since: 'Placed on',
      noHolder: 'Party not recorded',
      noResumeDate: 'No expected resume date',
    },
    dialog: {
      setTitle: 'Set external hold',
      clearTitle: 'Clear external hold',
      setDescription:
        'Pause the matter while it waits on a court, government body, department, or expert.',
      clearDescription: 'Resume the matter and lift the current external hold.',
      reason: 'Reason',
      reasonPlaceholder: 'Awaiting court action, government response, department input, or expert report.',
      category: 'Category',
      since: 'Placed on date',
      cancel: 'Cancel',
      setSubmit: 'Set hold',
      clearSubmit: 'Clear hold',
    },
    toast: {
      holdSet: 'External hold set.',
      holdCleared: 'External hold cleared.',
    },
  },
  ar: {
    title: 'الجدول الزمني للقضية',
    description: 'الأحداث الزمنية لدورة حياة هذه القضية وحالة الحجز الخارجي عليها.',
    loadError: 'تعذّر تحميل الجدول الزمني للقضية.',
    emptyTitle: 'لا توجد أحداث زمنية',
    emptyDescription: 'تظهر أحداث دورة الحياة هنا مع تقدّم القضية.',
    unavailableTitle: 'الجدول الزمني غير متاح',
    unavailableDescription: 'خدمة الجدول الزمني للقضية غير متاحة في هذه البيئة.',
    setHold: 'فرض حجز خارجي',
    clearHold: 'رفع الحجز',
    holdMarker: 'حجز خارجي',
    byActor: (actor) => `بواسطة ${actor}`,
    categoryOptions: {
      court: 'المحكمة',
      government: 'جهة حكومية',
      department: 'إدارة داخلية',
      expert: 'خبير',
    },
    delayEventTitle: (category, resolved) =>
      `${resolved ? 'معالجة تأخير' : 'تسجيل تأخير'}: ${category}`,
    eventTypes: {
      created: 'فتح القضية',
      opened: 'فتح القضية',
      intake: 'استلام القضية',
      updated: 'تحديث القضية',
      triaged: 'فرز القضية',
      status_change: 'تغيير الحالة',
      status_changed: 'تغيير الحالة',
      hold_set: 'فرض حجز خارجي',
      hold_placed: 'فرض حجز خارجي',
      hold_cleared: 'رفع الحجز الخارجي',
      contract_linked: 'ربط عقد',
      contract_unlinked: 'إلغاء ربط عقد',
      document_linked: 'ربط مستند',
      document_unlinked: 'إلغاء ربط مستند',
      comment_added: 'إضافة تعليق',
      deadline: 'إضافة موعد نهائي',
      deadline_created: 'إضافة موعد نهائي',
      deadline_obligation_created: 'إضافة موعد نهائي',
      reminder: 'تذكير',
      due: 'تاريخ الاستحقاق',
      delay_recorded: 'تسجيل تأخير',
      delay_resolved: 'معالجة التأخير',
      delay_reopened: 'إعادة فتح التأخير',
      delay_updated: 'تحديث التأخير',
      timeline_updated: 'تحديث الجدول الزمني',
    },
    hold: {
      onHoldTitle: 'محجوزة — بانتظار اعتماد خارجي',
      activeTitle: 'حجز خارجي ساري',
      notOnHold: 'غير محجوزة',
      notOnHoldDescription: 'تسير هذه القضية دون حجز خارجي.',
      reason: 'السبب',
      holder: 'بانتظار',
      expectedResume: 'الاستئناف المتوقع',
      setOn: (date) => `فُرض الحجز في ${date}`,
      noReason: 'لم يُسجَّل سبب',
      category: 'الفئة',
      noCategory: 'لم تُسجَّل الفئة',
      since: 'تاريخ الفرض',
      noHolder: 'لم يُسجَّل الطرف',
      noResumeDate: 'لا يوجد تاريخ استئناف متوقع',
    },
    dialog: {
      setTitle: 'فرض حجز خارجي',
      clearTitle: 'رفع الحجز الخارجي',
      setDescription: 'إيقاف القضية مؤقتًا بانتظار المحكمة أو جهة حكومية أو إدارة داخلية أو خبير.',
      clearDescription: 'استئناف القضية ورفع الحجز الخارجي الحالي.',
      reason: 'السبب',
      reasonPlaceholder: 'بانتظار إجراء من المحكمة أو رد جهة حكومية أو إفادة إدارة داخلية أو تقرير خبير.',
      category: 'الفئة',
      since: 'تاريخ فرض الحجز',
      cancel: 'إلغاء',
      setSubmit: 'فرض الحجز',
      clearSubmit: 'رفع الحجز',
    },
    toast: {
      holdSet: 'تم فرض الحجز الخارجي.',
      holdCleared: 'تم رفع الحجز الخارجي.',
    },
  },
};

function resolveMatterTimelineLabels(locale: AppLocale = 'en'): MatterTimelineLabels {
  return resolveLexBilingual(matterTimelineLabelsBundle, locale);
}

function useMatterTimelineLabels(): MatterTimelineLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveMatterTimelineLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Shape-normalising helpers (read the defensive shape into render-ready data).
 * ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function categoryLabel(labels: MatterTimelineLabels, category: unknown): string | undefined {
  if (typeof category !== 'string' || !category.trim()) return undefined;
  return labels.categoryOptions[category as DelayCategory] ?? category.replace(/_/g, ' ');
}

function timelineEntries(payload: MatterTimelinePayload | null | undefined): MatterTimelineEntry[] {
  return payload?.delay_events ?? payload?.entries ?? payload?.events ?? payload?.items ?? [];
}

function normalizeHold(payload: MatterTimelinePayload | null | undefined): MatterExternalHoldState | null {
  if (!payload) return null;
  const external = payload.external_hold;
  const raw =
    isRecord(external) ? (external as MatterExternalHoldState) : isRecord(payload.hold) ? payload.hold : null;
  const active =
    typeof external === 'boolean' ? external : Boolean(raw?.active ?? raw?.on_hold ?? false);
  return {
    ...(raw ?? {}),
    active,
    category: raw?.category ?? payload.external_hold_category ?? null,
    since: raw?.since ?? raw?.set_at ?? payload.external_hold_since ?? null,
    set_at: raw?.set_at ?? raw?.since ?? payload.external_hold_since ?? null,
  };
}

function entryTimestamp(entry: MatterTimelineEntry): string | undefined {
  if ((entry.resolved === true || Boolean(entry.resolved_at)) && entry.resolved_at) {
    return entry.resolved_at;
  }
  return (
    entry.at ??
    entry.occurred_at ??
    entry.opened_at ??
    entry.resolved_at ??
    entry.created_at ??
    entry.timestamp ??
    undefined
  ) as string | undefined;
}

function entryToken(entry: MatterTimelineEntry): string {
  const explicit = entry.type ?? entry.kind ?? entry.event ?? '';
  if (explicit) return explicit.toString();
  if (entry.category) {
    return entry.resolved || entry.resolved_at ? 'delay_resolved' : 'delay_recorded';
  }
  return '';
}

function isHoldEntry(entry: MatterTimelineEntry): boolean {
  if (entry.is_hold === true || entry.hold === true) return true;
  const token = entryToken(entry).toLowerCase();
  return token.includes('hold');
}

function entryTitle(entry: MatterTimelineEntry, labels: MatterTimelineLabels): string {
  const raw = entry.title ?? entry.label ?? null;
  if (raw && raw.trim()) return raw;
  if (entry.category) {
    return labels.delayEventTitle(
      categoryLabel(labels, entry.category) ?? labels.eventTypes.delay_recorded,
      Boolean(entry.resolved ?? entry.resolved_at),
    );
  }
  const token = entryToken(entry);
  if (!token) return labels.holdMarker;
  // Resolve the raw lifecycle token through the bilingual map; the spaced form
  // (dots + underscores flattened) is a LAST-RESORT fallback for unmapped tokens.
  return labels.eventTypes[token] ?? token.replace(/[._]/g, ' ');
}

function entryDetail(entry: MatterTimelineEntry): string | undefined {
  const raw = entry.description ?? entry.detail ?? entry.notes ?? entry.reason ?? null;
  return raw && raw.trim() ? raw : undefined;
}

function entryIcon(entry: MatterTimelineEntry): LucideIcon {
  if (isHoldEntry(entry)) {
    return entryToken(entry).toLowerCase().includes('clear') ? PlayCircle : Gavel;
  }
  const token = entryToken(entry).toLowerCase();
  if (token.includes('status')) return Flag;
  if (token.includes('due') || token.includes('reminder')) return CalendarClock;
  if (token.includes('open') || token.includes('intake') || token.includes('create')) {
    return History;
  }
  return CircleDot;
}

function holdIsActive(hold: MatterExternalHoldState | null | undefined): boolean {
  if (!hold) return false;
  return Boolean(hold.active ?? hold.on_hold);
}

function holdCategory(
  hold: MatterExternalHoldState | null | undefined,
  labels: MatterTimelineLabels,
): string | undefined {
  return categoryLabel(labels, hold?.category);
}

function holdHolder(hold: MatterExternalHoldState | null | undefined): string | undefined {
  const raw = hold?.holder ?? hold?.party ?? null;
  return raw && raw.trim() ? raw : undefined;
}

function holdResumeDate(hold: MatterExternalHoldState | null | undefined): string | undefined {
  const raw = hold?.expected_resume_date ?? hold?.resume_date ?? null;
  return raw && raw.trim() ? raw : undefined;
}

function toDateInputValue(value?: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toISOString().slice(0, 10);
}

function toOptionalDateTime(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`).toISOString();
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface MatterCaseTimelineProps {
  matterId: string;
  canWrite: boolean;
}

export function MatterCaseTimeline({ matterId, canWrite }: MatterCaseTimelineProps) {
  const labels = useMatterTimelineLabels();
  const queryClient = useQueryClient();
  const [holdDialogOpen, setHoldDialogOpen] = useState(false);

  const timelineSupported = typeof lexTimelineApi.getMatterTimeline === 'function';

  const timelineQuery = useQuery({
    queryKey: ['lex-matter-timeline', matterId],
    queryFn: () => lexTimelineApi.getMatterTimeline!(matterId),
    enabled: Boolean(matterId) && timelineSupported,
  });

  const payload = timelineQuery.data;
  const entries = useMemo<MatterTimelineEntry[]>(() => timelineEntries(payload), [payload]);
  const hold = useMemo(() => normalizeHold(payload), [payload]);
  const onHold = holdIsActive(hold);

  const timelineItems = useMemo(
    () =>
      entries.map((entry, idx) => {
        const ts = entryTimestamp(entry);
        const actor = (entry.actor_name ?? '').toString().trim();
        const detail = entryDetail(entry);
        const isHold = isHoldEntry(entry);
        const descriptionParts = [detail, actor ? labels.byActor(actor) : undefined].filter(
          Boolean,
        ) as string[];
        return {
          id: entry.id ?? `${entryToken(entry) || 'event'}-${idx}`,
          icon: entryIcon(entry),
          title: entryTitle(entry, labels),
          description: descriptionParts.length ? descriptionParts.join(' · ') : undefined,
          timestamp: ts ? formatDateTime(ts) : undefined,
          variant: isHold ? ('warning' as const) : ('default' as const),
          isHold,
        };
      }),
    [entries, labels],
  );

  const setHoldMutation = useMutation({
    mutationFn: (body: SetMatterExternalHoldPayload) =>
      Promise.resolve(lexTimelineApi.setMatterExternalHold!(matterId, body)),
    onSuccess: async (_result, variables) => {
      showSuccess(variables.held ? labels.toast.holdSet : labels.toast.holdCleared);
      setHoldDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-matter-timeline', matterId] }),
        queryClient.invalidateQueries({ queryKey: ['lex-matters'] }),
      ]);
    },
    onError: showApiError,
  });

  const holdActionsEnabled =
    canWrite && timelineSupported && typeof lexTimelineApi.setMatterExternalHold === 'function';

  const sectionActions = holdActionsEnabled ? (
    <Button
      size="sm"
      variant={onHold ? 'outline' : 'default'}
      onClick={() => setHoldDialogOpen(true)}
      disabled={setHoldMutation.isPending}
    >
      {onHold ? (
        <PlayCircle className="me-1.5 h-3.5 w-3.5" aria-hidden />
      ) : (
        <PauseCircle className="me-1.5 h-3.5 w-3.5" aria-hidden />
      )}
      {onHold ? labels.clearHold : labels.setHold}
    </Button>
  ) : undefined;

  return (
    <SectionCard title={labels.title} description={labels.description} actions={sectionActions}>
      {!timelineSupported ? (
        <EmptyState
          icon={History}
          title={labels.unavailableTitle}
          description={labels.unavailableDescription}
          size="compact"
        />
      ) : (
        <div className="space-y-5">
          <HoldBanner hold={hold} onHold={onHold} labels={labels} />

          {timelineQuery.isLoading ? (
            <LoadingSkeleton variant="list-item" count={4} />
          ) : timelineQuery.isError ? (
            <ErrorState
              message={labels.loadError}
              onRetry={() => void timelineQuery.refetch()}
            />
          ) : timelineItems.length === 0 ? (
            <EmptyState
              icon={History}
              title={labels.emptyTitle}
              description={labels.emptyDescription}
              size="compact"
            />
          ) : (
            <Timeline items={timelineItems} />
          )}
        </div>
      )}

      {holdActionsEnabled ? (
        <ExternalHoldDialog
          open={holdDialogOpen}
          onOpenChange={setHoldDialogOpen}
          hold={hold}
          onHold={onHold}
          loading={setHoldMutation.isPending}
          labels={labels}
          onSubmit={(body) => setHoldMutation.mutate(body)}
        />
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Prominent external-hold banner.
 * ------------------------------------------------------------------------- */

function HoldBanner({
  hold,
  onHold,
  labels,
}: {
  hold: MatterExternalHoldState | null | undefined;
  onHold: boolean;
  labels: MatterTimelineLabels;
}) {
  if (!onHold) {
    return (
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3 ps-5">
        <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">{labels.hold.notOnHold}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{labels.hold.notOnHoldDescription}</p>
        </div>
      </div>
    );
  }

  const reason = hold?.reason && hold.reason.trim() ? hold.reason : labels.hold.noReason;
  const category = holdCategory(hold, labels) ?? labels.hold.noCategory;
  const holder = holdHolder(hold) ?? labels.hold.noHolder;
  const resume = holdResumeDate(hold);
  const setAt =
    hold?.set_at && hold.set_at.trim()
      ? hold.set_at
      : hold?.since && hold.since.trim()
        ? hold.since
        : undefined;

  return (
    <div className="relative overflow-hidden rounded-lg border border-warning-300/70 bg-warning-50 px-4 py-3 ps-5 dark:border-warning-500/40 dark:bg-warning-800/15">
      <span className="absolute inset-y-0 start-0 w-1 bg-warning-300/80" aria-hidden />
      <div className="flex items-start gap-3">
        <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-warning-700 dark:text-warning-300">
              {labels.hold.onHoldTitle}
            </p>
            <Badge variant="warning">{labels.holdMarker}</Badge>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <HoldFact label={labels.hold.category} value={category} />
            {hold?.reason ? <HoldFact label={labels.hold.reason} value={reason} /> : null}
            {holdHolder(hold) ? <HoldFact label={labels.hold.holder} value={holder} /> : null}
            {resume ? <HoldFact label={labels.hold.expectedResume} value={formatDate(resume)} /> : null}
            {setAt ? <HoldFact label={labels.hold.since} value={formatDate(setAt)} /> : null}
          </dl>
        </div>
      </div>
    </div>
  );
}

function HoldFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      {label ? (
        <dt className="text-xs text-warning-700/80 dark:text-warning-300/70">{label}</dt>
      ) : null}
      <dd className="text-sm text-warning-700 dark:text-warning-300">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Set / clear external-hold dialog.
 * ------------------------------------------------------------------------- */

function ExternalHoldDialog({
  open,
  onOpenChange,
  hold,
  onHold,
  loading,
  labels,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hold: MatterExternalHoldState | null | undefined;
  onHold: boolean;
  loading: boolean;
  labels: MatterTimelineLabels;
  onSubmit: (payload: SetMatterExternalHoldPayload) => void;
}) {
  const clearing = onHold;
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<DelayCategory>('court');
  const [sinceDate, setSinceDate] = useState('');

  // Reset fields whenever the dialog opens, seeding from the current hold so a
  // set-from-existing edit keeps prior context.
  useEffect(() => {
    if (open) {
      setReason(hold?.reason ?? '');
      setCategory((hold?.category as DelayCategory | undefined) ?? 'court');
      setSinceDate(toDateInputValue(hold?.since ?? hold?.set_at));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = () => {
    const trimmedReason = reason.trim();
    if (clearing) {
      onSubmit({ held: false, reason: trimmedReason || undefined });
      return;
    }
    onSubmit({
      held: true,
      category,
      reason: trimmedReason || undefined,
      since: toOptionalDateTime(sinceDate),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{clearing ? labels.dialog.clearTitle : labels.dialog.setTitle}</DialogTitle>
          <DialogDescription>
            {clearing ? labels.dialog.clearDescription : labels.dialog.setDescription}
          </DialogDescription>
        </DialogHeader>

        {clearing ? null : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="matter-hold-category">{labels.dialog.category}</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as DelayCategory)}>
                <SelectTrigger id="matter-hold-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELAY_CATEGORY_VALUES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {labels.categoryOptions[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="matter-hold-reason">{labels.dialog.reason}</Label>
              <Textarea
                id="matter-hold-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={labels.dialog.reasonPlaceholder}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="matter-hold-since">{labels.dialog.since}</Label>
              <Input
                id="matter-hold-since"
                type="date"
                value={sinceDate}
                onChange={(event) => setSinceDate(event.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.dialog.cancel}
          </Button>
          <Button type="button" disabled={loading} onClick={submit}>
            {clearing ? labels.dialog.clearSubmit : labels.dialog.setSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
