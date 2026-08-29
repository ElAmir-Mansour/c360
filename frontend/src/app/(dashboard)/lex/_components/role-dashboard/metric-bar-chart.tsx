'use client';

/**
 * Single-series vertical BAR chart for the role dashboards — pure CSS/flex
 * (no chart library), value label above each bar, localized category label
 * below. Bars share one brand-teal tone (single series ⇒ no legend, per the
 * dataviz rules). Heights are proportional to the series max.
 */

import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { BarDatum } from '../../_lib/role-dashboards/use-role-dashboard-data';

interface MetricBarChartProps {
  bars: BarDatum[];
  labelFor: (key: string) => string;
  /** Resolve every category to its underlying Lex register/filter. */
  hrefFor: (key: string) => string;
}

const BAR_COLOR = 'hsl(var(--chart-6))'; // brand teal
const MIN_H = 6; // px floor so a zero bar still reads as a baseline tick

export function MetricBarChart({ bars, labelFor, hrefFor }: MetricBarChartProps) {
  const f = useLexFormat();
  const max = Math.max(1, ...bars.map((b) => b.value));

  return (
    <div className="flex items-end justify-between gap-3 pt-4" style={{ height: 168 }}>
      {bars.map((b) => {
        const pct = (b.value / max) * 100;
        const display =
          b.unit === 'percent'
            ? f.formatPercent(b.value, { fromPercent: true, maximumFractionDigits: 0 })
            : f.formatNumber(b.value);
        const label = labelFor(b.key);
        return (
          <Link
            key={b.key}
            href={hrefFor(b.key)}
            aria-label={`${label}: ${display}`}
            title={`${label}: ${display}`}
            className={cn(
              'group flex min-w-0 flex-1 flex-col items-center justify-end gap-2 rounded-soft px-1',
              'outline-none transition-colors hover:bg-muted/40',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <span className="text-caption font-semibold tabular-nums text-foreground">{display}</span>
            <div
              className={cn(
                'w-full max-w-[3rem] rounded-t-soft transition-[height,opacity]',
                'group-hover:opacity-80 group-focus-visible:opacity-80',
              )}
              style={{
                height: `max(${MIN_H}px, ${pct}%)`,
                backgroundColor: BAR_COLOR,
                opacity: b.value === 0 ? 0.35 : 1,
              }}
              aria-hidden
            />
            <span className="w-full truncate text-center text-caption text-muted-foreground">
              {label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
