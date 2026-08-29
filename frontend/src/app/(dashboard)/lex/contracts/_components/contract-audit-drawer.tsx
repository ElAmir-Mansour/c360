/**
 * ContractAuditDrawer — Feature #7: right-hand slide-over showing a contract's
 * tamper-evident history on the contracts list (`/lex/contracts`).
 *
 * Opening the drawer lazily fetches the per-contract lifecycle timeline
 * (`enterpriseApi.lex.getContractTimeline`) — projected server-side from
 * append-only storage (created/status/version/analysis columns +
 * metadata timeline), so there is no second write path that could drift from
 * the source of truth — and renders it through the shared
 * `<LexActivityTimeline>` storytelling primitive (actor avatars, day grouping,
 * tone-colored rail, Hijri/Arabic-Indic timestamps in Arabic mode).
 *
 * The query key intentionally matches the detail page
 * (`['lex-contract-timeline', id]`) so the cache is shared and the detail
 * page's invalidations propagate here.
 *
 * Bilingual (EN + MSA) and RTL-aware: labels follow the canonical
 * `LexBilingual<T>` contract from `../../_lib/lex-i18n` and are resolved via
 * the active locale; layout uses logical properties only.
 */

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, History, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import {
  LexActivityTimeline,
  type LexActivityEvent,
  type LexActivityTone,
} from '@/components/lex/activity-timeline';
import { enterpriseApi } from '@/lib/enterprise';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveTimelineEvent } from '../_lib/contract-timeline-i18n';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexContractTimeline } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import { contractAuditSourceLabels } from '../_lib/contracts-labels';

export interface ContractAuditDrawerProps {
  /** Contract id to audit. `null` keeps the drawer dormant (no fetch). */
  contractId: string | null;
  /** Optional row title for the header while the timeline loads. */
  contractTitle?: string | null;
  /** Controlled open state. */
  open: boolean;
  /** Controlled open-state setter. */
  onOpenChange: (open: boolean) => void;
}

/* ------------------------------------------------------------------------- *
 * Drawer-local bilingual labels (exported for tests, following the
 * `contracts-labels.ts` pattern).
 * ------------------------------------------------------------------------- */

export interface ContractAuditDrawerLabels {
  title: string;
  description: string;
  tamperEvident: string;
  systemActor: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  openDetail: string;
  eventCount: (count: number) => string;
  generatedPrefix: (date: string) => string;
}

export const contractAuditDrawerLabels: LexBilingual<ContractAuditDrawerLabels> = {
  en: {
    title: 'Audit & history',
    description:
      'Tamper-evident event history projected from append-only contract records.',
    tamperEvident: 'Append-only',
    systemActor: 'System',
    loadError: 'Failed to load the contract audit history.',
    emptyTitle: 'No audit events yet',
    emptyDescription:
      'Lifecycle, version, and analysis events will appear here as the contract moves.',
    openDetail: 'Open full detail',
    eventCount: (count) => `${count} event${count === 1 ? '' : 's'}`,
    generatedPrefix: (date) => `Generated ${date}`,
  },
  ar: {
    title: 'التدقيق والسجل',
    description: 'سجل أحداث مقاوم للتلاعب مستمد من قيود العقد ذات الإضافة فقط.',
    tamperEvident: 'إضافة فقط',
    systemActor: 'النظام',
    loadError: 'تعذّر تحميل سجل تدقيق العقد.',
    emptyTitle: 'لا توجد أحداث تدقيق بعد',
    emptyDescription: 'ستظهر هنا أحداث دورة الحياة والنسخ والتحليل مع تقدّم العقد.',
    openDetail: 'فتح التفاصيل الكاملة',
    eventCount: (count) => `${count} حدث`,
    generatedPrefix: (date) => `أُنشئ في ${date}`,
  },
};

/**
 * Map a timeline `event_type` onto the activity-timeline tone ramp — the same
 * mapping the contract detail console uses (created/active → success,
 * analysis/version → info, renewal/expiry warnings → warning,
 * terminated/cancelled → danger; unknown stays neutral).
 */
