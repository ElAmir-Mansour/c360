'use client';

import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

import { cn } from '@/lib/utils';
import { useT } from '@/components/providers/locale-provider';
import {
  useSystemStatus,
  type SystemStatusValue,
} from '@/hooks/use-system-status';

// ---------------------------------------------------------------------------
// SecurityContext — presentational pieces for the auth surface (capability #20).
//
// Two independent, self-degrading widgets:
//   (a) <LastSignInNote>     — renders a "Last sign-in: ..." note from optional
//                              session metadata. Renders nothing if no data.
//   (b) <SystemStatusBadge>  — a live status dot + label driven by
//                              useSystemStatus(). Replaces the decorative
//                              "live" badge in the auth layout.
//
// Styling uses .auth-clario palette tokens (text-foreground, text-primary,
// bg-card, border-primary/*, brand-gold). No new ui primitives, no npm deps.
// ---------------------------------------------------------------------------

interface LastSignInNoteProps {
  /** ISO-8601 timestamp of the previous successful sign-in. */
  lastSignInAt?: string | null;
  /** IP address of the previous successful sign-in. */
  lastSignInIp?: string | null;
  className?: string;
}

function parseTimestamp(value: string): Date | null {
  // Accept both ISO strings and anything Date can parse; reject invalid dates.
  const iso = parseISO(value);
  if (isValid(iso)) return iso;
  const fallback = new Date(value);
  return isValid(fallback) ? fallback : null;
}

/**
 * LastSignInNote renders a compact "Last sign-in" line. It hides itself
 * entirely when no usable timestamp is provided, so callers can pass through
 * optional session metadata without guarding upstream.
 */
export function LastSignInNote({
  lastSignInAt,
  lastSignInIp,
  className,
}: LastSignInNoteProps) {
  const t = useT();
  if (!lastSignInAt) return null;

  const date = parseTimestamp(lastSignInAt);
  if (!date) return null;

  const absolute = format(date, "d MMM yyyy 'at' HH:mm");
  const relative = formatDistanceToNow(date, { addSuffix: true });
  const ip = lastSignInIp?.trim();

  return (
    <p
      className={cn(
        'text-[11px] leading-5 text-foreground/55',
        className,
      )}
    >
      <span className="font-medium text-foreground/70">{t('auth.securityContext.lastSignIn')}</span>{' '}
      <time dateTime={date.toISOString()} title={absolute}>
        {absolute}
      </time>{' '}
      <span className="text-foreground/45">({relative})</span>
      {ip ? (
        <>
          {' '}
          <span aria-hidden="true" className="text-foreground/30">
            ·
          </span>{' '}
          <span className="text-foreground/55">{t('auth.securityContext.from')} {ip}</span>
        </>
      ) : null}
    </p>
  );
}

interface SystemStatusBadgeProps {
  /** Optional human-readable labels per status (e.g. i18n strings). */
  labels?: Partial<Record<SystemStatusValue, string>>;
  /** Optional accessible name for the live region (e.g. i18n "System status"). */
  ariaLabel?: string;
  className?: string;
}

const DEFAULT_STATUS_LABELS: Record<SystemStatusValue, string> = {
  operational: 'All systems operational',
  degraded: 'Degraded performance',
  unknown: 'Status unavailable',
};

// Token-driven styling per status. `unknown` is intentionally muted/neutral so
// a missing backend reads as "no signal", not as an alarm.
const STATUS_STYLES: Record<
  SystemStatusValue,
  { container: string; dot: string; pulse: boolean }
> = {
  operational: {
    container: 'border-primary/30 bg-primary/10 text-primary',
    dot: 'bg-primary',
    pulse: true,
  },
  degraded: {
    container: 'border-brand-gold/50 bg-brand-gold/15 text-brand-gold-dark',
    dot: 'bg-brand-gold',
    pulse: true,
  },
  unknown: {
    container: 'border-primary/15 bg-secondary/70 text-foreground/55',
    dot: 'bg-foreground/30',
    pulse: false,
  },
};

/**
 * SystemStatusBadge consumes useSystemStatus() and renders a colored live dot
 * plus a label. It mirrors the geometry of the prior decorative "live" badge
 * (pill + 1.5px dot) so it can drop into the auth layout in its place.
 *
 * Motion: the dot pulses only when `motion-safe` (respects
 * prefers-reduced-motion) and only for active states.
 */
export function SystemStatusBadge({ labels, ariaLabel, className }: SystemStatusBadgeProps) {
  const { status } = useSystemStatus();
  const styles = STATUS_STYLES[status];
  const label = labels?.[status] ?? DEFAULT_STATUS_LABELS[status];

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-overline font-medium uppercase tracking-caps-xwide',
        styles.container,
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {styles.pulse ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping motion-reduce:hidden',
              styles.dot,
            )}
          />
        ) : null}
        <span
          aria-hidden="true"
          className={cn(
            'relative inline-flex h-1.5 w-1.5 rounded-full',
            styles.dot,
          )}
        />
      </span>
      <span>{label}</span>
    </span>
  );
}

/**
 * SecurityContext is a thin convenience wrapper that stacks the security
 * metadata note above the system-status badge. Both children self-hide /
 * self-degrade, so this renders cleanly even with no session metadata.
 */
interface SecurityContextProps {
  lastSignInAt?: string | null;
  lastSignInIp?: string | null;
  statusLabels?: Partial<Record<SystemStatusValue, string>>;
  statusAriaLabel?: string;
  className?: string;
}

export function SecurityContext({
  lastSignInAt,
  lastSignInIp,
  statusLabels,
  statusAriaLabel,
  className,
}: SecurityContextProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <SystemStatusBadge labels={statusLabels} ariaLabel={statusAriaLabel} />
      <LastSignInNote lastSignInAt={lastSignInAt} lastSignInIp={lastSignInIp} />
    </div>
  );
}
