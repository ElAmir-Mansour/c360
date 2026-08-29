'use client';

/**
 * MatterActivityFeed — FEATURE 7 of the Matters detail surface.
 *
 * Renders the chronological audit / activity feed of a legal matter (قضية):
 * who did what, the status transition it produced (from → to), and the relative
 * time, told as one human-readable story through the shared
 * {@link LexActivityTimeline} (day-grouped, actor avatars, tone-colored rail,
 * Hijri + Arabic-Indic relative time in Arabic mode).
 * The flat (cursor-less) audit array is revealed in append-mode page-sized
 * windows via a sentinel + "Show more" control (see ACTIVITY_PAGE_SIZE). Each
 * entry maps to the backend `GET /matters/{id}/audit` shape
 * (`{ id, tenant_id, matter_id, action, from_status, to_status, detail,
 * actor_user_id, created_at }`, identical to SettlementAuditEntry /
 * LegalCaseAuditEntry), ordered created_at ASC.
 *
 * IMPORTANT: the backend reports that matters do not yet EMIT audit events, so
 * the array is expected to be empty today. The component renders a friendly
 * "no recorded activity yet" empty state in that case, and keeps working
 * unchanged once entries start landing.
 *
 * The enterprise lex client exposes `listMatterAudit`; this module keeps a
 * defensive local mirror of the entry shape and a narrow runtime-guarded
 * accessor so older mocked/test clients that provide only a subset of
 * `enterpriseApi.lex` still render an unavailable state instead of throwing.
 *
 * Follows the canonical lex bilingual contract (../../_lib/lex-i18n.ts): a
 * self-contained `LexBilingual<MatterActivityLabels>` bundle (full EN + MSA)
 * resolved via the local {@link useMatterActivityLabels} hook. RTL-correct
 * logical Tailwind props (me-/ms-/ps-/start-). Legal glossary: قضية / إجراء /
 * الحالة / سجل النشاط.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import {
  LexActivityTimeline,
  type LexActivityEvent,
  type LexActivityTone,
} from '@/components/lex/activity-timeline';
import { SectionCard } from '@/components/suites/section-card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { enterpriseApi } from '@/lib/enterprise';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Append-mode "load more" page size.
 *
 * `GET /matters/{id}/audit` returns a FLAT array (no cursor / total_pages), so
 * the canonical `useInfiniteScroll` hook — which is built around a
 * `fetchFn(page) => PaginatedResponse<T>` with `meta.total_pages` — does not
 * apply here. Per the FEATURE 10 contract we instead degrade gracefully to a
 * sentinel-driven append reveal over the already-fetched array: we render the
 * first `ACTIVITY_PAGE_SIZE` rows and grow the visible window in page-sized
 * steps as the sentinel scrolls into view (or via the explicit "Show more"
 * button). This keeps the existing single-fetch behaviour intact.
 * ------------------------------------------------------------------------- */
const ACTIVITY_PAGE_SIZE = 8;

/* ------------------------------------------------------------------------- *
 * Defensive backend-shape mirror.
 *
 * Mirrors `GET /matters/{id}/audit` data[] entries (== SettlementAuditEntry /
 * LegalCaseAuditEntry). Every field is optional and read through fallbacks so
 * `[key: string]: unknown` keeps forward-compat with extra fields.
 * ------------------------------------------------------------------------- */

export interface MatterAuditEntry {
  id?: string;
  tenant_id?: string;
  matter_id?: string;
  /** Stable action token (e.g. `created`, `status_changed`, `triaged`). */
  action?: string | null;
  /** Status transition this entry produced; omitted when null. */
  from_status?: string | null;
  to_status?: string | null;
  /** Structured detail object (always present server-side; defaults to {}). */
  detail?: Record<string, unknown> | null;
  /** Actor that produced the entry. */
  actor_user_id?: string | null;
  actor_name?: string | null;
  /** ISO timestamp of the entry. */
  created_at?: string | null;
  [key: string]: unknown;
}

/**
 * Narrow accessor over the lex client. Declared optional so the component guards
 * for presence at runtime (mirrors {@link MatterCaseTimeline}).
 *
 * Tolerates either the agreed `{ data: MatterAuditEntry[] }` envelope or a bare
 * array, normalised by {@link extractEntries}.
 */
