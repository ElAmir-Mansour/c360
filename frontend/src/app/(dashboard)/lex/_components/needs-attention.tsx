/**
 * Unified, cross-domain "Needs attention" queue for the Watheeq Legal-Affairs
 * command center (`/lex` landing page).
 *
 * Renders the aggregated {@link useLexNeedsAttention} feed (breached SLA clocks,
 * overdue obligations, approvable workflow tasks, contract renewal warnings,
 * upcoming hearings, and high/critical compliance alerts) inside the shared
 * {@link CommandCard} shell. A modern segmented filter control (with per-tab
 * counts) narrows by {@link AttentionType}; each item is a navigational
 * {@link SeverityRow} whose severity is conveyed by BOTH an accent strip and a
 * tone icon (never colour alone), with a muted subtitle and a relative-time /
 * status-chip trailing slot.
 *
 * Per-source failures degrade gracefully — the hook composes six independent
 * fail-soft queries, so one failing slice contributes `[]` and the rest still
 * render. Approval rows deep-link to their contract; the heavy bulk
 * approve/reject mutation lives in `contract-analytics.tsx`, NOT here.
 *
 * Bilingual (EN/AR) via `useLexLabels()`; RTL-safe via logical spacing utilities
 * and Arabic-Indic numerals via `useLexFormat()`.
 */

'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ClipboardCheck,
  Gavel,
  Inbox,
  RefreshCw,
  ShieldAlert,
  Stamp,
  Timer,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

import { useLexLabels } from '../_lib/lex-i18n';
import { humanizeLexText } from '../_lib/humanize-lex-token';
import {
  useLexNeedsAttention,
  type AttentionItem,
  type AttentionSeverity,
  type AttentionType,
} from '../_lib/use-lex-command-center';
import {
  CommandCard,
  SectionHeader,
  SeverityRow,
  EmptyState,
  type RowSeverity,
} from './command-ui';

/**
 * Humanize the few enum-ish badge tokens that some attention sources surface
 * raw (contract renewal-warning `reason`s, workflow statuses). Real human
 * strings — owner names, case numbers like "CASE-2024-001" — contain spaces,
 * digits or hyphens and pass through unchanged.
 */
const BADGE_LABELS: Record<string, { en: string; ar: string }> = {
  renewal_date: { en: 'Renewal due', ar: 'موعد التجديد' },
  expiry_minus_lead: { en: 'Expiring soon', ar: 'قرب الانتهاء' },
  expired: { en: 'Expired', ar: 'منتهٍ' },
  pending: { en: 'Pending', ar: 'قيد الانتظار' },
  pending_approval: { en: 'Pending approval', ar: 'بانتظار الاعتماد' },
  awaiting_approval: { en: 'Awaiting approval', ar: 'بانتظار الاعتماد' },
  awaiting_review: { en: 'Awaiting review', ar: 'بانتظار المراجعة' },
  in_review: { en: 'In review', ar: 'قيد المراجعة' },
  internal_review: { en: 'Internal review', ar: 'مراجعة داخلية' },
  legal_review: { en: 'Legal review', ar: 'مراجعة قانونية' },
  negotiation: { en: 'Negotiation', ar: 'تفاوض' },
  pending_signature: { en: 'Pending signature', ar: 'بانتظار التوقيع' },
  in_progress: { en: 'In progress', ar: 'قيد التنفيذ' },
  blocked: { en: 'Blocked', ar: 'محظور' },
};

