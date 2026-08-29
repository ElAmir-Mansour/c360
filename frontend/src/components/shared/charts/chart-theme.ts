'use client';

import { useEffect, useState } from 'react';
import { chartVar } from '@/lib/design-tokens';

/**
 * chart-theme — the single styling source of truth for the shared recharts
 * wrappers. Every wrapper reads axis/grid/cursor styling and series-color
 * defaults from here so all suites render charts in one visual language.
 *
 * Colors ride the design-token CSS variables via the JS mirror in
 * `src/lib/design-tokens.ts` (`chartVar` / `severityVar` / `statusVar`), so
 * charts re-theme automatically in dark mode — no hex anywhere in this layer.
 * recharts resolves `hsl(var(--x))` in SVG presentation attributes at paint
 * time, which keeps the tokens live.
 */

/**
 * Axis tick font size (px) — mirrors the `caption` step of the type scale
 * (0.75rem; see `fontSize.caption` in `src/styles/tokens/index.ts`). recharts
 * needs a concrete number for SVG text, so this constant is the numeric
 * mirror of that token — keep them in sync.
 */
export const CHART_TICK_FONT_SIZE = 12;

/** Muted, recessive axis ticks — shared by every cartesian wrapper. */
export const AXIS_TICK_STYLE = {
  fontSize: CHART_TICK_FONT_SIZE,
  fill: 'hsl(var(--muted-foreground))',
} as const;

/**
 * Grid lines ride the border token (`--border` aliases `--ds-border-default`
 * in globals.css), so the grid stays recessive in both themes.
 */
export const GRID_STROKE = 'hsl(var(--border))';
export const GRID_DASH = '3 3';

/** Hover cursors: hairline crosshair for line/area, soft band fill for bars. */
export const CURSOR_STROKE = { stroke: 'hsl(var(--border))', strokeWidth: 1 } as const;
export const CURSOR_FILL = { fill: 'hsl(var(--muted))' } as const;

/**
 * Default series color: series configs may omit `color` and inherit the
 * categorical `--chart-1..6` ramp in fixed order. The index is the series'
 * declaration position, so color follows the entity (never repainted when a
 * sibling series is filtered out).
 */
export function seriesColorAt(index: number, explicit?: string): string {
  return explicit ?? chartVar(index);
}

export type ChartDir = 'ltr' | 'rtl';

/**
 * useChartDir — reads the document direction. recharts does NOT mirror
 * automatically the way HTML/flexbox does, so the wrappers use this to move
 * the y-axis to the inline-start edge (visual right under RTL) and mirror the
 * plot margins. Reacts to runtime `dir` flips (locale switcher) via a
 * MutationObserver. The impls are client-only (`ssr: false`), so the lazy
 * initializer can safely read `document` on first render — no LTR flash.
 */
export function useChartDir(): ChartDir {
  const [dir, setDir] = useState<ChartDir>(() =>
    typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr',
  );

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDir(root.dir === 'rtl' ? 'rtl' : 'ltr');
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['dir'] });
    return () => observer.disconnect();
  }, []);

  return dir;
}

export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Standard plot margins, mirrored for RTL: the breathing room sits on the
 * side opposite the y-axis, and the y-axis moves to the right edge under RTL.
 */
export function chartMargin(dir: ChartDir): ChartMargin {
  return dir === 'rtl'
    ? { top: 5, right: 0, bottom: 5, left: 20 }
    : { top: 5, right: 20, bottom: 5, left: 0 };
}
