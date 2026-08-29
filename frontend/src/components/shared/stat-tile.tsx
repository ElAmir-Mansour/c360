import * as React from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  CircleHelp,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { statisticHint } from '@/lib/lex/statistic-hint';
import { IconBadge } from '@/components/shared/icon-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * StatTile — THE canonical KPI primitive for the platform.
 *
 * One component covers every stat surface the suites used to hand-roll
 * (`KpiCard`, `StatCard`, `DetailStatCard`, `MetricTile`, `dashboard/KpiCard`
 * are now thin deprecated delegates onto this):
 *
 *   - `label` + `value` (+ optional `unit`)
 *   - `delta` with direction + sentiment-driven color (token `--status-*`)
 *   - leading `icon` chip, trailing `badge` slot
 *   - `spark` slot for sparklines / inline charts
 *   - semantic `tone` mapped onto the materialized `.kpi-theme-*` token ramps
 *     (with a `themeClass` escape hatch for the legacy 15-color themes)
 *   - `size`: `sm` (dense inline strip) / `md` (standard tile) / `lg` (hero)
 *   - `loading` skeleton state, `error` em-dash state, `href` navigation
 *   - `description` / `helper` copy, `progress` rail, `detail`/`detailValue`
 *     footer
 *
 * All colors ride design-system tokens; the themed surfaces come from the
 * materialized `.kpi-card-themed` / `.kpi-icon-badge` classes in globals.css,
 * so the tile re-themes in dark mode and flips under RTL automatically.
 */

export type StatTileTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export type StatTileSize = 'sm' | 'md' | 'lg';

/**
 * `operational` is the compact, flat treatment for scan-heavy KPI grids. It
 * deliberately omits the decorative accent rail and elevated hover motion;
 * the semantic theme is still carried by the label, icon and progress rail.
 */
export type StatTileAppearance = 'default' | 'operational';

export interface StatTileDelta {
  value: number;
  /** Arrow direction. Defaults from the sign of `value`. */
  direction?: 'up' | 'down' | 'neutral';
  /** Color semantics. Defaults: up → good, down → bad. */
  sentiment?: 'good' | 'bad' | 'neutral';
  /** Trailing muted label, e.g. "vs last week". */
  label?: string;
  /** Format the value as a signed percentage (`+3.2%`). */
  percent?: boolean;
}

export interface StatTileProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  label: string;
  value?: React.ReactNode;
  /** Unit / suffix rendered beside the value. */
  unit?: string;
  /** Signed number (rendered as a %) or a structured descriptor. */
  delta?: number | StatTileDelta;
  icon?: LucideIcon;
  /** Sparkline / inline chart slot, rendered in the tile footer. */
  spark?: React.ReactNode;
  /** Trailing adornment (status chip, live indicator) at the top edge. */
  badge?: React.ReactNode;
  /** Inline adornment rendered right after the value (live-delta chips). */
  valueExtra?: React.ReactNode;
  /** Semantic tone → materialized `.kpi-theme-*` token ramp. */
  tone?: StatTileTone;
  /**
   * Escape hatch: a raw `.kpi-theme-*` class (legacy KpiCard color themes).
   * Wins over `tone` when provided.
   */
  themeClass?: string;
  size?: StatTileSize;
  /** Visual treatment. Defaults to the existing elevated/themed card. */
  appearance?: StatTileAppearance;
  /**
   * Opt-in colour wash for the flat `operational` tile: a whisper-tinted
   * surface plus a 3px top strip drawn from the tile's own theme accent
   * (`--kpi-accent-resolved`). Off by default so every existing KPI strip
   * stays flat; turn it on where distinct per-card colour is wanted. No-op
   * for the elevated `default` appearance (already themed).
   */
  accent?: boolean;
  /** Renders a shaped skeleton in place of the content. */
  loading?: boolean;
  /** Renders an em-dash value (failed to load). */
  error?: boolean;
  /** Navigates the whole tile; renders a subtle link affordance. */
  href?: string;
  /**
   * Makes the whole tile an accessible button. Do not combine with `href`;
   * navigation takes precedence when both are supplied.
   */
  onAction?: () => void;
  /** Optional toggle state announced by an actionable tile. */
  pressed?: boolean;
  /** Disables an actionable tile. */
  disabled?: boolean;
  /** Supporting copy under the value (md/lg). */
  description?: string;
  /** Short hover explanation for what the statistic represents. */
  hint?: string;
  /** Small muted footnote under the value (sm/md). */
  helper?: string;
  /** Progress ratio 0..100 → token-accented rail. */
  progress?: number;
  progressLabel?: string;
  /** Footer metadata line (start-aligned text + end-aligned value). */
  detail?: string;
  detailValue?: React.ReactNode;
  className?: string;
}

