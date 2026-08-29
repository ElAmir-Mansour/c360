import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { type LucideIcon } from 'lucide-react';
import { StatTile, type StatTileTone } from '@/components/shared/stat-tile';

/**
 * @deprecated Use `StatTile` (size `sm`) from `@/components/shared/stat-tile`
 * — the canonical KPI primitive. `<MetricTile>` remains as a thin adapter so
 * the dense metric-strip call sites keep compiling.
 */

/** @deprecated Legacy cva kept only for class-composition call sites. */
const metricTileVariants = cva(
  'flex items-center gap-3 rounded-xl border border-border bg-card/50 px-4 py-3',
  {
    variants: {
      tone: {
        primary: '',
        success: '',
        warning: '',
        danger: '',
        info: '',
        muted: '',
      },
    },
    defaultVariants: {
      tone: 'primary',
    },
  },
);

type Tone = NonNullable<VariantProps<typeof metricTileVariants>['tone']>;

const TONE_TO_TILE: Record<Tone, StatTileTone> = {
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  muted: 'neutral',
};

export interface MetricTileProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof metricTileVariants> {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  /** Signed percentage delta; sign drives the trend color + arrow. */
  delta?: number;
  deltaLabel?: string;
}

/** @deprecated Thin adapter over the canonical `StatTile` (size `sm`). */
export function MetricTile({
  label,
  value,
  icon,
  tone,
  delta,
  deltaLabel,
  className,
  ...props
}: MetricTileProps) {
  return (
    <StatTile
      size="sm"
      label={label}
      value={value}
      icon={icon}
      tone={TONE_TO_TILE[tone ?? 'primary']}
      delta={
        delta !== undefined
          ? { value: delta, label: deltaLabel, percent: true }
          : undefined
      }
      className={className}
      {...props}
    />
  );
}

export { metricTileVariants };
