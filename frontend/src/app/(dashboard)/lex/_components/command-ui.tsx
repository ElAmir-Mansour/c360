'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

/**
 * Shared presentational primitives for the Watheeq Legal-Affairs command center
 * (`/lex`). Every command-center section composes these so the whole page reads
 * as ONE upgraded system — a single section-shell, header, KPI, list-row, tile
 * and empty-state vocabulary.
 *
 * Hard rules honoured throughout:
 *   - TOKEN-ONLY. Semantic Tailwind utilities + the `--ds-*` scale; no raw
 *     hex/px colour, spacing, radius, shadow or motion. SVG stroke colours that
 *     cannot read a class resolve through `@/lib/design-tokens` (`statusVar`).
 *   - BILINGUAL / RTL. No user-visible copy is hardcoded — every label is a
 *     prop supplied by the calling section (which pulls from `useLexLabels()`).
 *     Numeric display strings are passed in pre-formatted by the caller (via
 *     `useLexFormat()`), or formatted through an injected `formatValue`, so
 *     Arabic-Indic numerals are preserved. Logical spacing (`me-`/`ms-`,
 *     `start`/`end`) mirrors under `dir="rtl"`.
 *   - LIGHT / DARK via tokens only; WCAG AA (icon + label, never colour alone;
 *     visible focus rings); motion gated behind `motion-safe:`.
 *
 * These are intentionally small and composable. They own look-and-feel only —
 * no data fetching, no i18n catalog access.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Info,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { IconBadge } from '@/components/shared/icon-badge';
import { ListRow } from '@/components/shared/list-row';
import { TrendSparkline } from '@/components/shared/trend-sparkline';
import { statusVar, type StatusTone } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------------- *
 * Tone vocabulary — the single source of truth every primitive maps through.
 * ------------------------------------------------------------------------- */

/** Semantic tone shared by StatBlock / tiles / rows. */
export type CommandTone =
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral';

/** IconBadge uses `danger` where the semantic tone is `error`; else 1:1. */
type IconBadgeTone =
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted';

const TONE_TO_ICON_BADGE: Record<CommandTone, IconBadgeTone> = {
  primary: 'primary',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'muted',
};

/** Foreground text colour for a tone (AA on card in light + dark). */
const TONE_TO_TEXT: Record<CommandTone, string> = {
  primary: 'text-primary',
  info: 'text-status-info',
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-muted-foreground',
};

/** Quiet tonal washes used by persona quick links; all preserve card contrast. */
const TONE_TO_QUICK_ACTION_SURFACE: Record<CommandTone, string> = {
  primary:
    'bg-card hover:bg-[var(--lex-landing-tint)]/30',
  info:
    'bg-card hover:bg-status-info/[0.08]',
  success:
    'bg-card hover:bg-status-success/[0.08]',
  warning:
    'bg-card hover:bg-status-warning/[0.08]',
  error:
    'bg-card hover:bg-status-error/[0.08]',
  neutral:
    'bg-card hover:bg-[var(--lex-landing-tint)]/30',
};

/** Quiet tonal washes used by opt-in stats and legal-domain navigation tiles. */
const TONE_TO_TINTED_SURFACE: Record<CommandTone, string> = {
  primary:
    'border-border bg-card hover:border-primary/30 hover:bg-[var(--lex-landing-tint)]/30',
  info:
    'border-status-info/25 bg-card hover:border-status-info/30 hover:bg-status-info/[0.08]',
  success:
    'border-status-success/25 bg-card hover:border-status-success/30 hover:bg-status-success/[0.08]',
  warning:
    'border-status-warning/25 bg-card hover:border-status-warning/30 hover:bg-status-warning/[0.08]',
  error:
    'border-status-error/25 bg-card hover:border-status-error/30 hover:bg-status-error/[0.08]',
  neutral:
    'border-border bg-card hover:border-primary/30 hover:bg-[var(--lex-landing-tint)]/30',
};

/**
 * Resolve a tone to a CSS colour string for SVG/inline contexts. Re-themes in
 * dark mode (var-backed). Brand primary + neutral fall outside the status ramp.
 */
function toneColor(tone: CommandTone): string {
  if (tone === 'primary') return 'hsl(var(--primary))';
  if (tone === 'neutral') return 'hsl(var(--muted-foreground))';
  return statusVar(tone as StatusTone);
}

