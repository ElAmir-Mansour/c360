'use client';

/**
 * Cross-domain distribution DONUT — a hand-rolled SVG (no chart library, no
 * ResponsiveContainer, mirroring the analytics suite's recharts-avoidance) with
 * a center total and a legend of value counts. Colors come from the shared
 * categorical series palette so it re-themes in dark mode.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useLexFormat } from '@/lib/lex/ksa';
import { seriesVar } from '../../reports/analytics/_components/charts/_lib/palette';
import type { DonutSlice } from '../../_lib/role-dashboards/use-role-dashboard-data';
import { useRoleDashboardStrings } from '../../_lib/role-dashboards/i18n';

interface DistributionDonutProps {
  slices: DonutSlice[];
  total: number;
  /** Resolve every domain slice to its underlying Lex register. */
  hrefFor: (key: string) => string;
}

const SIZE = 168;
const STROKE = 26;
const RADIUS = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;
const GAP = 2; // px surface gap between arcs

export function DistributionDonut({ slices, total, hrefFor }: DistributionDonutProps) {
  const f = useLexFormat();
  const { t } = useRoleDashboardStrings();

  const arcs = useMemo(() => {
    if (total <= 0) return [];
    let offset = 0;
    return slices.map((s, i) => {
      const fraction = s.value / total;
      const len = Math.max(fraction * CIRC - GAP, 0);
      const arc = { key: s.key, value: s.value, color: seriesVar(i), len, offset };
      offset += fraction * CIRC;
      return arc;
    });
  }, [slices, total]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-6">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="group"
          aria-label={t('panel.distribution')}
          className="-rotate-90"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={STROKE}
            opacity={0.35}
          />
          {arcs.map((a) => {
            const label = t(`dist.${a.key}`);
            const value = f.formatNumber(a.value);
            return (
              <a
                key={a.key}
                href={hrefFor(a.key)}
                aria-label={`${label}: ${value}`}
                className="group"
              >
                <title>{`${label}: ${value}`}</title>
                <circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${a.len} ${CIRC - a.len}`}
                  strokeDashoffset={-a.offset}
                  strokeLinecap="butt"
                  className="cursor-pointer transition-opacity group-hover:opacity-80 group-focus-visible:opacity-70"
                />
              </a>
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-h2 font-semibold tabular-nums text-foreground">{f.formatNumber(total)}</span>
          <span className="text-caption text-muted-foreground">{t('ui.total')}</span>
        </div>
      </div>

      <ul className="flex-1 space-y-2 text-sm">
        {slices.map((s, i) => {
          const label = t(`dist.${s.key}`);
          const value = f.formatNumber(s.value);
          return (
            <li key={s.key}>
              <Link
                href={hrefFor(s.key)}
                aria-label={`${label}: ${value}`}
                className="flex items-center justify-between gap-3 rounded-soft px-1 py-1 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: seriesVar(i) }}
                    aria-hidden
                  />
                  <span className="text-foreground">{label}</span>
                </span>
                <span className="font-semibold tabular-nums text-muted-foreground">{value}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