function humanizeBadge(raw: string, locale: string): string {
  const key = raw.trim().toLowerCase();
  const known = BADGE_LABELS[key];
  if (known) return locale === 'ar' ? known.ar : known.en;
  if (locale === 'ar' && /^[a-z]+(?:_[a-z]+)*$/.test(key)) {
    return 'حالة غير معروفة';
  }
  // lowercase snake/word enum → Title Case; anything with caps/digits/hyphens
  // (names, reference numbers) is already human → leave as-is.
  if (/^[a-z]+(?:_[a-z]+)*$/.test(key)) {
    return key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  return raw;
}

/* ------------------------------------------------------------------------- *
 * Type → icon + severity → row-severity mapping
 * ------------------------------------------------------------------------- */

/** A per-type leading icon adds semantic clarity beyond the severity tone. */
const TYPE_ICON: Record<AttentionType, LucideIcon> = {
  sla: Timer,
  obligation: ClipboardCheck,
  approval: Stamp,
  renewal: RefreshCw,
  hearing: Gavel,
  alert: ShieldAlert,
};

/**
 * Aggregation severity → the {@link SeverityRow} tone union. `critical` stays
 * critical (error/red), `high` reads as a warning, mid/low taper to info /
 * neutral. Colour is always paired with the type icon, satisfying AA.
 */
const SEVERITY_MAP: Record<AttentionSeverity, RowSeverity> = {
  critical: 'critical',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
  info: 'info',
};

/* ------------------------------------------------------------------------- *
 * Filter chips
 * ------------------------------------------------------------------------- */

/**
 * UI filter key. `'all'` shows everything; the remaining keys map to one or more
 * {@link AttentionType} values. Compliance `'alert'` items have no dedicated chip
 * (they surface only under "All").
 */
type AttentionFilter =
  | 'all'
  | 'sla'
  | 'obligation'
  | 'approval'
  | 'renewal'
  | 'hearing';

/** Which attention types each filter chip admits. */
const FILTER_TYPES: Record<Exclude<AttentionFilter, 'all'>, AttentionType> = {
  sla: 'sla',
  obligation: 'obligation',
  approval: 'approval',
  renewal: 'renewal',
  hearing: 'hearing',
};

interface FilterOption {
  key: AttentionFilter;
  label: string;
  count: number;
}

interface SegmentedFilterProps {
  options: FilterOption[];
  value: AttentionFilter;
  onChange: (key: AttentionFilter) => void;
}

/**
 * A modern segmented control: a pill track with per-segment counts. The active
 * segment lifts onto a `bg-card` chip; counts render as tabular-nums pills that
 * take the primary tone when active. Horizontally scrollable (never wrapping) so
 * it mirrors cleanly under `dir="rtl"`.
 */
function SegmentedFilter({ options, value, onChange }: SegmentedFilterProps) {
  const f = useLexFormat();
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-muted/50 p-1"
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-caption font-medium',
              'transition-[color,background-color,box-shadow] duration-fast ease-standard',
              'focus-visible:outline-none focus-visible:shadow-focus-ring',
              active
                ? 'bg-card text-foreground shadow-elevation-1'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span>{opt.label}</span>
            <span
              className={cn(
                'rounded-full px-1.5 text-overline tabular-nums',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {f.formatNumber(opt.count)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Loading skeleton — row-shaped, wrapped in the CommandCard shell.
 * ------------------------------------------------------------------------- */

function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-border bg-card/50 px-4 py-3"
        >
          <Skeleton className="h-8 w-8 rounded-soft" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2 rounded-soft" />
            <Skeleton className="h-3 w-1/3 rounded-soft" />
          </div>
          <Skeleton className="h-3 w-16 rounded-soft" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Component
 * ------------------------------------------------------------------------- */

export function NeedsAttention() {
  const labels = useLexLabels();
  const f = useLexFormat();
  const na = labels.overview.needsAttention;
  const { items, byType, isLoading } = useLexNeedsAttention();

  const [filter, setFilter] = useState<AttentionFilter>('all');

  const visible = useMemo<AttentionItem[]>(() => {
    if (filter === 'all') return items;
    return byType[FILTER_TYPES[filter]] ?? [];
  }, [filter, items, byType]);

  const options: FilterOption[] = [
    { key: 'all', label: na.filterAll, count: items.length },
    { key: 'sla', label: na.filterSla, count: byType.sla.length },
    {
      key: 'obligation',
      label: na.filterObligations,
      count: byType.obligation.length,
    },
    { key: 'approval', label: na.filterApprovals, count: byType.approval.length },
    { key: 'renewal', label: na.filterRenewals, count: byType.renewal.length },
    { key: 'hearing', label: na.filterHearings, count: byType.hearing.length },
  ];

  // Local eyebrow caption (not in the shared i18n catalog).
  const eyebrow = f.locale === 'ar' ? 'قائمة الأولويات' : 'Priority queue';

  const isEmpty = !isLoading && visible.length === 0;

  return (
    <CommandCard accent="neutral">
      <div className="space-y-4">
        <SectionHeader
          eyebrow={eyebrow}
          icon={AlertTriangle}
          tone="warning"
          title={na.title}
          description={na.description}
        />

        <SegmentedFilter options={options} value={filter} onChange={setFilter} />

        {isLoading ? (
          <LoadingRows count={4} />
        ) : isEmpty ? (
          <EmptyState
            icon={Inbox}
            title={na.emptyTitle}
            description={na.emptyDescription}
          />
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto pe-1">
            {visible.map((item) => (
              <SeverityRow
                key={item.id}
                href={item.href}
                severity={SEVERITY_MAP[item.severity]}
                icon={TYPE_ICON[item.type]}
                title={item.title}
                meta={
                  item.subtitle
                    ? humanizeLexText(item.subtitle, f.locale)
                    : undefined
                }
                trailing={
                  <>
                    {item.badge ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 whitespace-nowrap font-medium normal-case tracking-normal"
                      >
                        {humanizeBadge(item.badge, f.locale)}
                      </Badge>
                    ) : null}
                    {item.dueAt ? (
                      <span
                        className="whitespace-nowrap text-caption tabular-nums text-muted-foreground"
                        title={f.formatDual(item.dueAt)}
                      >
                        {f.formatRelative(item.dueAt)}
                      </span>
                    ) : null}
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>
    </CommandCard>
  );
}

export default NeedsAttention;
