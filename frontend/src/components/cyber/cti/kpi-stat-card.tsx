'use client';

import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import { cn } from '@/lib/utils';

interface KPIStatCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
  trend?: { direction: 'increasing' | 'decreasing' | 'stable' | 'up' | 'down'; percentage: number };
  /**
   * Semantic tonal accent (decorative only). When set, the tile rides the
   * materialized `.kpi-card-themed` / `.kpi-theme-*` surface — faded gradient +
   * orb + accent border, with the value text staying neutral (`text-foreground`).
   * Defaults to `"neutral"` (legacy flat card). Prefer this over `color`.
   */
  tone?: StatTone;
  color?: string;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function CTIKPIStatCard({
  label,
  value,
  subtitle,
  trend,
  tone = 'neutral',
  color,
  icon,
  onClick,
  className,
}: KPIStatCardProps) {
  const formatted = typeof value === 'number' ? value.toLocaleString() : value;
  const toned = tone !== 'neutral';

  const normalizedDirection =
    trend?.direction === 'up'
      ? 'increasing'
      : trend?.direction === 'down'
        ? 'decreasing'
        : trend?.direction;

  const TrendIcon = normalizedDirection === 'increasing' ? TrendingUp
    : normalizedDirection === 'decreasing' ? TrendingDown
    : Minus;

  // For threat/risk KPIs: increasing = bad (rose), decreasing = good (brand green).
  const trendColor = normalizedDirection === 'increasing' ? 'text-rose-500'
    : normalizedDirection === 'decreasing' ? 'text-primary'
    : 'text-foreground/45';

  // Toned variant: consume the materialized `.kpi-card-themed` surface so the
  // gradient/orb/border accents come from globals.css. Value text stays neutral;
  // only the label picks up `--kpi-accent`. Ignores the legacy `color` override.
  if (toned) {
    return (
      <div
        className={cn(
          'kpi-card-themed',
          TONE_THEME_CLASS[tone],
          onClick && 'cursor-pointer',
          className,
        )}
        onClick={onClick}
      >
        <div className="flex items-start justify-between gap-3">
          <p
            className="text-overline font-semibold uppercase tracking-caps-xwide"
            style={{ color: 'var(--kpi-accent)' }}
          >
            {label}
          </p>
          {icon && (
            <div className="kpi-icon-badge shrink-0">
              {icon}
            </div>
          )}
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            {formatted}
          </span>
          {trend && (
            <span className={`flex items-center gap-0.5 text-[11px] font-medium ${trendColor}`}>
              <TrendIcon className="h-3 w-3" />
              {Math.abs(trend.percentage).toFixed(1)}%
            </span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
    );
  }

  return (
    <Card
      className={cn(
        'border-primary/12 bg-card shadow-[0_8px_24px_-16px_rgba(15,23,42,0.10)] transition-all hover:shadow-[0_12px_32px_-16px_rgba(15,23,42,0.16)]',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
      style={color ? { borderColor: color } : undefined}
    >
      <CardContent className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-overline font-semibold uppercase tracking-caps-xwide text-foreground/55">{label}</p>
          {icon && <div className="text-foreground/55">{icon}</div>}
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span
            className="text-2xl font-semibold tracking-tight tabular-nums text-foreground"
            style={color ? { color } : undefined}
          >
            {formatted}
          </span>
          {trend && (
            <span className={`flex items-center gap-0.5 text-[11px] font-medium ${trendColor}`}>
              <TrendIcon className="h-3 w-3" />
              {Math.abs(trend.percentage).toFixed(1)}%
            </span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 text-[11px] text-foreground/55">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}