export function contractAuditEventTone(eventType: string): LexActivityTone {
  const type = eventType.toLowerCase();
  if (/(terminat|cancel|delet|reject|expire|breach)/.test(type)) return 'danger';
  if (/(renew|warning|overdue|pending|review|flag)/.test(type)) return 'warning';
  if (/(activ|approv|sign|execut|complet|created)/.test(type)) return 'success';
  if (/(analy|version|upload|classif|status|workflow)/.test(type)) return 'info';
  return 'neutral';
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}

export function ContractAuditDrawer({
  contractId,
  contractTitle,
  open,
  onOpenChange,
}: ContractAuditDrawerProps) {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useMemo(
    () => resolveLexBilingual(contractAuditDrawerLabels, locale),
    [locale],
  );
  const auditSourceLabels = useMemo(
    () => resolveLexBilingual(contractAuditSourceLabels, locale),
    [locale],
  );

  const timelineQuery = useQuery<LexContractTimeline>({
    // Shared with the detail page so invalidations there refresh this drawer.
    queryKey: ['lex-contract-timeline', contractId],
    queryFn: () => enterpriseApi.lex.getContractTimeline(contractId as string),
    enabled: open && Boolean(contractId),
    staleTime: 30_000,
  });

  const timeline = timelineQuery.data ?? null;

  // Project the raw timeline into the shared activity-story feed. Mirrors the
  // detail console's mapping so both surfaces narrate identically.
  const activityEvents: LexActivityEvent[] = useMemo(
    () =>
      // Backend timeline prose is Arabic-only; resolve per locale from the
      // stable event_type + metadata.
      (timeline?.events ?? []).map((event) => {
        const resolved = resolveTimelineEvent(event, locale);
        return {
        id: event.id,
        actor: { name: resolved.actor ?? labels.systemActor },
        action: resolved.title,
        target: resolved.description || undefined,
        at: event.occurred_at,
        tone: contractAuditEventTone(event.event_type),
        detail: event.source
          ? auditSourceLabels[event.source] ?? formatToken(event.source)
          : undefined,
        };
      }),
    [timeline?.events, labels.systemActor, auditSourceLabels, locale],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        dir={direction}
        className="flex h-full w-[calc(100vw-1rem)] flex-col overflow-y-auto p-0 sm:max-w-xl"
      >
        <div className="border-b border-border/70 px-6 py-5">
          <SheetHeader className="space-y-2 text-start">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary"
                aria-hidden
              >
                <ShieldCheck className="h-4 w-4" />
              </span>
              <SheetTitle className="pe-8 text-lg leading-tight">
                {labels.title}
              </SheetTitle>
              <Badge variant="outline" className="shrink-0">
                {labels.tamperEvident}
              </Badge>
            </div>
            <SheetDescription>
              {contractTitle ? (
                <span className="block truncate font-medium text-foreground" dir="auto">
                  {contractTitle}
                </span>
              ) : null}
              {labels.description}
            </SheetDescription>
            {contractId ? (
              <Button asChild variant="link" className="h-auto justify-start p-0">
                <Link href={`/lex/contracts/${contractId}`}>
                  {labels.openDetail}
                  <ExternalLink className="ms-1.5 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            ) : null}
          </SheetHeader>
        </div>

        <div className="flex-1 px-6 py-5">
          {timelineQuery.isLoading ? (
            <Skeleton variant="list" rows={5} />
          ) : timelineQuery.isError ? (
            <ErrorState
              message={labels.loadError}
              onRetry={() => void timelineQuery.refetch()}
              error={timelineQuery.error}
            />
          ) : activityEvents.length > 0 ? (
            <div className="space-y-4">
              <LexActivityTimeline
                events={activityEvents}
                dir={direction}
                emptyLabel={labels.emptyTitle}
              />
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{labels.eventCount(activityEvents.length)}</span>
                {timeline?.generated_at ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{labels.generatedPrefix(f.formatDate(timeline.generated_at))}</span>
                  </>
                ) : null}
              </p>
            </div>
          ) : (
            <EmptyState
              icon={History}
              title={labels.emptyTitle}
              description={labels.emptyDescription}
              size="compact"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