interface LexAuditMethods {
  listMatterAudit?: (
    matterId: string,
  ) => Promise<{ data?: MatterAuditEntry[] } | MatterAuditEntry[]>;
}

const lexAuditApi = enterpriseApi.lex as unknown as LexAuditMethods;

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained, full EN + MSA).
 * ------------------------------------------------------------------------- */

interface MatterActivityLabels {
  title: string;
  description: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  unavailableTitle: string;
  unavailableDescription: string;
  byActor: (actor: string) => string;
  unknownActor: string;
  statusTransition: (from: string, to: string) => string;
  statusSet: (to: string) => string;
  /** "Show more" reveal control + visible/total counter. */
  showMore: string;
  showingCount: (shown: number, total: number) => string;
  /** Action-token labels, keyed by raw backend token. */
  actions: Record<string, string>;
  /** Matter-status labels for the from→to transition line, keyed by raw token. */
  statuses: Record<string, string>;
}

const matterActivityLabelsBundle: LexBilingual<MatterActivityLabels> = {
  en: {
    title: 'Activity Feed',
    description: 'Chronological audit trail of changes and actions on this matter.',
    loadError: 'Failed to load the matter activity feed.',
    emptyTitle: 'No recorded activity yet',
    emptyDescription:
      'Audit entries appear here as the matter is created, triaged, and its status changes.',
    unavailableTitle: 'Activity feed unavailable',
    unavailableDescription: 'The matter activity service is not available in this environment.',
    byActor: (actor) => `by ${actor}`,
    unknownActor: 'System',
    statusTransition: (from, to) => `Status: ${from} → ${to}`,
    statusSet: (to) => `Status set to ${to}`,
    showMore: 'Show more',
    showingCount: (shown, total) => `Showing ${shown} of ${total}`,
    actions: {
      // Authoritative raw backend tokens (MatterService.appendAudit →
      // legal_matter_audit_log).
      'matter.created': 'Matter created',
      'matter.updated': 'Matter updated',
      'matter.status_changed': 'Status changed',
      'matter.triaged': 'Matter triaged',
      'matter.contract_linked': 'Contract linked',
      // Defensive unprefixed + not-yet-emitted aliases (forward-compat).
      created: 'Matter created',
      updated: 'Matter updated',
      deleted: 'Matter deleted',
      triaged: 'Matter triaged',
      status_changed: 'Status changed',
      contract_linked: 'Contract linked',
      contract_unlinked: 'Contract unlinked',
      'matter.contract_unlinked': 'Contract unlinked',
      document_linked: 'Document linked',
      'matter.document_linked': 'Document linked',
      document_unlinked: 'Document unlinked',
      'matter.document_unlinked': 'Document unlinked',
      comment_added: 'Comment added',
      'matter.comment_added': 'Comment added',
      'matter.deleted': 'Matter deleted',
      hold_set: 'External hold set',
      hold_cleared: 'External hold cleared',
    },
    statuses: {
      intake: 'Intake',
      open: 'Open',
      in_review: 'In Review',
      waiting_on_business: 'Waiting on Business',
      on_hold: 'On Hold',
      closed: 'Closed',
      cancelled: 'Cancelled',
    },
  },
  ar: {
    title: 'سجل النشاط',
    description: 'سجل التدقيق الزمني للتغييرات والإجراءات على هذه القضية.',
    loadError: 'تعذّر تحميل سجل نشاط القضية.',
    emptyTitle: 'لا يوجد نشاط مُسجَّل بعد',
    emptyDescription: 'تظهر سجلات التدقيق هنا عند إنشاء القضية وفرزها وتغيّر حالتها.',
    unavailableTitle: 'سجل النشاط غير متاح',
    unavailableDescription: 'خدمة نشاط القضية غير متاحة في هذه البيئة.',
    byActor: (actor) => `بواسطة ${actor}`,
    unknownActor: 'النظام',
    statusTransition: (from, to) => `الحالة: ${from} ← ${to}`,
    statusSet: (to) => `تعيين الحالة إلى ${to}`,
    showMore: 'عرض المزيد',
    showingCount: (shown, total) => `عرض ${shown} من ${total}`,
    actions: {
      // الرموز الخلفية الأصلية المعتمدة (MatterService.appendAudit →
      // legal_matter_audit_log).
      'matter.created': 'إنشاء القضية',
      'matter.updated': 'تحديث القضية',
      'matter.status_changed': 'تغيير الحالة',
      'matter.triaged': 'فرز القضية',
      'matter.contract_linked': 'ربط عقد',
      // مرادفات دفاعية بدون بادئة + رموز لم تُطلَق بعد (توافق مستقبلي).
      created: 'إنشاء القضية',
      updated: 'تحديث القضية',
      deleted: 'حذف القضية',
      triaged: 'فرز القضية',
      status_changed: 'تغيير الحالة',
      contract_linked: 'ربط عقد',
      contract_unlinked: 'إلغاء ربط عقد',
      'matter.contract_unlinked': 'إلغاء ربط عقد',
      document_linked: 'ربط مستند',
      'matter.document_linked': 'ربط مستند',
      document_unlinked: 'إلغاء ربط مستند',
      'matter.document_unlinked': 'إلغاء ربط مستند',
      comment_added: 'إضافة تعليق',
      'matter.comment_added': 'إضافة تعليق',
      'matter.deleted': 'حذف القضية',
      hold_set: 'فرض حجز خارجي',
      hold_cleared: 'رفع الحجز الخارجي',
    },
    statuses: {
      intake: 'استقبال',
      open: 'مفتوحة',
      in_review: 'قيد المراجعة',
      waiting_on_business: 'بانتظار جهة العمل',
      on_hold: 'معلّقة',
      closed: 'مغلقة',
      cancelled: 'ملغاة',
    },
  },
};

