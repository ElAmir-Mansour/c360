'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { rowAccentClass } from '@/components/lex/row-accents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { TableCell, TableRow } from '@/components/ui/table';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { StatTone } from '@/components/shared/stat-card';
import type { LexPlaybookPortfolioRow } from '@/types/suites';
import { clampPercent, complianceTone } from './deviation-meta';
import { formatToken } from './playbook-form';
import type { PlaybookLabels } from './labels';

/**
 * Map the compliance {@link StatTone} band onto a row-accent status token so the
 * shared {@link rowAccentClass} tints + lifts the row consistently with the rest
 * of the suite: failing → danger, needs-attention → warning, healthy → success.
 */
const TONE_ACCENT_STATUS: Record<StatTone, string> = {
  rose: 'breached',
  gold: 'pending',
  emerald: 'active',
  sky: 'in_progress',
  slate: 'closed',
  teal: 'closed',
  neutral: 'closed',
};

/**
 * Map the {@link complianceTone} StatTone (only ever rose | gold | emerald for a
 * 0–100 score) onto the Progress indicator + percent-text color. A lower score
 * is rendered louder (rose) to draw a triage eye to the worst agreements first.
 */
const TONE_INDICATOR_CLASS: Record<StatTone, string> = {
  rose: 'bg-rose-500',
  gold: 'bg-warning-500',
  emerald: 'bg-success-500',
  // Defensive fallbacks — complianceTone never returns these for a finite score.
  sky: 'bg-sky-500',
  slate: 'bg-neutral-400',
  teal: 'bg-neutral-400',
  neutral: 'bg-primary',
};

const TONE_TEXT_CLASS: Record<StatTone, string> = {
  rose: 'text-rose-600 dark:text-rose-400',
  gold: 'text-warning-700 dark:text-warning-300',
  emerald: 'text-success-600 dark:text-success-300',
  sky: 'text-sky-600 dark:text-sky-400',
  slate: 'text-neutral-500',
  teal: 'text-neutral-500',
  neutral: 'text-foreground',
};

interface PortfolioRowProps {
  row: LexPlaybookPortfolioRow;
  labels: PlaybookLabels;
}

export function PortfolioRow({ row, labels }: PortfolioRowProps) {
  const f = useLexFormat();
  const tone = complianceTone(row.compliance_score);
  const percent = clampPercent(row.compliance_score);
  // Below 60% is the failing band — emphasize it.
  const failing = tone === 'rose';

  return (
    <TableRow className={rowAccentClass('status', TONE_ACCENT_STATUS[tone])}>
      <TableCell className="min-w-[220px]">
        <div className="space-y-1.5">
          <span className="font-medium">{row.contract_title}</span>
          <div>
            <Badge variant="outline">
              {row.contract_type
                ? labels.contractTypeLabels[String(row.contract_type)] ??
                  formatToken(String(row.contract_type))
                : labels.anyType}
            </Badge>
          </div>
        </div>
      </TableCell>

      <TableCell className="min-w-[160px]">
        <span className="text-sm">{row.playbook_name}</span>
      </TableCell>

      <TableCell className="min-w-[180px]">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <span
              className={cnTone(TONE_TEXT_CLASS[tone], failing)}
              aria-label={`${percent}%`}
            >
              {f.formatNumber(percent)}%
            </span>
          </div>
          <Progress
            value={percent}
            indicatorClassName={TONE_INDICATOR_CLASS[tone]}
            aria-label={labels.portfolio.score}
          />
        </div>
      </TableCell>

      <TableCell>
        <CountBadge label={labels.portfolio.missing} value={row.missing_count} variant="destructive" />
      </TableCell>
      <TableCell>
        <CountBadge label={labels.portfolio.altered} value={row.altered_count} variant="warning" />
      </TableCell>
      <TableCell>
        <CountBadge label={labels.portfolio.extra} value={row.extra_count} variant="secondary" />
      </TableCell>

      <TableCell className="whitespace-nowrap">
        <span className="text-sm text-foreground">
          {f.formatRelative(row.generated_at)}
        </span>
        <p className="text-xs text-muted-foreground" dir="auto">
          {f.formatDual(row.generated_at)}
        </p>
      </TableCell>

      <TableCell className="text-end">
        <Button asChild variant="ghost" size="sm">
          {/* Cross-agent contract: the deviation review on the playbooks page
              reads ?contract={id} to preselect + run the report. */}
          <Link
            href={`/lex/playbooks?contract=${encodeURIComponent(row.contract_id)}`}
            className={cn(
              'group transition-colors duration-fast ease-standard',
            )}
          >
            {labels.portfolio.viewReview}
            <ArrowUpRight
              className="ms-1.5 h-4 w-4 transition-transform duration-fast ease-standard motion-safe:group-hover:translate-x-0.5 rtl:-scale-x-100"
              aria-hidden
            />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CountBadge({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: 'destructive' | 'warning' | 'secondary';
}) {
  const f = useLexFormat();
  if (!value) {
    return (
      <span
        className="text-sm tabular-nums text-muted-foreground"
        aria-label={`${label}: 0`}
      >
        {f.formatNumber(0)}
      </span>
    );
  }
  return (
    <Badge
      variant={variant}
      className="tabular-nums"
      aria-label={`${label}: ${value}`}
    >
      {f.formatNumber(value)}
    </Badge>
  );
}

/** Join the tone text class with an emphasis weight for the failing band. */
function cnTone(toneClass: string, failing: boolean): string {
  return [
    'text-sm tabular-nums',
    toneClass,
    failing ? 'font-semibold' : 'font-medium',
  ].join(' ');
}
