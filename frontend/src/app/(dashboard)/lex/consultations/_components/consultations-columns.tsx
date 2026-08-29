'use client';

import * as React from 'react';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LexStatusChip, LexPriorityChip } from '@/components/lex/status-chip';
import { SlaAgingBadge } from '@/components/lex/sla-aging-badge';
import { cn } from '@/lib/utils';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLexFormat } from '@/lib/lex/ksa';
import type { Consultation } from '@/lib/lex/consultations';
import { slaRisk, type SlaRiskLevel } from './consultation-sla-meta';
import { formatConsultationToken, type ConsultationLabels } from './labels';

/**
 * KSA-aware "updated …" cell: routes the relative time through
 * {@link useLexFormat} so Arabic mode renders Arabic-Indic Hijri-aware copy
 * ("منذ ساعتين"), with the absolute Gregorian+Hijri dual date on hover.
 */
function LexUpdatedCell({ date }: { date: string }) {
  const f = useLexFormat();
  return (
    <time dateTime={date} title={f.formatDual(date)} className="text-sm text-muted-foreground">
      {f.formatRelative(date)}
    </time>
  );
}

/** Inline row-action identifiers the shell wires up to dialogs/mutations (#7). */
export type ConsultationRowAction = 'open' | 'classify' | 'route' | 'respond' | 'archive';

/**
 * Options for {@link buildConsultationColumns}.
 *
 * STABLE CONTRACT — keep this shape additive. `onRowAction` is invoked by the
 * inline row-actions column (#7); the shell maps each emitted intent onto its
 * transition dialog + mutation (and enforces permissions there).
 */
export interface BuildConsultationColumnsOptions {
  /** Resolved consultation labels (English/Arabic already applied). */
  labels: ConsultationLabels;
  /** Active locale, used to resolve the bilingual `title`. */
  locale: AppLocale;
  /** Inline per-row actions (#7); the shell handles the actual transitions. */
  onRowAction?: (consultation: Consultation, action: ConsultationRowAction) => void;
}

/* ------------------------------------------------------------------------- *
 * SLA presentation helpers (#1).
 * ------------------------------------------------------------------------- */

/** Map an SLA risk level onto a {@link Badge} variant within the frozen palette. */
const SLA_BADGE_VARIANT: Record<SlaRiskLevel, 'destructive' | 'warning' | 'success' | 'secondary'> =
  {
    breached: 'destructive',
    due_soon: 'warning',
    on_track: 'success',
    none: 'secondary',
  };

/**
 * Format a positive millisecond span as a compact "Xd Yh" / "Xh Ym" / "Xm"
 * string. Always shows at most the two most-significant non-zero units so the
 * countdown stays terse in a table cell. Sub-minute spans round up to "1m" so a
 * live clock never flickers to an empty value just before breach.
 */
function formatSpan(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * Client-only ticking countdown to `dueAt`. Renders "in 3h 20m" while the clock
 * runs and "overdue by 2h" once it passes, updating roughly once a minute.
 *
 * SSR-guarded: the first paint (and the server render) shows a stable em-dash so
 * markup matches across hydration; the live value appears after mount. Reuses the
 * `L.sla.inDuration` / `L.sla.overdueBy` interpolators for bilingual copy.
 */
function SlaCountdown({
  dueAt,
  labels,
  className,
}: {
  dueAt: string;
  labels: ConsultationLabels;
  className?: string;
}) {
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setNow(Date.now());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const dueTs = React.useMemo(() => new Date(dueAt).getTime(), [dueAt]);

  // Pre-mount / invalid-date: stable placeholder (no hydration mismatch).
  if (now === null || Number.isNaN(dueTs)) {
    return (
      <span className={cn('text-xs tabular-nums text-muted-foreground', className)} suppressHydrationWarning>
        —
      </span>
    );
  }

  const remaining = dueTs - now;
  const overdue = remaining <= 0;
  const span = formatSpan(Math.abs(remaining));
  const text = overdue ? labels.sla.overdueBy(span) : labels.sla.inDuration(span);

  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        overdue ? 'font-medium text-error-600 dark:text-error-300' : 'text-muted-foreground',
        className,
      )}
      suppressHydrationWarning
    >
      {text}
    </span>
  );
}

/**
 * Compact "Due / SLA" cell (#1): a tone-coded risk badge plus either a live
 * countdown (while pending) or the resolved outcome, and an escalation chip when
 * the consultation has escalated.
 */
