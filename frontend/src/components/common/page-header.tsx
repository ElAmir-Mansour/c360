import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge, type BadgeProps } from '@/components/ui/badge';

/** A single chip in the optional `tags` row. */
export interface PageHeaderTag {
  label: React.ReactNode;
  /** Optional leading icon node (e.g. a lucide icon element). */
  icon?: React.ReactNode;
  /** Visual tone for the chip; defaults to neutral. */
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
}

/** A single stat in the optional inline meta row. */
export interface PageHeaderStat {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Optional accent color for the value (any CSS color / token). */
  accent?: string;
}

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * Optional small muted label above the title. No default — the header stays
   * quiet unless a page explicitly opts in. Renders as plain overline text
   * (not a pill). Passing `null`/`false` keeps it hidden, as before.
   */
  eyebrow?: React.ReactNode;
  /** Optional breadcrumb slot rendered above the title block. */
  breadcrumb?: React.ReactNode;
  /** Optional chip row rendered under the title/description as quiet badges. */
  tags?: PageHeaderTag[];
  /**
   * Optional custom node rendered on the trailing side, above the actions row.
   * Prefer the structured `stats` prop, which renders a compact inline meta row.
   */
  aside?: React.ReactNode;
  /** Convenience: render a compact inline stat row without composing `aside`. */
  stats?: PageHeaderStat[];
  className?: string;
}

/**
 * Maps the legacy tag `tone` API onto the canonical Badge variants so existing
 * callers keep their semantic color without the old bespoke chip styling. The
 * `info` tone has no Badge variant, so it overrides the secondary variant with
 * the token-bound info ramp (mirrors the success/warning/destructive recipes).
 */
const TAG_TONE_BADGE: Record<
  NonNullable<PageHeaderTag['tone']>,
  { variant: BadgeProps['variant']; className?: string }
> = {
  neutral: { variant: 'secondary' },
  primary: { variant: 'default' },
  success: { variant: 'success' },
  warning: { variant: 'warning' },
  danger: { variant: 'destructive' },
  info: {
    variant: 'secondary',
    className:
      'border-info-300/60 bg-info-50 text-info-700 hover:bg-info-100 dark:border-info-700/60 dark:bg-info-700/15 dark:text-info-300 dark:hover:bg-info-700/25',
  },
};

/**
 * Quiet, flat page header: breadcrumb slot, title on the shared type scale
 * (`text-h1`, Inter semibold, tight tracking), muted description, and an
 * end-aligned actions row. No card chrome, gradients, blur, or fixed heights —
 * spacing rides the design-system space scale and every color is a semantic
 * token, so it re-themes in dark mode and mirrors correctly in RTL.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  breadcrumb,
  tags,
  aside,
  stats,
  className,
}: PageHeaderProps) {
  const hasTags = Boolean(tags && tags.length > 0);
  const hasStats = Boolean(stats && stats.length > 0);

  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {breadcrumb && (
        <div className="text-body-sm text-muted-foreground">{breadcrumb}</div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0 flex-1 space-y-1.5">
          {eyebrow != null && eyebrow !== false && (
            <p className="text-overline font-medium uppercase text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1 className="text-h1 font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="max-w-prose text-body-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        {(actions || aside) && (
          <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
            {aside}
            {actions && (
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {actions}
              </div>
            )}
          </div>
        )}
      </div>

      {hasTags && (
        <div className="flex flex-wrap items-center gap-2">
          {tags!.map((tag, i) => {
            const tone = TAG_TONE_BADGE[tag.tone ?? 'neutral'];
            return (
              <Badge
                key={i}
                variant={tone.variant}
                className={cn('gap-1.5', tone.className)}
              >
                {tag.icon}
                {tag.label}
              </Badge>
            );
          })}
        </div>
      )}

      {hasStats && (
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {stats!.map((stat, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <dt className="text-caption font-medium uppercase tracking-label text-muted-foreground">
                {stat.label}
              </dt>
              <dd
                className="text-body-sm font-semibold tabular-nums text-foreground"
                style={stat.accent ? { color: stat.accent } : undefined}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