/** Shared interactive treatment: motion-safe hover lift + visible focus ring. */
const INTERACTIVE_CLASS = cn(
  'cursor-pointer outline-none',
  'transition-[transform,box-shadow,border-color,background-color] duration-fast ease-standard',
  'hover:border-primary/30 hover:shadow-elevation-2',
  'focus-visible:border-primary/40 focus-visible:shadow-focus-ring',
);

/* ------------------------------------------------------------------------- *
 * CommandCard — the premium section shell.
 * ------------------------------------------------------------------------- */

export type CommandAccent = 'primary' | 'teal' | 'gold' | 'neutral';

const ACCENT_HAIRLINE: Record<Exclude<CommandAccent, 'neutral'>, string> = {
  primary: 'bg-primary/40',
  teal: 'bg-brand-teal/50',
  gold: 'bg-brand-gold/50',
};

export interface CommandCardProps
  extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
  className?: string;
  /** Polymorphic root (e.g. `Link`, `'section'`, `'article'`). Defaults `div`. */
  as?: React.ElementType;
  /** Optional faint top hairline / brand wash. `neutral` = no accent. */
  accent?: CommandAccent;
  /** Adds motion-safe hover lift + focus-visible ring (make the root focusable). */
  interactive?: boolean;
  /** Present so `as={Link}` call sites can pass an href without `any`. */
  href?: string;
}

/**
 * The one section shell for the command center: `bg-card`, `rounded-softest`,
 * `border-border`, resting `shadow-elevation-1`, `overflow-hidden`, with an
 * optional accent hairline. Interactive variants lift on hover (motion-safe)
 * and expose a focus ring.
 */
export function CommandCard({
  children,
  className,
  as,
  accent = 'neutral',
  interactive = false,
  ...rest
}: CommandCardProps) {
  const Comp = as ?? 'div';
  return (
    <Comp
      className={cn(
        'relative overflow-hidden rounded-softest border border-border bg-card p-5 shadow-elevation-1 sm:p-6',
        interactive && INTERACTIVE_CLASS,
        className,
      )}
      {...rest}
    >
      {accent !== 'neutral' ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-px',
            ACCENT_HAIRLINE[accent],
          )}
        />
      ) : null}
      {children}
    </Comp>
  );
}

/* ------------------------------------------------------------------------- *
 * SectionHeader — overline eyebrow + title + description + trailing action.
 * ------------------------------------------------------------------------- */

export interface SectionHeaderProps {
  /** Small uppercase eyebrow above the title. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Trailing slot — an action button or "view all" link. RTL-safe. */
  action?: React.ReactNode;
  /** Optional leading icon rendered in a tonal IconBadge. */
  icon?: LucideIcon;
  /** Tone for the leading icon badge. */
  tone?: CommandTone;
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  icon,
  tone = 'primary',
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 text-start',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <IconBadge icon={icon} tone={TONE_TO_ICON_BADGE[tone]} size="md" />
        ) : null}
        <div className="min-w-0 space-y-1">
          {eyebrow ? (
            <p className="text-overline uppercase tracking-caps text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="text-h3 font-semibold leading-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="text-body-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * StatBlock — a modern KPI cell.
 * ------------------------------------------------------------------------- */

export interface StatDelta {
  /** Signed value; sign drives the arrow + tone (positive = up/success). */
  value: number;
  /** Pre-formatted, locale-aware label (e.g. "+12%"). Falls back to `value`. */
  label?: string;
}

export interface StatBlockProps {
  label: string;
  /** Pre-formatted, locale-aware display value (string) or a number/JSX. */
  value: React.ReactNode;
  icon: LucideIcon;
  tone?: CommandTone;
  delta?: StatDelta;
  /** Inline sparkline series (already locale-labelled by the caller). */
  trend?: { label: string; value: number }[];
  /** When set the whole block becomes a focusable link with hover-lift. */
  href?: string;
  isLoading?: boolean;
  /** Adds a quiet tone-matched border and background wash. */
  tinted?: boolean;
  className?: string;
}

export function StatBlock({
  label,
  value,
  icon,
  tone = 'neutral',
  delta,
  trend,
  href,
  isLoading = false,
  tinted = false,
  className,
}: StatBlockProps) {
  const deltaUp = delta ? delta.value >= 0 : false;
  const DeltaIcon = deltaUp ? TrendingUp : TrendingDown;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <IconBadge icon={icon} tone={TONE_TO_ICON_BADGE[tone]} size="md" />
        {delta ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium tabular-nums',
              deltaUp
                ? 'bg-status-success/10 text-status-success'
                : 'bg-status-error/10 text-status-error',
            )}
          >
            <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
            {delta.label ?? String(delta.value)}
          </span>
        ) : null}
      </div>

      <div className="mt-4 space-y-1">
        {isLoading ? (
          <Skeleton className="h-8 w-16 rounded-soft" />
        ) : (
          <p
            className={cn(
              'text-h1 font-semibold leading-none tabular-nums',
              tinted ? TONE_TO_TEXT[tone] : 'text-foreground',
            )}
          >
            {value}
          </p>
        )}
        <p className="text-caption text-muted-foreground">{label}</p>
      </div>

      {trend && trend.length > 1 ? (
        <TrendSparkline
          data={trend}
          height={32}
          color={toneColor(tone)}
          className="mt-3"
        />
      ) : null}
    </>
  );

  const shell = cn(
    'block rounded-softest border border-border bg-card p-5 text-start shadow-elevation-1',
    href && INTERACTIVE_CLASS,
    tinted && TONE_TO_TINTED_SURFACE[tone],
    className,
  );

  if (href) {
    return (
      <Link href={href} className={shell} title={statisticHint(label)}>
        {body}
      </Link>
    );
  }
  return <div className={shell} title={statisticHint(label, false)}>{body}</div>;
}

