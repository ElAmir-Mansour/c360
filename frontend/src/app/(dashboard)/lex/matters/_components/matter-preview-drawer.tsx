/**
 * MatterPreviewDrawer — Feature 3: quick-preview slide-over for the matters list
 * (`/lex/matters`).
 *
 * Clicking a list row opens this drawer, which lazily fetches the full matter
 * (`enterpriseApi.lex.getMatter`) and renders a condensed, read-only snapshot —
 * the SLA tier, status / priority / type badges, owner + requester, intake
 * dates, linked-contract chips, and a compact obligation summary — without
 * leaving the list. Header/footer links escalate to the full matter detail
 * console, and the footer exposes the same Triage / Change-status actions the
 * row context menu offers (wired by the integrator via `onTriage` /
 * `onChangeStatus`).
 *
 * Bilingual (EN + MSA) and RTL-aware: the few preview-specific chrome strings
 * live in a drawer-local `LexBilingual<PreviewDrawerLabels>` bundle, while all
 * matter status / priority / type / metadata wording is reused from the shared
 * matters label bundle (`useMatterLabels()`) so the copy stays identical to the
 * list and detail surfaces. The Sheet `dir` comes from `useLocale()` and all
 * spacing uses logical properties (me-/ms-/pe-/ps-).
 */

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Sparkles, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { enterpriseApi } from '@/lib/enterprise/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLocale } from '@/components/providers/locale-provider';
import type { LexMatter } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

import {
  formatMatterToken,
  matterRelationshipLabels,
  useMatterLabels,
  type MatterLabels,
} from './labels';
import { MatterSlaBadge } from '../_lib/matter-sla';
import { MatterObligationSummary } from './matter-obligation-summary';

export interface MatterPreviewDrawerProps {
  /** Matter id to preview. `null` keeps the drawer dormant (no fetch). */
  matterId: string | null;
  /** Controlled open state. */
  open: boolean;
  /** Controlled open-state setter. */
  onOpenChange: (open: boolean) => void;
  /** Invoked when the integrator should open the triage dialog for this matter. */
  onTriage?: (matterId: string) => void;
  /** Invoked when the integrator should open the change-status dialog for this matter. */
  onChangeStatus?: (matterId: string) => void;
}

/* ------------------------------------------------------------------------- *
 * Drawer-local bilingual labels. Matter status / priority / type / metadata
 * wording is reused from `useMatterLabels()`; only the preview-specific chrome
 * strings live here.
 * ------------------------------------------------------------------------- */

interface PreviewDrawerLabels {
  openDetail: string;
  triage: string;
  changeStatus: string;
  loadError: string;
  sectionFacts: string;
  sectionContracts: string;
  sectionObligations: string;
  owner: string;
  requester: string;
  type: string;
  opened: string;
  due: string;
  closed: string;
  noContracts: string;
}

const previewDrawerLabels: LexBilingual<PreviewDrawerLabels> = {
  en: {
    openDetail: 'Open full detail',
    triage: 'Triage',
    changeStatus: 'Change status',
    loadError: 'Failed to load matter details.',
    sectionFacts: 'Intake',
    sectionContracts: 'Linked contracts',
    sectionObligations: 'Obligations',
    owner: 'Owner',
    requester: 'Requester',
    type: 'Type',
    opened: 'Opened',
    due: 'Due',
    closed: 'Closed',
    noContracts: 'No linked contracts',
  },
  ar: {
    openDetail: 'فتح التفاصيل الكاملة',
    triage: 'فرز',
    changeStatus: 'تغيير الحالة',
    loadError: 'تعذّر تحميل تفاصيل القضية.',
    sectionFacts: 'الاستقبال',
    sectionContracts: 'العقود المرتبطة',
    sectionObligations: 'الالتزامات',
    owner: 'المسؤول',
    requester: 'مقدّم الطلب',
    type: 'النوع',
    opened: 'تاريخ الفتح',
    due: 'الاستحقاق',
    closed: 'تاريخ الإغلاق',
    noContracts: 'لا توجد عقود مرتبطة',
  },
};

/** Badge tone for a priority token, mirroring the list/detail PriorityBadge. */
function priorityVariant(priority: string): 'destructive' | 'warning' | 'secondary' {
  if (priority === 'critical' || priority === 'high') {
    return 'destructive';
  }
  if (priority === 'medium') {
    return 'warning';
  }
  return 'secondary';
}

function statusLabel(labels: MatterLabels, status: string): string {
  return labels.filters.statusOptions[status] ?? formatMatterToken(status);
}

function typeLabel(labels: MatterLabels, type: string): string {
  return labels.filters.typeOptions[type] ?? formatMatterToken(type);
}

function priorityLabel(labels: MatterLabels, priority: string): string {
  return labels.filters.priorityOptions[priority] ?? formatMatterToken(priority);
}

function relationshipLabel(map: Record<string, string>, relationship: string): string {
  return map[relationship] ?? formatMatterToken(relationship);
}

