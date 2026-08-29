/**
 * Feature 13 — portfolio insight feed panel for the contracts LIST page
 * (`/lex/contracts`), mounted above the table.
 *
 * Renders the ranked, severity-toned insight cards served by
 * `GET /contracts/insights` (via {@link useContractInsights}). Card copy
 * (title/detail) is bilingual STRAIGHT FROM THE PAYLOAD — the component only
 * picks the locale side; chrome labels follow the canonical lex
 * `LexBilingual<T> = { en, ar }` token-record contract. Each card offers:
 *
 *   - "View matching" — hands `{ insight, contractIds, mapping }` back to the
 *     page via `onViewMatching`; `mapping` is the kind→list-filter translation
 *     from `insightFilterMapping` (the list endpoint has no `ids` filter).
 *   - Dismiss-for-session — hides the card via the sessionStorage-backed store
 *     inside the hook; a "restore" affordance in the header undoes it.
 *
 * The whole panel is collapsible (chevron header toggle, `aria-expanded`);
 * when the server returns no cards a compact positive empty state renders, and
 * when every card is dismissed a "restore" empty state renders instead.
 * Logical spacing (ms-/me-) keeps the layout correct under RTL. Read-only —
 * no mutation verbs, so no RBAC gating beyond the page's own view gate.
 */

'use client';

import { useId, useMemo, useState } from 'react';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  FileClock,
  Filter,
  Lightbulb,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/empty-state';
import { RelativeTime } from '@/components/shared/relative-time';
import { type Severity } from '@/components/shared/severity-indicator';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import {
  type LexBilingual,
  lexSeverityLabels,
  resolveLexBilingual,
} from '../../_lib/lex-i18n';
import { toIndicatorSeverity } from '../[id]/_components/risk-severity';
import {
  type ContractInsightFilterMapping,
  type LexContractInsight,
  insightFilterMapping,
  resolveInsightCopy,
  useContractInsights,
} from '../_lib/use-contract-insights';

/* ------------------------------------------------------------------------- *
 * Bilingual chrome labels (canonical lex token-record contract).
 * ------------------------------------------------------------------------- */

interface ContractInsightFeedLabels {
  /** Panel heading. */
  panelTitle: string;
  /** Collapse/expand toggle aria-labels. */
  expand: string;
  collapse: string;
  /** Card count chip next to the heading. Receives a localized number. */
  insightCount: (count: string) => string;
  /** "Partial scan" chip when the bounded scan truncated. */
  truncated: string;
  /** Header meta prefix for the generated-at relative time. */
  updated: string;
  /** Per-card CTA applying the matching filter on the list. */
  viewMatching: string;
  /** Per-card matching-contracts chip. Receives a localized number. */
  matchingContracts: (count: string) => string;
  /** Dismiss control aria-label; receives the resolved card title. */
  dismiss: (title: string) => string;
  /** Header restore affordance; receives a localized dismissed count. */
  restore: (count: string) => string;
  /** Positive empty state (server returned no cards). */
  emptyTitle: string;
  emptyDescription: string;
  /** Empty state when every returned card is session-dismissed. */
  allDismissedTitle: string;
  allDismissedDescription: string;
  restoreAll: string;
}