function resolveMatterActivityLabels(locale: AppLocale = 'en'): MatterActivityLabels {
  return resolveLexBilingual(matterActivityLabelsBundle, locale);
}

function useMatterActivityLabels(): MatterActivityLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveMatterActivityLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Shape-normalising helpers.
 * ------------------------------------------------------------------------- */

/**
 * Humanise a raw token (`status_changed` → `Status Changed`). LAST-RESORT only:
 * real action tokens resolve through the bilingual `actions` map; dots are
 * flattened too so an unmapped `matter.*` token never leaks its raw prefix form.
 */
function formatToken(token: string): string {
  return token
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

function extractEntries(
  payload: { data?: MatterAuditEntry[] } | MatterAuditEntry[] | undefined,
): MatterAuditEntry[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.data ?? [];
}

function actionToken(entry: MatterAuditEntry): string {
  return (entry.action ?? '').toString().trim();
}

function actionLabel(entry: MatterAuditEntry, labels: MatterActivityLabels): string {
  const token = actionToken(entry);
  if (!token) return labels.title;
  return labels.actions[token] ?? formatToken(token);
}

function trimmedString(value: string | null | undefined): string | undefined {
  const raw = (value ?? '').toString().trim();
  return raw ? raw : undefined;
}

function actorName(entry: MatterAuditEntry, labels: MatterActivityLabels): string {
  return trimmedString(entry.actor_name) ?? trimmedString(entry.actor_user_id) ?? labels.unknownActor;
}

/**
 * The action's object: the status transition this entry produced, rendered as the
 * emphasized "target" of the timeline's "<actor> <action> <target>" sentence.
 */
function entryTarget(entry: MatterAuditEntry, labels: MatterActivityLabels): string | undefined {
  const from = trimmedString(entry.from_status);
  const to = trimmedString(entry.to_status);
  // Resolve statuses through the bilingual map; prettify only as last-resort.
  const statusLabel = (status: string) => labels.statuses[status] ?? formatToken(status);
  if (from && to) {
    return labels.statusTransition(statusLabel(from), statusLabel(to));
  }
  if (to) {
    return labels.statusSet(statusLabel(to));
  }
  return undefined;
}

/** Free-text note from the structured `detail` blob, surfaced as the extra line. */
function entryNote(entry: MatterAuditEntry): string | undefined {
  const detail = entry.detail;
  if (!detail || typeof detail !== 'object') return undefined;
  return (
    trimmedString((detail.message as string | undefined) ?? null) ??
    trimmedString((detail.note as string | undefined) ?? null) ??
    trimmedString((detail.summary as string | undefined) ?? null)
  );
}

/** Timeline tone derived from the action token (destructive = danger). */
function entryTone(entry: MatterAuditEntry): LexActivityTone {
  const token = actionToken(entry).toLowerCase();
  if (token.includes('delete') || token.includes('remove') || token.includes('unlink')) {
    return 'danger';
  }
  if (token.includes('create') || token.includes('add') || token.includes('link')) {
    return 'success';
  }
  if (token.includes('status') || token.includes('triage')) {
    return 'info';
  }
  return 'neutral';
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface MatterActivityFeedProps {
  matterId: string;
}

export function MatterActivityFeed({ matterId }: MatterActivityFeedProps) {
  const { locale, direction } = useLocaleOrDefault();
  const labels = useMatterActivityLabels();

  const auditSupported = typeof lexAuditApi.listMatterAudit === 'function';

  const auditQuery = useQuery({
    queryKey: ['lex-matter-audit', matterId],
    queryFn: () => lexAuditApi.listMatterAudit!(matterId),
    enabled: Boolean(matterId) && auditSupported,
  });

  const entries = useMemo(() => extractEntries(auditQuery.data), [auditQuery.data]);

  // Normalise the flat audit array into the shared timeline's event shape so the
  // detail page tells one human-readable "<actor> <action> <target>" story,
  // grouped by day with avatars + localized relative time (Hijri + Arabic-Indic
  // in Arabic mode). Entries missing a timestamp are dropped (the timeline keys
  // its day grouping off `at`).
  const activityItems = useMemo<LexActivityEvent[]>(
    () =>
      entries.reduce<LexActivityEvent[]>((acc, entry, idx) => {
        const at = trimmedString(entry.created_at);
        if (!at) return acc;
        acc.push({
          id: entry.id ?? `${actionToken(entry) || 'activity'}-${idx}`,
          actor: { name: actorName(entry, labels) },
          action: actionLabel(entry, labels),
          target: entryTarget(entry, labels),
          at,
          tone: entryTone(entry),
          detail: entryNote(entry),
        });
        return acc;
      }, []),
    [entries, labels],
  );

  // Append-mode reveal window over the already-fetched array (see
  // ACTIVITY_PAGE_SIZE note). Grows in page-sized steps via the sentinel /
  // "Show more" button; resets whenever the underlying entry set changes.
  const [visibleCount, setVisibleCount] = useState(ACTIVITY_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(ACTIVITY_PAGE_SIZE);
  }, [activityItems]);

  const total = activityItems.length;
  const visibleItems = useMemo(
    () => activityItems.slice(0, visibleCount),
    [activityItems, visibleCount],
  );
  const hasMore = visibleCount < total;

  // Sentinel: auto-advance the reveal window when scrolled into view.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinel || !hasMore) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed[0]?.isIntersecting) {
          setVisibleCount((count) => Math.min(count + ACTIVITY_PAGE_SIZE, total));
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, total]);

  const renderBody = () => {
    if (!auditSupported) {
      return (
        <EmptyState
          icon={History}
          title={labels.unavailableTitle}
          description={labels.unavailableDescription}
          size="compact"
        />
      );
    }
    if (auditQuery.isLoading) {
      return <LoadingSkeleton variant="list-item" count={4} />;
    }
    if (auditQuery.isError) {
      return <ErrorState message={labels.loadError} onRetry={() => void auditQuery.refetch()} />;
    }
    if (total === 0) {
      return (
        <EmptyState
          icon={History}
          title={labels.emptyTitle}
          description={labels.emptyDescription}
          size="compact"
        />
      );
    }

    return (
      <div className="space-y-3" dir={direction} lang={locale}>
        <LexActivityTimeline events={visibleItems} emptyLabel={labels.emptyTitle} />

        {hasMore ? (
          <div className="flex flex-col items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVisibleCount((count) => Math.min(count + ACTIVITY_PAGE_SIZE, total))}
            >
              {labels.showMore}
            </Button>
            <span className="text-xs text-muted-foreground">
              {labels.showingCount(visibleItems.length, total)}
            </span>
            {/* Sentinel: intersecting reveals the next page automatically. */}
            <div ref={setSentinel} aria-hidden className="h-px w-full" />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <SectionCard title={labels.title} description={labels.description}>
      {renderBody()}
    </SectionCard>
  );
}
