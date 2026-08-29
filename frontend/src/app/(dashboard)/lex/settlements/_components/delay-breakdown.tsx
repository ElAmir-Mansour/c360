'use client';

/**
 * Delay breakdown by category (case-timeline feature #3).
 *
 * Summarises the matter's CURRENTLY-OPEN delay burden by category: for every
 * unresolved delay event it accrues `(now - opened_at)` in whole days, groups by
 * `category`, and renders a compact horizontal stacked bar + a legend (category
 * label · open-day count). Colours come from the shared `StatTone` palette via
 * `delayCategoryMeta`, so a category looks identical here, on the timeline track
 * (#1), and on its event badge. When there are no open delays it shows the
 * `breakdown.noOpenDelays` message.
 *
 * Pure/derived: it owns NO data — everything comes from `timeline.delay_events`
 * (hydrated by `getTimeline`; guarded to `[]`). Kept intentionally small so it
 * sits inside the overview SectionCard without dominating it.
 *
 * RTL: the panel root sets `dir`; the bar is a plain flex row of percentage
 * widths (order flips naturally under `dir="rtl"`) with logical `me-`/gap
 * spacing, so it reads correctly in both directions.
 */

import { useMemo } from 'react';
import { CHART_COLORS, SEVERITY_COLORS } from '@/lib/design-tokens';
import type { StatTone } from '@/components/shared/stat-card';
import { delayCategoryMeta } from './delay-category-meta';
import { delayCategoryLabel, useSettlementLabels } from './labels';
import type { MatterTimeline } from '@/lib/lex/settlements';

/** Concrete accent colours per shared tone (mirrors the `.kpi-theme-*` accents). */
const TONE_COLOR: Record<StatTone, string> = {
  neutral: 'hsl(var(--muted-foreground))',
  emerald: SEVERITY_COLORS.low,
  gold: SEVERITY_COLORS.medium,
  sky: SEVERITY_COLORS.info,
  rose: SEVERITY_COLORS.critical,
  slate: CHART_COLORS[0],
  teal: CHART_COLORS[0],
};

const DAY_MS = 24 * 60 * 60 * 1000;

interface CategorySlice {
  category: string;
  label: string;
  days: number;
  color: string;
}

export interface DelayBreakdownProps {
  timeline: MatterTimeline;
  selectedCategory?: string | null;
  onSelectCategory?: (category: string | null) => void;
}

export function DelayBreakdown({
  timeline,
  selectedCategory = null,
  onSelectCategory,
}: DelayBreakdownProps) {
  const L = useSettlementLabels();
  const labels = L.timeline.breakdown;

  const { slices, total } = useMemo(() => {
    const now = Date.now();
    const events = timeline.delay_events ?? [];
    const byCategory = new Map<string, number>();

    for (const ev of events) {
      if (ev.resolved) continue;
      const opened = Date.parse(ev.opened_at);
      if (Number.isNaN(opened)) continue;
      // Whole open days contributed by this event (floor, min 0).
      const days = Math.max(0, Math.floor((now - opened) / DAY_MS));
      byCategory.set(ev.category, (byCategory.get(ev.category) ?? 0) + days);
    }

    const built: CategorySlice[] = Array.from(byCategory.entries())
      .map(([category, days]) => ({
        category,
        days,
        label: delayCategoryLabel(L, category),
        color: TONE_COLOR[delayCategoryMeta(category).tone],
      }))
      .filter((s) => s.days > 0)
      .sort((a, b) => b.days - a.days);

    return { slices: built, total: built.reduce((sum, s) => sum + s.days, 0) };
  }, [timeline, L]);

  return (
    <section className="space-y-3">
      <p className="text-sm font-medium text-foreground">{labels.title}</p>

      {slices.length === 0 || total === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.noOpenDelays}</p>
      ) : (
        <div className="space-y-3">
          {/* Stacked bar. */}
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-muted/60"
            role="group"
            aria-label={slices
              .map((s) => `${s.label}: ${L.timeline.duration.days(s.days)}`)
              .join(', ')}
          >
            {slices.map((s) => (
              <button
                type="button"
                key={s.category}
                onClick={() => onSelectCategory?.(selectedCategory === s.category ? null : s.category)}
                aria-pressed={selectedCategory === s.category}
                aria-label={`${s.label}: ${L.timeline.duration.days(s.days)}`}
                className="h-full transition hover:brightness-110 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{
                  width: `${(s.days / total) * 100}%`,
                  backgroundColor: s.color,
                  opacity: selectedCategory && selectedCategory !== s.category ? 0.3 : 1,
                }}
                title={`${s.label} · ${L.timeline.duration.days(s.days)}`}
              />
            ))}
          </div>

          {/* Legend: category label + open-day count. */}
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {slices.map((s) => (
              <li key={s.category}>
                <button
                  type="button"
                  onClick={() => onSelectCategory?.(selectedCategory === s.category ? null : s.category)}
                  aria-pressed={selectedCategory === s.category}
                  className="flex items-center gap-1.5 rounded text-xs transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                    aria-hidden
                  />
                  <span className="font-medium text-foreground">{s.label}</span>
                  <span className="text-muted-foreground">{L.timeline.duration.days(s.days)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
