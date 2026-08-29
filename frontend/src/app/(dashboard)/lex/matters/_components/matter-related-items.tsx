'use client';

/**
 * MatterRelatedItems — FEATURE 9 of the Matters detail surface.
 *
 * Renders the cross-domain "related items" graph for a legal matter (قضية):
 * the generic `matter_links` edges that connect this matter to a sibling lex
 * entity (consultation / investigation / legal case / settlement / litigation /
 * contract). Links are grouped by `target_type` and each row deep-links to that
 * domain's detail route. With write access the viewer can add a new related
 * link (choose target type + target id, optional relationship) and unlink an
 * existing one.
 *
 * Each link renders on the canonical {@link ListRow} primitive with a leading
 * {@link IconBadge} (tone per target domain) and trailing relationship badge +
 * open/unlink actions. Because the related endpoint returns a flat (cursor-less)
 * array, every per-type group degrades gracefully to an append-mode reveal
 * (sentinel + "Show more", see RELATED_PAGE_SIZE) over its already-fetched
 * links rather than reloading the page.
 *
 * BACKEND CONTRACT (FEATURE 9):
 *   GET    /matters/{id}/related            -> { data: MatterLink[] }
 *   POST   /matters/{id}/related            -> { data: MatterLink }  (201)
 *   DELETE /matters/{id}/related/{linkId}   -> 204
 *   MatterLink = { id, tenant_id, matter_id, target_type, target_id,
 *                  relationship, created_by, created_at,
 *                  target_reference?, target_title? }
 *   target_reference / target_title are OPTIONAL and currently always omitted —
 *   so this surface falls back to the raw target_id for display.
 *
 * The enterprise lex client provides the related-item methods:
 *   - enterpriseApi.lex.listMatterRelated(matterId)         -> MatterLink[]
 *   - enterpriseApi.lex.addMatterRelated(matterId, payload) -> MatterLink
 *   - enterpriseApi.lex.removeMatterRelated(matterId, linkId)
 * This module keeps a narrow runtime-guarded accessor so older mocked/test
 * clients that provide only a subset of `enterpriseApi.lex` still render an
 * unavailable state instead of throwing.
 *
 * Follows the canonical lex bilingual contract (../../_lib/lex-i18n.ts): a
 * self-contained `LexBilingual<MatterRelatedLabels>` bundle (full EN + MSA) read
 * via the local {@link useMatterRelatedLabels} hook. RTL-correct logical Tailwind
 * props (ms-/me-/ps-/pe-/start-/end-).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink,
  FileText,
  Gavel,
  Handshake,
  Link2,
  Loader2,
  type LucideIcon,
  MessageSquareText,
  Plus,
  Scale,
  Search,
  Unlink,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { IconBadge, type IconBadgeProps } from '@/components/shared/icon-badge';
import { ListRow } from '@/components/shared/list-row';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { LexRecordPicker, type LexRecordKind } from '@/components/lex/lex-record-picker';
import { RelativeTime } from '@/components/shared/relative-time';
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
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Target-type domain table.
 *
 * The six enum values the backend accepts, each mapped to its detail-route base
 * and an icon. `legal_case` and `litigation` both resolve to the `/lex/cases`
 * litigation case-management route (the `cases` module IS litigation case mgmt).
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- *
 * Append-mode "load more" page size.
 *
 * `GET /matters/{id}/related` returns a FLAT array (no cursor / total_pages),
 * so the canonical `useInfiniteScroll` hook — built around a
 * `fetchFn(page) => PaginatedResponse<T>` with `meta.total_pages` — does not
 * apply. Per the FEATURE 10 contract each per-type group degrades gracefully to
 * a sentinel-driven append reveal over its already-fetched links: it renders
 * the first `RELATED_PAGE_SIZE` rows and grows the visible window in page-sized
 * steps as the group's sentinel scrolls into view (or via "Show more"). The
 * single-fetch data flow is unchanged.
 * ------------------------------------------------------------------------- */
const RELATED_PAGE_SIZE = 6;

export const MATTER_RELATED_TARGET_TYPES = [
  'consultation',
  'investigation',
  'legal_case',
  'settlement',
  'litigation',
  'contract',
] as const;