/* ------------------------------------------------------------------------- */

const TONE_THEME: Record<StatTileTone, string> = {
  neutral: '',
  primary: 'kpi-theme-primary',
  success: 'kpi-theme-emerald',
  warning: 'kpi-theme-amber',
  danger: 'kpi-theme-red',
  info: 'kpi-theme-sky',
};

const TONE_ICON_BADGE: Record<
  StatTileTone,
  'muted' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
> = {
  neutral: 'muted',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

/**
 * Neutral palette for `.kpi-card-themed`: achromatic, token-bound values for
 * the vars the themed surface reads, so a neutral tile is a quieter sibling of
 * the toned ones (and re-themes for dark mode via the same tokens).
 */
const NEUTRAL_KPI_VARS: React.CSSProperties = {
  ['--kpi-bg' as string]:
    'linear-gradient(135deg, hsl(var(--ds-surface-card)), hsl(var(--ds-bg-subtle)) 70%)',
  ['--kpi-border' as string]: 'hsl(var(--ds-border-default) / 0.7)',
  ['--kpi-border-hover' as string]: 'hsl(var(--ds-border-default))',
  ['--kpi-orb' as string]: 'hsl(var(--ds-text-muted))',
  ['--kpi-orb-alt' as string]: 'hsl(var(--ds-text-secondary))',
  ['--kpi-icon-bg' as string]:
    'linear-gradient(135deg, hsl(var(--ds-text-secondary)), hsl(var(--ds-text-muted)))',
  ['--kpi-accent' as string]: 'hsl(var(--ds-text-muted))',
};

/** Theme plumbing normally supplied by `.kpi-card-themed`. */
const OPERATIONAL_KPI_VARS: React.CSSProperties = {
  ['--kpi-accent-resolved' as string]:
    'var(--kpi-accent, hsl(var(--ds-brand-primary)))',
  ['--kpi-chip-bg' as string]:
    'color-mix(in srgb, var(--kpi-accent-resolved) 12%, transparent)',
  ['--kpi-accent-ring' as string]:
    'color-mix(in srgb, var(--kpi-accent-resolved) 34%, transparent)',
};

interface NormalizedDelta {
  value: number;
  direction: 'up' | 'down' | 'neutral';
  sentiment: 'good' | 'bad' | 'neutral';
  label?: string;
  percent: boolean;
}

function normalizeDelta(delta: number | StatTileDelta): NormalizedDelta {
  const d: StatTileDelta =
    typeof delta === 'number' ? { value: delta, percent: true } : delta;
  const direction =
    d.direction ?? (d.value > 0 ? 'up' : d.value < 0 ? 'down' : 'neutral');
  const sentiment =
    d.sentiment ??
    (direction === 'up' ? 'good' : direction === 'down' ? 'bad' : 'neutral');
  return {
    value: d.value,
    direction,
    sentiment,
    label: d.label,
    percent: d.percent ?? false,
  };
}

const SENTIMENT_TEXT: Record<NormalizedDelta['sentiment'], string> = {
  good: 'text-status-success',
  bad: 'text-status-error',
  neutral: 'text-muted-foreground',
};

const SENTIMENT_BG: Record<NormalizedDelta['sentiment'], string> = {
  good: 'bg-status-success/10',
  bad: 'bg-status-error/10',
  neutral: 'bg-muted',
};

const DIRECTION_ICON: Record<NormalizedDelta['direction'], LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
};