/* ------------------------------------------------------------------------- *
 * ScoreGauge — a clean radial score gauge (full track ring, never empty-look).
 * ------------------------------------------------------------------------- */

/** Settle delay so the arc sweeps from empty to the live value on mount. */
const GAUGE_SETTLE_MS = 60;

export interface ScoreGaugeProps {
  value: number;
  max?: number;
  /** Unit rendered after the centered value (e.g. "%"). */
  unit?: string;
  /** Percentage thresholds (of `max`) for the value-arc tone. */
  thresholds?: { good: number; warning: number };
  /** Diameter in px. */
  size?: number;
  /** Accessible label for the gauge (not rendered visibly). */
  label: string;
  /** Locale-aware formatter for the centered value (Arabic-Indic numerals). */
  formatValue?: (value: number) => string;
  className?: string;
}

export function ScoreGauge({
  value,
  max = 100,
  unit,
  thresholds = { good: 80, warning: 60 },
  size = 120,
  label,
  formatValue,
  className,
}: ScoreGaugeProps) {
  const [animated, setAnimated] = React.useState(0);

  React.useEffect(() => {
    const timer = setTimeout(() => setAnimated(value), GAUGE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const strokeWidth = Math.max(6, Math.round(size * 0.08));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(Math.max(animated / max, 0), 1);
  const offset = circumference * (1 - pct);

  const valuePct = (value / max) * 100;
  const tone: CommandTone =
    valuePct >= thresholds.good
      ? 'success'
      : valuePct >= thresholds.warning
        ? 'warning'
        : 'error';
  const arcColor = toneColor(tone);

  const display = formatValue ? formatValue(value) : String(Math.round(value));

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(Math.max(value, 0), max)}
      aria-valuetext={`${display}${unit ?? ''}`}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Full track ring — always visible so 0% never looks broken. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={strokeWidth}
        />
        {/* Value arc — tone by threshold, round caps, top-anchored. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="motion-safe:[transition:stroke-dashoffset_var(--ds-duration-slow)_var(--ds-ease-decelerate),stroke_var(--ds-duration-slow)_var(--ds-ease-decelerate)]"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-h2 font-semibold leading-none tabular-nums text-foreground">
          {display}
          {unit ? (
            <span className="ms-0.5 text-body font-medium text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * SeverityRow — a polished worklist row.
 * ------------------------------------------------------------------------- */

export type RowSeverity =
  | 'critical'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'success';

const SEVERITY_TO_TONE: Record<RowSeverity, CommandTone> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
  neutral: 'neutral',
  success: 'success',
};

const SEVERITY_DEFAULT_ICON: Record<RowSeverity, LucideIcon> = {
  critical: AlertTriangle,
  warning: AlertCircle,
  info: Info,
  neutral: Circle,
  success: CheckCircle2,
};

export interface SeverityRowProps {
  severity: RowSeverity;
  /** Overrides the default per-severity icon. */
  icon?: LucideIcon;
  title: React.ReactNode;
  /** Muted meta line (tabular-nums). */
  meta?: React.ReactNode;
  /** Trailing slot — a status chip, badge, or relative-time stamp. */
  trailing?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Built on the canonical {@link ListRow} for a unified hover/focus/accent look.
 * The severity is conveyed by BOTH the accent strip colour and a tone icon
 * (never colour alone), satisfying AA.
 */
export function SeverityRow({
  severity,
  icon,
  title,
  meta,
  trailing,
  href,
  onClick,
  className,
}: SeverityRowProps) {
  const tone = SEVERITY_TO_TONE[severity];
  const Icon = icon ?? SEVERITY_DEFAULT_ICON[severity];

  return (
    <ListRow
      href={href}
      onClick={onClick}
      leadingAccent
      accentColor={toneColor(tone)}
      leading={<IconBadge icon={Icon} tone={TONE_TO_ICON_BADGE[tone]} size="sm" />}
      title={title}
      subtitle={
        meta != null ? (
          <span className="tabular-nums">{meta}</span>
        ) : undefined
      }
      trailing={trailing}
      className={className}
    />
  );
}

/* ------------------------------------------------------------------------- *
 * DomainTileCard / TilePill — a modern domain entry tile.
 * ------------------------------------------------------------------------- */

export interface DomainTileCardProps {
  icon: LucideIcon;
  name: string;
  /** Pre-formatted, locale-aware count (string/JSX), or omitted / `—`. */
  count?: React.ReactNode;
  href: string;
  tone?: CommandTone;
  className?: string;
}

export function DomainTileCard({
  icon,
  name,
  count,
  href,
  tone = 'primary',
  className,
}: DomainTileCardProps) {
  return (
    <Link
      href={href}
      aria-label={name}
      className={cn(
        'group flex items-center gap-3 rounded-softest border p-4 shadow-elevation-1',
        INTERACTIVE_CLASS,
        TONE_TO_TINTED_SURFACE[tone],
        className,
      )}
    >
      <IconBadge icon={icon} tone={TONE_TO_ICON_BADGE[tone]} size="md" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-sm font-medium text-foreground" title={name}>
          {name}
        </span>
        {count != null ? (
          <span
            className={cn(
              'mt-0.5 text-h3 font-semibold leading-none tabular-nums',
              TONE_TO_TEXT[tone],
            )}
          >
            {count}
          </span>
        ) : null}
      </span>
      <ArrowRight
        className={cn(
          'h-4 w-4 shrink-0 opacity-70 transition-[transform,color,opacity] duration-fast ease-standard rtl:-scale-x-100 group-hover:opacity-100 motion-safe:group-hover:translate-x-0.5 motion-safe:rtl:group-hover:-translate-x-0.5',
          TONE_TO_TEXT[tone],
        )}
        aria-hidden
      />
    </Link>
  );
}

/** Alias — the domain-tile primitive is also referenced as `TilePill`. */
export const TilePill = DomainTileCard;

/* ------------------------------------------------------------------------- *
 * QuickActionCard — a role quick-link card (for PersonaHome).
 * ------------------------------------------------------------------------- */

export interface QuickActionCardProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  href: string;
  tone?: CommandTone;
  className?: string;
}

export function QuickActionCard({
  icon,
  title,
  description,
  href,
  tone = 'primary',
  className,
}: QuickActionCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex min-h-20 items-center gap-3 rounded-softest border border-border p-4 text-start shadow-elevation-1',
        TONE_TO_QUICK_ACTION_SURFACE[tone],
        INTERACTIVE_CLASS,
        className,
      )}
    >
      <IconBadge icon={icon} tone={TONE_TO_ICON_BADGE[tone]} size="md" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-sm font-semibold text-foreground" title={title}>
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 line-clamp-2 text-caption text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <ArrowRight
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-[transform,color] duration-fast ease-standard rtl:-scale-x-100 group-hover:text-primary motion-safe:group-hover:translate-x-0.5 motion-safe:rtl:group-hover:-translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}

/* ------------------------------------------------------------------------- *
 * EmptyState — a premium, centered empty state.
 * ------------------------------------------------------------------------- */

export interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-soft border border-dashed border-border bg-muted/30 px-6 py-10 text-center',
        className,
      )}
    >
      <IconBadge icon={icon} tone="muted" size="lg" />
      <div className="space-y-1">
        <p className="text-h4 font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-body-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        action.href ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={action.onClick}>
            {action.label}
          </Button>
        )
      ) : null}
    </div>
  );
}
