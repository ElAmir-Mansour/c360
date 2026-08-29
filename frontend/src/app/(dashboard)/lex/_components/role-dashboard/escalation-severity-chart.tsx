'use client';

/**
 * Escalation & Risk Warnings — a horizontal severity BAR chart for the role
 * dashboards. Each row is one severity tier (ordered most→least severe): a
 * status-coloured bar whose length is proportional to the tier's share of the
 * risk queue, with the tier NAME and COUNT directly labelled so identity is never
 * colour-alone.
 *
 * Follows the same hand-rolled, no-chart-library approach as the sibling
 * `MetricBarChart` / `DistributionDonut`. Per the dataviz rules: a single measure
 * (count) ⇒ no legend; the hues are the RESERVED severity palette (`severityVar`,
 * critical→red … info→blue), which ships with a text label and re-themes in dark
 * mode; value/label text wears text tokens, never the mark colour. Logical
 * `start-0` keeps the fill anchored to the reading edge under RTL.
 */

import { useLexFormat } from '@/lib/lex/ksa';
import { severityVar } from '@/lib/design-tokens';
import Link from 'next/link';
import type { AttentionSeverity } from '../../_lib/use-lex-command-center';
import type { SeverityDatum } from '../../_lib/role-dashboards/use-role-dashboard-data';

interface EscalationSeverityChartProps {
  data: SeverityDatum[];
  total: number;
  labelFor: (severity: AttentionSeverity) => string;
  /** Unit noun for the total line (e.g. "warnings"). */
  totalLabel: string;
  /** Resolve a severity tier to the filtered attention register. */
  hrefFor: (severity: AttentionSeverity) => string;
}

const MIN_PCT = 6; // width floor so a single-item tier still reads as a bar

export function EscalationSeverityChart({
  data,
  total,
  labelFor,
  totalLabel,
  hrefFor,
}: EscalationSeverityChartProps) {
  const f = useLexFormat();
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {data.map((d) => {
          const pct = Math.max((d.count / max) * 100, MIN_PCT);
          const color = severityVar(d.severity);
          const label = labelFor(d.severity);
          const count = f.formatNumber(d.count);
          return (
            <li key={d.severity}>
              <Link
                href={hrefFor(d.severity)}
                aria-label={`${label}: ${count}`}
                title={`${label}: ${count}`}
                className="flex items-center gap-3 rounded-soft px-1 py-1 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex w-24 shrink-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span className="truncate text-sm text-foreground">{label}</span>
                </span>
                <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                  <span
                    className="absolute inset-y-0 start-0 rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                    aria-hidden
                  />
                </span>
                <span className="w-10 shrink-0 text-end text-sm font-semibold tabular-nums text-foreground">
                  {count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-caption text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">
          {f.formatNumber(total)}
        </span>{' '}
        {totalLabel}
      </p>
    </div>
  );
}
