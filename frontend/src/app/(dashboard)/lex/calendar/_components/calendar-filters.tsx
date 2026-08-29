'use client';

/**
 * Type + severity filter chips for the Unified Legal Calendar.
 *
 * Two chip rows seated in the canonical lex filter container
 * (`rounded-xl border bg-card/40 p-4`). Each chip is a toggle;
 * an empty set means "all" (no filtering). Chips carry a left colour dot keyed
 * to the source/severity so the legend reads directly off the grid. RTL-safe via
 * logical spacing; the active count badge mirrors with the locale direction.
 */

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import {
  EVENT_SEVERITIES,
  EVENT_TYPES,
  type LegalEventSeverity,
  type LegalEventType,
} from '../_lib/calendar-events';
import { TYPE_DOT, SEVERITY_DOT } from './calendar-tokens';
import type { CalendarLabels } from '../_lib/calendar-i18n';

export interface CalendarFiltersProps {
  labels: CalendarLabels;
  /** Per-type event counts, for the chip count badges. */
  typeCounts: Record<LegalEventType, number>;
  severityCounts: Record<LegalEventSeverity, number>;
  activeTypes: Set<LegalEventType>;
  activeSeverities: Set<LegalEventSeverity>;
  onToggleType: (type: LegalEventType) => void;
  onToggleSeverity: (severity: LegalEventSeverity) => void;
  onClear: () => void;
}

export function CalendarFilters({
  labels,
  typeCounts,
  severityCounts,
  activeTypes,
  activeSeverities,
  onToggleType,
  onToggleSeverity,
  onClear,
}: CalendarFiltersProps) {
  const f = useLexFormat();
  const hasActive = activeTypes.size > 0 || activeSeverities.size > 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {labels.filters.heading}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={!hasActive}
          className={cn(
            'h-7 px-2.5 text-xs',
            !hasActive && 'pointer-events-none opacity-40',
          )}
        >
          {labels.filters.clear}
        </Button>
      </div>

      <ChipRow label={labels.filters.types}>
        {EVENT_TYPES.map((type) => (
          <FilterChip
            key={type}
            label={labels.type[type]}
            count={f.formatNumber(typeCounts[type] ?? 0)}
            dot={TYPE_DOT[type]}
            active={activeTypes.has(type)}
            onClick={() => onToggleType(type)}
          />
        ))}
      </ChipRow>

      <ChipRow label={labels.filters.severities}>
        {EVENT_SEVERITIES.map((severity) => (
          <FilterChip
            key={severity}
            label={labels.severity[severity]}
            count={f.formatNumber(severityCounts[severity] ?? 0)}
            dot={SEVERITY_DOT[severity]}
            active={activeSeverities.has(severity)}
            onClick={() => onToggleSeverity(severity)}
          />
        ))}
      </ChipRow>
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center">
      <span className="shrink-0 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground/80 sm:w-20">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  dot,
  active,
  onClick,
}: {
  label: string;
  count: string;
  dot: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        'transition-colors duration-fast ease-standard',
        active
          ? 'border-primary/40 bg-primary/10 text-primary shadow-elevation-1'
          : 'border-border/60 bg-card/60 text-muted-foreground hover:border-primary/30 hover:text-foreground',
      )}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden />
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 text-overline tabular-nums',
          active ? 'bg-primary/15 text-primary' : 'bg-secondary text-secondary-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}