export function MatterPreviewDrawer({
  matterId,
  open,
  onOpenChange,
  onTriage,
  onChangeStatus,
}: MatterPreviewDrawerProps) {
  const { locale, direction } = useLocale();
  const matterLabels = useMatterLabels();
  const labels = useMemo(
    () => resolveLexBilingual(previewDrawerLabels, locale),
    [locale],
  );
  const relationshipLabels = useMemo(
    () => resolveLexBilingual(matterRelationshipLabels, locale),
    [locale],
  );

  const matterQuery = useQuery<LexMatter>({
    queryKey: ['lex', 'matter', matterId, 'preview'],
    queryFn: () => enterpriseApi.lex.getMatter(matterId as string),
    enabled: open && Boolean(matterId),
    staleTime: 60_000,
  });

  const matter = matterQuery.data;
  const detailHref = matter ? `/lex/matters/${matter.id}` : '#';
  const contracts = matter?.contracts ?? [];
  const requesterName = matter?.requester_name?.trim();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        dir={direction}
        className="flex h-full w-[calc(100vw-1rem)] flex-col overflow-y-auto p-0 sm:max-w-2xl"
      >
        {matterQuery.isLoading ? (
          <PreviewLoading />
        ) : matterQuery.isError ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <ErrorState
              message={labels.loadError}
              onRetry={() => void matterQuery.refetch()}
              error={matterQuery.error}
            />
          </div>
        ) : matter ? (
          <>
            <div className="border-b border-border/70 px-6 py-5">
              <SheetHeader className="space-y-3 text-start">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={statusLabel(matterLabels, matter.status)} size="sm" />
                  <Badge variant={priorityVariant(matter.priority)}>
                    {priorityLabel(matterLabels, matter.priority)}
                  </Badge>
                  <Badge variant="outline">{typeLabel(matterLabels, matter.type)}</Badge>
                  <MatterSlaBadge matter={matter} size="sm" />
                </div>
                <div>
                  <SheetTitle className="pe-8 text-xl leading-tight">
                    {matter.title || matterLabels.detail.notSet}
                  </SheetTitle>
                  <SheetDescription className="mt-1">
                    {matter.matter_number || matterLabels.detail.autoGenerated}
                  </SheetDescription>
                </div>
                <Button asChild variant="link" className="h-auto justify-start p-0">
                  <Link href={detailHref}>
                    {labels.openDetail}
                    <ExternalLink className="ms-1.5 h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </SheetHeader>
            </div>

            <div className="flex-1 space-y-6 px-6 py-5">
              {/* Snapshot facts. */}
              <PreviewSection title={labels.sectionFacts}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <PreviewFact
                    label={labels.owner}
                    value={matter.owner_name || matterLabels.detail.unassigned}
                  />
                  <PreviewFact
                    label={labels.requester}
                    value={requesterName || matterLabels.intake.noRequester}
                  />
                  <PreviewFact
                    label={labels.type}
                    value={typeLabel(matterLabels, matter.type)}
                  />
                  <PreviewFact
                    label={labels.opened}
                    value={matter.opened_at ? formatDate(matter.opened_at) : matterLabels.detail.notSet}
                  />
                  <PreviewFact
                    label={labels.due}
                    value={matter.due_date ? formatDate(matter.due_date) : matterLabels.detail.noDueDate}
                  />
                  <PreviewFact
                    label={labels.closed}
                    value={matter.closed_at ? formatDate(matter.closed_at) : matterLabels.detail.notSet}
                  />
                </div>
              </PreviewSection>

              {/* Description — render only when captured. */}
              {matter.description?.trim() ? (
                <PreviewSection title={matterLabels.detail.descriptionTitle}>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {matter.description}
                  </p>
                </PreviewSection>
              ) : null}

              {/* Linked-contract chips — render only when the matter carries links. */}
              <PreviewSection title={labels.sectionContracts}>
                {contracts.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {contracts.map((contract) => (
                      <Link
                        key={contract.id}
                        href={`/lex/contracts/${contract.contract_id}`}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                      >
                        <span className="truncate">
                          {contract.contract_title || contract.contract_id}
                        </span>
                        <span className="shrink-0 text-overline uppercase text-muted-foreground">
                          {relationshipLabel(relationshipLabels, contract.relationship)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{labels.noContracts}</p>
                )}
              </PreviewSection>

              {/* Compact obligation summary (sibling component). */}
              <PreviewSection title={labels.sectionObligations}>
                <MatterObligationSummary matterId={matter.id} variant="compact" />
              </PreviewSection>
            </div>

            <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-background/95 px-6 py-4">
              {onTriage ? (
                <Button variant="outline" onClick={() => onTriage(matter.id)}>
                  <Sparkles className="me-2 h-4 w-4" aria-hidden />
                  {labels.triage}
                </Button>
              ) : null}
              {onChangeStatus ? (
                <Button variant="outline" onClick={() => onChangeStatus(matter.id)}>
                  <RefreshCw className="me-2 h-4 w-4" aria-hidden />
                  {labels.changeStatus}
                </Button>
              ) : null}
              <Button asChild>
                <Link href={detailHref}>
                  {labels.openDetail}
                  <ExternalLink className="ms-2 h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </>
        ) : (
          /* Dormant: no matterId selected. Keep an accessible title for a11y. */
          <SheetHeader className="px-6 py-5 text-start">
            <SheetTitle className="sr-only">{matterLabels.detail.loadingTitle}</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PreviewLoading() {
  return (
    <div className="flex flex-1 flex-col gap-5 px-6 py-6">
      <LoadingSkeleton variant="text" count={2} />
      <LoadingSkeleton variant="card" count={1} />
      <LoadingSkeleton variant="list-item" count={3} />
    </div>
  );
}

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function PreviewFact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-xl border border-border/70 bg-card/50 px-3 py-3')}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 truncate text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