function formatDeltaValue(d: NormalizedDelta): string {
  const sign = d.value > 0 ? '+' : '';
  return d.percent ? `${sign}${d.value.toFixed(1)}%` : `${sign}${d.value}`;
}

function formatValue(value: React.ReactNode): React.ReactNode {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  return value;
}

/** Delta pill (md/lg) — sentiment tint + directional arrow + optional label. */
function DeltaPill({ delta }: { delta: NormalizedDelta }) {
  const Arrow = DIRECTION_ICON[delta.direction];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-medium',
        SENTIMENT_TEXT[delta.sentiment],
        SENTIMENT_BG[delta.sentiment],
      )}
    >
      <Arrow className="h-3 w-3 shrink-0" aria-hidden />
      <span>
        {/* Isolate the numeric token so an RTL page never merges it with an
            adjacent label into a garbled run (e.g. "0" + "24h" → "024h"). */}
        <bdi>{formatDeltaValue(delta)}</bdi>
        {delta.label && (
          <bdi className="ms-1 text-muted-foreground">{delta.label}</bdi>
        )}
      </span>
    </span>
  );
}

/** Inline delta (sm) — plain sentiment-colored text beside the value. */
function DeltaInline({ delta }: { delta: NormalizedDelta }) {
  const Arrow = DIRECTION_ICON[delta.direction];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        SENTIMENT_TEXT[delta.sentiment],
      )}
    >
      <Arrow className="h-3 w-3 shrink-0" aria-hidden />
      <bdi>{formatDeltaValue(delta)}</bdi>
      {delta.label && <bdi className="ms-1 text-muted-foreground">{delta.label}</bdi>}
    </span>
  );
}

