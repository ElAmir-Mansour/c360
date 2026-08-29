import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Info,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * FeedbackState — THE single, consistent full-region state primitive for the
 * platform: loading, success, warning, error, info and empty all rendered
 * through one token-only, RTL-/dark-/AA-safe scaffold (tinted icon disc,
 * title, description, up to two actions), so pages stop hand-rolling a slightly
 * different centered stack for every zero/loading/error case.
 *
 * Bilingual-agnostic: the caller passes already-localized strings — this
 * component never hard-codes copy.
 *
 * Status is NEVER conveyed by colour alone: each tone pairs its colour token
 * with a distinct icon shape AND the title/description text, and the region
 * carries the right ARIA role (`alert` for warning/error, `status` for
 * loading/success/info) so assistive tech is informed independent of hue.
 *
 * ── Relationship to the existing state components (all still valid) ──────────
 * This is the unified base the older components can be *expressed in terms of*;
 * they are intentionally NOT deleted (large blast radius) but map cleanly onto
 * a tone:
 *   • common/empty-state `EmptyState`        → `tone="empty"` (+ its built-in
 *     decorative illustrations, which this primitive does not reproduce).
 *   • common/error-state `ErrorState`        → `tone="error" | "warning"` per
 *     its detected variant (its 401/403 path stays on `ForbiddenState`).
 *   • common/forbidden-state `ForbiddenState`→ a bespoke 403 (lock art +
 *     request-access CTA); keep as-is, it is richer than a generic tone.
 *   • shared/section-empty `SectionEmpty`    → `tone="empty" size="compact"`.
 *   • common/route-error `RouteError`        → `tone="error"` inside the Next
 *     error-boundary contract.
 * New code should prefer this primitive; the above remain for their extra
 * behaviour and to avoid churning ~dozens of call sites.
 */

export type FeedbackTone =
  | 'loading'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'empty';

export interface FeedbackAction {
  label: string;
  href?: string;
  onClick?: () => void;
  /** Optional leading icon for the action button. */
  icon?: LucideIcon;
}

export interface FeedbackStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Semantic tone — drives the default icon, colour token and ARIA role. */
  tone?: FeedbackTone;
  /** Override the tone's default icon (e.g. a domain-specific Lucide glyph). */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Primary (solid) action. */
  action?: FeedbackAction;
  /** Lower-emphasis (outline) action shown beside the primary one. */
  secondaryAction?: FeedbackAction;
  /** `compact` tightens spacing for inline / in-card use. */
  size?: 'default' | 'compact';
  /** Extra content rendered below the description (e.g. a Skeleton block). */
  children?: React.ReactNode;
  className?: string;
}

interface ToneConfig {
  icon: LucideIcon;
  /** Tinted disc chrome — background + icon colour + subtle ring, token-only. */
  disc: string;
  /** Whether this tone should announce assertively (`alert`) vs politely. */
  role: 'alert' | 'status' | undefined;
  /** Spin the icon (loading only), gated behind `motion-safe:`. */
  spin?: boolean;
}

const TONES: Record<FeedbackTone, ToneConfig> = {
  loading: {
    icon: Loader2,
    disc: 'bg-muted text-muted-foreground ring-1 ring-border/60',
    role: 'status',
    spin: true,
  },
  success: {
    icon: CheckCircle2,
    disc: 'bg-status-success/10 text-status-success ring-1 ring-status-success/20',
    role: 'status',
  },
  warning: {
    icon: AlertTriangle,
    disc: 'bg-status-warning/10 text-status-warning ring-1 ring-status-warning/25',
    role: 'alert',
  },
  error: {
    icon: AlertCircle,
    disc: 'bg-status-error/10 text-status-error ring-1 ring-status-error/25',
    role: 'alert',
  },
  info: {
    icon: Info,
    disc: 'bg-status-info/10 text-status-info ring-1 ring-status-info/20',
    role: 'status',
  },
  empty: {
    icon: Inbox,
    disc: 'bg-muted/70 text-muted-foreground ring-1 ring-border/60',
    role: undefined,
  },
};

function FeedbackActionButton({
  action,
  variant,
}: {
  action: FeedbackAction;
  variant?: 'default' | 'outline';
}) {
  const Icon = action.icon;
  const content = (
    <>
      {Icon && <Icon className="me-2 h-4 w-4" aria-hidden />}
      {action.label}
    </>
  );
  if (action.href) {
    return (
      <Button asChild size="sm" variant={variant}>
        <Link href={action.href}>{content}</Link>
      </Button>
    );
  }
  return (
    <Button size="sm" variant={variant} onClick={action.onClick}>
      {content}
    </Button>
  );
}

/**
 * The unified state region. Token-only, RTL-safe (logical `me-` spacing,
 * centered layout), dark-mode correct via semantic tokens, and reduced-motion
 * aware (entrance + spinner gated behind `motion-safe:`).
 */
export function FeedbackState({
  tone = 'empty',
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'default',
  children,
  className,
  ...props
}: FeedbackStateProps) {
  const compact = size === 'compact';
  const config = TONES[tone];
  const Icon = icon ?? config.icon;

  return (
    <div
      role={config.role}
      aria-busy={tone === 'loading' || undefined}
      aria-live={config.role === 'status' ? 'polite' : undefined}
      className={cn(
        'flex flex-col items-center justify-center text-center motion-safe:animate-fade-up',
        compact ? 'px-4 py-10' : 'px-6 py-16',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'mb-4 grid place-items-center rounded-full',
          config.disc,
          compact ? 'h-14 w-14' : 'h-20 w-20',
        )}
      >
        <Icon
          className={cn(
            compact ? 'h-6 w-6' : 'h-9 w-9',
            config.spin && 'motion-safe:animate-spin',
          )}
          aria-hidden
        />
      </div>
      <h3
        className={cn(
          'font-semibold text-foreground',
          compact ? 'text-base' : 'text-h4',
        )}
      >
        {title}
      </h3>
      {description && (
        <p className="mt-2 max-w-sm text-body-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      {children && <div className="mt-4 w-full">{children}</div>}
      {(action || secondaryAction) && (
        <div
          className={cn(
            'flex flex-wrap items-center justify-center gap-3',
            compact ? 'mt-4' : 'mt-6',
          )}
        >
          {action && <FeedbackActionButton action={action} />}
          {secondaryAction && (
            <FeedbackActionButton action={secondaryAction} variant="outline" />
          )}
        </div>
      )}
    </div>
  );
}