function SlaCell({ row, labels }: { row: Consultation; labels: ConsultationLabels }) {
  const risk = slaRisk({
    breached: row.sla_breached,
    responseDueAt: row.sla_response_due_at,
    ackDone: row.sla_ack_done,
  });

  const resolved = row.sla_outcome && row.sla_outcome !== 'pending';
  const escalation = row.sla_escalation_level ?? 0;

  // No SLA clock at all: a neutral dash keeps the cell quiet.
  if (risk.level === 'none' && !resolved && !row.sla_response_due_at) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  const riskLabel =
    risk.level === 'breached'
      ? labels.sla.breached
      : risk.level === 'due_soon'
        ? labels.sla.dueSoon
        : risk.level === 'on_track'
          ? labels.sla.onTrack
          : labels.sla.responseDue;

  return (
    <div className="flex flex-col items-start gap-1">
      {resolved ? (
        <>
          <Badge variant={SLA_BADGE_VARIANT[risk.level]}>{riskLabel}</Badge>
          <Badge variant={row.sla_outcome === 'on_time' ? 'success' : 'destructive'}>
            {row.sla_outcome === 'on_time' ? labels.sla.met : labels.sla.breached}
          </Badge>
        </>
      ) : row.sla_response_due_at ? (
        <>
          {/* Shared, KSA-aware aging pill (bilingual tier + Arabic-Indic relative
              time) plus the live in-table countdown for the exact remaining span. */}
          <SlaAgingBadge dueAt={row.sla_response_due_at} status={row.status} size="sm" showWhenResolved />
          <SlaCountdown dueAt={row.sla_response_due_at} labels={labels} />
        </>
      ) : (
        <Badge variant={SLA_BADGE_VARIANT[risk.level]}>{riskLabel}</Badge>
      )}

      {escalation > 0 ? (
        <span className="text-[11px] font-medium text-warning-700 dark:text-warning-300">
          {labels.sla.escalationLevel(escalation)}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Row actions (#7).
 * ------------------------------------------------------------------------- */

/**
 * Status → forward transition the actions menu offers. The shell owns the actual
 * dialog/mutation/permission gating; this map only decides which intents are
 * relevant for the row's current FSM state.
 */
const STATUS_TRANSITION: Partial<
  Record<Consultation['status'], { action: ConsultationRowAction; labelKey: keyof ConsultationLabels['rowActions'] }>
> = {
  submitted: { action: 'classify', labelKey: 'classify' },
  classified: { action: 'route', labelKey: 'route' },
  routed: { action: 'respond', labelKey: 'respond' },
  approved: { action: 'archive', labelKey: 'archive' },
};

function RowActionsCell({
  row,
  labels,
  onRowAction,
}: {
  row: Consultation;
  labels: ConsultationLabels;
  onRowAction?: (consultation: Consultation, action: ConsultationRowAction) => void;
}) {
  const transition = STATUS_TRANSITION[row.status];

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={labels.rowActions.actions}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>{labels.rowActions.actions}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onRowAction?.(row, 'open')}>
            {labels.rowActions.open}
          </DropdownMenuItem>
          {transition ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onRowAction?.(row, transition.action)}>
                {labels.rowActions[transition.labelKey]}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * buildConsultationColumns — factory returning the consultations table column
 * definitions. The original six columns are preserved exactly; #1 adds a
 * "Due / SLA" column with a live countdown, and #7 adds a trailing row-actions
 * menu that emits transition intents via `onRowAction`.
 *
 * Returned as a plain array; the caller is responsible for memoizing (the list
 * page wraps the call in `useMemo`).
 */
export function buildConsultationColumns(
  opts: BuildConsultationColumnsOptions,
): ColumnDef<Consultation>[] {
  const { labels, locale, onRowAction } = opts;

  return [
    {
      id: 'title',
      header: labels.columns.title,
      cell: ({ row }) => (
        <div>
          <Link
            href={`/lex/consultations/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {resolveLocalized(row.original.title, locale) || row.original.consultation_number}
          </Link>
          <p className="text-xs text-muted-foreground">{row.original.consultation_number}</p>
        </div>
      ),
    },
    {
      id: 'type',
      accessorKey: 'type',
      header: labels.columns.type,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {labels.filters.typeOptions[row.original.type] ??
            formatConsultationToken(row.original.type)}
        </span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: labels.columns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <LexStatusChip
          domain="consultation"
          value={row.original.status}
          labels={labels.filters.statusOptions}
          size="sm"
        />
      ),
    },
    {
      id: 'priority',
      accessorKey: 'priority',
      header: labels.columns.priority,
      enableSorting: true,
      cell: ({ row }) => (
        <LexPriorityChip
          value={row.original.priority}
          labels={labels.filters.priorityOptions}
          size="sm"
        />
      ),
    },
    {
      id: 'advisor',
      header: labels.columns.advisor,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.advisor_name || labels.detail.unassigned}
        </span>
      ),
    },
    {
      id: 'due_sla',
      header: labels.columns.dueSla,
      cell: ({ row }) => <SlaCell row={row.original} labels={labels} />,
    },
    {
      id: 'updated_at',
      accessorKey: 'updated_at',
      header: labels.columns.updated,
      enableSorting: true,
      cell: ({ row }) => <LexUpdatedCell date={row.original.updated_at} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">{labels.rowActions.actions}</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <RowActionsCell row={row.original} labels={labels} onRowAction={onRowAction} />
      ),
    },
  ];
}