export type MatterRelatedTargetType = (typeof MATTER_RELATED_TARGET_TYPES)[number];

const TARGET_ROUTE_BASE: Record<MatterRelatedTargetType, string> = {
  consultation: '/lex/consultations',
  investigation: '/lex/investigations',
  legal_case: '/lex/cases',
  settlement: '/lex/settlements',
  litigation: '/lex/cases',
  contract: '/lex/contracts',
};

const TARGET_ICON: Record<MatterRelatedTargetType, LucideIcon> = {
  consultation: MessageSquareText,
  investigation: Search,
  legal_case: Gavel,
  settlement: Handshake,
  litigation: Scale,
  contract: FileText,
};

type IconBadgeTone = NonNullable<IconBadgeProps['tone']>;

const TARGET_TONE: Record<MatterRelatedTargetType, IconBadgeTone> = {
  consultation: 'info',
  investigation: 'warning',
  legal_case: 'primary',
  settlement: 'success',
  litigation: 'danger',
  contract: 'primary',
};

/* ------------------------------------------------------------------------- *
 * Defensive backend-shape mirror + narrow client accessor.
 * ------------------------------------------------------------------------- */

/** A single cross-domain related-item edge (matter_links row). */
export interface MatterRelatedLink {
  id: string;
  tenant_id?: string;
  matter_id?: string;
  target_type: MatterRelatedTargetType | string;
  target_id: string;
  relationship?: string | null;
  created_by?: string;
  created_at?: string | null;
  /** OPTIONAL enrichment — currently always omitted by the backend. */
  target_reference?: string | null;
  target_title?: string | null;
  [key: string]: unknown;
}

/** Request body for POST /matters/{id}/related. */
export interface AddMatterRelatedPayload {
  target_type: MatterRelatedTargetType | string;
  target_id: string;
  relationship?: string;
}

/**
 * Narrow accessor over the lex client. Declared with optional members so callers
 * guard for presence at runtime and detail tests that mock only a subset of
 * `enterpriseApi.lex` never throw.
 */
interface LexRelatedMethods {
  listMatterRelated?: (matterId: string) => Promise<MatterRelatedLink[] | { data?: MatterRelatedLink[] }>;
  addMatterRelated?: (
    matterId: string,
    payload: AddMatterRelatedPayload,
  ) => Promise<MatterRelatedLink | { data?: MatterRelatedLink } | unknown>;
  removeMatterRelated?: (matterId: string, linkId: string) => Promise<void | unknown>;
}

const lexRelatedApi = enterpriseApi.lex as unknown as LexRelatedMethods;

/** Unwraps either a bare array or a `{ data: [...] }` envelope into MatterRelatedLink[]. */
function unwrapLinks(
  result: MatterRelatedLink[] | { data?: MatterRelatedLink[] } | null | undefined,
): MatterRelatedLink[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.data)) return result.data;
  return [];
}

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained, full EN + MSA).
 * ------------------------------------------------------------------------- */

interface MatterRelatedLabels {
  title: string;
  description: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  unavailableTitle: string;
  unavailableDescription: string;
  addLink: string;
  open: string;
  unlink: string;
  linkedOn: string;
  relationship: string;
  noRelationship: string;
  showMore: string;
  showingCount: (shown: number, total: number) => string;
  /** Group heading label per target type, e.g. "Consultations". */
  groupTitles: Record<MatterRelatedTargetType, string>;
  /** Singular label per target type, used in the add dialog + confirm copy. */
  typeLabels: Record<MatterRelatedTargetType, string>;
  countSuffix: (count: number) => string;
  dialog: {
    title: string;
    description: string;
    targetType: string;
    targetTypePlaceholder: string;
    targetId: string;
    targetIdPlaceholder: string;
    targetIdHint: string;
    relationship: string;
    relationshipPlaceholder: string;
    cancel: string;
    submit: string;
  };
  confirm: {
    title: string;
    description: (label: string) => string;
    confirm: string;
  };
  toast: {
    added: string;
    removed: string;
  };
}

