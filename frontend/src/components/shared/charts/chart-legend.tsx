'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { seriesColorAt } from './chart-theme';

/**
 * ChartLegend — THE unified legend for every shared chart wrapper.
 *
 * Mirrors ChartTooltip's token styling (2.5-unit `rounded-pill` swatch,
 * `text-body-sm` type-scale step, `text-muted-foreground` ink) so the legend
 * and tooltip read as one system. Identity always rides the swatch + text
 * label, never color alone.
 *
 * Two ways in:
 *  - recharts injection: `<Legend content={<ChartLegend />} />` — recharts
 *    clones the element with a `payload` prop that is mapped to items here.
 *  - standalone `items`: used by the pie wrapper (vertical orientation with a
 *    percentage `detail` column and hide/show toggling).
 *
 * RTL-safe by construction: plain flexbox + logical utilities (`ms-auto`,
 * `text-start`), so it mirrors with the document direction — no recharts
 * coordinate math involved.
 */

export interface ChartLegendItem {
  key: string;
  label: string;
  color: string;
  /** Toggled-off entries render dimmed + struck-through (interactive legends). */
  hidden?: boolean;
  /** Optional trailing detail (e.g. "42.1%"), end-aligned in vertical mode. */
  detail?: string;
}

/** Shape recharts injects when this renders via `<Legend content={…} />`. */
interface RechartsLegendPayloadEntry {
  value?: string | number;
  color?: string;
  dataKey?: unknown;
  inactive?: boolean;
}

export interface ChartLegendProps {
  /** Explicit items (standalone usage, e.g. the pie legend). Wins over `payload`. */
  items?: ChartLegendItem[];
  /** Injected by recharts when used as `<Legend content={<ChartLegend />} />`. */
  payload?: ReadonlyArray<RechartsLegendPayloadEntry>;
  /** When provided, entries become toggle buttons (`aria-pressed` = visible). */
  onToggle?: (key: string) => void;
  /** When provided, entries select a data bucket without changing visibility. */
  onSelect?: (key: string) => void;
  /** Row (default, below cartesian charts) or column (beside a pie). */
  orientation?: 'horizontal' | 'vertical';
  /**
   * Main-axis alignment for the horizontal orientation. Named `justify` (not
   * `align`) on purpose: recharts clones its own `align` prop onto legend
   * content, which would silently clobber a prop of the same name.
   */
  justify?: 'start' | 'center' | 'end';
  className?: string;
}

function payloadToItems(payload: ReadonlyArray<RechartsLegendPayloadEntry>): ChartLegendItem[] {
  return payload.map((entry, index) => ({
    key: String(entry.dataKey ?? entry.value ?? index),
    label: String(entry.value ?? entry.dataKey ?? ''),
    color: entry.color ?? seriesColorAt(index),
    hidden: entry.inactive,
  }));
}

const JUSTIFY_CLASS: Record<NonNullable<ChartLegendProps['justify']>, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
};

function LegendSwatch({ color, hidden }: { color: string; hidden?: boolean }) {
  return (
    <span
      className={cn(
        'h-2.5 w-2.5 shrink-0 rounded-pill transition-opacity duration-fast ease-standard',
        hidden && 'opacity-30',
      )}
      // Token CSS-var reference (hsl(var(--chart-N))) — resolves live, re-themes
      // in dark mode. Same pattern as ChartTooltip's swatch.
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

export function ChartLegend({
  items,
  payload,
  onToggle,
  onSelect,
  orientation = 'horizontal',
  justify = 'center',
  className,
}: ChartLegendProps) {
  const resolved = items ?? (payload ? payloadToItems(payload) : []);
  if (resolved.length === 0) return null;

  const vertical = orientation === 'vertical';

  return (
    <ul
      className={cn(
        'text-body-sm',
        vertical
          ? 'flex w-full min-w-0 flex-col gap-2'
          : cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2', JUSTIFY_CLASS[justify]),
        className,
      )}
    >
      {resolved.map((item) => {
        const content = (
          <>
            <LegendSwatch color={item.color} hidden={item.hidden} />
            <span
              className={cn(
                'truncate text-muted-foreground transition-opacity duration-fast ease-standard',
                item.hidden && 'line-through opacity-70',
              )}
            >
              {item.label}
            </span>
            {item.detail !== undefined && (
              <span
                className={cn(
                  'shrink-0 tabular-nums text-muted-foreground',
                  vertical && 'ms-auto',
                )}
              >
                {item.detail}
              </span>
            )}
          </>
        );

        return (
          <li key={item.key} className={cn('min-w-0', vertical && 'w-full')}>
            {onToggle || onSelect ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  onSelect ? onSelect(item.key) : onToggle?.(item.key)
                }
                aria-pressed={onToggle ? !item.hidden : undefined}
                className={cn(
                  'h-auto min-w-0 items-center gap-1.5 rounded-input p-0 text-start font-normal transition-opacity duration-fast ease-standard hover:bg-transparent hover:opacity-80',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  vertical && 'w-full',
                )}
              >
                {content}
              </Button>
            ) : (
              <span className={cn('flex min-w-0 items-center gap-1.5', vertical && 'w-full')}>
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