export const contractInsightFeedLabels: LexBilingual<ContractInsightFeedLabels> = {
  en: {
    panelTitle: 'Portfolio Indicators',
    expand: 'Expand portfolio indicators',
    collapse: 'Collapse portfolio indicators',
    insightCount: (count) => `${count} insights`,
    truncated: 'Partial scan',
    updated: 'Updated',
    viewMatching: 'View matching',
    matchingContracts: (count) => `${count} contracts`,
    dismiss: (title) => `Dismiss insight for this session: ${title}`,
    restore: (count) => `Restore ${count} dismissed`,
    emptyTitle: 'No portfolio insights',
    emptyDescription: 'Your contract portfolio has no attention items right now.',
    allDismissedTitle: 'All insights dismissed',
    allDismissedDescription:
      'Dismissed insights stay hidden for this session and return next time.',
    restoreAll: 'Restore insights',
  },
  ar: {
    panelTitle: 'مؤشرات المحفظة',
    expand: 'إظهار مؤشرات المحفظة',
    collapse: 'طيّ مؤشرات المحفظة',
    insightCount: (count) => `${count} رؤية`,
    truncated: 'فحص جزئي',
    updated: 'آخر تحديث',
    viewMatching: 'عرض المطابقة',
    matchingContracts: (count) => `${count} عقدًا`,
    dismiss: (title) => `إخفاء الرؤية لهذه الجلسة: ${title}`,
    restore: (count) => `استعادة ${count} مخفية`,
    emptyTitle: 'لا توجد رؤى للمحفظة',
    emptyDescription: 'لا توجد عناصر تتطلب الانتباه في محفظة العقود حاليًا.',
    allDismissedTitle: 'تم إخفاء جميع الرؤى',
    allDismissedDescription: 'تبقى الرؤى المخفية غير ظاهرة خلال هذه الجلسة وتعود في الجلسة القادمة.',
    restoreAll: 'استعادة الرؤى',
  },
};

function useContractInsightFeedLabels(): ContractInsightFeedLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractInsightFeedLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Severity + kind presentation.
 * ------------------------------------------------------------------------- */

/**
 * Card chrome per severity, spelled out literally so Tailwind's JIT scanner
 * detects each class. Mirrors the `CHIP_TONE` ramp in `contract-risk-cell.tsx`
 * so insight cards read consistently against the rest of the suite.
 */
const CARD_TONE: Record<Severity, string> = {
  critical: 'border-error-500/35 bg-error-500/8',
  high: 'border-error-500/30 bg-error-500/6',
  warning: 'border-warning-500/30 bg-warning-500/7',
  medium: 'border-warning-500/30 bg-warning-500/7',
  low: 'border-info-500/30 bg-info-500/6',
  info: 'border-border/70 bg-muted/50',
};

const ICON_TONE: Record<Severity, string> = {
  critical: 'bg-error-500/15 text-error-700 dark:text-error-300',
  high: 'bg-error-500/12 text-error-700 dark:text-error-300',
  warning: 'bg-warning-500/15 text-warning-700 dark:text-warning-300',
  medium: 'bg-warning-500/15 text-warning-700 dark:text-warning-300',
  low: 'bg-info-500/12 text-info-700 dark:text-info-300',
  info: 'bg-muted text-muted-foreground',
};

const SEVERITY_CHIP_TONE: Record<Severity, string> = {
  critical: 'border-error-500/35 text-error-700 dark:text-error-300',
  high: 'border-error-500/30 text-error-700 dark:text-error-300',
  warning: 'border-warning-500/30 text-warning-700 dark:text-warning-300',
  medium: 'border-warning-500/30 text-warning-700 dark:text-warning-300',
  low: 'border-info-500/30 text-info-700 dark:text-info-300',
  info: 'border-border/70 text-muted-foreground',
};

/** Leading icon per insight kind; unknown kinds fall back to a lightbulb. */
const KIND_ICON: Record<string, LucideIcon> = {
  missing_mandatory_clause: ShieldAlert,
  renewal_opt_out_closing: CalendarClock,
  value_outlier: TrendingUp,
  counterparty_concentration: Building2,
  stale_draft: FileClock,
};

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

/**
 * The "view matching" payload handed back to the page. `mapping` is the
 * server-filter translation for the insight's kind (null when no faithful
 * list filter exists — the integrator then falls back to `contractIds`).
 */
export interface ContractInsightViewMatchingRequest {
  insight: LexContractInsight;
  contractIds: string[];
  mapping: ContractInsightFilterMapping | null;
}

export interface ContractInsightFeedProps {
  /** Apply the card's matching filter on the contracts list. */
  onViewMatching: (request: ContractInsightViewMatchingRequest) => void;
  /** Optional server knobs (omitted → server defaults of 30/30 days). */
  windowDays?: number;
  staleDays?: number;
  /** Optional className passthrough for layout placement. */
  className?: string;
}