const matterRelatedLabelsBundle: LexBilingual<MatterRelatedLabels> = {
  en: {
    title: 'Related Items',
    description:
      'Cross-domain links connecting this matter to consultations, investigations, cases, settlements, litigation, and contracts.',
    loadError: 'Failed to load related items.',
    emptyTitle: 'No related items',
    emptyDescription: 'Link this matter to related lex records to build its cross-domain graph.',
    unavailableTitle: 'Related items unavailable',
    unavailableDescription: 'The related-items service is not available in this environment.',
    addLink: 'Add link',
    open: 'Open',
    unlink: 'Unlink',
    linkedOn: 'Linked',
    relationship: 'Relationship',
    noRelationship: 'Related',
    showMore: 'Show more',
    showingCount: (shown, total) => `Showing ${shown} of ${total}`,
    groupTitles: {
      consultation: 'Consultations',
      investigation: 'Investigations',
      legal_case: 'Legal cases',
      settlement: 'Settlements',
      litigation: 'Litigation',
      contract: 'Contracts',
    },
    typeLabels: {
      consultation: 'Consultation',
      investigation: 'Investigation',
      legal_case: 'Legal case',
      settlement: 'Settlement',
      litigation: 'Litigation',
      contract: 'Contract',
    },
    countSuffix: (count) => `${count} linked`,
    dialog: {
      title: 'Add related item',
      description: 'Link this matter to a sibling lex record from another domain.',
      targetType: 'Item type',
      targetTypePlaceholder: 'Select item type',
      targetId: 'Item',
      targetIdPlaceholder: 'Select a record',
      targetIdHint: 'Search by title or reference number.',
      relationship: 'Relationship (optional)',
      relationshipPlaceholder: 'e.g. related, parent, derived-from',
      cancel: 'Cancel',
      submit: 'Add link',
    },
    confirm: {
      title: 'Unlink related item',
      description: (label) => `Remove the link to this ${label}? The target record itself is not deleted.`,
      confirm: 'Unlink',
    },
    toast: {
      added: 'Related item linked.',
      removed: 'Related item unlinked.',
    },
  },
  ar: {
    title: 'العناصر المرتبطة',
    description:
      'روابط متعدّدة المجالات تربط هذه القضية بالاستشارات والتحقيقات والقضايا والتسويات والتقاضي والعقود.',
    loadError: 'تعذّر تحميل العناصر المرتبطة.',
    emptyTitle: 'لا توجد عناصر مرتبطة',
    emptyDescription: 'اربط هذه القضية بسجلات قانونية ذات صلة لبناء رسمها متعدّد المجالات.',
    unavailableTitle: 'العناصر المرتبطة غير متاحة',
    unavailableDescription: 'خدمة العناصر المرتبطة غير متاحة في هذه البيئة.',
    addLink: 'إضافة رابط',
    open: 'فتح',
    unlink: 'فك الربط',
    linkedOn: 'رُبط',
    relationship: 'العلاقة',
    noRelationship: 'ذو صلة',
    showMore: 'عرض المزيد',
    showingCount: (shown, total) => `عرض ${shown} من ${total}`,
    groupTitles: {
      consultation: 'الاستشارات',
      investigation: 'التحقيقات',
      legal_case: 'القضايا القانونية',
      settlement: 'التسويات',
      litigation: 'التقاضي',
      contract: 'العقود',
    },
    typeLabels: {
      consultation: 'استشارة',
      investigation: 'تحقيق',
      legal_case: 'قضية قانونية',
      settlement: 'تسوية',
      litigation: 'دعوى',
      contract: 'عقد',
    },
    countSuffix: (count) => `${count} مرتبط`,
    dialog: {
      title: 'إضافة عنصر مرتبط',
      description: 'اربط هذه القضية بسجل قانوني شقيق من مجال آخر.',
      targetType: 'نوع العنصر',
      targetTypePlaceholder: 'اختر نوع العنصر',
      targetId: 'العنصر',
      targetIdPlaceholder: 'اختر سجلاً',
      targetIdHint: 'ابحث بالعنوان أو الرقم المرجعي.',
      relationship: 'العلاقة (اختياري)',
      relationshipPlaceholder: 'مثال: ذو صلة، أصل، مشتق من',
      cancel: 'إلغاء',
      submit: 'إضافة رابط',
    },
    confirm: {
      title: 'فك ربط العنصر المرتبط',
      description: (label) => `هل تريد إزالة الرابط بهذا الـ${label}؟ لن يُحذف السجل المستهدف نفسه.`,
      confirm: 'فك الربط',
    },
    toast: {
      added: 'تم ربط العنصر المرتبط.',
      removed: 'تم فك ربط العنصر المرتبط.',
    },
  },
};

