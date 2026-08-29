'use client';

import * as React from 'react';
import { useEffect, useState } from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HighlightAnimation } from '@/components/realtime/highlight-animation';
import {
  StatTile,
  type StatTileAppearance,
  type StatTileSize,
} from '@/components/shared/stat-tile';
import { type StatTone, TONE_THEME_CLASS } from '@/components/shared/stat-card';

/**
 * @deprecated Use `StatTile` from `@/components/shared/stat-tile` — the
 * canonical KPI primitive. `<KpiCard>` remains as a thin adapter that keeps
 * every historic prop compiling (simple + rich modes, the 15 legacy color
 * themes, live-delta chips, highlight pulses) while delegating all rendering
 * to the canonical tile.
 */

export type KpiColorTheme =
  | 'red' | 'orange' | 'amber' | 'yellow'
  | 'green' | 'emerald' | 'teal' | 'cyan'
  | 'sky' | 'blue' | 'indigo' | 'violet'
  | 'purple' | 'pink' | 'primary';

/** Structured trend descriptor used by the rich/linked KPI layout. */
export interface KpiTrend {
  value: number;
  label: string;
  direction: 'up' | 'down' | 'neutral';
  sentiment: 'good' | 'bad' | 'neutral';
}

export interface KpiCardProps {
  title: string;
  value: string | number | undefined;
  /** Optional unit/suffix rendered next to the value (rich layout). */
  unit?: string;
  /** Signed percentage change — simple layout trend pill. */
  change?: number;
  changeLabel?: string;
  icon?: LucideIcon;
  iconColor?: string;
  /** Explicit color theme. When omitted, auto-derived from iconColor. */
  colorTheme?: KpiColorTheme;
  /**
   * Stream-E semantic tone (emerald/gold/sky/rose/slate/neutral). When set it
   * takes precedence over `colorTheme`/`iconColor` and maps onto the same
   * materialized `.kpi-theme-*` palette.
   */
  tone?: StatTone;
  /** Opt into the flat, data-dense operational card treatment. */
  appearance?: StatTileAppearance;
  /** Opt into the per-card colour wash (operational appearance only). */
  accent?: boolean;
  /** Defaults to `lg`, or `md` when `appearance="operational"`. */
  size?: Extract<StatTileSize, 'md' | 'lg'>;
  description?: string;
  /** Short hover explanation for the number and its reporting scope. */
  hint?: string;
  /** Simple-layout loading state. */
  loading?: boolean;
  /** Optional progress ratio for compact dashlets, expressed as 0..100. */
  progress?: number;
  /** Label rendered beside the compact progress rail. */
  progressLabel?: string;
  /** Compact metadata line rendered in the card footer. */
  detail?: string;
  /** Optional supporting metric rendered as an end-aligned footer value. */
  detailValue?: string | number;
  /** Rich-layout loading state (alias of `loading`). */
  isLoading?: boolean;
  /** Rich-layout error state — renders an em-dash placeholder. */
  isError?: boolean;
  /** Navigates the whole card; renders an external-link affordance. */
  href?: string;
  /** Makes the whole card an accessible button. Do not combine with `href`. */
  onAction?: () => void;
  /** Optional toggle state announced by an actionable card. */
  pressed?: boolean;
  /** Disables an actionable card. */
  disabled?: boolean;
  /** Structured trend descriptor (rich layout). */
  trend?: KpiTrend;
  /** Historic staggered-entrance index — accepted for compatibility. */
  index?: number;
  /** Real-time delta chip (rich layout). */
  liveDelta?: number | null;
  /** Pulse highlight trigger (rich layout). */
  highlightKey?: number | null;
  /** Inline content (e.g. a sparkline) rendered in the tile footer. */
  children?: React.ReactNode;
  className?: string;
}

/** Map common Tailwind icon-color class fragments to theme names. */
function deriveTheme(iconColor: string | undefined): KpiColorTheme {
  if (!iconColor) return 'primary';
  const c = iconColor.toLowerCase();
  const families: KpiColorTheme[] = [
    'emerald', 'orange', 'amber', 'yellow',
    'green', 'teal', 'cyan', 'sky',
    'blue', 'indigo', 'violet', 'purple',
    'pink', 'red',
  ];
  for (const f of families) {
    if (c.includes(f)) return f;
  }
  if (c.includes('destructive')) return 'red';
  return 'primary';
}

/** @deprecated Thin adapter over the canonical `StatTile`. */
export function KpiCard({
  title,
  value,
  unit,
  change,
  changeLabel,
  icon: Icon,
  iconColor = 'text-primary',
  colorTheme,
  tone,
  appearance = 'default',
  accent = false,
  size,
  description,
  hint,
  loading = false,
  progress,
  progressLabel,
  detail,
  detailValue,
  isLoading,
  isError = false,
  href,
  onAction,
  pressed,
  disabled,
  trend,
  index: _index = 0,
  liveDelta = null,
  highlightKey = null,
  children,
  className,
}: KpiCardProps) {
  // Precedence: explicit `tone` → explicit `colorTheme` → derive from iconColor.
  // `neutral` keeps a brand chip (historic behavior) via kpi-theme-primary.
  const themeClass = tone
    ? TONE_THEME_CLASS[tone] || 'kpi-theme-primary'
    : `kpi-theme-${colorTheme ?? deriveTheme(iconColor)}`;

  // Real-time delta chip: shown for 3s whenever `liveDelta` changes.
  const [showDelta, setShowDelta] = useState(false);
  useEffect(() => {
    if (!liveDelta) {
      return;
    }
    setShowDelta(true);
    const timeout = window.setTimeout(() => setShowDelta(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [liveDelta]);

  const valueExtra =
    showDelta && liveDelta ? (
      <span
        className={cn(
          'rounded-full px-2.5 py-1 text-caption font-semibold motion-safe:animate-fade-up',
          liveDelta > 0
            ? 'bg-status-warning/10 text-status-warning'
            : 'bg-primary/10 text-primary',
        )}
      >
        {liveDelta > 0 ? `+${liveDelta}` : `${liveDelta}`}
      </span>
    ) : undefined;

  const delta = trend
    ? {
        value: trend.value,
        direction: trend.direction,
        sentiment: trend.sentiment,
        label: trend.label,
        percent: false,
      }
    : change !== undefined
      ? { value: change, label: changeLabel, percent: true }
      : undefined;
  const resolvedSize = size ?? (appearance === 'operational' ? 'md' : 'lg');

  return (
    <HighlightAnimation highlight={highlightKey !== null} highlightKey={highlightKey}>
      <StatTile
        size={resolvedSize}
        appearance={appearance}
        accent={accent}
        label={title}
        value={value}
        unit={unit}
        icon={Icon}
        themeClass={themeClass}
        delta={delta}
        spark={children}
        valueExtra={valueExtra}
        description={description}
        hint={hint}
        progress={progress}
        progressLabel={progressLabel}
        detail={detail}
        detailValue={detailValue}
        loading={isLoading ?? loading}
        error={isError}
        href={href}
        onAction={onAction}
        pressed={pressed}
        disabled={disabled}
        className={className}
      />
    </HighlightAnimation>
  );
}