/**
 * Collapsible portfolio insight feed. Fetch/dismiss state lives in
 * {@link useContractInsights}; this component is presentation + callbacks.
 * Renders a slim pulse placeholder while loading and nothing on error (the
 * list page stays fully usable without the feed).
 */
export function ContractInsightFeed({
  onViewMatching,
  windowDays,
  staleDays,
  className,
}: ContractInsightFeedProps) {
  const labels = useContractInsightFeedLabels();
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const contentId = useId();
  const [open, setOpen] = useState(true);

  const {
    report,
    insights,
    totalCount,
    dismissedCount,
    dismiss,
    restoreDismissed,
    isLoading,
    isError,
  } = useContractInsights({ windowDays, staleDays });

  const severityLabels = useMemo(
    () => resolveLexBilingual(lexSeverityLabels, locale),
    [locale],
  );

  if (isError) {
    return null;
  }

  if (isLoading || !report) {
    return (
      <div
        aria-hidden="true"
        className={cn('h-12 animate-pulse rounded-lg border border-border/60 bg-muted/40', className)}
      />
    );
  }

  const generatedAt = report.generated_at ? new Date(report.generated_at) : null;
  const hasValidGeneratedAt =
    generatedAt instanceof Date && !Number.isNaN(generatedAt.getTime());

  return (
    <section
      aria-label={labels.panelTitle}
      className={cn('rounded-lg border bg-card', className)}
    >
      {/* Header — always visible; owns the collapse toggle. */}
      <div className="flex items-center gap-3 p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold">{labels.panelTitle}</h3>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {labels.insightCount(f.formatNumber(totalCount))}
          </Badge>
          {report.truncated ? (
            <Badge
              variant="outline"
              className="shrink-0 border-warning-500/30 text-warning-700 dark:text-warning-300"
            >
              {labels.truncated}
            </Badge>
          ) : null}
          {hasValidGeneratedAt ? (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              {labels.updated}
              <RelativeTime date={generatedAt} />
            </span>
          ) : null}
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-1">
          {dismissedCount > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={restoreDismissed}
            >
              <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {labels.restore(f.formatNumber(dismissedCount))}
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls={contentId}
            aria-label={open ? labels.collapse : labels.expand}
          >
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform duration-fast ease-standard',
                open && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      {/* Collapsible body. */}
      {open ? (
        <div id={contentId} className="border-t px-3 pb-3">
          {insights.length === 0 ? (
            totalCount > 0 ? (
              <EmptyState
                size="compact"
                icon={Lightbulb}
                title={labels.allDismissedTitle}
                description={labels.allDismissedDescription}
                action={{ label: labels.restoreAll, onClick: restoreDismissed, icon: RotateCcw }}
              />
            ) : (
              <EmptyState
                size="compact"
                icon={CheckCircle2}
                title={labels.emptyTitle}
                description={labels.emptyDescription}
              />
            )
          ) : (
            <ul className="mt-3 space-y-2">
              {insights.map((insight) => {
                const copy = resolveInsightCopy(insight, locale);
                const severity = toIndicatorSeverity(insight.severity);
                const Icon = KIND_ICON[insight.kind] ?? Lightbulb;
                const contractIds = insight.contract_ids ?? [];
                const mapping = insightFilterMapping(insight);
                const canViewMatching = mapping !== null || contractIds.length > 0;

                return (
                  <li
                    key={insight.id}
                    className={cn(
                      'flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start',
                      CARD_TONE[severity],
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        ICON_TONE[severity],
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1 space-y-1 text-start">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-semibold">{copy.title}</p>
                        <Badge
                          variant="outline"
                          className={cn('shrink-0', SEVERITY_CHIP_TONE[severity])}
                        >
                          {severityLabels[severity] ?? severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{copy.detail}</p>
                      {contractIds.length > 0 ? (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {labels.matchingContracts(f.formatNumber(contractIds.length))}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-1 ps-11 sm:ps-0">
                      {canViewMatching ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onViewMatching({ insight, contractIds, mapping })}
                        >
                          <Filter className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          {labels.viewMatching}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => dismiss(insight.id)}
                        aria-label={labels.dismiss(copy.title)}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