function resolveMatterRelatedLabels(locale: AppLocale = 'en'): MatterRelatedLabels {
  return resolveLexBilingual(matterRelatedLabelsBundle, locale);
}

function useMatterRelatedLabels(): MatterRelatedLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveMatterRelatedLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Helpers.
 * ------------------------------------------------------------------------- */

function isKnownTargetType(value: string): value is MatterRelatedTargetType {
  return (MATTER_RELATED_TARGET_TYPES as readonly string[]).includes(value);
}

/** Best-effort display title for a link (enrichment → reference → raw id). */
function linkDisplay(link: MatterRelatedLink): string {
  const title = link.target_title?.trim();
  if (title) return title;
  const reference = link.target_reference?.trim();
  if (reference) return reference;
  return link.target_id;
}

/** Deep-link href for a link; null when the target type is unknown/unroutable. */
function linkHref(link: MatterRelatedLink): string | null {
  const type = String(link.target_type);
  if (!isKnownTargetType(type)) return null;
  return `${TARGET_ROUTE_BASE[type]}/${link.target_id}`;
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface MatterRelatedItemsProps {
  matterId: string;
  canWrite: boolean;
}

export function MatterRelatedItems({ matterId, canWrite }: MatterRelatedItemsProps) {
  const { locale, direction } = useLocaleOrDefault();
  const labels = useMatterRelatedLabels();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [targetType, setTargetType] = useState<MatterRelatedTargetType>(MATTER_RELATED_TARGET_TYPES[0]);
  const [targetId, setTargetId] = useState('');
  const [relationship, setRelationship] = useState('');
  const [unlinkTarget, setUnlinkTarget] = useState<MatterRelatedLink | null>(null);

  const supportsList = typeof lexRelatedApi.listMatterRelated === 'function';
  const supportsAdd = typeof lexRelatedApi.addMatterRelated === 'function';
  const supportsRemove = typeof lexRelatedApi.removeMatterRelated === 'function';

  const relatedQuery = useQuery({
    queryKey: ['lex-matter-related', matterId],
    queryFn: async () => {
      const result = await lexRelatedApi.listMatterRelated!(matterId);
      return unwrapLinks(result);
    },
    enabled: Boolean(matterId) && supportsList,
  });

  useEffect(() => {
    if (!addOpen) {
      return;
    }
    setTargetType(MATTER_RELATED_TARGET_TYPES[0]);
    setTargetId('');
    setRelationship('');
  }, [addOpen]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['lex-matter-related', matterId] });

  const addMutation = useMutation({
    mutationFn: (payload: AddMatterRelatedPayload) => lexRelatedApi.addMatterRelated!(matterId, payload),
    onSuccess: async () => {
      showSuccess(labels.toast.added);
      setAddOpen(false);
      await invalidate();
    },
    onError: showApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (linkId: string) => lexRelatedApi.removeMatterRelated!(matterId, linkId),
    onSuccess: async () => {
      showSuccess(labels.toast.removed);
      setUnlinkTarget(null);
      await invalidate();
    },
    onError: showApiError,
  });

  const links = useMemo(() => relatedQuery.data ?? [], [relatedQuery.data]);

  // Group links by target_type, preserving the canonical domain order. Unknown
  // target types fall into an "other" bucket rendered after the known groups.
  const groups = useMemo(() => {
    const known = MATTER_RELATED_TARGET_TYPES.map((type) => ({
      type,
      items: links.filter((link) => String(link.target_type) === type),
    })).filter((group) => group.items.length > 0);
    const other = links.filter((link) => !isKnownTargetType(String(link.target_type)));
    return { known, other };
  }, [links]);

  const writeEnabled = canWrite && supportsAdd;

  const headerActions = writeEnabled ? (
    <Button size="sm" onClick={() => setAddOpen(true)}>
      <Plus className="me-1.5 h-3.5 w-3.5" />
      {labels.addLink}
    </Button>
  ) : undefined;

  const renderBody = () => {
    if (!supportsList) {
      return (
        <EmptyState
          icon={Link2}
          size="compact"
          title={labels.unavailableTitle}
          description={labels.unavailableDescription}
        />
      );
    }
    if (relatedQuery.isLoading) {
      return <LoadingSkeleton variant="list-item" count={3} />;
    }
    if (relatedQuery.isError) {
      return <ErrorState message={labels.loadError} onRetry={() => void relatedQuery.refetch()} />;
    }
    if (links.length === 0) {
      return (
        <EmptyState
          icon={Link2}
          size="compact"
          title={labels.emptyTitle}
          description={labels.emptyDescription}
        />
      );
    }

    return (
      <div className="space-y-6">
        {groups.known.map((group) => (
          <RelatedGroup
            key={group.type}
            heading={labels.groupTitles[group.type]}
            items={group.items}
            icon={TARGET_ICON[group.type]}
            tone={TARGET_TONE[group.type]}
            labels={labels}
            canRemove={canWrite && supportsRemove}
            onUnlink={setUnlinkTarget}
            removing={removeMutation.isPending}
          />
        ))}
        {groups.other.length > 0 ? (
          <RelatedGroup
            heading={labels.title}
            items={groups.other}
            icon={Link2}
            tone="muted"
            labels={labels}
            canRemove={canWrite && supportsRemove}
            onUnlink={setUnlinkTarget}
            removing={removeMutation.isPending}
          />
        ) : null}
      </div>
    );
  };

  return (
    <SectionCard title={labels.title} description={labels.description} actions={headerActions}>
      <div dir={direction} lang={locale}>
        {renderBody()}
      </div>

      {writeEnabled ? (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" dir={direction} lang={locale}>
            <DialogHeader>
              <DialogTitle>{labels.dialog.title}</DialogTitle>
              <DialogDescription>{labels.dialog.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="matter-related-type">{labels.dialog.targetType}</Label>
                <Select
                  value={targetType}
                  onValueChange={(value) => {
                    setTargetType(value as MatterRelatedTargetType);
                    setTargetId('');
                  }}
                >
                  <SelectTrigger id="matter-related-type">
                    <SelectValue placeholder={labels.dialog.targetTypePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {MATTER_RELATED_TARGET_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {labels.typeLabels[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="matter-related-target-id">{labels.dialog.targetId}</Label>
                <LexRecordPicker
                  id="matter-related-target-id"
                  kind={(targetType === 'legal_case' || targetType === 'litigation' ? 'case' : targetType) as LexRecordKind}
                  ariaLabel={labels.dialog.targetId}
                  value={targetId}
                  onChange={setTargetId}
                  enabled={addOpen}
                  labels={{
                    select: labels.dialog.targetIdPlaceholder,
                    search: labels.dialog.targetIdHint,
                  }}
                />
                <p className="text-xs text-muted-foreground">{labels.dialog.targetIdHint}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="matter-related-relationship">{labels.dialog.relationship}</Label>
                <Input
                  id="matter-related-relationship"
                  value={relationship}
                  onChange={(event) => setRelationship(event.target.value)}
                  placeholder={labels.dialog.relationshipPlaceholder}
                  autoComplete="off"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                {labels.dialog.cancel}
              </Button>
              <Button
                type="button"
                disabled={!targetId.trim() || addMutation.isPending}
                onClick={() => {
                  const trimmedId = targetId.trim();
                  if (!trimmedId) {
                    return;
                  }
                  const trimmedRel = relationship.trim();
                  addMutation.mutate({
                    target_type: targetType,
                    target_id: trimmedId,
                    ...(trimmedRel ? { relationship: trimmedRel } : {}),
                  });
                }}
              >
                {addMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {labels.dialog.submit}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canWrite && supportsRemove ? (
        <ConfirmDialog
          open={Boolean(unlinkTarget)}
          onOpenChange={(open) => {
            if (!open) setUnlinkTarget(null);
          }}
          title={labels.confirm.title}
          description={labels.confirm.description(
            unlinkTarget
              ? isKnownTargetType(String(unlinkTarget.target_type))
                ? labels.typeLabels[unlinkTarget.target_type as MatterRelatedTargetType]
                : labels.typeLabels.legal_case
              : '',
          )}
          confirmLabel={labels.confirm.confirm}
          variant="destructive"
          loading={removeMutation.isPending}
          onConfirm={() => {
            if (unlinkTarget) {
              removeMutation.mutate(unlinkTarget.id);
            }
          }}
        />
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Sub-components.
 * ------------------------------------------------------------------------- */

function RelatedGroup({
  heading,
  items,
  icon: Icon,
  tone,
  labels,
  canRemove,
  onUnlink,
  removing,
}: {
  heading: string;
  items: MatterRelatedLink[];
  icon: LucideIcon;
  tone: IconBadgeTone;
  labels: MatterRelatedLabels;
  canRemove: boolean;
  onUnlink: (link: MatterRelatedLink) => void;
  removing: boolean;
}) {
  // Append-mode reveal window over this group's already-fetched links (see
  // RELATED_PAGE_SIZE). Grows in page-sized steps via the sentinel /
  // "Show more" button; resets whenever the group's links change.
  const [visibleCount, setVisibleCount] = useState(RELATED_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(RELATED_PAGE_SIZE);
  }, [items]);

  const total = items.length;
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = visibleCount < total;

  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!sentinel || !hasMore) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed[0]?.isIntersecting) {
          setVisibleCount((count) => Math.min(count + RELATED_PAGE_SIZE, total));
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, total]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">{heading}</h3>
        <Badge variant="outline">{labels.countSuffix(total)}</Badge>
      </div>
      <ul className="space-y-2">
        {visibleItems.map((link) => (
          <RelatedRow
            key={link.id}
            link={link}
            icon={Icon}
            tone={tone}
            labels={labels}
            canRemove={canRemove}
            onUnlink={onUnlink}
            removing={removing}
          />
        ))}
      </ul>

      {hasMore ? (
        <div className="flex flex-col items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((count) => Math.min(count + RELATED_PAGE_SIZE, total))}
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
}

function RelatedRow({
  link,
  icon: Icon,
  tone,
  labels,
  canRemove,
  onUnlink,
  removing,
}: {
  link: MatterRelatedLink;
  icon: LucideIcon;
  tone: IconBadgeTone;
  labels: MatterRelatedLabels;
  canRemove: boolean;
  onUnlink: (link: MatterRelatedLink) => void;
  removing: boolean;
}) {
  const href = linkHref(link);
  const display = linkDisplay(link);
  const relationshipText = link.relationship?.trim() || labels.noRelationship;

  const subtitle = (
    <>
      {labels.relationship}: {relationshipText}
      {link.created_at ? (
        <>
          {' • '}
          {labels.linkedOn} <RelativeTime date={link.created_at} />
        </>
      ) : null}
    </>
  );

  const trailing = (
    <>
      <Badge variant="outline">{relationshipText}</Badge>
      {href ? (
        <Button asChild size="sm" variant="ghost">
          <Link href={href}>
            <ExternalLink className="me-1.5 h-3.5 w-3.5" />
            {labels.open}
          </Link>
        </Button>
      ) : null}
      {canRemove ? (
        <Button size="sm" variant="outline" onClick={() => onUnlink(link)} disabled={removing}>
          <Unlink className="me-1.5 h-3.5 w-3.5" />
          {labels.unlink}
        </Button>
      ) : null}
    </>
  );

  const titleNode = href ? (
    <Link href={href} className="hover:underline">
      {display}
    </Link>
  ) : (
    display
  );

  return (
    <li>
      <ListRow
        leading={<IconBadge icon={Icon} tone={tone} size="sm" />}
        title={titleNode}
        subtitle={subtitle}
        trailing={trailing}
      />
    </li>
  );
}
