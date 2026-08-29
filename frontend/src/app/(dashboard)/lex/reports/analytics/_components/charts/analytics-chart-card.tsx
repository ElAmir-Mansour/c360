/**
 * <AnalyticsChartCard> — the premium frame that every Legal-Affairs analytics
 * chart sits inside.
 *
 * It standardises the chart chrome so the 10-chart dashboard reads as one
 * coherent grid: a rounded, glassy, elevated card with a header (title +
 * optional description + optional actions), a consistent minimum height, and
 * built-in `loading` (shimmer) and `empty` states so a chart never collapses or
 * jumps between states.
 *
 * Visual language is borrowed from `<LexListShell>` / `<SectionCard>` (rounded
 * border, `bg-card`, backdrop blur, soft elevation) so it feels native to the
 * Lex suite. Direction is read from the active locale and stamped on the root so
 * logical spacing + `rtl:` variants flip correctly in Arabic mode.
 *
 * PERF: wrapped in `React.memo`. Its children (the actual chart) are the
 * memoized chart components; this frame only re-renders when its own props
 * change. It contains NO data transforms — purely presentational.
 */

'use client';

import { memo, type ReactNode } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';

export interface AnalyticsChartCardProps {
  /** Card heading (already localized by the caller). */
  title: ReactNode;
  /** Optional supporting line under the title. */
  description?: ReactNode;
  /** Optional trailing header controls (e.g. a segmented toggle, legend chip). */
  actions?: ReactNode;
  /** The chart itself. */
  children: ReactNode;
  /** Shimmer skeleton in place of the body. */
  loading?: boolean;
  /** Empty state in place of the body (header stays visible). */
  empty?: boolean;
  /** Copy for the empty state. Caller passes a localized string. */
  emptyMessage?: ReactNode;
  /** Force a direction; otherwise derived from the active locale. */
  dir?: 'ltr' | 'rtl';
  /** Extra classes on the card root (e.g. column spans). */
  className?: string;
  /** Extra classes on the body region (e.g. a fixed chart height). */
  bodyClassName?: string;
  /**
   * Minimum body height so cards in a row align even with differing content.
   * Defaults to a comfortable chart height. Pass a Tailwind class via
   * `bodyClassName` to override precisely.
   */
  minBodyHeight?: number;
}

function AnalyticsChartCardImpl({
  title,
  description,
  actions,
  children,
  loading = false,
  empty = false,
  emptyMessage,
  dir,
  className,
  bodyClassName,
  minBodyHeight = 260,
}: AnalyticsChartCardProps) {
  const { direction } = useLocaleOrDefault();
  const resolvedDir: 'ltr' | 'rtl' = dir ?? (direction === 'rtl' ? 'rtl' : 'ltr');

  let body: ReactNode;
  if (loading) {
    body = (
      <div
        className="flex w-full animate-pulse flex-col gap-3 motion-reduce:animate-none"
        style={{ minHeight: minBodyHeight }}
        aria-hidden
      >
        <div className="h-3 w-1/3 rounded-pill bg-muted" />
        <div className="flex-1 rounded-card bg-muted/70" />
        <div className="flex gap-2">
          <div className="h-3 w-16 rounded-pill bg-muted" />
          <div className="h-3 w-16 rounded-pill bg-muted" />
          <div className="h-3 w-16 rounded-pill bg-muted" />
        </div>
      </div>
    );
  } else if (empty) {
    body = (
      <div
        className="flex w-full flex-col items-center justify-center gap-1 text-center"
        style={{ minHeight: minBodyHeight }}
      >
        <p className="text-sm font-medium text-muted-foreground">
          {emptyMessage ?? '—'}
        </p>
      </div>
    );
  } else {
    body = children;
  }

  return (
    <section
      dir={resolvedDir}
      className={cn(
        'group/chart flex flex-col overflow-hidden rounded-2xl border border-border/60',
        'bg-card/60 shadow-elevation-1',
        'motion-safe:transition-shadow motion-safe:duration-fast',
        'motion-safe:hover:shadow-elevation-2',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border/50 px-5 py-4">
        <div className="min-w-0 space-y-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </header>

      <div
        className={cn('flex-1 px-5 py-4', bodyClassName)}
        style={loading || empty ? undefined : { minHeight: minBodyHeight }}
      >
        {body}
      </div>
    </section>
  );
}

export const AnalyticsChartCard = memo(AnalyticsChartCardImpl);