function ProgressRail({
  progress,
  progressLabel,
}: {
  progress: number;
  progressLabel?: string;
}) {
  const normalized = Math.max(0, Math.min(100, progress));
  return (
    <div className="mt-4 space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-overline font-medium text-muted-foreground">
        <span>{progressLabel ?? 'Share'}</span>
        <span className="tabular-nums">{Math.round(normalized)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-[var(--kpi-accent-resolved)] transition-[width] duration-normal ease-standard"
          style={{ width: `${normalized}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  unit,
  delta,
  icon: Icon,
  spark,
  badge,
  valueExtra,
  tone = 'neutral',
  themeClass,
  size = 'md',
  appearance = 'default',
  accent = false,
  loading = false,
  error = false,
  href,
  onAction,
  pressed,
  disabled = false,
  description,
  hint,
  helper,
  progress,
  progressLabel,
  detail,
  detailValue,
  className,
  style,
  ...props
}: StatTileProps) {
  const resolvedTheme = themeClass ?? TONE_THEME[tone];
  const isNeutral = !themeClass && tone === 'neutral';
  const normalizedDelta = delta !== undefined ? normalizeDelta(delta) : undefined;
  const hasProgress = typeof progress === 'number' && Number.isFinite(progress);
  const hasFooterMeta = Boolean(detail) || detailValue !== undefined;
  const isOperational = appearance === 'operational';
  const isActionable = Boolean(href || onAction);
  const statHint =
    hint ??
    description ??
    helper ??
    statisticHint(label, isActionable);
  // Opt-in colour wash (operational only): a whisper-tinted surface + a 3px top
  // strip, both derived from the tile's own `--kpi-accent-resolved`, so each
  // themed card reads as a distinct on-brand colour without any hard-coded hex.
  const accentStyle: React.CSSProperties =
    accent && isOperational
      ? {
          backgroundColor:
            'color-mix(in srgb, var(--kpi-accent-resolved) 9%, hsl(var(--ds-surface-card)))',
          borderTopColor: 'var(--kpi-accent-resolved)',
          borderTopWidth: '3px',
        }
      : {};
  const tileStyle: React.CSSProperties = {
    ...(isNeutral ? NEUTRAL_KPI_VARS : undefined),
    ...(isOperational ? OPERATIONAL_KPI_VARS : undefined),
    ...accentStyle,
    ...style,
  };

  /* ---- loading skeletons -------------------------------------------------- */
  if (loading) {
    if (size === 'sm') {
      return (
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border border-border bg-card/50 px-4 py-3',
            className,
          )}
          style={style}
          aria-busy="true"
        >
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        </div>
      );
    }
    return (
      <div
        className={cn(
          isOperational
            ? 'relative min-h-40 overflow-hidden rounded-xl border border-border/70 bg-card p-4 shadow-none'
            : 'kpi-card-themed',
          resolvedTheme || 'kpi-theme-primary',
          size === 'lg' && !isOperational && 'p-6',
          className,
        )}
        style={tileStyle}
        aria-busy="true"
      >
        <div className="mb-3 flex items-center gap-2.5">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="h-4 w-24 rounded-full" />
        </div>
        <Skeleton className="mb-2 h-9 w-28 rounded-xl" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }

  const displayValue = error ? (
    <span className="text-muted-foreground" title="Failed to load">
      —
    </span>
  ) : (
    formatValue(value)
  );

  /* ---- sm: dense inline strip --------------------------------------------- */
  if (size === 'sm') {
    const tile = (
      <div
        className={cn(
          'flex items-center gap-3 rounded-xl border border-border bg-card/50 px-4 py-3',
          isActionable &&
            'transition-[border-color,box-shadow] duration-fast ease-standard group-hover/stat:border-primary/30 group-hover/stat:shadow-elevation-2',
          className,
        )}
        style={style}
        title={statHint}
        {...props}
      >
        {Icon && <IconBadge icon={Icon} tone={TONE_ICON_BADGE[tone]} size="md" />}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-overline font-semibold uppercase text-muted-foreground">
            <span className="truncate">{label}</span>
            <CircleHelp className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          </p>
          <div className="flex flex-wrap items-baseline gap-2">
            {/* dir="ltr" keeps a value+unit measurement reading left-to-right
                (e.g. "0.0%") even on an RTL page, where the flex row would
                otherwise reverse it to "% 0.0". */}
            <bdi dir="ltr" className="inline-flex items-baseline gap-2">
              <span className="text-xl font-bold leading-tight tracking-tight text-foreground">
                {displayValue}
              </span>
              {unit && (
                <span className="text-xs font-medium text-muted-foreground">{unit}</span>
              )}
            </bdi>
            {normalizedDelta && !error && <DeltaInline delta={normalizedDelta} />}
            {valueExtra}
          </div>
          {helper && <p className="mt-0.5 truncate text-xs text-muted-foreground">{helper}</p>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
        {spark && <div className="shrink-0">{spark}</div>}
      </div>
    );
    return wrapInteractive(tile, { href, onAction, pressed, disabled, appearance });
  }

  /* ---- md / lg: themed card ------------------------------------------------ */
  const isLg = size === 'lg';
  const tile = (
    <div
      className={cn(
        isOperational
          ? 'group/stat-inner relative flex min-h-40 h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card p-4 shadow-none transition-[border-color,box-shadow] duration-fast ease-standard'
          : 'kpi-card-themed group/stat-inner flex h-full flex-col',
        resolvedTheme,
        isLg && !isOperational && 'p-6',
        isActionable &&
          (isOperational
            ? 'cursor-pointer group-hover/stat:border-primary/30 group-hover/stat:shadow-elevation-1'
            : 'cursor-pointer transition-transform duration-normal ease-standard motion-safe:group-hover/stat:-translate-y-0.5'),
        className,
      )}
      style={tileStyle}
      title={statHint}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-3">
          {isLg ? (
            <span className="inline-flex max-w-full items-center truncate rounded-full border border-border/50 bg-secondary/60 px-3 py-1 text-overline font-semibold leading-none text-muted-foreground">
              <span className="truncate">{label}</span>
              <CircleHelp className="ms-1 h-3 w-3 shrink-0 opacity-60" aria-hidden />
            </span>
          ) : (
            <p
              className="flex items-center gap-1 text-overline font-semibold uppercase"
              style={{ color: 'var(--kpi-accent)' }}
            >
              <span>{label}</span>
              <CircleHelp className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
            </p>
          )}
          <div className="flex flex-wrap items-baseline gap-2">
            {/* dir="ltr" keeps a value+unit measurement reading left-to-right
                (e.g. "0.0%") even on an RTL page, where the flex row would
                otherwise reverse it to "% 0.0". */}
            <bdi dir="ltr" className="inline-flex items-baseline gap-2">
              <span
                className={cn(
                  'font-display font-semibold tracking-tight text-foreground',
                  isLg ? 'text-h1 tabular-nums' : 'text-h2',
                )}
              >
                {displayValue}
              </span>
              {unit && !error && (
                <span
                  className={cn(
                    'font-medium text-muted-foreground',
                    isLg ? 'text-body-lg' : 'text-sm',
                  )}
                >
                  {unit}
                </span>
              )}
            </bdi>
            {valueExtra}
          </div>
        </div>
        {(Icon || badge || href) && (
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {badge}
              {Icon && (
                <div
                  className={cn(
                    'kpi-icon-badge shrink-0',
                    isLg && 'h-11 w-11 rounded-2xl',
                  )}
                >
                  <Icon className={cn(isLg ? 'h-5 w-5' : 'h-[18px] w-[18px]')} aria-hidden />
                </div>
              )}
            </div>
            {href && (
              <ExternalLink
                className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity duration-normal ease-standard group-hover/stat:opacity-100"
                aria-hidden
              />
            )}
          </div>
        )}
      </div>

      {normalizedDelta && !error && (
        <div className="mt-3">
          <DeltaPill delta={normalizedDelta} />
        </div>
      )}

      {description && !error && (
        <p className="mt-3 text-sm leading-5 text-muted-foreground">{description}</p>
      )}
      {helper && !error && <p className="mt-2 text-xs text-muted-foreground">{helper}</p>}

      {hasProgress && !error && (
        <ProgressRail progress={progress as number} progressLabel={progressLabel} />
      )}

      {spark && !error && (
        <div className="mt-auto flex items-center justify-end gap-3 pt-4">
          <div className="shrink-0">{spark}</div>
        </div>
      )}

      {hasFooterMeta && !error && (
        <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-xs">
          {detail ? <span className="text-muted-foreground">{detail}</span> : <span />}
          {detailValue !== undefined && (
            <span className="font-medium tabular-nums text-foreground">{detailValue}</span>
          )}
        </div>
      )}
    </div>
  );

  return wrapInteractive(tile, { href, onAction, pressed, disabled, appearance });
}

interface InteractiveTileOptions {
  href?: string;
  onAction?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  appearance: StatTileAppearance;
}

function wrapInteractive(
  tile: React.ReactElement,
  { href, onAction, pressed, disabled, appearance }: InteractiveTileOptions,
) {
  const wrapperClass = cn(
    'group/stat block h-full w-full text-start outline-none focus-visible:shadow-focus-ring',
    appearance === 'operational' ? 'rounded-xl' : 'rounded-2xl',
  );
  if (href) {
    return (
      <Link href={href} className={wrapperClass}>
        {tile}
      </Link>
    );
  }
  if (onAction) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={onAction}
        aria-pressed={pressed}
        disabled={disabled}
        className={cn(
          wrapperClass,
          'items-stretch justify-start whitespace-normal p-0 font-normal text-inherit hover:bg-transparent hover:text-inherit active:bg-transparent dark:text-inherit dark:hover:bg-transparent dark:hover:text-inherit',
          pressed && 'ring-2 ring-primary/60 shadow-elevation-1',
        )}
      >
        {tile}
      </Button>
    );
  }
  return tile;
}
